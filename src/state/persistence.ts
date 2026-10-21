import { CONFIG } from '../engine/config';
import { SKILL_IDS, UPGRADE_IDS } from '../engine/types';
import { defaultProgress, defaultSettings, type Progress, type Settings } from './progress';

export const PROGRESS_KEY = 'keystorm.progress';
export const SETTINGS_KEY = 'keystorm.settings';
export const PROGRESS_VERSION = 2;
export const SETTINGS_VERSION = 1;

interface Envelope<T> {
  version: number;
  data: T;
}

/** localStorage when it works, an in-memory map otherwise (private mode, blocked storage). */
const memory = new Map<string, string>();
const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      memory.set(key, value);
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      memory.delete(key);
    }
  },
};

function read<T>(key: string): Envelope<T> | null {
  const raw = storage.get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Envelope<T>;
    return parsed && typeof parsed === 'object' && 'data' in parsed ? parsed : null;
  } catch {
    return null;
  }
}

const num = (v: unknown, fallback: number, min = 0, max = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

type Migrations = Record<number, (data: unknown) => unknown>;

/** Runs `migrations[v]` for each version from the stored one up to `target`. */
function migrate<T>(env: Envelope<unknown>, migrations: Migrations, target: number): T {
  let data = env.data;
  for (let v = env.version; v < target; v++) data = migrations[v]?.(data) ?? data;
  return data as T;
}

/** Cumulative cost of the first `rank` steps of a price list. */
const spent = (prices: number[], rank: number) => prices.slice(0, rank).reduce((a, b) => a + b, 0);

/** Version 1's prices, for refunds when version 2 trimmed the shop. */
const V1_SKILL_PRICES = [30, 80, 180];
const V1_UPGRADE_PRICES: Record<string, number[]> = {
  chargeCapacity: [40, 90, 160, 250, 360],
  reinforcedFloor: [40, 90, 160],
  steadyHands: [40, 90, 160],
  comboKeeper: [150],
  quickCast: [150],
  coinBonus: [40, 90, 160, 250, 360],
  luckyDraw: [40, 90, 160],
  headStart: [40, 90],
  dangerRadar: [150],
};

const progressMigrations: Migrations = {
  // v1 → v2: the shop went from 14 skills and 9 upgrades to 4 and 4. Refund what was spent on
  // removed items and on ranks above the new maximums, at the prices the player paid.
  1: (raw) => {
    const d = { ...(raw as Partial<Progress> & Record<string, unknown>) };
    const skills = { ...((d.skills ?? {}) as Record<string, number>) };
    const upgrades = { ...((d.upgrades ?? {}) as Record<string, number>) };
    let refund = 0;
    for (const [id, tier] of Object.entries(skills)) {
      if (!(SKILL_IDS as readonly string[]).includes(id)) {
        refund += spent(V1_SKILL_PRICES, tier);
        delete skills[id];
      }
    }
    for (const [id, rank] of Object.entries(upgrades)) {
      const prices = V1_UPGRADE_PRICES[id] ?? [];
      const def = CONFIG.upgrades[id as keyof typeof CONFIG.upgrades];
      const keep = def ? Math.min(rank, def.maxRank) : 0;
      refund += spent(prices, rank) - spent(prices, keep);
      if (keep) upgrades[id] = keep;
      else delete upgrades[id];
    }
    return { ...d, skills, upgrades, coins: (typeof d.coins === 'number' ? d.coins : 0) + refund };
  },
};
const settingsMigrations: Migrations = {};

export function loadProgress(): Progress {
  const env = read<Partial<Progress>>(PROGRESS_KEY);
  const base = defaultProgress();
  if (!env) return base;
  const d = migrate<Partial<Progress>>(env, progressMigrations, PROGRESS_VERSION);
  const skills = { ...base.skills };
  for (const s of SKILL_IDS) skills[s] = Math.round(num(d.skills?.[s], 0, 0, CONFIG.skills[s].tiers.length));
  const upgrades = { ...base.upgrades };
  for (const u of UPGRADE_IDS) upgrades[u] = Math.round(num(d.upgrades?.[u], 0, 0, CONFIG.upgrades[u].maxRank));
  return {
    currentLevel: Math.round(num(d.currentLevel, 1, 1)),
    coins: Math.round(num(d.coins, 0)),
    skills,
    upgrades,
    records: {
      bestCombo: num(d.records?.bestCombo, 0),
      bestWpm: num(d.records?.bestWpm, 0),
    },
  };
}

export function saveProgress(p: Progress): void {
  storage.set(PROGRESS_KEY, JSON.stringify({ version: PROGRESS_VERSION, data: p } satisfies Envelope<Progress>));
}

export function loadSettings(): Settings {
  const env = read<Partial<Settings>>(SETTINGS_KEY);
  const base = defaultSettings();
  if (!env) return base;
  const d = migrate<Partial<Settings>>(env, settingsMigrations, SETTINGS_VERSION);
  return {
    volume: num(d.volume, base.volume, 0, 1),
    difficulty: d.difficulty === 'easy' || d.difficulty === 'hard' ? d.difficulty : 'normal',
    wordList: d.wordList === 'short' ? 'short' : 'standard',
    reducedMotion: typeof d.reducedMotion === 'boolean' ? d.reducedMotion : base.reducedMotion,
  };
}

export function saveSettings(s: Settings): void {
  storage.set(SETTINGS_KEY, JSON.stringify({ version: SETTINGS_VERSION, data: s } satisfies Envelope<Settings>));
}

export function clearProgress(): void {
  storage.remove(PROGRESS_KEY);
}
