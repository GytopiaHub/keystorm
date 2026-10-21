import { Application, useApplication, useTick } from '@pixi/react';
import { useEffect, useRef } from 'react';
import { CONFIG } from '../engine/config';
import type { GameEngine } from '../engine/engine';
import type { EngineEvent } from '../engine/types';
import { FieldRenderer } from './fieldRenderer';

interface Props {
  engine: GameEngine;
  paused: boolean;
  reducedMotion: boolean;
  /** Runs once per frame before drawing; returns the engine events to visualise. */
  onFrame: (dt: number) => EngineEvent[];
}

const { width, height } = CONFIG.gameplay.field;

export function FieldCanvas(props: Props) {
  return (
    <Application
      width={width}
      height={height}
      background={0x070a14}
      antialias
      autoDensity={false}
      resolution={Math.min(2, window.devicePixelRatio || 1)}
      className="field-canvas"
    >
      <Scene {...props} />
    </Application>
  );
}

function Scene({ engine, paused, reducedMotion, onFrame }: Props) {
  const { app, isInitialised } = useApplication();
  const renderer = useRef<FieldRenderer | null>(null);
  const latest = useRef({ engine, paused, onFrame });
  latest.current = { engine, paused, onFrame };

  useEffect(() => {
    if (!isInitialised) return;
    const r = new FieldRenderer(reducedMotion);
    app.stage.addChild(r.root);
    renderer.current = r;
    return () => {
      renderer.current = null;
      // The Application may already have torn down the stage (and our root with it).
      if (!r.root.destroyed) {
        r.root.removeFromParent();
        r.destroy();
      }
    };
    // Reduced-motion changes are applied below without rebuilding the renderer.
  }, [app, isInitialised]);

  useEffect(() => {
    renderer.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  useTick((ticker) => {
    const r = renderer.current;
    if (!r) return;
    const { engine, paused, onFrame } = latest.current;
    const dt = Math.min(ticker.deltaMS / 1000, 0.1);
    r.handle(onFrame(dt));
    r.update(engine, paused ? 0 : dt);
  });

  return null;
}
