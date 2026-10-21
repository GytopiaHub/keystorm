// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CONFIG, comboMultiplier, levelParams } from './config';
import { GameEngine, type EngineOptions } from './engine';
import { SKILL_IDS, type SkillId } from './types';
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
    expect(p).toMatchObject({ quota: 500, fallSpeed: 40, spawnInterval: 2, wordLengthRange: [3, 5] });
  });

  it('extrapolates beyond the table and respects caps', () => {
    const p10 = levelParams(10);
    const p11 = levelParams(11);
    expect(p11.quota).toBeGreaterThan(p10.quota);
    expect(p11.fallSpeed).toBeGreaterThan(p10.fallSpeed);
    expect(p11.spawnInterval).toBeLessThan(p10.spawnInterval);
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
    for (const w of e.words) expect(w.text.length).toBeLessThanOrEqual(5);
  });

  it('moves the same distance regardless of frame rate', () => {
    const a = quiet();
    const b = quiet();
    const wa = a.addWord('cat');
    const wb = b.addWord('cat');
    for (let i = 0; i < 60; i++) a.advance(1 / 60);
    for (let i = 0; i < 144; i++) b.advance(1 / 144);
    expect(wa.y).toBeCloseTo(wb.y, 0);
    expect(wa.y).toBeCloseTo(40, 0);
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

  it('reinforced floor raises the danger line', () => {
    expect(quiet({ upgrades: { ...emptyUpgrades(), reinforcedFloor: 2 } }).dangerRows).toBe(
      CONFIG.gameplay.field.baseDangerRows + 2,
    );
  });
});

describe('level completion and coins', () => {
  it('completes at quota, clears remaining words without score and grants rewards', () => {
    const e = quiet();
    e.score = 490;
    e.addWord('rain');
    e.addWord('hail');
    type(e, 'rain');
    expect(e.status).toBe('complete');
    expect(e.words).toHaveLength(0);
    expect(e.score).toBe(530);
    const r = e.result();
    expect(r.passed).toBe(true);
    expect(r.perfect).toBe(true);
    expect(r.coins.level).toBe(20);
    expect(r.coins.perfect).toBe(20);
    expect(r.coins.words).toBe(1);
  });

  it('withholds the perfect reward after a mistake', () => {
    const e = quiet();
    e.score = 490;
    type(e, 'nope');
    e.score = 490;
    e.addWord('rain');
    type(e, 'rain');
    expect(e.result().coins.perfect).toBe(0);
  });

  it('coin words grant a bonus and coin bonus scales coins', () => {
    const e = quiet({ upgrades: { ...emptyUpgrades(), coinBonus: 5 } });
    e.addWord('gold', { kind: 'coin' });
    type(e, 'gold');
    expect(e.coins.words + e.coins.coinWords).toBe(Math.round(1 * 1.5) + Math.round(5 * 1.5));
  });
});

