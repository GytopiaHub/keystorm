import { useCallback, useEffect, useRef, useState } from 'react';
import { play } from '../audio/sfx';
import { CONFIG } from '../engine/config';
import type { HudSnapshot } from '../engine/engine';
import type { EngineEvent, SkillId } from '../engine/types';
import { FieldCanvas } from '../render/FieldCanvas';
import { useGame } from '../state/store';
import { ART } from '../assets/art';
import { Button, Coins, SkillIcon } from './common';

/** Seconds to linger on the field after the quota is met or the pile tops out. */
const END_DELAY = 1.8;

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
    <div className="storm-bg flex h-screen flex-col">
      {/* The field's own sky, blurred, fills the letterbox around the canvas. */}
      <div aria-hidden className="art-bg art-dim" style={{ backgroundImage: `url(${ART.sky})` }} />
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
        if (e.cause === 'typed') {
          play(e.word.kind === 'coin' ? 'coin' : 'clear');
          s.pulseInput('hit');
        } else if (e.cause !== 'levelEnd' && e.word.kind === 'coin') play('coin');
        break;
      case 'chargeGained':
        play('charge');
        break;
      case 'poolFull':
        s.showToast(`Charge pool full — ${e.skill} charge lost`, 'bad');
        break;
      case 'mistake':
        play('mistake');
        s.pulseInput('miss');
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

const COMBO_STYLES = [
  'text-slate-300',
  'text-sky-300 glow-text',
  'text-fuchsia-300 glow-text',
  'text-orange-300 glow-text',
  'text-yellow-200 glow-text',
];

function comboTier(multiplier: number): number {
  return Math.max(0, CONFIG.gameplay.combo.tiers.findIndex((t) => t.multiplier === multiplier));
}

