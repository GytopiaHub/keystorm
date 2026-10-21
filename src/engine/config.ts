import gameplayJson from '../data/gameplay.json';
import levelsJson from '../data/levels.json';
import skillsJson from '../data/skills.json';
import upgradesJson from '../data/upgrades.json';
import type { Difficulty, LevelParams, SkillDef, SkillId, UpgradeDef, UpgradeId, WordListId } from './types';

export type GameplayConfig = typeof gameplayJson;

export interface GameConfig {
  gameplay: GameplayConfig;
  levels: LevelParams[];
  extrapolateFromLastRows: number;
  skills: Record<SkillId, SkillDef>;
  skillOrder: SkillId[];
  skillCategories: { id: string; label: string }[];
  upgrades: Record<UpgradeId, UpgradeDef>;
  upgradeOrder: UpgradeId[];
}

function build(): GameConfig {
  const skills = {} as Record<SkillId, SkillDef>;
  for (const s of skillsJson.skills as SkillDef[]) skills[s.id] = s;
  const upgrades = {} as Record<UpgradeId, UpgradeDef>;
  for (const u of upgradesJson.upgrades as UpgradeDef[]) upgrades[u.id] = u;
  return {
    gameplay: gameplayJson,
    levels: levelsJson.levels as LevelParams[],
    extrapolateFromLastRows: levelsJson.extrapolateFromLastRows,
    skills,
    skillOrder: (skillsJson.skills as SkillDef[]).map((s) => s.id),
    skillCategories: skillsJson.categories,
    upgrades,
    upgradeOrder: (upgradesJson.upgrades as UpgradeDef[]).map((u) => u.id),
  };
}

export const CONFIG: GameConfig = build();

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * Level parameters for any level. Levels beyond the table extrapolate linearly from the
 * average step over its last rows, clamped to the gameplay caps (FR-18).
 */
export function levelParams(
  level: number,
  difficulty: Difficulty = 'normal',
  wordList: WordListId = 'standard',
  config: GameConfig = CONFIG,
): LevelParams {
  const rows = config.levels;
  const caps = config.gameplay.caps;
  let p: LevelParams;
  if (level <= rows.length) {
    const row = rows[Math.max(0, level - 1)];
    p = { ...row, level, wordLengthRange: [...row.wordLengthRange] as [number, number] };
  } else {
    const last = rows[rows.length - 1];
    const span = Math.min(config.extrapolateFromLastRows, rows.length) - 1;
    const first = rows[rows.length - 1 - span];
    const n = level - last.level;
    const step = (k: 'quota' | 'fallSpeed' | 'spawnInterval' | 'coinWordChance' | 'blackChance' | 'chargeWordChance') =>
      span > 0 ? (last[k] - first[k]) / span : 0;
    const lenStep = (i: 0 | 1) => (span > 0 ? (last.wordLengthRange[i] - first.wordLengthRange[i]) / span : 0);
    p = {
      level,
      quota: Math.round(last.quota + step('quota') * n),
      fallSpeed: round(last.fallSpeed + step('fallSpeed') * n, 2),
      spawnInterval: round(last.spawnInterval + step('spawnInterval') * n, 3),
      wordLengthRange: [
        Math.round(last.wordLengthRange[0] + lenStep(0) * n),
        Math.round(last.wordLengthRange[1] + lenStep(1) * n),
      ],
      coinWordChance: round(last.coinWordChance + step('coinWordChance') * n, 4),
      blackChance: round(last.blackChance + step('blackChance') * n, 4),
      chargeWordChance: round(last.chargeWordChance + step('chargeWordChance') * n, 4),
    };
  }

  const diff = config.gameplay.difficulty[difficulty];
  p.fallSpeed = Math.min(caps.maxFallSpeed, p.fallSpeed) * diff.speed;
  p.spawnInterval = Math.max(caps.minSpawnInterval, p.spawnInterval) * diff.interval;
  p.coinWordChance = Math.min(caps.maxCoinWordChance, Math.max(0, p.coinWordChance));
  p.blackChance = Math.min(caps.maxBlackChance, Math.max(0, p.blackChance));
  p.chargeWordChance = Math.min(caps.maxChargeWordChance, Math.max(0, p.chargeWordChance));

  const listMax = (config.gameplay.wordLists[wordList] as { maxLength?: number }).maxLength ?? Infinity;
  const maxLen = Math.min(caps.maxWordLength, listMax);
  const hi = Math.max(3, Math.min(maxLen, p.wordLengthRange[1]));
  const lo = Math.max(3, Math.min(hi, p.wordLengthRange[0]));
  p.wordLengthRange = [lo, hi];
  return p;
}

export function comboMultiplier(combo: number, config: GameConfig = CONFIG): number {
  return config.gameplay.combo.tiers[comboTierIndex(combo, config)].multiplier;
}

export function comboTierIndex(combo: number, config: GameConfig = CONFIG): number {
  const tiers = config.gameplay.combo.tiers;
  let idx = 0;
  for (let i = 0; i < tiers.length; i++) if (combo >= tiers[i].min) idx = i;
  return idx;
}

/** Price to go from `tier` to `tier + 1`, or null when maxed. */
export function skillPrice(id: SkillId, tier: number, config: GameConfig = CONFIG): number | null {
  const def = config.skills[id];
  return tier < def.tiers.length ? def.prices[tier] : null;
}

/** Price to go from `rank` to `rank + 1`, or null when maxed. */
export function upgradePrice(id: UpgradeId, rank: number, config: GameConfig = CONFIG): number | null {
  const def = config.upgrades[id];
  return rank < def.maxRank ? def.prices[rank] : null;
}

export function levelReward(level: number, config: GameConfig = CONFIG): number {
  const r = config.gameplay.coins.levelReward;
  return r.base + r.perLevel * (level - 1);
}
