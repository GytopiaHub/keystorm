// @vitest-environment node
/**
 * Balance simulation: bot typists play the real engine through the campaign, buying from
 * the shop between attempts. Skipped in normal test runs; run with `npm run sim`.
 */
import { describe, it } from 'vitest';
import { CONFIG, skillPrice, upgradePrice } from '../engine/config';
import { GameEngine } from '../engine/engine';
import { SKILL_IDS, UPGRADE_IDS, type SkillId } from '../engine/types';
import { applyResult, buySkill, buyUpgrade, defaultProgress, isUnlocked, type Progress } from '../state/progress';

interface Bot {
  name: string;
  wpm: number;
  accuracy: number;
  /** Seconds before starting to type a new word. */
  reaction: number;
}

const BOTS: Bot[] = [
  { name: 'casual (30 wpm, 90%)', wpm: 30, accuracy: 0.9, reaction: 0.5 },
  { name: 'average (45 wpm, 95%)', wpm: 45, accuracy: 0.95, reaction: 0.35 },
  { name: 'strong (70 wpm, 97%)', wpm: 70, accuracy: 0.97, reaction: 0.25 },
];

let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);

/**
 * Which skill the bot fires now, if any. Like a player, it holds charges until danger (a word
 * about to land, or the pile near the line), then uses whatever fits.
 */
function chooseSkill(e: GameEngine): SkillId | null {
  const has = (s: SkillId) => e.pool.includes(s);
  const rowsLeft = e.dangerRows - e.pile.length;
  const speed = e.params.fallSpeed * e.heightScale;
  const fallTime = (y: number) => (e.landingY - y - e.field.wordHeight) / speed;
  const urgent = e.words.filter((w) => fallTime(w.y) < 1.8).length;
  if (!urgent && rowsLeft > 3) return null;
  if (has('WIND') && rowsLeft <= 3 && e.pile.length >= 2) return 'WIND';
  if (has('FIRE') && urgent >= 1) return 'FIRE';
  if (has('ICE') && !e.frozen) return 'ICE';
  if (has('SLOW') && !e.effects.SLOW && !e.frozen) return 'SLOW';
  if (has('WIND') && e.pile.length >= 2) return 'WIND';
  return null;
}

function playAttempt(level: number, p: Progress, bot: Bot) {
  const e = new GameEngine({ level, skills: p.skills, upgrades: p.upgrades, seed: Math.floor(rand() * 2 ** 31) });
  const cps = (bot.wpm * 5) / 60;
  let t = 0;
  let pending: { at: number; run: () => void } | null = null;
  while (e.status === 'playing' && t < 300) {
    e.step(GameEngine.STEP);
    t += GameEngine.STEP;
    if (pending) {
      if (t < pending.at) continue;
      pending.run();
      pending = null;
      continue;
    }
    const skill = chooseSkill(e);
    if (skill) {
      pending = { at: t + bot.reaction + (skill.length + 1) / cps, run: () => ((e.buffer = skill.toLowerCase()), e.submit()) };
      continue;
    }
    const target = [...e.words].sort((a, b) => b.y - a.y)[0];
    if (!target) continue;
    const typo = rand() > bot.accuracy;
    const text = target.text;
    pending = {
      at: t + bot.reaction + (text.length + 1) / cps,
      run: () => {
        // A player who sees their word land stops rather than submitting it.
        if (!e.words.includes(target)) return;
        e.buffer = typo ? `${text}x` : text;
        e.submit();
      },
    };
  }
  return { ...e.result(), seconds: t };
}

/** Greedy shopper: buys the cheapest thing it can, skills before upgrades. */
function shop(p: Progress): Progress {
  for (;;) {
    const options: { price: number; buy: () => Progress | null }[] = [];
    for (const s of SKILL_IDS) {
      const price = skillPrice(s, p.skills[s]);
      if (price !== null && isUnlocked(p, CONFIG.skills[s])) options.push({ price: price * 0.8, buy: () => buySkill(p, s) });
    }
    for (const u of UPGRADE_IDS) {
      const price = upgradePrice(u, p.upgrades[u]);
      if (price !== null && isUnlocked(p, CONFIG.upgrades[u])) options.push({ price, buy: () => buyUpgrade(p, u) });
    }
    options.sort((a, b) => a.price - b.price);
    const next = options.map((o) => o.buy()).find(Boolean);
    if (!next) return p;
    p = next;
  }
}

