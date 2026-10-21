import wordsJson from '../data/words.json';
import { SKILL_IDS } from './types';
import type { Rng } from './rng';

/** Words indexed by exact length, with skill names removed (FR-37). */
export class WordBank {
  private byLength = new Map<number, string[]>();

  constructor(words: Iterable<string>) {
    const banned = new Set<string>(SKILL_IDS.map((s) => s.toLowerCase()));
    for (const raw of words) {
      const w = raw.toLowerCase();
      if (!/^[a-z]+$/.test(w) || banned.has(w)) continue;
      const list = this.byLength.get(w.length) ?? [];
      list.push(w);
      this.byLength.set(w.length, list);
    }
  }

  static fromBuckets(buckets: Record<string, string[]> = wordsJson.buckets): WordBank {
    return new WordBank(Object.values(buckets).flat());
  }

  get size(): number {
    let n = 0;
    for (const l of this.byLength.values()) n += l.length;
    return n;
  }

  /** Lengths in [min, max] that have words, falling back to the nearest available lengths. */
  lengthsIn(min: number, max: number): number[] {
    const all = [...this.byLength.keys()].sort((a, b) => a - b);
    const inRange = all.filter((n) => n >= min && n <= max);
    if (inRange.length) return inRange;
    const nearest = all.reduce((best, n) => (Math.abs(n - max) < Math.abs(best - max) ? n : best), all[0]);
    return [nearest];
  }

  /** Random word with a uniformly chosen length in range, avoiding any text in `exclude`. */
  pick(rng: Rng, min: number, max: number, exclude: (w: string) => boolean): string | null {
    const lengths = this.lengthsIn(min, max);
    for (let attempt = 0; attempt < 12; attempt++) {
      const list = this.byLength.get(rng.pick(lengths))!;
      const w = rng.pick(list);
      if (!exclude(w)) return w;
    }
    return null;
  }
}
