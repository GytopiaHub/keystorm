import { CONFIG, comboMultiplier, comboTierIndex, levelParams, levelReward, type GameConfig, type GameplayConfig } from './config';
import { Rng, randomSeed } from './rng';
import {
  SKILL_IDS,
  type ActiveEffect,
  type AttemptResult,
  type ClearCause,
  type CoinBreakdown,
  type Difficulty,
  type EngineEvent,
  type LevelParams,
  type PileRow,
  type SkillId,
  type SkillTiers,
  type UpgradeRanks,
  type Word,
  type WordKind,
  type WordListId,
} from './types';
import { SKILL_BEHAVIOURS } from './skills';
import { WordBank } from './words';

export interface EngineOptions {
  level: number;
  skills: SkillTiers;
  upgrades: UpgradeRanks;
  seed?: number;
  difficulty?: Difficulty;
  wordList?: WordListId;
  config?: GameConfig;
  wordBank?: WordBank;
}

export type EngineStatus = 'playing' | 'complete' | 'failed';

export interface HudSnapshot {
  level: number;
  score: number;
  quota: number;
  coins: number;
  combo: number;
  multiplier: number;
  pool: SkillId[];
  capacity: number;
  effects: { skill: SkillId; remaining: number; duration: number }[];
  pileRows: number;
  dangerRows: number;
  status: EngineStatus;
}

/** How long instant skills show their weather, in seconds. */
const INSTANT_WEATHER = 1.6;

let sharedBank: WordBank | null = null;
const defaultBank = () => (sharedBank ??= WordBank.fromBuckets());

/**
 * The whole game simulation for one attempt. It never touches the DOM, so it runs headless
 * in tests; the renderer and UI read its public state and drain its events.
 */
export class GameEngine {
  static readonly STEP = 1 / 120;

  readonly config: GameConfig;
  readonly params: LevelParams;
  readonly skills: SkillTiers;
  readonly upgrades: UpgradeRanks;

  status: EngineStatus = 'playing';
  words: Word[] = [];
  pile: PileRow[] = [];
  buffer = '';
  score = 0;
  combo = 0;
  maxCombo = 0;
  pool: SkillId[] = [];
  /** Timed skills currently running, keyed by skill. */
  effects: Partial<Record<SkillId, ActiveEffect>> = {};
  elapsed = 0;
  /** Bumped on every discrete state change so the UI can skip redundant HUD updates. */
  version = 0;

  mistakes = 0;
  correctSubmissions = 0;
  correctChars = 0;
  wordsCleared = 0;
  skillsUsed: Partial<Record<SkillId, number>> = {};

  /** Coin amounts before the coin-bonus multiplier. */
  private coinBase = { words: 0, coinWords: 0, level: 0, perfect: 0 };
  private rng: Rng;
  private bank: WordBank;
  private events: EngineEvent[] = [];
  private spawnTimer = 0.6;
  private nextId = 1;
  private accumulator = 0;

  constructor(opts: EngineOptions) {
    this.config = opts.config ?? CONFIG;
    this.field = { ...this.config.gameplay.field };
    this.params = levelParams(opts.level, opts.difficulty, opts.wordList, this.config);
    this.skills = { ...opts.skills };
    this.upgrades = { ...opts.upgrades };
    this.rng = new Rng(opts.seed ?? randomSeed());
    this.bank = opts.wordBank ?? defaultBank();
  }

  // ---- derived values ------------------------------------------------------------------

  /**
   * Play-field geometry. Starts as the configured size; `fitField` can reshape it to fill the
   * screen before play begins.
   */
  field: GameplayConfig['field'];

  /** Field height relative to the configured one; distances and speeds scale by this. */
  get heightScale(): number {
    return this.field.height / this.config.gameplay.field.height;
  }

  /**
   * Reshape the field to `width` × `height` (logical pixels) before the attempt starts.
   * Fall speed and pile rows scale with the height, so fall time and pile capacity match any
   * screen; a wider field only spreads words out. Returns false once play has begun.
   */
  fitField(width: number, height: number): boolean {
    if (this.elapsed > 0 || this.words.length || this.pile.length) return false;
    const base = this.config.gameplay.field;
    const k = height / base.height;
    this.field = { ...base, width: Math.round(width), height: Math.round(height), rowHeight: base.rowHeight * k };
    this.version++;
    return true;
  }

  get capacity(): number {
    return this.config.gameplay.chargePool.baseCapacity + this.upgradeValue('chargeCapacity');
  }

  get dangerRows(): number {
    return this.field.baseDangerRows + this.upgradeValue('reinforcedFloor');
  }