function TopBar() {
  const hud = useGame((s) => s.hud);
  const savedCoins = useGame((s) => s.progress.coins);
  const pause = useGame((s) => s.pause);
  if (!hud) return null;
  const pct = Math.min(100, (hud.score / hud.quota) * 100);
  return (
    <div className="glass relative z-10 flex h-16 shrink-0 items-center gap-6 px-5">
      <div className="flex flex-col items-center leading-none">
        <span className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Level</span>
        <span className="font-display text-2xl font-black text-white tabular-nums">{hud.level}</span>
      </div>
      <div className="flex min-w-40 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-xs text-slate-400">
          <span className="flex items-baseline gap-2">
            <span className="uppercase tracking-[0.2em]">Score</span>
            <span key={hud.score} className="bump inline-block font-display text-base font-bold text-white tabular-nums" data-testid="score">
              {hud.score}
            </span>
          </span>
          <span className="tabular-nums">/ {hud.quota}</span>
        </div>
        <div
          className="h-3 overflow-hidden rounded-full bg-black/50 ring-1 ring-white/10"
          role="progressbar"
          aria-label="Quota"
          aria-valuenow={hud.score}
          aria-valuemax={hud.quota}
        >
          <div
            className="stripes h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-300 shadow-[0_0_14px_rgba(34,211,238,0.8)] transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
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
  const tier = comboTier(hud.multiplier);
  return (
    <div className="flex items-center gap-2" data-testid="combo">
      <div className="flex flex-col items-center leading-none">
        <span className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Combo</span>
        <span key={hud.combo} className={`bump inline-block font-display text-2xl font-black tabular-nums ${COMBO_STYLES[tier]}`}>
          {hud.combo}
        </span>
      </div>
      <span
        key={`m${hud.multiplier}`}
        className={`bump inline-block rounded-lg px-2 py-1 font-display text-sm font-black ${
          tier ? `bg-white/10 ring-1 ring-current ${COMBO_STYLES[tier]}` : 'text-slate-500'
        }`}
      >
        ×{hud.multiplier}
      </span>
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
          <div
            key={c.key}
            className="toast-in w-48 overflow-hidden rounded-lg bg-black/60 text-sm backdrop-blur"
            style={{ boxShadow: `0 0 0 1px ${def.color}, 0 0 16px -2px ${def.color}` }}
          >
            <div className="flex items-center gap-1.5 px-2 py-1">
              <SkillIcon id={c.skill} size={22} />
              <span className="font-semibold tabular-nums">{c.text}</span>
            </div>
            {c.frac !== undefined && (
              <div className="h-1" style={{ width: `${c.frac * 100}%`, background: def.color, boxShadow: `0 0 8px ${def.color}` }} />
            )}
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
  const tone =
    toast.tone === 'bad'
      ? 'text-rose-200 shadow-[0_0_0_1px_#f43f5e,0_0_20px_-4px_#f43f5e]'
      : toast.tone === 'good'
        ? 'text-emerald-200 shadow-[0_0_0_1px_#10b981,0_0_20px_-4px_#10b981]'
        : 'text-slate-100 shadow-[0_0_0_1px_#64748b]';
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center" role="status">
      <div key={toast.id} className={`toast-in rounded-xl bg-black/70 px-4 py-2 text-sm font-semibold backdrop-blur ${tone}`}>
        {toast.text}
      </div>
    </div>
  );
}

function PauseOverlay() {
  const { resume, restart, quitToMenu } = useGame.getState();
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="glass screen-in stagger flex w-80 flex-col gap-3 rounded-3xl p-7 text-center">
        <h2 className="title-storm text-4xl tracking-[0.2em]">PAUSED</h2>
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Esc to resume</p>
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
  const pulse = useGame((s) => s.inputPulse);
  const skills = useGame((s) => s.progress.skills);
  if (!hud) return null;
  const pulseClass = pulse ? (pulse.kind === 'hit' ? 'flash-hit' : 'flash-miss') : '';
  return (
    <div className="glass relative z-10 flex shrink-0 items-center gap-5 px-5 py-2.5">
      <PileMeter rows={hud.pileRows} danger={hud.dangerRows} />
      <div className="flex flex-1 justify-center">
        <div
          key={pulse?.id}
          data-testid="buffer"
          className={`flex h-12 min-w-80 items-center justify-center rounded-2xl bg-black/50 px-6 font-mono text-2xl font-bold tracking-[0.12em] text-emerald-300 shadow-[0_0_0_1px_rgba(34,211,238,0.45),0_0_24px_-6px_rgba(34,211,238,0.6)] ${pulseClass}`}
          aria-label="Typing buffer"
        >
          {buffer ? (
            <span style={{ textShadow: '0 0 12px rgba(92,255,157,0.7)' }}>{buffer}</span>
          ) : (
            <span className="font-sans text-sm font-normal tracking-normal text-slate-500">type a word, then Space</span>
          )}
          {buffer && <span className="caret ml-1 inline-block h-7 w-0.5 bg-emerald-300 shadow-[0_0_8px_#5cff9d]" />}
        </div>
      </div>
      <ChargePool hud={hud} buffer={buffer} skills={skills} />
    </div>
  );
}

function PileMeter({ rows, danger }: { rows: number; danger: number }) {
  const pct = rows / danger;
  const hot = pct >= 0.7;
  return (
    <div className="w-32 text-xs text-slate-400">
      <div className="mb-1 flex justify-between">
        <span className="uppercase tracking-[0.2em]">Flood</span>
        <span className={`font-display tabular-nums ${hot ? 'animate-pulse font-bold text-rose-400' : 'text-sky-300'}`}>
          {rows}/{danger}
        </span>
      </div>
      <div className="flex h-2.5 gap-0.5">
        {Array.from({ length: danger }, (_, i) => (
          <div
            key={i}
            className={`flex-1 rounded-sm transition-colors ${
              i < rows ? (hot ? 'bg-rose-500 shadow-[0_0_6px_#f43f5e]' : 'bg-sky-400 shadow-[0_0_6px_#38bdf8]') : 'bg-white/10'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function ChargePool({ hud, buffer, skills }: { hud: HudSnapshot; buffer: string; skills: Record<SkillId, number> }) {
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
            key={`${s}${counts.get(s)}`}
            className={`toast-in flex items-center gap-1 rounded-xl py-1 pl-1 pr-2 text-xs font-bold transition ${hot ? 'scale-110 bg-white/15' : 'bg-black/50'}`}
            style={{
              color: def.color,
              boxShadow: `0 0 0 ${hot ? 2 : 1}px ${def.color}, 0 0 ${hot ? 22 : 10}px -2px ${def.color}`,
            }}
            title={`${s} — Tier ${skills[s]}`}
          >
            {Array.from({ length: counts.get(s)! }, (_, i) => (
              <span
                key={i}
                aria-hidden
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ background: `radial-gradient(circle, ${def.color}55, transparent 70%)` }}
              >
                <SkillIcon id={s} size={28} />
              </span>
            ))}
            <span className="ml-0.5 font-display tracking-wide">
              {s} ×{counts.get(s)}
            </span>
          </div>
        );
      })}
      {Array.from({ length: empty }, (_, i) => (
        <span key={`e${i}`} className="h-8 w-8 rounded-lg border border-dashed border-white/20 bg-black/30" aria-hidden />
      ))}
      <span className="sr-only">
        {hud.pool.length} of {hud.capacity} charges
      </span>
    </div>
  );
}
