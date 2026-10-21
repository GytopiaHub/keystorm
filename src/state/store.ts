import { create } from 'zustand';
import { GameEngine, type HudSnapshot } from '../engine/engine';
import type { AttemptResult, SkillId, UpgradeId } from '../engine/types';
import { clearProgress, loadProgress, loadSettings, saveProgress, saveSettings } from './persistence';
import { applyResult, buySkill, buyUpgrade, defaultProgress, type Progress, type Settings } from './progress';

export type Screen =
  | 'menu'
  | 'levelSelect'
  | 'records'
  | 'settings'
  | 'playing'
  | 'paused'
  | 'complete'
  | 'failed'
  | 'shop';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'bad' | 'good';
}

export interface GameStore {
  screen: Screen;
  progress: Progress;
  settings: Settings;
  /** The live engine; never stored per frame, only swapped per attempt. */
  engine: GameEngine | null;
  attemptId: number;
  hud: HudSnapshot | null;
  buffer: string;
  lastResult: AttemptResult | null;
  /** Level the shop's play button starts. */
  nextLevel: number;
  toast: Toast | null;
  /** Feedback on the input box after each submit. */
  inputPulse: { id: number; kind: 'hit' | 'miss' } | null;

  startLevel: (level: number) => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  quitToMenu: () => void;
  endAttempt: () => void;
  openShop: () => void;
  goTo: (screen: Screen) => void;
  buySkill: (id: SkillId) => void;
  buyUpgrade: (id: UpgradeId) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  resetProgress: () => void;
  setHud: (hud: HudSnapshot) => void;
  setBuffer: (buffer: string) => void;
  showToast: (text: string, tone?: Toast['tone']) => void;
  pulseInput: (kind: 'hit' | 'miss') => void;
}

let seq = 0;

export const useGame = create<GameStore>((set, get) => {
  /** Keep coins and records from an attempt that ends early (quit or restart). */
  const commitUnfinished = () => {
    const { engine, progress } = get();
    if (!engine || engine.status !== 'playing') return progress;
    const next = applyResult(progress, { ...engine.result(), passed: false });
    saveProgress(next);
    return next;
  };

  const newEngine = (level: number) => {
    const { progress, settings } = get();
    return new GameEngine({
      level,
      skills: progress.skills,
      upgrades: progress.upgrades,
      difficulty: settings.difficulty,
      wordList: settings.wordList,
    });
  };

  return {
    screen: 'menu',
    progress: loadProgress(),
    settings: loadSettings(),
    engine: null,
    attemptId: 0,
    hud: null,
    buffer: '',
    lastResult: null,
    nextLevel: 1,
    toast: null,
    inputPulse: null,

    startLevel: (level) => {
      const engine = newEngine(level);
      set({
        engine,
        screen: 'playing',
        attemptId: get().attemptId + 1,
        hud: engine.hud(),
        buffer: '',
        lastResult: null,
        toast: null,
      });
    },

    pause: () => {
      if (get().screen === 'playing') set({ screen: 'paused' });
    },

    resume: () => {
      if (get().screen === 'paused') set({ screen: 'playing' });
    },

    restart: () => {
      const { engine } = get();
      if (!engine) return;
      const progress = commitUnfinished();
      set({ progress });
      get().startLevel(engine.params.level);
    },

    quitToMenu: () => {
      const progress = commitUnfinished();
      set({ progress, engine: null, hud: null, screen: 'menu', buffer: '' });
    },

    endAttempt: () => {
      const { engine, progress } = get();
      if (!engine || engine.status === 'playing') return;
      const result = engine.result();
      const next = applyResult(progress, result);
      saveProgress(next);
      set({
        progress: next,
        lastResult: result,
        nextLevel: result.passed ? result.level + 1 : result.level,
        screen: result.passed ? 'complete' : 'failed',
        hud: engine.hud(),
        buffer: '',
      });
    },

    openShop: () => {
      // From the menu the shop's play button resumes the current level.
      if (get().screen === 'menu') set({ nextLevel: get().progress.currentLevel });
      set({ screen: 'shop', engine: null });
    },

    goTo: (screen) => set({ screen }),

    buySkill: (id) => {
      const next = buySkill(get().progress, id);
      if (!next) return;
      saveProgress(next);
      set({ progress: next });
    },

    buyUpgrade: (id) => {
      const next = buyUpgrade(get().progress, id);
      if (!next) return;
      saveProgress(next);
      set({ progress: next });
    },

    updateSettings: (patch) => {
      const settings = { ...get().settings, ...patch };
      saveSettings(settings);
      set({ settings });
    },

    resetProgress: () => {
      clearProgress();
      const progress = defaultProgress();
      saveProgress(progress);
      set({ progress, nextLevel: 1, lastResult: null });
    },

    setHud: (hud) => set({ hud }),
    setBuffer: (buffer) => set({ buffer }),
    showToast: (text, tone = 'info') => set({ toast: { id: ++seq, text, tone } }),
    pulseInput: (kind) => set({ inputPulse: { id: ++seq, kind } }),
  };
});
