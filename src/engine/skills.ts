import type { GameEngine } from './engine';
import type { SkillId, SkillTierDef } from './types';

/**
 * What a skill does when fired. A skill is either instant (`cast`) or lasts a while (`timed`);
 * the engine handles charges, timers and events for both, so a new skill only describes its
 * effect here.
 */
export interface SkillBehaviour {
  /** Instant effect, applied once. */
  cast?: (engine: GameEngine, tier: SkillTierDef) => void;
  /**
   * Lasts `tier.duration` seconds. Firing it again while active restarts the timer instead of
   * stacking (FR-39).
   */
  timed?: {
    /** Words stop falling and no new words spawn. */
    freezes?: boolean;
    /** Multiplies fall speed. */
    speed?: (tier: SkillTierDef) => number;
  };
}

export const SKILL_BEHAVIOURS: Record<SkillId, SkillBehaviour> = {
  FIRE: { cast: (engine, tier) => engine.burnLowest(tier.count ?? 0) },
  ICE: { timed: { freezes: true } },
  SLOW: { timed: { speed: (tier) => tier.speed ?? 1 } },
  WIND: {
    cast: (engine, tier) => {
      engine.removePileRows(tier.rows ?? 0);
      engine.pushWordsUp(tier.push ?? 0);
    },
  },
};