  /**
   * Height each landed word adds. Reinforced floor fits more rows under the same danger line
   * by packing them tighter, rather than raising the line (a taller pile would shorten every
   * word's fall and make things worse).
   */
  get rowHeight(): number {
    return (this.field.rowHeight * this.field.baseDangerRows) / this.dangerRows;
  }

  /** Y at which a falling word's bottom edge touches the pile (FR-13). */
  get landingY(): number {
    return this.field.height - this.pile.length * this.rowHeight;
  }

  get dangerY(): number {
    return this.field.height - this.field.baseDangerRows * this.field.rowHeight;
  }

  get multiplier(): number {
    return comboMultiplier(this.combo, this.config);
  }

  get coinMultiplier(): number {
    return 1 + this.upgradeValue('coinBonus');
  }

  get coins(): CoinBreakdown {
    const m = this.coinMultiplier;
    const words = Math.round(this.coinBase.words * m);
    const coinWords = Math.round(this.coinBase.coinWords * m);
    const level = Math.round(this.coinBase.level * m);
    const perfect = Math.round(this.coinBase.perfect * m);
    return { words, coinWords, level, perfect, total: words + coinWords + level + perfect };
  }

  private upgradeValue(id: keyof UpgradeRanks): number {
    return (this.upgrades[id] ?? 0) * this.config.upgrades[id].perRank;
  }

  unlockedSkills(): SkillId[] {
    return SKILL_IDS.filter((s) => this.skills[s] > 0);
  }

  // ---- loop ----------------------------------------------------------------------------

  /** Advance by real elapsed time using fixed steps (NFR-04). */
  advance(realDt: number): void {
    this.accumulator += Math.min(Math.max(realDt, 0), 0.25);
    while (this.accumulator >= GameEngine.STEP && this.status === 'playing') {
      this.step(GameEngine.STEP);
      this.accumulator -= GameEngine.STEP;
    }
  }

