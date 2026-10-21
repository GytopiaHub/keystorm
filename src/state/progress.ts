import { CONFIG, skillPrice, upgradePrice, type GameConfig } from '../engine/config';
import {
  SKILL_IDS,
  UPGRADE_IDS,
  type AttemptResult,
  type Difficulty,
  type SkillId,
  type SkillTiers,
  type UpgradeId,
  type UpgradeRanks,
  type WordListId,
} from '../engine/types';

export interface Records {
  bestCombo: number;
  bestWpm: number;
}

export interface Progress {
  /** Highest level reached; play resumes here by default. */
  currentLevel: number;
  coins: number;
  skills: SkillTiers;
  upgrades: UpgradeRanks;
  records: Records;
}

export interface Settings {
  volume: number;
  difficulty: Difficulty;
  wordList: WordListId;
  reducedMotion: boolean;
}

export const emptySkills = (): SkillTiers =>
  Object.fromEntries(SKILL_IDS.map((s) => [s, 0])) as SkillTiers;

export const emptyUpgrades = (): UpgradeRanks =>
  Object.fromEntries(UPGRADE_IDS.map((u) => [u, 0])) as UpgradeRanks;

export const defaultProgress = (): Progress => ({
  currentLevel: 1,
  coins: 0,
  skills: emptySkills(),
  upgrades: emptyUpgrades(),
  records: { bestCombo: 0, bestWpm: 0 },
});

export const defaultSettings = (): Settings => ({
  volume: 0.7,
  difficulty: 'normal',
  wordList: 'standard',
  reducedMotion:
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
});

/** Fold an attempt into saved progress: coins are always kept (FR-30). */
export function applyResult(p: Progress, r: AttemptResult): Progress {
  return {
    ...p,
    coins: p.coins + r.coins.total,
    currentLevel: r.passed && r.level >= p.currentLevel ? r.level + 1 : p.currentLevel,
    records: {
      bestCombo: Math.max(p.records.bestCombo, r.maxCombo),
      bestWpm: Math.max(p.records.bestWpm, r.wpm),
    },
  };
}

/** Returns updated progress, or null when maxed or unaffordable. */
export function buySkill(p: Progress, id: SkillId, config: GameConfig = CONFIG): Progress | null {
  const price = skillPrice(p.skills[id], config);
  if (price === null || p.coins < price) return null;
  return { ...p, coins: p.coins - price, skills: { ...p.skills, [id]: p.skills[id] + 1 } };
}

export function buyUpgrade(p: Progress, id: UpgradeId, config: GameConfig = CONFIG): Progress | null {
  const price = upgradePrice(id, p.upgrades[id], config);
  if (price === null || p.coins < price) return null;
  return { ...p, coins: p.coins - price, upgrades: { ...p.upgrades, [id]: p.upgrades[id] + 1 } };
}