function campaign(bot: Bot, attemptsBudget: number, useShop: boolean) {
  let p = defaultProgress();
  const perLevel = new Map<number, { attempts: number; coins: number; seconds: number }>();
  for (let a = 0; a < attemptsBudget; a++) {
    const level = p.currentLevel;
    const r = playAttempt(level, p, bot);
    p = applyResult(p, r);
    const row = perLevel.get(level) ?? { attempts: 0, coins: 0, seconds: 0 };
    row.attempts++;
    row.coins += r.coins.total;
    row.seconds += r.seconds;
    perLevel.set(level, row);
    if (useShop) p = shop(p);
  }
  return { p, perLevel };
}

describe.skipIf(process.env.SIM !== '1')('balance simulation', () => {
  it('runs the campaign for each bot', () => {
    const budget = Number(process.env.SIM_ATTEMPTS ?? 60);
    for (const bot of BOTS) {
      for (const useShop of [false, true]) {
        seed = 777;
        const { p, perLevel } = campaign(bot, budget, useShop);
        const rows = [...perLevel.entries()].map(
          ([lvl, r]) => `L${lvl}: ${r.attempts}x ${Math.round(r.seconds / r.attempts)}s +${Math.round(r.coins / r.attempts)}c`,
        );
        const owned = [
          ...SKILL_IDS.filter((s) => p.skills[s]).map((s) => `${s}${p.skills[s]}`),
          ...UPGRADE_IDS.filter((u) => p.upgrades[u]).map((u) => `${u}${p.upgrades[u]}`),
        ];
        console.log(
          `\n${bot.name} ${useShop ? 'WITH shop' : 'no shop'}: reached L${p.currentLevel} in ${budget} attempts, ${p.coins} coins left\n  owned: ${owned.join(' ') || '-'}\n  ${rows.join(' | ')}`,
        );
      }
    }
  });
});

/** Pass rate at a level when owning exactly one item, versus owning nothing. */
function itemValue(bot: Bot, level: number, runs: number) {
  const base = defaultProgress();
  base.currentLevel = 99;
  const passRate = (p: Progress) => {
    // Same seeds for every configuration, so differences come from the item, not luck.
    seed = 4242;
    let passed = 0;
    let rows = 0;
    let used = 0;
    let secs = 0;
    let coins = 0;
    for (let i = 0; i < runs; i++) {
      const r = playAttempt(level, p, bot);
      if (r.passed) passed++;
      rows += r.score / r.quota;
      used += Object.values(r.skillsUsed).reduce((a, b) => a + (b ?? 0), 0);
      secs += r.seconds;
      coins += r.coins.total;
    }
    return {
      pass: Math.round((passed / runs) * 100),
      progress: `${Math.round((rows / runs) * 100)}% quota, ${(used / runs).toFixed(1)} casts, ${Math.round(secs / runs)}s, ${Math.round(coins / runs)}c`,
    };
  };
  const out: string[] = [];
  const none = passRate(base);
  out.push(`none: ${none.pass}% pass, ${none.progress}`);
  for (const s of SKILL_IDS) {
    for (const tier of [1, 2, 3]) {
      const p = { ...base, skills: { ...base.skills, [s]: tier } };
      const cost = CONFIG.skills[s].prices.slice(0, tier).reduce((a, b) => a + b, 0);
      const r = passRate(p);
      out.push(`${s}${tier} (${cost}c): ${r.pass}% pass, ${r.progress}`);
    }
  }
  // Upgrades act through skills, so measure them on top of a starter kit.
  const kit = { ...base, skills: { ...base.skills, SLOW: 2, FIRE: 2 } };
  const k = passRate(kit);
  out.push(`kit SLOW2+FIRE2: ${k.pass}% pass, ${k.progress}`);
  for (const u of UPGRADE_IDS) {
    for (let rank = 1; rank <= CONFIG.upgrades[u].maxRank; rank++) {
      const p = { ...kit, upgrades: { ...kit.upgrades, [u]: rank } };
      const cost = CONFIG.upgrades[u].prices.slice(0, rank).reduce((a, b) => a + b, 0);
      const r = passRate(p);
      out.push(`  +${u}${rank} (${cost}c): ${r.pass}% pass, ${r.progress}`);
    }
  }
  return out;
}

describe.skipIf(process.env.SIM !== 'items')('item value', () => {
  it('measures each skill and upgrade alone', () => {
    const runs = Number(process.env.SIM_RUNS ?? 60);
    const edges = (process.env.SIM_EDGES ?? '0:3,1:5,2:9').split(',').map((x) => x.split(':').map(Number));
    for (const [botIdx, level] of edges) {
      const bot = BOTS[botIdx];
      seed = 99;
      console.log(`\n${bot.name} at L${level}:\n  ${itemValue(bot, level, runs).join('\n  ')}`);
    }
  });
});
