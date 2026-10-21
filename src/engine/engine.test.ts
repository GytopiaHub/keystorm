// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CONFIG, comboMultiplier, levelParams } from './config';
import { GameEngine, type EngineOptions } from './engine';
import { SKILL_BEHAVIOURS } from './skills';
import { SKILL_IDS, UPGRADE_IDS, type SkillId } from './types';
import { WordBank } from './words';
import { emptySkills, emptyUpgrades } from '../state/progress';
import wordsJson from '../data/words.json';

const make = (opts: Partial<EngineOptions> = {}) => {
  const e = new GameEngine({ level: 1, seed: 42, skills: emptySkills(), upgrades: emptyUpgrades(), ...opts });
  return e;
};

const quiet = (opts: Partial<EngineOptions> = {}) => {
  const e = make(opts);
  e.disableSpawning();
  return e;
};

const type = (e: GameEngine, text: string) => {
  for (const c of text) e.typeChar(c);
  e.submit();
};

const withSkill = (skill: SkillId, tier = 1) => ({ ...emptySkills(), [skill]: tier });

describe('word data', () => {
  it('has at least 3000 words and no skill names', () => {
    const all = Object.values(wordsJson.buckets).flat();
    expect(all.length).toBeGreaterThanOrEqual(3000);
    const names = new Set(SKILL_IDS.map((s) => s.toLowerCase()));
    expect(all.filter((w) => names.has(w))).toEqual([]);
    expect(WordBank.fromBuckets().size).toBe(all.length);
  });
});

describe('level config', () => {
  it('uses the table for level 1', () => {
    const p = levelParams(1);
    expect(p).toMatchObject(CONFIG.levels[0]);
  });

  it('extrapolates beyond the table and respects caps', () => {
    const last = CONFIG.levels.length;
    const a = levelParams(last);
    const b = levelParams(last + 1);
    expect(b.quota).toBeGreaterThan(a.quota);
    expect(b.fallSpeed).toBeGreaterThan(a.fallSpeed);
    expect(b.spawnInterval).toBeLessThan(a.spawnInterval);
    const far = levelParams(500);
    expect(far.fallSpeed).toBe(CONFIG.gameplay.caps.maxFallSpeed);
    expect(far.spawnInterval).toBe(CONFIG.gameplay.caps.minSpawnInterval);
    expect(far.wordLengthRange[1]).toBeLessThanOrEqual(CONFIG.gameplay.caps.maxWordLength);
  });

  it('applies difficulty and the short word list', () => {
    expect(levelParams(1, 'hard').fallSpeed).toBeGreaterThan(levelParams(1).fallSpeed);
    expect(levelParams(30, 'normal', 'short').wordLengthRange[1]).toBe(6);
  });

  it('maps combo to multiplier tiers', () => {
    expect([0, 4, 5, 9, 10, 19, 20, 34, 35, 99].map((c) => comboMultiplier(c))).toEqual([
      1, 1, 1.5, 1.5, 2, 2, 2.5, 2.5, 3, 3,
    ]);
  });
});

describe('spawning and movement', () => {
  it('is deterministic for a seed', () => {
    const a = make({ seed: 7 });
    const b = make({ seed: 7 });
    for (let i = 0; i < 2000; i++) {
      a.step(GameEngine.STEP);
      b.step(GameEngine.STEP);
    }
    expect(a.words.map((w) => [w.text, w.x, w.y])).toEqual(b.words.map((w) => [w.text, w.x, w.y]));
  });

  it('never shows duplicate text and keeps spawns apart in the top band', () => {
    const e = make({ level: 40 });
    for (let i = 0; i < 120 * 60 && e.status === 'playing'; i++) {
      e.step(GameEngine.STEP);
      const texts = e.words.map((w) => w.text);
      expect(new Set(texts).size).toBe(texts.length);
    }
  });

  it('spawns words within the level length range', () => {
    const e = make();
    for (let i = 0; i < 120 * 30; i++) e.step(GameEngine.STEP);
    expect(e.words.length + e.pile.length).toBeGreaterThan(0);
    for (const w of e.words) expect(w.text.length).toBeGreaterThanOrEqual(3);
    for (const w of e.words) expect(w.text.length).toBeLessThanOrEqual(CONFIG.levels[0].wordLengthRange[1]);
  });

  it('moves the same distance regardless of frame rate', () => {
    const a = quiet();
    const b = quiet();
    const wa = a.addWord('cat');
    const wb = b.addWord('cat');
    for (let i = 0; i < 60; i++) a.advance(1 / 60);
    for (let i = 0; i < 144; i++) b.advance(1 / 144);
    expect(wa.y).toBeCloseTo(wb.y, 0);
    expect(wa.y).toBeCloseTo(CONFIG.levels[0].fallSpeed, 0);
  });
});

