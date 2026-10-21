import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const ROMAN = ['—', 'I', 'II', 'III'];

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-cyan-400 text-slate-950 hover:bg-cyan-300 focus-visible:ring-cyan-200',
  secondary: 'bg-slate-800 text-slate-100 hover:bg-slate-700 ring-1 ring-slate-600 focus-visible:ring-cyan-300',
  danger: 'bg-rose-600 text-white hover:bg-rose-500 focus-visible:ring-rose-300',
  ghost: 'text-slate-300 hover:text-white hover:bg-slate-800/60',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`rounded-lg px-4 py-2 font-semibold transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}

export function Screen({ title, children, footer }: { title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="storm-bg flex min-h-screen items-center justify-center p-4">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col rounded-2xl bg-slate-950/80 shadow-2xl ring-1 ring-slate-700/60 backdrop-blur">
        <h1 className="border-b border-slate-800 px-6 py-4 text-2xl font-bold tracking-wide">{title}</h1>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-3 border-t border-slate-800 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl bg-slate-900/80 px-4 py-3 ring-1 ring-slate-800">
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${accent ?? 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

export function CoinIcon({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[11px] font-black text-amber-950 ring-2 ring-amber-200/60 ${className}`}
    >
      $
    </span>
  );
}

export function Coins({ value, plain = false }: { value: number; plain?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-bold tabular-nums ${plain ? '' : 'text-amber-300'}`}>
      <CoinIcon />
      {value}
      <span className="sr-only">coins</span>
    </span>
  );
}
