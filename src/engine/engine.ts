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
  type TimedEffect,
  type UpgradeRanks,
  type Word,
  type WordKind,
  type WordListId,
} from './types';
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
  effects: { skill: TimedEffect; remaining: number; duration: number }[];
  bombArmed: boolean;
  doubleLeft: number;
  shieldLeft: number;
  luckBonus: number;
  overdriveMultiplier: number;
  pileRows: number;
  dangerRows: number;
  forgivesLeft: number;
  status: EngineStatus;
}

const TIMED: TimedEffect[] = ['CHAIN', 'ICE', 'SLOW', 'MAGNET', 'OVERDRIVE'];
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
  effects: Partial<Record<TimedEffect, ActiveEffect>> = {};
  bombRadius: number | null = null;
  doubleLeft = 0;
  shieldLeft = 0;
  luckBonus = 0;
  dangerWordId: number | null = null;
  elapsed = 0;
  /** Bumped on every discrete state change so the UI can skip redundant HUD updates. */
  version = 0;

  mistakes = 0;
  forgiven = 0;
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

    const unlocked = this.unlockedSkills();
    for (let i = 0; i < this.upgrades.headStart && unlocked.length; i++) {
      if (this.pool.length < this.capacity) this.pool.push(this.rng.pick(unlocked));
    }
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

  /** Y at which a falling word's bottom edge touches the pile (FR-13). */
  get landingY(): number {
    return this.field.height - this.pile.length * this.field.rowHeight;
  }

  get dangerY(): number {
    return this.field.height - this.dangerRows * this.field.rowHeight;
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

  get forgivesLeft(): number {
    return Math.max(0, this.upgrades.steadyHands - this.forgiven);
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

    for (const key of TIMED) {
      const e = this.effects[key];
      if (!e) continue;
      e.remaining -= dt;
      if (e.remaining <= 0) {
        delete this.effects[key];
        this.version++;
      }
    }

    const frozen = !!this.effects.ICE;
    if (!frozen) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        // When there's no room, retry shortly instead of waiting a full interval.
        this.spawnTimer = this.trySpawn() ? this.spawnTimer + this.params.spawnInterval : 0.1;
      }
      this.moveWords(dt);
    }

    if (this.upgrades.dangerRadar > 0) this.updateDangerWord();
  }

  private fallSpeed(): number {
    let speed = this.params.fallSpeed * this.heightScale;
    if (this.effects.SLOW) speed *= this.tierDef('SLOW', this.effects.SLOW.tier).speed ?? 1;
    if (this.effects.OVERDRIVE) speed *= this.tierDef('OVERDRIVE', this.effects.OVERDRIVE.tier).speed ?? 1;
    return speed;
  }

  private moveWords(dt: number): void {
    const speed = this.fallSpeed();
    const h = this.field.wordHeight;
    const magnet = !!this.effects.MAGNET;
    for (const word of [...this.words]) {
      if (magnet && (word.kind === 'coin' || word.kind === 'charge')) {
        const target = this.landingY - this.config.gameplay.magnet.hoverRowsAbovePile * this.field.rowHeight - h;
        const pull = this.config.gameplay.magnet.pullSpeed * this.heightScale;
        if (word.y < target) word.y = Math.min(target, word.y + pull * dt);
      } else {
        word.y += speed * word.speedMul * dt;
      }
      if (word.y + h >= this.landingY) this.land(word);
      if (this.status !== 'playing') return;
    }
  }

  private updateDangerWord(): void {
    let best: Word | null = null;
    let bestScore = Infinity;
    for (const w of this.words) {
      const distance = this.landingY - (w.y + this.field.wordHeight);
      const s = distance / w.speedMul;
      if (s < bestScore) {
        bestScore = s;
        best = w;
      }
    }
    this.dangerWordId = best?.id ?? null;
  }

  // ---- spawning ------------------------------------------------------------------------

  private trySpawn(): boolean {
    const f = this.field;
    if (this.words.length >= f.maxWords) return false;

    const p = this.params;
    const unlocked = this.unlockedSkills();
    const chargeChance = p.chargeWordChance * (1 + this.upgradeValue('luckyDraw')) * (1 + this.luckBonus);
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
    if (this.shieldLeft > 0) {
      this.shieldLeft--;
      this.emit({ type: 'landed', word, shielded: true });
      return;
    }
    this.pile.push({ text: word.original, kind: word.kind });
    this.emit({ type: 'landed', word, shielded: false });
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

    // An exact on-screen word always wins, even over a Quick cast prefix.
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
    const exact = SKILL_IDS.find((s) => s.toLowerCase() === input);
    if (exact) return exact;
    if (this.upgrades.quickCast > 0 && input.length >= 3) {
      return SKILL_IDS.find((s) => s.toLowerCase().startsWith(input)) ?? null;
    }
    return null;
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
    const cx = target.x;
    const cy = target.y + this.field.wordHeight / 2;

    if (this.bombRadius !== null) {
      const r = this.bombRadius;
      this.bombRadius = null;
      this.emit({ type: 'bomb', x: cx, y: cy, radius: r });
      for (const w of [...this.words]) {
        if (Math.hypot(w.x - cx, w.y + this.field.wordHeight / 2 - cy) <= r) this.clearWord(w, 'bomb');
      }
    }

    if (this.effects.CHAIN) {
      const letter = target.text[0];
      const linked = this.words.filter((w) => w.text[0] === letter);
      if (linked.length) {
        this.emit({
          type: 'chain',
          from: { x: cx, y: cy },
          to: linked.map((w) => ({ x: w.x, y: w.y + this.field.wordHeight / 2 })),
        });
        for (const w of linked) this.clearWord(w, 'chain');
      }
    }
    this.checkComplete();
  }

  private mistake(text: string): void {
    if (this.forgivesLeft > 0) {
      this.forgiven++;
      this.version++;
      this.emit({ type: 'mistake', forgiven: true, text });
      return;
    }
    this.mistakes++;
    if (this.upgrades.comboKeeper > 0) {
      const idx = comboTierIndex(this.combo, this.config);
      this.combo = idx > 0 ? this.config.gameplay.combo.tiers[idx - 1].min : 0;
    } else {
      this.combo = 0;
    }
    this.score = Math.max(0, this.score - this.config.gameplay.scoring.mistakePenalty);
    const black = this.config.gameplay.blackWord;
    for (const w of this.words) {
      if (w.kind === 'black') w.speedMul = Math.min(black.maxMultiplier, w.speedMul * black.speedMultiplier);
    }
    this.version++;
    this.emit({ type: 'mistake', forgiven: false, text });
  }

  // ---- clearing and scoring ------------------------------------------------------------

  private removeWord(word: Word): void {
    const i = this.words.indexOf(word);
    if (i >= 0) this.words.splice(i, 1);
    if (this.dangerWordId === word.id) this.dangerWordId = null;
    this.version++;
  }

  private clearWord(word: Word, cause: ClearCause): void {
    this.removeWord(word);
    if (cause === 'levelEnd') {
      this.emit({ type: 'cleared', word, cause, points: 0, coins: 0 });
      return;
    }
    const doubled = this.doubleLeft > 0 ? 2 : 1;
    if (doubled > 1) this.doubleLeft--;
    const overdrive = this.effects.OVERDRIVE
      ? (this.tierDef('OVERDRIVE', this.effects.OVERDRIVE.tier).multiplier ?? 1)
      : 1;
    const points = Math.round(
      word.original.length * this.config.gameplay.scoring.pointsPerLetter * this.multiplier * doubled * overdrive,
    );
    this.score += points;
    this.wordsCleared++;

    const c = this.config.gameplay.coins;
    this.coinBase.words += c.perWord * doubled;
    const bonus = word.kind === 'coin' ? c.coinWordBonus * doubled : 0;
    this.coinBase.coinWords += bonus;
    const coins = Math.round((c.perWord * doubled + bonus) * this.coinMultiplier);

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
    this.checkComplete();
  }

  /** Apply a skill's effect at a tier. Exposed for tests and GAMBLE. */
  fire(skill: SkillId, tier: number, via?: SkillId): void {
    const def = this.tierDef(skill, tier);
    let duration = INSTANT_WEATHER;
    switch (skill) {
      case 'FIRE': {
        const byUrgency = [...this.words].sort((a, b) => b.y - a.y);
        const n = def.count ?? Math.ceil(byUrgency.length * (def.fraction ?? 1));
        for (const w of byUrgency.slice(0, n)) this.clearWord(w, 'fire');
        break;
      }
      case 'BOMB':
        this.bombRadius = def.radius ?? 0;
        break;
      case 'CHAIN':
      case 'ICE':
      case 'SLOW':
      case 'MAGNET':
      case 'OVERDRIVE':
        duration = def.duration ?? 0;
        // Timed effects never stack; firing again restarts the timer (FR-39).
        this.effects[skill] = { remaining: duration, duration, tier };
        break;
      case 'REWIND': {
        const frac = def.fraction ?? 0;
        for (const w of this.words) w.y = frac >= 1 ? 0 : Math.max(0, w.y - frac * this.field.height);
        break;
      }
      case 'SHRINK': {
        const n = def.letters ?? 4;
        for (const w of this.words) {
          if (w.text.length > n) {
            w.text = w.text.slice(0, n);
            w.width = this.wordWidth(w.text, w.kind);
          }
        }
        break;
      }
      case 'WIND': {
        const n = Math.min(def.rows ?? 0, this.pile.length);
        this.pile.splice(this.pile.length - n, n);
        this.emit({ type: 'pileRemoved', rows: n });
        break;
      }
      case 'SHIELD':
        this.shieldLeft = def.words ?? 0;
        break;
      case 'DOUBLE':
        this.doubleLeft = def.words ?? 0;
        break;
      case 'LUCK':
        this.luckBonus = Math.max(this.luckBonus, def.bonus ?? 0);
        break;
      case 'GAMBLE': {
        const other = this.rng.pick(SKILL_IDS.filter((s) => s !== 'GAMBLE'));
        this.emit({ type: 'skillFired', skill, tier, via, duration: 0.9 });
        this.version++;
        this.fire(other, def.tier ?? tier, 'GAMBLE');
        return;
      }
    }
    this.version++;
    this.emit({ type: 'skillFired', skill, tier, via, duration });
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
    const total = this.correctSubmissions + this.mistakes + this.forgiven;
    return total ? Math.round((this.correctSubmissions / total) * 1000) / 10 : 0;
  }

  hud(): HudSnapshot {
    const effects = TIMED.flatMap((skill) => {
      const e = this.effects[skill];
      return e ? [{ skill, remaining: e.remaining, duration: e.duration }] : [];
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
      bombArmed: this.bombRadius !== null,
      doubleLeft: this.doubleLeft,
      shieldLeft: this.shieldLeft,
      luckBonus: this.luckBonus,
      overdriveMultiplier: this.effects.OVERDRIVE
        ? (this.tierDef('OVERDRIVE', this.effects.OVERDRIVE.tier).multiplier ?? 1)
        : 1,
      pileRows: this.pile.length,
      dangerRows: this.dangerRows,
      forgivesLeft: this.forgivesLeft,
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
