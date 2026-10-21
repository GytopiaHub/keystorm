import { useCallback, useEffect, useRef, useState } from 'react';
import { play } from '../audio/sfx';
import { CONFIG } from '../engine/config';
import type { HudSnapshot } from '../engine/engine';
import type { EngineEvent, SkillId } from '../engine/types';
import { FieldCanvas } from '../render/FieldCanvas';
import { useGame } from '../state/store';
import { Button, Coins } from './common';

/** Seconds to linger on the field after the quota is met or the pile tops out. */
const END_DELAY = 1.1;

export function PlayScreen() {
  const engine = useGame((s) => s.engine);
  const screen = useGame((s) => s.screen);
  const reducedMotion = useGame((s) => s.settings.reducedMotion);
  const paused = screen === 'paused';

  const lastVersion = useRef(-1);
  const hudClock = useRef(0);
  const endClock = useRef(0);
  const ended = useRef(false);

  const onFrame = useCallback((dt: number): EngineEvent[] => {
    const s = useGame.getState();
    const eng = s.engine;
    if (!eng) return [];
    if (s.screen === 'playing') eng.advance(dt);
    const events = eng.drainEvents();
    if (events.length) reactTo(events);

    hudClock.current += dt;
    const timers = Object.keys(eng.effects).length > 0;
    if (eng.version !== lastVersion.current || (timers && hudClock.current >= 0.1)) {
      lastVersion.current = eng.version;
      hudClock.current = 0;
      s.setHud(eng.hud());
    }

    if (eng.status !== 'playing' && !ended.current) {
      endClock.current += dt;
      if (endClock.current >= END_DELAY) {
        ended.current = true;
        s.endAttempt();
      }
    }
    return events;
  }, []);

  useKeyboard();
  useAutoPause();

  if (!engine) return null;
  return (
    <div className="flex h-screen flex-col bg-[#05070f]">
      <TopBar />
      <div className="relative min-h-0 flex-1">
        <div className={`h-full w-full ${paused ? 'invisible' : ''}`}>
          <FieldCanvas engine={engine} paused={paused} reducedMotion={reducedMotion} onFrame={onFrame} />
        </div>
        {!paused && <EffectsBar />}
        {!paused && <Toasts />}
        {paused && <PauseOverlay />}
      </div>
      <BottomBar />
    </div>
  );
}

function reactTo(events: EngineEvent[]) {
  const s = useGame.getState();
  for (const e of events) {
    switch (e.type) {
      case 'cleared':
        if (e.cause === 'typed') play(e.word.kind === 'coin' ? 'coin' : 'clear');
        else if (e.cause !== 'levelEnd' && e.word.kind === 'coin') play('coin');
        break;
      case 'chargeGained':
        play('charge');
        break;
      case 'poolFull':
        s.showToast(`Charge pool full — ${e.skill} charge lost`, 'bad');
        break;
      case 'mistake':
        play('mistake');
        if (e.forgiven) s.showToast('Mistake forgiven (Steady hands)', 'good');
        break;
      case 'noCharge':
        play('noCharge');
        s.showToast(e.locked ? `${e.skill} is locked — buy it in the shop` : `No ${e.skill} charge`, 'info');
        break;
      case 'skillFired':
        play(e.skill === 'BOMB' ? 'thunder' : 'skill');
        if (e.via === 'GAMBLE') s.showToast(`GAMBLE → ${e.skill} (Tier ${e.tier})`, 'good');
        break;
      case 'bomb':
        play('thunder');
        break;
      case 'landed':
        play('land');
        if (e.shielded) s.showToast('Shield absorbed a word', 'good');
        break;
      case 'comboTier':
        play('combo');
        s.flashCombo(e.multiplier);
        break;
      case 'levelComplete':
        play('complete');
        break;
      case 'levelFailed':
        play('fail');
        break;
    }
  }
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useGame.getState();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (s.screen === 'playing') s.pause();
        else if (s.screen === 'paused') s.resume();
        return;
      }
      const eng = s.engine;
      if (s.screen !== 'playing' || !eng || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        eng.backspace();
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!e.repeat) eng.submit();
      } else if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
        e.preventDefault();
        eng.typeChar(e.key);
        play('key');
      } else {
        return;
      }
      s.setBuffer(eng.buffer);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Pause whenever the window loses focus or the tab is hidden (FR-49, NFR-09). */
