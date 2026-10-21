import { SKILL_IDS, UPGRADE_IDS } from '../engine/types';
import { defaultProgress, defaultSettings, type Progress, type Settings } from './progress';

export const PROGRESS_KEY = 'keystorm.progress';
export const SETTINGS_KEY = 'keystorm.settings';
export const SCHEMA_VERSION = 1;

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

/**
 * Migrations run in order from the stored version up to SCHEMA_VERSION. Version 1 is the
 * first schema, so there's nothing to migrate yet; future changes add a step here.
 */
const migrations: Record<number, (data: unknown) => unknown> = {};

function migrate<T>(env: Envelope<unknown>): T {
  let data = env.data;
  for (let v = env.version; v < SCHEMA_VERSION; v++) data = migrations[v]?.(data) ?? data;
  return data as T;
}

export function loadProgress(): Progress {
  const env = read<Partial<Progress>>(PROGRESS_KEY);
  const base = defaultProgress();
  if (!env) return base;
  const d = migrate<Partial<Progress>>(env);
  const skills = { ...base.skills };
  for (const s of SKILL_IDS) skills[s] = Math.round(num(d.skills?.[s], 0, 0, 3));
  const upgrades = { ...base.upgrades };
  for (const u of UPGRADE_IDS) upgrades[u] = Math.round(num(d.upgrades?.[u], 0, 0, 10));
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
  storage.set(PROGRESS_KEY, JSON.stringify({ version: SCHEMA_VERSION, data: p } satisfies Envelope<Progress>));
}

export function loadSettings(): Settings {
  const env = read<Partial<Settings>>(SETTINGS_KEY);
  const base = defaultSettings();
  if (!env) return base;
  const d = migrate<Partial<Settings>>(env);
  return {
    volume: num(d.volume, base.volume, 0, 1),
    difficulty: d.difficulty === 'easy' || d.difficulty === 'hard' ? d.difficulty : 'normal',
    wordList: d.wordList === 'short' ? 'short' : 'standard',
    reducedMotion: typeof d.reducedMotion === 'boolean' ? d.reducedMotion : base.reducedMotion,
  };
}

export function saveSettings(s: Settings): void {
  storage.set(SETTINGS_KEY, JSON.stringify({ version: SCHEMA_VERSION, data: s } satisfies Envelope<Settings>));
}

export function clearProgress(): void {
  storage.remove(PROGRESS_KEY);
}
