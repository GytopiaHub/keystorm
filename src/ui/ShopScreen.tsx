import { useState } from 'react';
import { CONFIG, skillPrice, upgradePrice } from '../engine/config';
import type { SkillId, UpgradeId } from '../engine/types';
import { useGame } from '../state/store';
import { Button, Coins, ROMAN, Screen } from './common';

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
          <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-slate-400">{cat.label}</h2>
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
  const def = CONFIG.skills[id];
  const price = skillPrice(tier);
  const current = tier > 0 ? def.tiers[tier - 1].label : null;
  const next = price !== null ? def.tiers[tier].label : null;
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-slate-900/80 p-4 ring-1 ring-slate-800" data-testid={`skill-${id}`}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-lg text-lg ring-2"
          style={{ background: `${def.color}26`, ['--tw-ring-color' as string]: def.color }}
        >
          {def.icon}
        </span>
        <div className="flex-1">
          <div className="font-black tracking-wider" style={{ color: def.color }}>
            {id}
          </div>
          <div className="text-xs text-slate-400">{def.description}</div>
        </div>
        <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${tier ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-500'}`}>
          {tier ? `Tier ${ROMAN[tier]}` : 'Locked'}
        </span>
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
        onClick={() => buy(id)}
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
  const def = CONFIG.upgrades[id];
  const price = upgradePrice(id, rank);
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-slate-900/80 p-4 ring-1 ring-slate-800" data-testid={`upgrade-${id}`}>
      <div className="flex items-center justify-between">
        <div className="font-bold">{def.name}</div>
        <span className="text-xs font-bold tabular-nums text-slate-300">
          Rank {rank}/{def.maxRank}
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: def.maxRank }, (_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i < rank ? 'bg-cyan-400' : 'bg-slate-700'}`} />
        ))}
      </div>
      <div className="text-sm text-slate-300">
        {price !== null && <span className="text-slate-400">Next rank: </span>}
        {def.description}
      </div>
      <Button
        variant={price !== null && coins >= price ? 'primary' : 'secondary'}
        disabled={price === null || coins < price}
        onClick={() => buy(id)}
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