function useAutoPause() {
  useEffect(() => {
    const pause = () => useGame.getState().pause();
    const onVisibility = () => document.hidden && pause();
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}

// ---- HUD pieces ------------------------------------------------------------------------

function TopBar() {
  const hud = useGame((s) => s.hud);
  const savedCoins = useGame((s) => s.progress.coins);
  const pause = useGame((s) => s.pause);
  if (!hud) return null;
  const pct = Math.min(100, (hud.score / hud.quota) * 100);
  return (
    <div className="flex h-14 shrink-0 items-center gap-5 border-b border-slate-800 bg-slate-950 px-4">
      <div className="text-sm uppercase tracking-widest text-slate-400">
        Level <span className="text-xl font-bold text-white tabular-nums">{hud.level}</span>
      </div>
      <div className="flex min-w-40 flex-1 flex-col gap-1">
        <div className="flex justify-between text-xs text-slate-400">
          <span>
            Score <span className="font-bold text-white tabular-nums" data-testid="score">{hud.score}</span>
          </span>
          <span className="tabular-nums">Quota {hud.quota}</span>
        </div>
        <div
          className="h-2.5 overflow-hidden rounded-full bg-slate-800"
          role="progressbar"
          aria-label="Quota"
          aria-valuenow={hud.score}
          aria-valuemax={hud.quota}
        >
          <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ComboMeter hud={hud} />
      <Coins value={savedCoins + hud.coins} />
      <Button variant="ghost" className="px-2 py-1 text-sm" onClick={pause} aria-label="Pause (Esc)">
        ❚❚ <span className="text-xs text-slate-500">Esc</span>
      </Button>
    </div>
  );
}

function ComboMeter({ hud }: { hud: HudSnapshot }) {
  const flash = useGame((s) => s.comboFlash);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!flash) return;
    setShown(flash.id);
    const t = setTimeout(() => setShown(null), 1100);
    return () => clearTimeout(t);
  }, [flash]);
  return (
    <div className="relative flex items-baseline gap-2" data-testid="combo">
      <span className="text-xs uppercase tracking-widest text-slate-400">Combo</span>
      <span className="text-2xl font-black tabular-nums text-white">{hud.combo}</span>
      <span className={`rounded-md px-1.5 py-0.5 text-sm font-bold ${hud.multiplier > 1 ? 'bg-fuchsia-500/20 text-fuchsia-300' : 'text-slate-500'}`}>
        ×{hud.multiplier}
      </span>
      {flash && shown === flash.id && (
        <span key={flash.id} className="combo-pop pointer-events-none absolute -bottom-8 left-0 whitespace-nowrap text-lg font-black text-fuchsia-300">
          ×{flash.multiplier} COMBO!
        </span>
      )}
    </div>
  );
}

const EFFECT_LABEL: Record<string, string> = {
  CHAIN: 'Chain',
  ICE: 'Frozen',
  SLOW: 'Slow',
  MAGNET: 'Magnet',
  OVERDRIVE: 'Overdrive',
};

function EffectsBar() {
  const hud = useGame((s) => s.hud);
  if (!hud) return null;
  const chips: { key: string; skill: SkillId; text: string; frac?: number }[] = hud.effects.map((e) => ({
    key: e.skill,
    skill: e.skill,
    text: `${EFFECT_LABEL[e.skill]}${e.skill === 'OVERDRIVE' ? ` ×${hud.overdriveMultiplier}` : ''} ${e.remaining.toFixed(1)}s`,
    frac: e.remaining / e.duration,
  }));
  if (hud.bombArmed) chips.push({ key: 'bomb', skill: 'BOMB', text: 'Bomb armed' });
  if (hud.doubleLeft > 0) chips.push({ key: 'double', skill: 'DOUBLE', text: `Double ×${hud.doubleLeft}` });
  if (hud.shieldLeft > 0) chips.push({ key: 'shield', skill: 'SHIELD', text: `Shield ×${hud.shieldLeft}` });
  if (hud.luckBonus > 0) chips.push({ key: 'luck', skill: 'LUCK', text: `Luck +${Math.round(hud.luckBonus * 100)}%` });
  if (!chips.length) return null;
  return (
    <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5" aria-live="polite">
      {chips.map((c) => {
        const def = CONFIG.skills[c.skill];
        return (
          <div key={c.key} className="w-48 overflow-hidden rounded-md bg-slate-950/80 text-sm ring-1" style={{ ['--tw-ring-color' as string]: def.color }}>
            <div className="flex items-center gap-1.5 px-2 py-1">
              <span aria-hidden>{def.icon}</span>
              <span className="font-semibold tabular-nums">{c.text}</span>
            </div>
            {c.frac !== undefined && <div className="h-1" style={{ width: `${c.frac * 100}%`, background: def.color }} />}
          </div>
        );
      })}
    </div>
  );
}

