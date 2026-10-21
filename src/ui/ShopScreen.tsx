import { useState, type CSSProperties } from 'react';
import { CONFIG, skillPrice, upgradePrice } from '../engine/config';
import type { SkillId, UpgradeId } from '../engine/types';
import { useGame } from '../state/store';
import { Button, Coins, ROMAN, Screen, SkillIcon } from './common';

type Tab = 'skills' | 'upgrades';

export function ShopScreen() {
  const progress = useGame((s) => s.progress);
  const nextLevel = useGame((s) => s.nextLevel);
  const { startLevel, goTo } = useGame.getState();
  const [tab, setTab] = useState<Tab>('skills');

  return (
    <Screen
      title={
        <div className="flex items-center justify-between">
          <span>Shop</span>
          <span className="text-lg">
            <Coins value={progress.coins} />
          </span>
        </div>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => goTo('menu')}>
            Menu
          </Button>
          <Button variant="primary" onClick={() => startLevel(nextLevel)}>
            Start level {nextLevel}
          </Button>
        </>
      }
    >
      <div role="tablist" className="mb-5 flex gap-2">
        {(['skills', 'upgrades'] as Tab[]).map((t) => (
          <Button
            key={t}
            role="tab"
            aria-selected={tab === t}
            variant={tab === t ? 'primary' : 'secondary'}
            onClick={() => setTab(t)}
          >
            {t === 'skills' ? 'Skills' : 'Upgrades'}
          </Button>
        ))}
      </div>
      {tab === 'skills' ? <SkillsTab /> : <UpgradesTab />}
    </Screen>
  );
}

function SkillsTab() {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-slate-400">
        Unlocked skills drop charge words in play. Clear one to store a charge, then type the skill’s name to fire it.
      </p>
      {CONFIG.skillCategories.map((cat) => (
        <section key={cat.id}>
          <h2 className="mb-3 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.25em] text-slate-400">
            {cat.label}
            <span className="h-px flex-1 bg-gradient-to-r from-white/15 to-transparent" />
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {CONFIG.skillOrder
              .filter((s) => CONFIG.skills[s].category === cat.id)
              .map((s) => (
                <SkillCard key={s} id={s} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SkillCard({ id }: { id: SkillId }) {
  const tier = useGame((s) => s.progress.skills[id]);
  const coins = useGame((s) => s.progress.coins);
  const buy = useGame((s) => s.buySkill);
  const [bought, setBought] = useState(0);
  const def = CONFIG.skills[id];
  const price = skillPrice(tier);
  const current = tier > 0 ? def.tiers[tier - 1].label : null;
  const next = price !== null ? def.tiers[tier].label : null;
  return (
    <div
      key={bought}
      className={`skill-card flex flex-col gap-2 rounded-2xl bg-white/[0.03] p-4 ${bought ? 'just-bought' : ''}`}
      style={{ '--c': def.color } as CSSProperties}
      data-testid={`skill-${id}`}
    >
      <div className="flex items-center gap-3">
        <div className="relative grid h-16 w-16 shrink-0 place-items-center">
          <div
            aria-hidden
            className="absolute inset-2 rounded-full blur-lg"
            style={{ background: def.color, opacity: tier ? 0.45 : 0.08 }}
          />
          <SkillIcon id={id} size={60} className={`relative ${tier ? '' : 'locked-icon'}`} />
        </div>
        <div className="flex-1">
          <div className="font-display font-black tracking-wider" style={{ color: def.color, textShadow: `0 0 12px ${def.color}88` }}>
            {id}
          </div>
          <div className="text-xs text-slate-400">{def.description}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-xs font-bold ${tier ? 'text-white' : 'text-slate-500'}`}>{tier ? `Tier ${ROMAN[tier]}` : 'Locked'}</span>
          <div className="flex gap-1" aria-hidden>
            {[1, 2, 3].map((t) => (
              <span
                key={t}
                className="h-1.5 w-4 rounded-full"
                style={t <= tier ? { background: def.color, boxShadow: `0 0 6px ${def.color}` } : { background: 'rgba(255,255,255,0.12)' }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="text-sm">
        {current && (
          <div>
            <span className="text-slate-400">Now: </span>
            {current}
          </div>
        )}
        {next && (
          <div>
            <span className="text-slate-400">{tier ? `Tier ${ROMAN[tier + 1]}: ` : 'Tier I: '}</span>
            {next}
          </div>
        )}
      </div>
      <Button
        variant={price !== null && coins >= price ? 'primary' : 'secondary'}
        disabled={price === null || coins < price}
        onClick={() => {
          buy(id);
          setBought((n) => n + 1);
        }}
        className="mt-auto"
      >
        {price === null ? (
          'Maxed'
        ) : (
          <span className="inline-flex items-center gap-2">
            {tier ? 'Upgrade' : 'Unlock'} · <Coins value={price} plain />
          </span>
        )}
      </Button>
    </div>
  );
}

function UpgradesTab() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {CONFIG.upgradeOrder.map((u) => (
        <UpgradeCard key={u} id={u} />
      ))}
    </div>
  );
}

function UpgradeCard({ id }: { id: UpgradeId }) {
  const rank = useGame((s) => s.progress.upgrades[id]);
  const coins = useGame((s) => s.progress.coins);
  const buy = useGame((s) => s.buyUpgrade);
  const [bought, setBought] = useState(0);
  const def = CONFIG.upgrades[id];
  const price = upgradePrice(id, rank);
  return (
    <div
      key={bought}
      className={`skill-card flex flex-col gap-2 rounded-2xl bg-white/[0.03] p-4 ${bought ? 'just-bought' : ''}`}
      style={{ '--c': '#38bdf8' } as CSSProperties}
      data-testid={`upgrade-${id}`}
    >
      <div className="flex items-center justify-between">
        <div className="font-display font-bold tracking-wide">{def.name}</div>
        <span className="text-xs font-bold tabular-nums text-slate-300">
          Rank {rank}/{def.maxRank}
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: def.maxRank }, (_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i < rank ? 'bg-cyan-400 shadow-[0_0_6px_#22d3ee]' : 'bg-white/10'}`} />
        ))}
      </div>
      <div className="text-sm text-slate-300">
        {price !== null && <span className="text-slate-400">Next rank: </span>}
        {def.description}
      </div>
      <Button
        variant={price !== null && coins >= price ? 'primary' : 'secondary'}
        disabled={price === null || coins < price}
        onClick={() => {
          buy(id);
          setBought((n) => n + 1);
        }}
        className="mt-auto"
      >
        {price === null ? (
          'Maxed'
        ) : (
          <span className="inline-flex items-center gap-2">
            Buy rank {rank + 1} · <Coins value={price} plain />
          </span>
        )}
      </Button>
    </div>
  );
}