describe('field size', () => {
  it('scales fall speed and pile rows with height so timing is the same', () => {
    const base = quiet();
    const tall = quiet();
    expect(tall.fitField(1400, 840)).toBe(true);
    expect(tall.field.rowHeight).toBeCloseTo(CONFIG.gameplay.field.rowHeight * 1.5);
    const a = base.addWord('cat');
    const b = tall.addWord('cat');
    for (let i = 0; i < 120; i++) {
      base.step(GameEngine.STEP);
      tall.step(GameEngine.STEP);
    }
    expect(b.y / tall.field.height).toBeCloseTo(a.y / base.field.height);
    expect(tall.dangerY / tall.field.height).toBeCloseTo(base.dangerY / base.field.height);
  });

  it('refuses to reshape once play has started', () => {
    const e = quiet();
    e.step(GameEngine.STEP);
    expect(e.fitField(1400, 840)).toBe(false);
    expect(e.field.width).toBe(CONFIG.gameplay.field.width);
  });
});

describe('typing', () => {
  it('clears a matching word case-insensitively and scores by length', () => {
    const e = quiet();
    e.addWord('storm');
    type(e, 'STORM');
    expect(e.words).toHaveLength(0);
    expect(e.score).toBe(50);
    expect(e.combo).toBe(1);
  });

  it('clears the lowest word when several match', () => {
    const e = quiet();
    const high = e.addWord('ab', { y: 10 });
    const low = e.addWord('ab', { y: 200 });
    type(e, 'ab');
    expect(e.words).toEqual([high]);
    expect(e.words).not.toContain(low);
  });

  it('highlights words starting with the buffer', () => {
    const e = quiet();
    const a = e.addWord('rain');
    e.addWord('snow');
    e.typeChar('r');
    e.typeChar('a');
    expect([...e.highlighted()]).toEqual([a.id]);
  });

  it('backspace edits the buffer', () => {
    const e = quiet();
    e.typeChar('a');
    e.typeChar('b');
    e.backspace();
    expect(e.buffer).toBe('a');
  });

  it('treats a non-match as a mistake: combo reset, penalty, floor at 0', () => {
    const e = quiet();
    e.addWord('cloud');
    e.addWord('rain');
    type(e, 'cloud');
    type(e, 'zzz');
    expect(e.combo).toBe(0);
    expect(e.score).toBe(25);
    type(e, 'qqq');
    expect(e.score).toBe(0);
    expect(e.mistakes).toBe(2);
  });

  it('applies the combo multiplier', () => {
    const e = quiet();
    const words = ['aaa', 'bbb', 'ccc', 'ddd', 'eee'];
    for (const w of words) e.addWord(w);
    for (const w of words) type(e, w);
    // 4 words at x1 then the 5th at x1.5
    expect(e.score).toBe(4 * 30 + 45);
  });

  it('ignores an empty submit', () => {
    const e = quiet();
    e.submit();
    expect(e.mistakes).toBe(0);
  });
});

describe('pile and failure', () => {
  it('lands words and raises the landing line', () => {
    const e = quiet();
    const before = e.landingY;
    e.addWord('cat', { y: e.landingY - CONFIG.gameplay.field.wordHeight });
    e.step(GameEngine.STEP);
    expect(e.pile).toHaveLength(1);
    expect(e.landingY).toBe(before - CONFIG.gameplay.field.rowHeight);
  });

  it('fails when the pile reaches the danger line', () => {
    const e = quiet();
    for (let i = 0; i < e.dangerRows; i++) {
      e.addWord(`w${'x'.repeat(i)}`, { y: e.landingY });
      e.step(GameEngine.STEP);
    }
    expect(e.status).toBe('failed');
  });

  it('reinforced floor fits more rows under the same danger line', () => {
    const base = quiet();
    const e = quiet({ upgrades: { ...emptyUpgrades(), reinforcedFloor: 2 } });
    const perRank = CONFIG.upgrades.reinforcedFloor.perRank;
    expect(e.dangerRows).toBe(CONFIG.gameplay.field.baseDangerRows + 2 * perRank);
    expect(e.dangerY).toBe(base.dangerY);
    expect(e.rowHeight * e.dangerRows).toBeCloseTo(base.rowHeight * base.dangerRows);
  });
});