function Toasts() {
  const toast = useGame((s) => s.toast);
  const [visible, setVisible] = useState<number | null>(null);
  useEffect(() => {
    if (!toast) return;
    setVisible(toast.id);
    const t = setTimeout(() => setVisible(null), 1400);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || visible !== toast.id) return null;
  const tone = toast.tone === 'bad' ? 'text-rose-200 ring-rose-500/60' : toast.tone === 'good' ? 'text-emerald-200 ring-emerald-500/60' : 'text-slate-100 ring-slate-500/60';
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center" role="status">
      <div className={`toast-in rounded-lg bg-slate-950/90 px-4 py-2 text-sm font-semibold ring-1 ${tone}`}>{toast.text}</div>
    </div>
  );
}

function PauseOverlay() {
  const { resume, restart, quitToMenu } = useGame.getState();
  return (
    <div className="storm-bg absolute inset-0 flex items-center justify-center">
      <div className="flex w-72 flex-col gap-3 rounded-2xl bg-slate-950/90 p-6 text-center ring-1 ring-slate-700">
        <h2 className="text-3xl font-black tracking-widest">PAUSED</h2>
        <p className="text-sm text-slate-400">Press Esc to resume</p>
        <Button variant="primary" onClick={resume} autoFocus>
          Resume
        </Button>
        <Button onClick={restart}>Restart level</Button>
        <Button variant="ghost" onClick={quitToMenu}>
          Quit to menu
        </Button>
      </div>
    </div>
  );
}

function BottomBar() {
  const buffer = useGame((s) => s.buffer);
  const hud = useGame((s) => s.hud);
  const skills = useGame((s) => s.progress.skills);
  if (!hud) return null;
  return (
    <div className="flex shrink-0 items-center gap-4 border-t border-slate-800 bg-slate-950 px-4 py-2">
      <PileMeter rows={hud.pileRows} danger={hud.dangerRows} />
      <div className="flex flex-1 justify-center">
        <div
          data-testid="buffer"
          className="flex h-12 min-w-72 items-center justify-center rounded-xl bg-slate-900 px-5 font-mono text-2xl font-bold tracking-wider text-emerald-300 ring-2 ring-cyan-500/40"
          aria-label="Typing buffer"
        >
          {buffer || <span className="text-base font-normal tracking-normal text-slate-500">type a word, then Space</span>}
          {buffer && <span className="caret ml-0.5 inline-block h-7 w-0.5 bg-emerald-300" />}
        </div>
      </div>
      <ChargePool hud={hud} buffer={buffer} skills={skills} />
    </div>
  );
}

function PileMeter({ rows, danger }: { rows: number; danger: number }) {
  const pct = rows / danger;
  return (
    <div className="w-28 text-xs text-slate-400">
      <div className="mb-1 flex justify-between">
        <span>Pile</span>
        <span className={`tabular-nums ${pct >= 0.7 ? 'font-bold text-rose-400' : ''}`}>
          {rows}/{danger}
        </span>
      </div>
      <div className="flex h-2 gap-0.5">
        {Array.from({ length: danger }, (_, i) => (
          <div key={i} className={`flex-1 rounded-sm ${i < rows ? (pct >= 0.7 ? 'bg-rose-500' : 'bg-sky-500') : 'bg-slate-800'}`} />
        ))}
      </div>
    </div>
  );
}

function ChargePool({
  hud,
  buffer,
  skills,
}: {
  hud: HudSnapshot;
  buffer: string;
  skills: Record<SkillId, number>;
}) {
  const counts = new Map<SkillId, number>();
  for (const s of hud.pool) counts.set(s, (counts.get(s) ?? 0) + 1);
  const groups = CONFIG.skillOrder.filter((s) => counts.has(s));
  const empty = hud.capacity - hud.pool.length;
  const matches = (s: SkillId) => buffer.length > 0 && s.toLowerCase().startsWith(buffer);
  return (
    <div className="flex max-w-[45%] flex-wrap items-center justify-end gap-1.5" aria-label="Charge pool" data-testid="pool">
      {groups.map((s) => {
        const def = CONFIG.skills[s];
        const hot = matches(s);
        return (
          <div
            key={s}
            className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-bold ring-2 transition ${hot ? 'scale-105 bg-white/15' : 'bg-slate-900'}`}
            style={{ ['--tw-ring-color' as string]: def.color, color: def.color }}
            title={`${s} — Tier ${skills[s]}`}
          >
            {Array.from({ length: counts.get(s)! }, (_, i) => (
              <span key={i} aria-hidden className="flex h-5 w-5 items-center justify-center rounded-sm text-[12px]" style={{ background: `${def.color}33` }}>
                {def.icon}
              </span>
            ))}
            <span className="ml-0.5 tracking-wide">
              {s} ×{counts.get(s)}
            </span>
          </div>
        );
      })}
      {Array.from({ length: empty }, (_, i) => (
        <span key={`e${i}`} className="h-7 w-5 rounded-sm border border-dashed border-slate-700" aria-hidden />
      ))}
      <span className="sr-only">
        {hud.pool.length} of {hud.capacity} charges
      </span>
    </div>
  );
}
