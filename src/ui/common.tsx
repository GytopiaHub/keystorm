import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import wordsJson from '../data/words.json';
import { useGame } from '../state/store';

export const ROMAN = ['—', 'I', 'II', 'III'];

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'btn-primary focus-visible:ring-cyan-200',
  secondary: 'btn-secondary text-slate-100 focus-visible:ring-cyan-300',
  danger: 'btn-danger text-white focus-visible:ring-rose-300',
  ghost: 'text-slate-300 hover:text-white hover:bg-white/5',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`rounded-xl px-4 py-2 font-semibold transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}

/** Animated storm sky with words drifting down behind menus. */
export function StormBackdrop({ children, className = '' }: { children: ReactNode; className?: string }) {
  const words = useMemo(() => {
    const pool = [...wordsJson.buckets['3-4'], ...wordsJson.buckets['5-6'], ...wordsJson.buckets['7-8']];
    return Array.from({ length: 22 }, (_, i) => ({
      text: pool[Math.floor(Math.random() * pool.length)],
      left: (i / 22) * 100 + Math.random() * 3,
      duration: 9 + Math.random() * 14,
      delay: -Math.random() * 20,
      size: 13 + Math.random() * 14,
    }));
  }, []);
  return (
    <div className={`storm-bg min-h-screen ${className}`}>
      {words.map((w, i) => (
        <span
          key={i}
          aria-hidden
          className="falling-word"
          style={{ left: `${w.left}%`, animationDuration: `${w.duration}s`, animationDelay: `${w.delay}s`, fontSize: w.size }}
        >
          {w.text}
        </span>
      ))}
      {children}
    </div>
  );
}

export function Screen({ title, children, footer }: { title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <StormBackdrop className="flex items-center justify-center p-4">
      <div className="glass screen-in flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col rounded-2xl">
        <h1 className="border-b border-white/10 px-6 py-4 font-display text-2xl font-bold tracking-wider">{title}</h1>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-3 border-t border-white/10 px-6 py-4">{footer}</div>}
      </div>
    </StormBackdrop>
  );
}

export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-4 py-3 ring-1 ring-white/10">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`mt-1 font-display text-xl font-bold tabular-nums ${accent ?? 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

export function CoinIcon({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-b from-amber-200 to-amber-500 text-[11px] font-black text-amber-950 shadow-[0_0_10px_rgba(251,191,36,0.6)] ring-1 ring-amber-100/70 ${className}`}
    >
      $
    </span>
  );
}

export function Coins({ value, plain = false }: { value: number; plain?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-bold tabular-nums ${plain ? '' : 'text-amber-300'}`}>
      <CoinIcon />
      <span key={value} className={plain ? '' : 'bump inline-block'}>
        {value}
      </span>
      <span className="sr-only">coins</span>
    </span>
  );
}

/** Counts up to `target` over `ms`; instant with reduced motion. */
export function useCountUp(target: number, ms = 700): number {
  const reduced = useGame((s) => s.settings.reducedMotion);
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return value;
}

export function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value)}</>;
}