describe('level completion and coins', () => {
  it('completes at quota, clears remaining words without score and grants rewards', () => {
    const e = quiet();
    e.score = e.params.quota - 10;
    e.addWord('rain');
    e.addWord('hail');
    type(e, 'rain');
    expect(e.status).toBe('complete');
    expect(e.words).toHaveLength(0);
    expect(e.score).toBe(e.params.quota + 30);
    const r = e.result();
    expect(r.passed).toBe(true);
    expect(r.perfect).toBe(true);
    expect(r.coins.level).toBe(20);
    expect(r.coins.perfect).toBe(20);
    expect(r.coins.words).toBe(1);
  });

  it('withholds the perfect reward after a mistake', () => {
    const e = quiet();
    e.score = e.params.quota - 10;
    type(e, 'nope');
    e.score = e.params.quota - 10;
    e.addWord('rain');
    type(e, 'rain');
    expect(e.result().coins.perfect).toBe(0);
  });

  it('coin words grant a bonus and coin bonus scales coins', () => {
    const e = quiet({ upgrades: { ...emptyUpgrades(), coinBonus: 2 } });
    const m = 1 + 2 * CONFIG.upgrades.coinBonus.perRank;
    e.addWord('gold', { kind: 'coin' });
    type(e, 'gold');
    const c = CONFIG.gameplay.coins;
    expect(e.coins.words + e.coins.coinWords).toBe(Math.round(c.perWord * m) + Math.round(c.coinWordBonus * m));
  });
});

describe('skill and upgrade definitions', () => {
  it('every skill has data, a behaviour, valid tiers and a price per tier', () => {
    for (const id of SKILL_IDS) {
      const def = CONFIG.skills[id];
      expect(def, id).toBeDefined();
      expect(SKILL_BEHAVIOURS[id], id).toBeDefined();
      expect(def.prices).toHaveLength(def.tiers.length);
      expect(def.unlockLevel).toBeGreaterThanOrEqual(1);
      const timed = !!SKILL_BEHAVIOURS[id].timed;
      for (const t of def.tiers) if (timed) expect(t.duration, id).toBeGreaterThan(0);
    }
  });

  it('every upgrade has data with a price per rank', () => {
    for (const id of UPGRADE_IDS) {
      const def = CONFIG.upgrades[id];
      expect(def, id).toBeDefined();
      expect(def.prices).toHaveLength(def.maxRank);
      expect(def.unlockLevel).toBeGreaterThanOrEqual(1);
    }
  });

  it('each tier and rank is stronger and costs more than the last', () => {
    for (const id of SKILL_IDS) {
      const { prices, tiers } = CONFIG.skills[id];
      for (let i = 1; i < prices.length; i++) expect(prices[i], id).toBeGreaterThan(prices[i - 1]);
      for (let i = 1; i < tiers.length; i++) {
        const [a, b] = [tiers[i - 1], tiers[i]];
        if (a.count !== undefined) expect(b.count!).toBeGreaterThan(a.count);
        if (a.duration !== undefined) expect(b.duration!).toBeGreaterThan(a.duration);
        if (a.speed !== undefined) expect(b.speed!).toBeLessThan(a.speed);
        if (a.rows !== undefined) expect(b.rows!).toBeGreaterThan(a.rows);
      }
    }
    for (const id of UPGRADE_IDS) {
      const { prices } = CONFIG.upgrades[id];
      for (let i = 1; i < prices.length; i++) expect(prices[i], id).toBeGreaterThan(prices[i - 1]);
    }
  });
});

