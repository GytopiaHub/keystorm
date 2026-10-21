import { useState } from 'react';
import { CONFIG } from '../engine/config';
import type { Difficulty, WordListId } from '../engine/types';
import { useGame } from '../state/store';
import { Button, Coins, Screen, Stat } from './common';

export function MainMenu() {
  const progress = useGame((s) => s.progress);
  const { startLevel, goTo, openShop } = useGame.getState();
  return (
    <div className="storm-bg flex min-h-screen items-center justify-center p-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-3xl bg-slate-950/75 px-8 py-10 shadow-2xl ring-1 ring-slate-700/60 backdrop-blur">
        <div className="text-center">
          <h1 className="title-glow text-5xl font-black tracking-[0.15em] sm:text-6xl text-cyan-100">KEYSTORM</h1>
          <p className="mt-2 text-sm text-slate-400">Type the falling words before the flood rises.</p>
        </div>
        <div className="flex items-center gap-6 text-sm text-slate-300">
          <span>
            Level <span className="text-xl font-bold text-white tabular-nums">{progress.currentLevel}</span>
          </span>
          <Coins value={progress.coins} />
        </div>
        <div className="flex w-full flex-col gap-2.5">
          <Button variant="primary" className="py-3 text-lg" autoFocus onClick={() => startLevel(progress.currentLevel)}>
            Play level {progress.currentLevel}
          </Button>
          <Button onClick={() => goTo('levelSelect')}>Level select</Button>
          <Button onClick={openShop}>Shop</Button>
          <div className="grid grid-cols-2 gap-2.5">
            <Button onClick={() => goTo('records')}>Records</Button>
            <Button onClick={() => goTo('settings')}>Settings</Button>
          </div>
        </div>
        <details className="w-full text-sm text-slate-400">
          <summary className="cursor-pointer select-none text-slate-300">How to play</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Type a falling word and press Space or Enter to clear it.</li>
            <li>Missed words land and pile up. If the pile reaches the red line, the level is failed.</li>
            <li>Reach the score quota to pass. Accurate typing builds a combo multiplier; mistakes reset it.</li>
            <li>Gold words give bonus coins. Thundercloud words speed up when you mistype.</li>
            <li>Buy skills in the shop. Clear coloured charge words to fill your charge pool, then type a skill’s name to fire it.</li>
            <li>Esc pauses.</li>
          </ul>
        </details>
      </div>
    </div>
  );
}

export function LevelSelect() {
  const current = useGame((s) => s.progress.currentLevel);
  const { startLevel, goTo } = useGame.getState();
  return (
    <Screen
      title="Level select"
      footer={
        <Button variant="ghost" onClick={() => goTo('menu')}>
          Back
        </Button>
      }
    >
      <p className="mb-4 text-sm text-slate-400">
        Replay any level you’ve reached. Coins you earn are kept; your current level doesn’t change.
      </p>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
        {Array.from({ length: current }, (_, i) => i + 1).map((lvl) => (
          <Button
            key={lvl}
            variant={lvl === current ? 'primary' : 'secondary'}
            className="tabular-nums"
            onClick={() => startLevel(lvl)}
            aria-label={`Play level ${lvl}`}
          >
            {lvl}
          </Button>
        ))}
      </div>
    </Screen>
  );
}

export function RecordsScreen() {
  const progress = useGame((s) => s.progress);
  const goTo = useGame((s) => s.goTo);
  return (
    <Screen
      title="Records"
      footer={
        <Button variant="ghost" onClick={() => goTo('menu')}>
          Back
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Current level" value={progress.currentLevel} />
        <Stat label="Best combo" value={progress.records.bestCombo} accent="text-fuchsia-300" />
        <Stat label="Best WPM" value={progress.records.bestWpm} accent="text-cyan-300" />
        <Stat label="Coins" value={<Coins value={progress.coins} />} />
      </div>
    </Screen>
  );
}

export function SettingsScreen() {
  const settings = useGame((s) => s.settings);
  const { updateSettings, resetProgress, goTo } = useGame.getState();
  const [confirming, setConfirming] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const difficulties = Object.entries(CONFIG.gameplay.difficulty) as [Difficulty, { label: string }][];
  const lists = Object.entries(CONFIG.gameplay.wordLists) as [WordListId, { label: string }][];

  return (
    <Screen
      title="Settings"
      footer={
        <Button variant="ghost" onClick={() => goTo('menu')}>
          Back
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <label className="flex flex-col gap-2">
          <span className="font-semibold">Volume: {Math.round(settings.volume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
            className="w-full max-w-sm accent-cyan-400"
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold">Difficulty</legend>
          <div className="flex gap-2">
            {difficulties.map(([id, d]) => (
              <Button
                key={id}
                variant={settings.difficulty === id ? 'primary' : 'secondary'}
                aria-pressed={settings.difficulty === id}
                onClick={() => updateSettings({ difficulty: id })}
              >
                {d.label}
              </Button>
            ))}
          </div>
          <span className="text-sm text-slate-400">Changes fall speed and spawn rate.</span>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold">Word list</legend>
          <div className="flex flex-wrap gap-2">
            {lists.map(([id, l]) => (
              <Button
                key={id}
                variant={settings.wordList === id ? 'primary' : 'secondary'}
                aria-pressed={settings.wordList === id}
                onClick={() => updateSettings({ wordList: id })}
              >
                {l.label}
              </Button>
            ))}
          </div>
        </fieldset>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={(e) => updateSettings({ reducedMotion: e.target.checked })}
            className="h-5 w-5 accent-cyan-400"
          />
          <span>
            <span className="font-semibold">Reduced motion</span>
            <span className="block text-sm text-slate-400">No screen shake or particles; weather becomes a static tint.</span>
          </span>
        </label>

        <div className="rounded-xl bg-rose-950/30 p-4 ring-1 ring-rose-900/60">
          <div className="font-semibold text-rose-200">Reset progress</div>
          <p className="mb-3 text-sm text-slate-400">Erases your level, coins, skills, upgrades and records. Settings are kept.</p>
          {resetDone && <p className="mb-3 text-sm text-emerald-300">Progress reset.</p>}
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-sm">Are you sure? This can’t be undone.</span>
              <Button
                variant="danger"
                onClick={() => {
                  resetProgress();
                  setConfirming(false);
                  setResetDone(true);
                }}
              >
                Yes, reset
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Reset progress…
            </Button>
          )}
        </div>
      </div>
    </Screen>
  );
}
