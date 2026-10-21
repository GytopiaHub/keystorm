export const SKILL_IDS = [
  'FIRE',
  'BOMB',
  'CHAIN',
  'ICE',
  'SLOW',
  'REWIND',
  'SHRINK',
  'WIND',
  'SHIELD',
  'MAGNET',
  'DOUBLE',
  'LUCK',
  'OVERDRIVE',
  'GAMBLE',
] as const;
export type SkillId = (typeof SKILL_IDS)[number];

export const UPGRADE_IDS = [
  'chargeCapacity',
  'reinforcedFloor',
  'steadyHands',
  'comboKeeper',
  'quickCast',
  'coinBonus',
  'luckyDraw',
  'headStart',
  'dangerRadar',
] as const;
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

export interface SkillTierDef {
  label: string;
  count?: number;
  fraction?: number;
  radius?: number;
  duration?: number;
  speed?: number;
  letters?: number;
  rows?: number;
  words?: number;
  bonus?: number;
  multiplier?: number;
  tier?: number;
}

export interface SkillDef {
  id: SkillId;
  category: string;
  color: string;
  icon: string;
  description: string;
  tiers: SkillTierDef[];
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  description: string;
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

export type TimedEffect = 'CHAIN' | 'ICE' | 'SLOW' | 'MAGNET' | 'OVERDRIVE';

export interface ActiveEffect {
  remaining: number;
  duration: number;
  tier: number;
}

export type ClearCause = 'typed' | 'fire' | 'bomb' | 'chain' | 'levelEnd';

export type EngineEvent =
  | { type: 'cleared'; word: Word; cause: ClearCause; points: number; coins: number }
  | { type: 'mistake'; forgiven: boolean; text: string }
  | { type: 'noCharge'; skill: SkillId; locked: boolean }
  | { type: 'skillFired'; skill: SkillId; tier: number; via?: SkillId; duration: number }
  | { type: 'chargeGained'; skill: SkillId }
  | { type: 'poolFull'; skill: SkillId }
  | { type: 'landed'; word: Word; shielded: boolean }
  | { type: 'comboTier'; combo: number; multiplier: number }
  | { type: 'bomb'; x: number; y: number; radius: number }
  | { type: 'chain'; from: { x: number; y: number }; to: { x: number; y: number }[] }
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