  step(dt: number): void {
    if (this.status !== 'playing') return;
    this.elapsed += dt;

    for (const key of Object.keys(this.effects) as SkillId[]) {
      const e = this.effects[key]!;
      e.remaining -= dt;
      if (e.remaining <= 0) {
        delete this.effects[key];
        this.version++;
      }
    }

    if (!this.frozen) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        // When there's no room, retry shortly instead of waiting a full interval.
        this.spawnTimer = this.trySpawn() ? this.spawnTimer + this.params.spawnInterval : 0.1;
      }
      this.moveWords(dt);
    }
  }

  /** Active timed skills with their behaviour and tier numbers. */
  private activeTimed() {
    return (Object.keys(this.effects) as SkillId[]).map((skill) => ({
      timed: SKILL_BEHAVIOURS[skill].timed ?? {},
      tier: this.tierDef(skill, this.effects[skill]!.tier),
    }));
  }

  /** True while a freezing skill (ICE) runs: nothing falls or spawns. */
  get frozen(): boolean {
    return this.activeTimed().some((e) => e.timed.freezes);
  }

  private fallSpeed(): number {
    let speed = this.params.fallSpeed * this.heightScale;
    for (const e of this.activeTimed()) if (e.timed.speed) speed *= e.timed.speed(e.tier);
    return speed;
  }

  private moveWords(dt: number): void {
    const speed = this.fallSpeed();
    const h = this.field.wordHeight;
    for (const word of [...this.words]) {
      word.y += speed * word.speedMul * dt;
      if (word.y + h >= this.landingY) this.land(word);
      if (this.status !== 'playing') return;
    }
  }

  // ---- spawning ------------------------------------------------------------------------

  private trySpawn(): boolean {
    const f = this.field;
    if (this.words.length >= f.maxWords) return false;

    const p = this.params;
    const unlocked = this.unlockedSkills();
    const chargeChance = p.chargeWordChance * (1 + this.upgradeValue('luckyDraw'));
    let kind: WordKind = 'normal';
    let skill: SkillId | undefined;
    const roll = this.rng.next();
    if (roll < p.blackChance) kind = 'black';
    else if (roll < p.blackChance + p.coinWordChance) kind = 'coin';
    else if (unlocked.length && roll < p.blackChance + p.coinWordChance + chargeChance) {
      kind = 'charge';
      skill = this.rng.pick(unlocked);
    }

    const taken = new Set<string>();
    for (const w of this.words) {
      taken.add(w.text);
      taken.add(w.original);
    }
    const text = this.bank.pick(this.rng, p.wordLengthRange[0], p.wordLengthRange[1], (w) => taken.has(w));
    if (!text) return false;

    const width = this.wordWidth(text, kind);
    const band = this.words.filter((w) => w.y < f.spawnBandHeight);
    const margin = 8;
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = this.rng.range(width / 2 + margin, f.width - width / 2 - margin);
      const overlaps = band.some((o) => Math.abs(o.x - x) < (width + o.width) / 2 + 6);
      if (overlaps) continue;
      this.words.push({ id: this.nextId++, text, original: text, kind, skill, x, y: 0, width, speedMul: 1 });
      this.version++;
      return true;
    }
    return false;
  }

  wordWidth(text: string, kind: WordKind): number {
    const f = this.field;
    const icon = kind === 'normal' ? 0 : 26;
    return text.length * f.charWidth + f.wordPadding + icon;
  }

  /** Test hook: place a specific word on the field. */
  addWord(text: string, opts: Partial<Omit<Word, 'id' | 'text' | 'original'>> = {}): Word {
    const kind = opts.kind ?? 'normal';
    const word: Word = {
      id: this.nextId++,
      text,
      original: text,
      kind,
      skill: opts.skill,
      x: opts.x ?? this.field.width / 2,
      y: opts.y ?? 0,
      width: opts.width ?? this.wordWidth(text, kind),
      speedMul: opts.speedMul ?? 1,
    };
    this.words.push(word);
    this.version++;
    return word;
  }

  /** Test hook: stop automatic spawning. */
  disableSpawning(): void {
    this.spawnTimer = Infinity;
  }

  // ---- landing and the pile ------------------------------------------------------------

  private land(word: Word): void {
    this.removeWord(word);
    this.pile.push({ text: word.original, kind: word.kind });
    this.emit({ type: 'landed', word });
    if (this.pile.length >= this.dangerRows) this.fail();
  }

  private fail(): void {
    this.status = 'failed';
    this.version++;
    this.emit({ type: 'levelFailed' });
  }

  // ---- input ---------------------------------------------------------------------------

  typeChar(ch: string): void {
    if (this.status !== 'playing') return;
    const c = ch.toLowerCase();
    if (!/^[a-z]$/.test(c) || this.buffer.length >= 24) return;
    this.buffer += c;
    this.version++;
  }

  backspace(): void {
    if (!this.buffer) return;
    this.buffer = this.buffer.slice(0, -1);
    this.version++;
  }

  /** Ids of words whose text starts with the buffer (FR-09). */
  highlighted(): Set<number> {
    const ids = new Set<number>();
    if (!this.buffer) return ids;
    for (const w of this.words) if (w.text.startsWith(this.buffer)) ids.add(w.id);
    return ids;
  }

  submit(): void {
    if (this.status !== 'playing') return;
    const input = this.buffer.trim().toLowerCase();
    this.buffer = '';
    this.version++;
    if (!input) return;

    // An on-screen word always wins over a skill name.
    let target: Word | null = null;
    for (const w of this.words) if (w.text === input && (!target || w.y > target.y)) target = w;
    if (target) {
      this.typedClear(target, input);
      return;
    }

    const skill = this.matchSkill(input);
    if (skill) {
      this.cast(skill);
      return;
    }
    this.mistake(input);
  }

  matchSkill(input: string): SkillId | null {
    return SKILL_IDS.find((s) => s.toLowerCase() === input) ?? null;
  }

  private typedClear(target: Word, input: string): void {
    const prevTier = comboTierIndex(this.combo, this.config);
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.correctSubmissions++;
    this.correctChars += input.length + 1;
    const tier = comboTierIndex(this.combo, this.config);
    if (tier > prevTier) this.emit({ type: 'comboTier', combo: this.combo, multiplier: this.multiplier });

    this.clearWord(target, 'typed');
    this.checkComplete();
  }

  private mistake(text: string): void {
    this.mistakes++;
    this.combo = 0;
    this.score = Math.max(0, this.score - this.config.gameplay.scoring.mistakePenalty);
    const black = this.config.gameplay.blackWord;
    for (const w of this.words) {
      if (w.kind === 'black') w.speedMul = Math.min(black.maxMultiplier, w.speedMul * black.speedMultiplier);
    }
    this.version++;
    this.emit({ type: 'mistake', text });
  }

  // ---- clearing and scoring ------------------------------------------------------------

  private removeWord(word: Word): void {
    const i = this.words.indexOf(word);
    if (i >= 0) this.words.splice(i, 1);
    this.version++;
  }

  private clearWord(word: Word, cause: ClearCause): void {
    this.removeWord(word);
    if (cause === 'levelEnd') {
      this.emit({ type: 'cleared', word, cause, points: 0, coins: 0 });
      return;
    }
    // Only typed words score: the quota measures typing, and skills are for survival.
    const points =
      cause === 'typed'
        ? Math.round(word.original.length * this.config.gameplay.scoring.pointsPerLetter * this.multiplier)
        : 0;
    this.score += points;
    this.wordsCleared++;

    const c = this.config.gameplay.coins;
    this.coinBase.words += c.perWord;
    const bonus = word.kind === 'coin' ? c.coinWordBonus : 0;
    this.coinBase.coinWords += bonus;
    const coins = Math.round((c.perWord + bonus) * this.coinMultiplier);

    if (word.kind === 'charge' && word.skill) {
      if (this.pool.length < this.capacity) {
        this.pool.push(word.skill);
        this.emit({ type: 'chargeGained', skill: word.skill });
      } else {
        this.emit({ type: 'poolFull', skill: word.skill });
      }
    }
    this.emit({ type: 'cleared', word, cause, points, coins });
  }

  private checkComplete(): void {
    if (this.status !== 'playing' || this.score < this.params.quota) return;
    this.status = 'complete';
    for (const w of [...this.words]) this.clearWord(w, 'levelEnd');
    const reward = levelReward(this.params.level, this.config);
    this.coinBase.level = reward;
    if (this.mistakes === 0) this.coinBase.perfect = reward * this.config.gameplay.coins.perfectMultiplier;
    this.version++;
    this.emit({ type: 'levelComplete' });
  }

  // ---- skills --------------------------------------------------------------------------

  private tierDef(skill: SkillId, tier: number) {
    const tiers = this.config.skills[skill].tiers;
    return tiers[Math.min(tiers.length, Math.max(1, tier)) - 1];
  }

  private cast(skill: SkillId): void {
    const tier = this.skills[skill] ?? 0;
    const idx = this.pool.indexOf(skill);
    if (tier === 0 || idx < 0) {
      this.emit({ type: 'noCharge', skill, locked: tier === 0 });
      return;
    }
    this.pool.splice(idx, 1);
    this.skillsUsed[skill] = (this.skillsUsed[skill] ?? 0) + 1;
    this.fire(skill, tier);
  }

  /** Apply a skill's effect at a tier, without spending a charge. Exposed for tests. */
  fire(skill: SkillId, tier: number): void {
    const behaviour = SKILL_BEHAVIOURS[skill];
    const def = this.tierDef(skill, tier);
    let duration = INSTANT_WEATHER;
    if (behaviour.timed) {
      duration = def.duration ?? 0;
      // Timed effects never stack; firing again restarts the timer (FR-39).
      this.effects[skill] = { remaining: duration, duration, tier };
    }
    behaviour.cast?.(this, def);
    this.version++;
    this.emit({ type: 'skillFired', skill, tier, duration });
  }

  // ---- effects available to skills (see skills.ts) ---------------------------------------

  /** Remove the `count` words closest to landing. */
  burnLowest(count: number): void {
    const byUrgency = [...this.words].sort((a, b) => b.y - a.y);
    for (const w of byUrgency.slice(0, count)) this.clearWord(w, 'skill');
  }

  /** Push every falling word up by `fraction` of the field height. */
  pushWordsUp(fraction: number): void {
    for (const w of this.words) w.y = Math.max(0, w.y - fraction * this.field.height);
  }

  /** Remove up to `rows` rows from the top of the pile. */
  removePileRows(rows: number): void {
    const n = Math.min(rows, this.pile.length);
    this.pile.splice(this.pile.length - n, n);
    this.emit({ type: 'pileRemoved', rows: n });
  }

  // ---- outputs -------------------------------------------------------------------------

  private emit(e: EngineEvent): void {
    this.events.push(e);
  }

  drainEvents(): EngineEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  get wpm(): number {
    const minutes = this.elapsed / 60;
    return minutes > 1 / 60 ? Math.round(this.correctChars / 5 / minutes) : 0;
  }

  get accuracy(): number {
    const total = this.correctSubmissions + this.mistakes;
    return total ? Math.round((this.correctSubmissions / total) * 1000) / 10 : 0;
  }

  hud(): HudSnapshot {
    const effects = (Object.keys(this.effects) as SkillId[]).map((skill) => {
      const e = this.effects[skill]!;
      return { skill, remaining: e.remaining, duration: e.duration };
    });
    return {
      level: this.params.level,
      score: this.score,
      quota: this.params.quota,
      coins: this.coins.total,
      combo: this.combo,
      multiplier: this.multiplier,
      pool: [...this.pool],
      capacity: this.capacity,
      effects,
      pileRows: this.pile.length,
      dangerRows: this.dangerRows,
      status: this.status,
    };
  }

  result(): AttemptResult {
    return {
      level: this.params.level,
      passed: this.status === 'complete',
      score: this.score,
      quota: this.params.quota,
      wpm: this.wpm,
      accuracy: this.accuracy,
      maxCombo: this.maxCombo,
      wordsCleared: this.wordsCleared,
      mistakes: this.mistakes,
      perfect: this.status === 'complete' && this.mistakes === 0,
      coins: this.coins,
      skillsUsed: { ...this.skillsUsed },
    };
  }
}
