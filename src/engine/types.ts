/**
 * Every skill in the game. To add one: add its id here, its data (colour, icon, unlock level,
 * prices, tiers) to src/data/skills.json, and its behaviour to SKILL_BEHAVIOURS in skills.ts.
 */
export const SKILL_IDS = ['FIRE', 'ICE', 'SLOW', 'WIND'] as const;
export type SkillId = (typeof SKILL_IDS)[number];

/**
 * Every shop upgrade. To add one: add its id here, its data to src/data/upgrades.json, and
 * read its value with `upgradeValue(id)` where it takes effect in the engine.
 */
export const UPGRADE_IDS = ['chargeCapacity', 'reinforcedFloor', 'coinBonus', 'luckyDraw'] as const;
export type UpgradeId = (typeof UPGRADE_IDS)[number];

export type Difficulty = 'easy' | 'normal' | 'hard';
export type WordListId = 'standard' | 'short';

/** Tier 0 = locked, 1–3 = Tier I–III. */
export type SkillTiers = Record<SkillId, number>;
export type UpgradeRanks = Record<UpgradeId, number>;

export interface LevelParams {
  level: number;
  quota: number;
  fallSpeed: number;
  spawnInterval: number;
  wordLengthRange: [number, number];
  coinWordChance: number;
  blackChance: number;
  chargeWordChance: number;
}

/** One tier's numbers. Each skill reads the fields it needs. */
export interface SkillTierDef {
  label: string;
  /** Words affected (FIRE). */
  count?: number;
  /** Seconds a timed effect lasts (ICE, SLOW). */
  duration?: number;
  /** Fall-speed factor while active (SLOW). */
  speed?: number;
  /** Pile rows removed (WIND). */
  rows?: number;
  /** Fraction of the field height falling words are pushed back up (WIND). */
  push?: number;
}

export interface SkillDef {
  id: SkillId;
  category: string;
  color: string;
  /** File name in src/assets/icons/, without extension. */
  icon: string;
  description: string;
  /** Level the player must reach before the shop offers this skill. */
  unlockLevel: number;
  /** Price of Tier I, II and III. */
  prices: number[];
  tiers: SkillTierDef[];
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  description: string;
  /** Level the player must reach before the shop offers this upgrade. */
  unlockLevel: number;
  maxRank: number;
  perRank: number;
  prices: number[];
}

export type WordKind = 'normal' | 'coin' | 'black' | 'charge';

export interface Word {
  id: number;
  /** Current text to type (may be trimmed by SHRINK). */
  text: string;
  /** Text as spawned. */
  original: string;
  kind: WordKind;
  skill?: SkillId;
  /** Centre x in field coordinates. */
  x: number;
  /** Top y in field coordinates. */
  y: number;
  width: number;
  /** Per-word speed multiplier (black words speed up on mistakes). */
  speedMul: number;
}

export interface PileRow {
  text: string;
  kind: WordKind;
}

export interface ActiveEffect {
  remaining: number;
  duration: number;
  tier: number;
}

/** How a word left the field: typed by the player, removed by a skill, or swept at level end. */
export type ClearCause = 'typed' | 'skill' | 'levelEnd';

export type EngineEvent =
  | { type: 'cleared'; word: Word; cause: ClearCause; points: number; coins: number }
  | { type: 'mistake'; text: string }
  | { type: 'noCharge'; skill: SkillId; locked: boolean }
  | { type: 'skillFired'; skill: SkillId; tier: number; duration: number }
  | { type: 'chargeGained'; skill: SkillId }
  | { type: 'poolFull'; skill: SkillId }
  | { type: 'landed'; word: Word }
  | { type: 'comboTier'; combo: number; multiplier: number }
  | { type: 'pileRemoved'; rows: number }
  | { type: 'levelComplete' }
  | { type: 'levelFailed' };

export interface CoinBreakdown {
  words: number;
  coinWords: number;
  level: number;
  perfect: number;
  total: number;
}

export interface AttemptResult {
  level: number;
  passed: boolean;
  score: number;
  quota: number;
  wpm: number;
  accuracy: number;
  maxCombo: number;
  wordsCleared: number;
  mistakes: number;
  perfect: boolean;
  coins: CoinBreakdown;
  skillsUsed: Partial<Record<SkillId, number>>;
}
