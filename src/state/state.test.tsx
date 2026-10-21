import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
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

  it('skill tiers cost more each step and stop at Tier III', () => {
    let p = { ...defaultProgress(), coins: 1000 };
    for (const expected of [970, 890, 710]) {
      p = buySkill(p, 'FIRE')!;
      expect(p.coins).toBe(expected);
    }
    expect(p.skills.FIRE).toBe(3);
    expect(buySkill(p, 'FIRE')).toBeNull();
    expect(buySkill({ ...defaultProgress(), coins: 10 }, 'ICE')).toBeNull();
  });

  it('upgrades respect max rank', () => {
    let p = { ...defaultProgress(), coins: 1000 };
    p = buyUpgrade(p, 'quickCast')!;
    expect(p.coins).toBe(850);
    expect(buyUpgrade(p, 'quickCast')).toBeNull();
  });
});

describe('persistence', () => {
  it('saves after a purchase and restores on load', () => {
    useGame.setState({ progress: { ...defaultProgress(), coins: 100 } });
    act(() => useGame.getState().buySkill('ICE'));
    expect(loadProgress()).toMatchObject({ coins: 70, skills: { ICE: 1 } });
  });

  it('ignores corrupt data and clamps bad values', () => {
    localStorage.setItem(PROGRESS_KEY, '{nope');
    expect(loadProgress()).toEqual(defaultProgress());
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ version: 1, data: { currentLevel: -3, coins: 'x', skills: { FIRE: 9 } } }));
    expect(loadProgress()).toMatchObject({ currentLevel: 1, coins: 0, skills: { FIRE: 3 } });
  });

  it('persists settings', () => {
    act(() => useGame.getState().updateSettings({ difficulty: 'hard', volume: 0.2 }));
    expect(loadSettings()).toMatchObject({ difficulty: 'hard', volume: 0.2 });
  });
});

describe('shop UI', () => {
  it('disables what the player cannot afford and buys what they can', () => {
    useGame.setState({ progress: { ...defaultProgress(), coins: 40 } });
    render(<ShopScreen />);
    const fire = within(screen.getByTestId('skill-FIRE'));
    fireEvent.click(fire.getByRole('button', { name: /Unlock/ }));
    expect(fire.getByText('Tier I')).toBeInTheDocument();
    expect(fire.getByRole('button', { name: /Upgrade/ })).toBeDisabled();
    expect(within(screen.getByTestId('skill-ICE')).getByRole('button', { name: /Unlock/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: 'Upgrades' }));
    expect(within(screen.getByTestId('upgrade-chargeCapacity')).getByText('Rank 0/5')).toBeInTheDocument();
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
