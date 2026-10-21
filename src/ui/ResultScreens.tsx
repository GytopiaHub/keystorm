import { CONFIG } from '../engine/config';
import type { AttemptResult, SkillId } from '../engine/types';
import { useGame } from '../state/store';
import { Button, Coins, CountUp, Screen, SkillIcon, Stat } from './common';

function AttemptStats({ r }: { r: AttemptResult }) {
  const used = (Object.entries(r.skillsUsed) as [SkillId, number][]).filter(([, n]) => n > 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Score / quota"
          value={
            <span>
              <CountUp value={r.score} /> <span className="text-base text-slate-500">/ {r.quota}</span>
            </span>
          }
          accent={r.passed ? 'text-emerald-300' : 'text-rose-300'}
        />
        <Stat label="WPM" value={<CountUp value={r.wpm} />} accent="text-cyan-300" />
        <Stat label="Accuracy" value={`${r.accuracy}%`} />
        <Stat label="Highest combo" value={<CountUp value={r.maxCombo} />} accent="text-fuchsia-300" />
        <Stat label="Words cleared" value={<CountUp value={r.wordsCleared} />} />
        <Stat label="Mistakes" value={r.mistakes} />
        <Stat label="Coins earned" value={<Coins value={r.coins.total} />} />
        <Stat label="Skills used" value={used.reduce((n, [, c]) => n + c, 0)} />
      </div>
      {used.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {used.map(([s, n]) => (
            <span
              key={s}
              className="flex items-center gap-1.5 rounded-xl bg-black/40 py-1 pl-1 pr-3 font-display font-bold"
              style={{ color: CONFIG.skills[s].color, boxShadow: `0 0 0 1px ${CONFIG.skills[s].color}` }}
            >
              <SkillIcon id={s} size={26} /> {s} ×{n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function LevelCompleteScreen() {
  const r = useGame((s) => s.lastResult);
  const openShop = useGame((s) => s.openShop);
  if (!r) return null;
  return (
    <Screen
      title={
        <div className="flex items-center gap-4">
          <span className="text-emerald-300 glow-text">Level {r.level} complete!</span>
          {r.perfect && <span className="perfect-badge rounded-full px-3 py-0.5 text-sm font-black tracking-[0.2em] text-amber-950">PERFECT</span>}
        </div>
      }
      footer={
        <Button variant="primary" onClick={openShop}>
          Continue to shop
        </Button>
      }
    >
      <div className="stagger mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Word coins" value={<Coins value={r.coins.words + r.coins.coinWords} />} />
        <Stat label="Level reward" value={<Coins value={r.coins.level} />} />
        <Stat
          label="Perfect bonus"
          value={r.perfect ? <Coins value={r.coins.perfect} /> : <span className="text-base text-slate-500">— (made mistakes)</span>}
        />
        <Stat label="Total" value={<Coins value={r.coins.total} />} accent="text-amber-300" />
      </div>
      <AttemptStats r={r} />
    </Screen>
  );
}

export function LevelFailedScreen() {
  const r = useGame((s) => s.lastResult);
  const { startLevel, openShop, goTo } = useGame.getState();
  if (!r) return null;
  return (
    <Screen
      title={<span className="text-rose-300 glow-text">Level {r.level} failed — the flood reached the line</span>}
      footer={
        <>
          <Button variant="ghost" onClick={() => goTo('menu')}>
            Menu
          </Button>
          <Button onClick={openShop}>Shop</Button>
          <Button variant="primary" onClick={() => startLevel(r.level)}>
            Retry level {r.level}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-400">
        You keep the coins from this attempt. Spend them on skills and upgrades to get past this level.
      </p>
      <AttemptStats r={r} />
    </Screen>
  );
}