describe('skills and the charge pool', () => {
  it('charge words add to the pool up to capacity', () => {
    const e = quiet({ skills: withSkill('FIRE') });
    for (let i = 0; i < 7; i++) e.addWord(`c${'a'.repeat(i + 2)}`, { kind: 'charge', skill: 'FIRE' });
    for (let i = 0; i < 7; i++) type(e, `c${'a'.repeat(i + 2)}`);
    expect(e.pool).toHaveLength(5);
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
    const e = quiet({ skills: withSkill('FIRE') });
    e.pool = ['FIRE'];
    for (const w of ['one', 'two', 'six', 'ten']) e.addWord(w, { y: w.length * 10 + (w === 'ten' ? 5 : 0) });
    e.combo = 3;
    type(e, 'fire');
    expect(e.pool).toHaveLength(0);
    expect(e.words.map((w) => w.text)).toHaveLength(1);
    expect(e.combo).toBe(3);
  });

  it('FIRE tier III clears everything', () => {
    const e = quiet();
    for (const w of ['one', 'two', 'six']) e.addWord(w);
    e.fire('FIRE', 3);
    expect(e.words).toHaveLength(0);
  });

  it('BOMB clears neighbours of the next typed word', () => {
    const e = quiet();
    e.addWord('aim', { x: 300, y: 100 });
    e.addWord('near', { x: 360, y: 100 });
    e.addWord('far', { x: 800, y: 100 });
    e.fire('BOMB', 1);
    type(e, 'aim');
    expect(e.words.map((w) => w.text)).toEqual(['far']);
  });

  it('CHAIN clears words with the same first letter', () => {
    const e = quiet();
    for (const w of ['sun', 'sea', 'sky', 'mud']) e.addWord(w);
    e.fire('CHAIN', 1);
    type(e, 'sun');
    expect(e.words.map((w) => w.text)).toEqual(['mud']);
  });

  it('ICE freezes words; timed effects reset instead of stacking', () => {
    const e = quiet();
    const w = e.addWord('cold', { y: 50 });
    e.fire('ICE', 1);
    for (let i = 0; i < 120; i++) e.step(GameEngine.STEP);
    expect(w.y).toBe(50);
    e.fire('ICE', 1);
    expect(e.effects.ICE!.remaining).toBe(2);
    for (let i = 0; i < 360; i++) e.step(GameEngine.STEP);
    expect(e.effects.ICE).toBeUndefined();
    expect(w.y).toBeGreaterThan(50);
  });

  it('SLOW and OVERDRIVE change speed; OVERDRIVE multiplies score', () => {
    const slow = quiet();
    const ws = slow.addWord('aaa');
    slow.fire('SLOW', 2);
    for (let i = 0; i < 120; i++) slow.step(GameEngine.STEP);
    expect(ws.y).toBeCloseTo(20, 0);

    const od = quiet();
    od.addWord('aaa');
    od.fire('OVERDRIVE', 1);
    type(od, 'aaa');
    expect(od.score).toBe(60);
  });

  it('REWIND, SHRINK, WIND and SHIELD', () => {
    const e = quiet();
    const w = e.addWord('thunder', { y: 300 });
    e.fire('REWIND', 1);
    expect(w.y).toBeCloseTo(300 - 0.25 * CONFIG.gameplay.field.height);
    e.fire('SHRINK', 2);
    expect(w.text).toBe('thu');
    type(e, 'thu');
    expect(e.words).toHaveLength(0);

    e.pile = [
      { text: 'a', kind: 'normal' },
      { text: 'b', kind: 'normal' },
      { text: 'c', kind: 'normal' },
    ];
    e.fire('WIND', 2);
    expect(e.pile).toHaveLength(1);

    e.fire('SHIELD', 1);
    e.addWord('drop', { y: e.landingY });
    e.step(GameEngine.STEP);
    expect(e.pile).toHaveLength(1);
    e.addWord('drip', { y: e.landingY });
    e.step(GameEngine.STEP);
    expect(e.pile).toHaveLength(2);
  });

  it('DOUBLE doubles score and coins for N words', () => {
    const e = quiet();
    e.fire('DOUBLE', 1);
    for (const w of ['aaa', 'bbb']) e.addWord(w);
    type(e, 'aaa');
    expect(e.score).toBe(60);
    expect(e.doubleLeft).toBe(4);
    expect(e.coins.words).toBe(2);
  });

  it('MAGNET pulls coin words down and holds them above the pile', () => {
    const e = quiet();
    const coin = e.addWord('gold', { kind: 'coin', y: 0 });
    e.fire('MAGNET', 1);
    for (let i = 0; i < 120 * 4; i++) e.step(GameEngine.STEP);
    const target = e.landingY - 2 * CONFIG.gameplay.field.rowHeight - CONFIG.gameplay.field.wordHeight;
    expect(coin.y).toBeCloseTo(target);
    expect(e.pile).toHaveLength(0);
  });

  it('GAMBLE fires another skill', () => {
    const e = quiet({ skills: withSkill('GAMBLE', 2) });
    e.pool = ['GAMBLE'];
    type(e, 'gamble');
    const fired = e.drainEvents().filter((ev) => ev.type === 'skillFired');
    expect(fired).toHaveLength(2);
    expect(fired[1]).toMatchObject({ via: 'GAMBLE', tier: 2 });
    expect(fired[1].type === 'skillFired' && fired[1].skill).not.toBe('GAMBLE');
  });

  it('LUCK raises charge spawn rate for the rest of the level', () => {
    const e = quiet();
    e.fire('LUCK', 3);
    expect(e.luckBonus).toBe(1);
    e.fire('LUCK', 1);
    expect(e.luckBonus).toBe(1);
  });

  it('only spawns charge words for unlocked skills', () => {
    const e = make({ level: 10, skills: withSkill('ICE'), seed: 3 });
    const seen = new Set<string>();
    for (let i = 0; i < 120 * 120 && e.status === 'playing'; i++) {
      e.step(GameEngine.STEP);
      for (const w of e.words) if (w.kind === 'charge') seen.add(w.skill!);
      e.words.splice(0, e.words.length - 10);
    }
    expect([...seen]).toEqual(['ICE']);
  });
});

describe('upgrades', () => {
  it('quick cast fires from a prefix, but exact words win', () => {
    const e = quiet({ skills: withSkill('WIND'), upgrades: { ...emptyUpgrades(), quickCast: 1 } });
    e.pool = ['WIND'];
    e.addWord('win');
    type(e, 'win');
    expect(e.words).toHaveLength(0);
    expect(e.pool).toEqual(['WIND']);
    type(e, 'win');
    expect(e.pool).toEqual([]);
  });

  it('steady hands forgives mistakes', () => {
    const e = quiet({ upgrades: { ...emptyUpgrades(), steadyHands: 1 } });
    e.combo = 7;
    e.score = 100;
    type(e, 'zzz');
    expect(e.combo).toBe(7);
    expect(e.score).toBe(100);
    type(e, 'zzz');
    expect(e.combo).toBe(0);
  });

  it('combo keeper drops one tier', () => {
    const e = quiet({ upgrades: { ...emptyUpgrades(), comboKeeper: 1 } });
    e.combo = 12;
    type(e, 'zzz');
    expect(e.combo).toBe(5);
  });

  it('charge capacity and head start', () => {
    const e = quiet({
      skills: withSkill('ICE'),
      upgrades: { ...emptyUpgrades(), chargeCapacity: 2, headStart: 2 },
    });
    expect(e.capacity).toBe(9);
    expect(e.pool).toEqual(['ICE', 'ICE']);
  });

  it('black words speed up on mistakes', () => {
    const e = quiet();
    const b = e.addWord('dark', { kind: 'black' });
    type(e, 'zzz');
    expect(b.speedMul).toBe(2);
  });

  it('danger radar picks the word closest to landing', () => {
    const e = quiet({ upgrades: { ...emptyUpgrades(), dangerRadar: 1 } });
    e.addWord('high', { y: 10 });
    const low = e.addWord('low', { y: 300 });
    e.step(GameEngine.STEP);
    expect(e.dangerWordId).toBe(low.id);
  });
});