describe('skills and the charge pool', () => {
  it('charge words add to the pool up to capacity', () => {
    const e = quiet({ skills: withSkill('FIRE') });
    for (let i = 0; i < 4; i++) e.addWord(`c${'a'.repeat(i + 2)}`, { kind: 'charge', skill: 'FIRE' });
    for (let i = 0; i < 4; i++) type(e, `c${'a'.repeat(i + 2)}`);
    expect(e.pool).toHaveLength(CONFIG.gameplay.chargePool.baseCapacity);
    expect(e.drainEvents().some((ev) => ev.type === 'poolFull')).toBe(true);
  });

  it('charge capacity adds slots', () => {
    const e = quiet({ upgrades: { ...emptyUpgrades(), chargeCapacity: 2 } });
    expect(e.capacity).toBe(CONFIG.gameplay.chargePool.baseCapacity + 2 * CONFIG.upgrades.chargeCapacity.perRank);
  });

  it('typing a skill without a charge is not a mistake', () => {
    const e = quiet({ skills: withSkill('FIRE') });
    e.addWord('aaa');
    type(e, 'aaa');
    type(e, 'fire');
    expect(e.mistakes).toBe(0);
    expect(e.combo).toBe(1);
    expect(e.drainEvents().some((ev) => ev.type === 'noCharge')).toBe(true);
  });

  it('firing a skill spends a charge and does not touch the combo', () => {
    const e = quiet({ skills: withSkill('ICE') });
    e.pool = ['ICE'];
    e.combo = 3;
    type(e, 'ice');
    expect(e.pool).toHaveLength(0);
    expect(e.effects.ICE).toBeDefined();
    expect(e.combo).toBe(3);
  });

  it('FIRE burns the lowest words; burnt words give coins but no score', () => {
    const e = quiet();
    e.addWord('top', { y: 10 });
    e.addWord('mid', { y: 100 });
    e.addWord('low', { y: 200 });
    e.fire('FIRE', 1); // Tier I burns 2
    expect(e.words.map((w) => w.text)).toEqual(['top']);
    expect(e.score).toBe(0);
    expect(e.coins.words).toBeGreaterThan(0);
  });

  it('ICE freezes words and spawning; firing again resets instead of stacking', () => {
    const e = quiet();
    const w = e.addWord('cold', { y: 50 });
    e.fire('ICE', 1);
    for (let i = 0; i < 120; i++) e.step(GameEngine.STEP);
    expect(w.y).toBe(50);
    e.fire('ICE', 1);
    expect(e.effects.ICE!.remaining).toBe(CONFIG.skills.ICE.tiers[0].duration);
    for (let i = 0; i < 120 * 10; i++) e.step(GameEngine.STEP);
    expect(e.effects.ICE).toBeUndefined();
    expect(w.y).toBeGreaterThan(50);
  });

  it('SLOW scales fall speed by its tier factor', () => {
    const base = quiet();
    const slow = quiet();
    const a = base.addWord('aaa');
    const b = slow.addWord('aaa');
    slow.fire('SLOW', 2);
    for (let i = 0; i < 120; i++) {
      base.step(GameEngine.STEP);
      slow.step(GameEngine.STEP);
    }
    expect(b.y).toBeCloseTo(a.y * CONFIG.skills.SLOW.tiers[1].speed!, 1);
  });

  it('WIND removes pile rows and pushes falling words up', () => {
    const e = quiet();
    e.pile = Array.from({ length: 6 }, (_, i) => ({ text: `r${i}`, kind: 'normal' as const }));
    const w = e.addWord('gust', { y: 300 });
    e.fire('WIND', 1);
    const t = CONFIG.skills.WIND.tiers[0];
    expect(e.pile).toHaveLength(6 - t.rows!);
    expect(w.y).toBeCloseTo(300 - t.push! * e.field.height);
  });

  it('only spawns charge words for owned skills', () => {
    const e = make({ level: 10, skills: withSkill('ICE'), seed: 3 });
    const seen = new Set<string>();
    for (let i = 0; i < 120 * 120 && e.status === 'playing'; i++) {
      e.step(GameEngine.STEP);
      for (const w of e.words) if (w.kind === 'charge') seen.add(w.skill!);
      e.words.splice(0, e.words.length - 10);
    }
    expect([...seen]).toEqual(['ICE']);
  });

  it('lucky draw raises the charge word rate', () => {
    const count = (luckyDraw: number) => {
      const e = make({ level: 5, skills: withSkill('FIRE'), upgrades: { ...emptyUpgrades(), luckyDraw }, seed: 11 });
      let charges = 0;
      const seen = new Set<number>();
      for (let i = 0; i < 120 * 120; i++) {
        e.step(GameEngine.STEP);
        for (const w of e.words) if (w.kind === 'charge' && !seen.has(w.id)) (seen.add(w.id), charges++);
        e.words.length = 0;
        e.pile.length = 0;
      }
      return charges;
    };
    expect(count(3)).toBeGreaterThan(count(0) * 1.5);
  });
});

describe('hazards', () => {
  it('black words speed up on mistakes', () => {
    const e = quiet();
    const b = e.addWord('dark', { kind: 'black' });
    type(e, 'zzz');
    expect(b.speedMul).toBe(CONFIG.gameplay.blackWord.speedMultiplier);
  });
});
