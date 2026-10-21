import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../engine/config';
import type { AttemptResult } from '../engine/types';
import { ShopScreen } from '../ui/ShopScreen';
import { SettingsScreen } from '../ui/MenuScreens';
import { loadProgress, loadSettings, PROGRESS_KEY } from './persistence';
import { applyResult, buySkill, buyUpgrade, defaultProgress } from './progress';
import { useGame } from './store';

const result = (over: Partial<AttemptResult> = {}): AttemptResult => ({
  level: 1,
  passed: true,
  score: 520,
  quota: 500,
  wpm: 42,
  accuracy: 100,
  maxCombo: 9,
  wordsCleared: 12,
  mistakes: 0,
  perfect: true,
  coins: { words: 12, coinWords: 5, level: 20, perfect: 20, total: 57 },
  skillsUsed: {},
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  useGame.setState({ progress: defaultProgress(), screen: 'menu', engine: null });
});

describe('progress rules', () => {
  it('passing the current level advances it; coins and records are kept', () => {
    const p = applyResult(defaultProgress(), result());
    expect(p).toMatchObject({ currentLevel: 2, coins: 57, records: { bestCombo: 9, bestWpm: 42 } });
  });

  it('failing keeps the level but still keeps coins', () => {
    const p = applyResult(defaultProgress(), result({ passed: false, coins: { words: 8, coinWords: 0, level: 0, perfect: 0, total: 8 } }));
    expect(p.currentLevel).toBe(1);
    expect(p.coins).toBe(8);
  });

  it('replaying an earlier level does not change the current level', () => {
    const p = applyResult({ ...defaultProgress(), currentLevel: 5 }, result({ level: 2 }));
    expect(p.currentLevel).toBe(5);
  });

  it('skill tiers charge their listed prices and stop at Tier III', () => {
    let p = { ...defaultProgress(), coins: 2000, currentLevel: 99 };
    let coins = p.coins;
    for (const price of CONFIG.skills.FIRE.prices) {
      p = buySkill(p, 'FIRE')!;
      coins -= price;
      expect(p.coins).toBe(coins);
    }
    expect(p.skills.FIRE).toBe(3);
    expect(buySkill(p, 'FIRE')).toBeNull();
    expect(buySkill({ ...defaultProgress(), coins: 10, currentLevel: 99 }, 'ICE')).toBeNull();
  });

  it('upgrades respect max rank', () => {
    let p = { ...defaultProgress(), coins: 2000, currentLevel: 99 };
    for (let i = 0; i < CONFIG.upgrades.chargeCapacity.maxRank; i++) p = buyUpgrade(p, 'chargeCapacity')!;
    expect(p.upgrades.chargeCapacity).toBe(CONFIG.upgrades.chargeCapacity.maxRank);
    expect(buyUpgrade(p, 'chargeCapacity')).toBeNull();
  });

  it('skills and upgrades stay locked until their unlock level', () => {
    const unlockAt = CONFIG.skills.WIND.unlockLevel;
    const early = { ...defaultProgress(), coins: 2000, currentLevel: unlockAt - 1 };
    expect(buySkill(early, 'WIND')).toBeNull();
    expect(buySkill({ ...early, currentLevel: unlockAt }, 'WIND')).not.toBeNull();
    const floorAt = CONFIG.upgrades.reinforcedFloor.unlockLevel;
    expect(buyUpgrade({ ...early, currentLevel: floorAt - 1 }, 'reinforcedFloor')).toBeNull();
    expect(buyUpgrade({ ...early, currentLevel: floorAt }, 'reinforcedFloor')).not.toBeNull();
  });
});

describe('persistence', () => {
  it('saves after a purchase and restores on load', () => {
    useGame.setState({ progress: { ...defaultProgress(), coins: 100, currentLevel: 10 } });
    act(() => useGame.getState().buySkill('ICE'));
    expect(loadProgress()).toMatchObject({ coins: 100 - CONFIG.skills.ICE.prices[0], skills: { ICE: 1 } });
  });

  it('ignores corrupt data and clamps bad values', () => {
    localStorage.setItem(PROGRESS_KEY, '{nope');
    expect(loadProgress()).toEqual(defaultProgress());
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ version: 2, data: { currentLevel: -3, coins: 'x', skills: { FIRE: 9 } } }));
    expect(loadProgress()).toMatchObject({ currentLevel: 1, coins: 0, skills: { FIRE: 3 } });
  });

  it('refunds removed skills and over-max ranks from version 1 saves', () => {
    const v1 = {
      currentLevel: 4,
      coins: 10,
      skills: { FIRE: 2, BOMB: 1, GAMBLE: 3 },
      upgrades: { chargeCapacity: 4, quickCast: 1, coinBonus: 1 },
    };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ version: 1, data: v1 }));
    const p = loadProgress();
    // BOMB I (30) + GAMBLE I–III (30+80+180) + capacity ranks 3–4 (160+250) + quick cast (150).
    expect(p.coins).toBe(10 + 30 + 290 + 410 + 150);
    expect(p.skills).toMatchObject({ FIRE: 2 });
    expect(p.upgrades).toMatchObject({ chargeCapacity: 2, coinBonus: 1 });
  });

  it('persists settings', () => {
    act(() => useGame.getState().updateSettings({ difficulty: 'hard', volume: 0.2 }));
    expect(loadSettings()).toMatchObject({ difficulty: 'hard', volume: 0.2 });
  });
});

describe('shop UI', () => {
  it('disables what the player cannot afford and buys what they can', () => {
    const slow = CONFIG.skills.SLOW;
    useGame.setState({ progress: { ...defaultProgress(), coins: slow.prices[0], currentLevel: 99 } });
    render(<ShopScreen />);
    fireEvent.click(within(screen.getByTestId('skill-SLOW')).getByRole('button', { name: /Buy/ }));
    // The card remounts after a purchase to play its flash, so query it again.
    const card = within(screen.getByTestId('skill-SLOW'));
    expect(card.getByText('Tier I')).toBeInTheDocument();
    expect(card.getByRole('button', { name: /Upgrade/ })).toBeDisabled();
    expect(within(screen.getByTestId('skill-ICE')).getByRole('button', { name: /Buy/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: 'Upgrades' }));
    const cap = CONFIG.upgrades.chargeCapacity.maxRank;
    expect(within(screen.getByTestId('upgrade-chargeCapacity')).getByText(`Rank 0/${cap}`)).toBeInTheDocument();
  });

  it('shows the unlock level on locked items', () => {
    useGame.setState({ progress: { ...defaultProgress(), coins: 999, currentLevel: 1 } });
    render(<ShopScreen />);
    const wind = within(screen.getByTestId('skill-WIND'));
    expect(wind.getByRole('button', { name: `Reach level ${CONFIG.skills.WIND.unlockLevel}` })).toBeDisabled();
  });
});

describe('settings UI', () => {
  it('asks for confirmation before resetting progress', () => {
    useGame.setState({ progress: { ...defaultProgress(), coins: 999, currentLevel: 7 } });
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset progress…' }));
    expect(useGame.getState().progress.coins).toBe(999);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, reset' }));
    expect(useGame.getState().progress).toEqual(defaultProgress());
  });
});
