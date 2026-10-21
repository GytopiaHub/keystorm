import { Application, useApplication, useTick } from '@pixi/react';
import { useEffect, useRef } from 'react';
import { CONFIG } from '../engine/config';
import type { GameEngine } from '../engine/engine';
import type { EngineEvent } from '../engine/types';
import { FieldRenderer } from './fieldRenderer';

let fontsLoaded: Promise<unknown> | null = null;
function fontsReady(): Promise<unknown> {
  fontsLoaded ??= Promise.race([
    Promise.all([
      document.fonts?.load('700 22px "JetBrains Mono"'),
      document.fonts?.load('900 40px "Exo 2"'),
    ]),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]).catch(() => undefined);
  return fontsLoaded;
}

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
  const latest = useRef({ engine, paused, onFrame, reducedMotion });
  latest.current = { engine, paused, onFrame, reducedMotion };

  useEffect(() => {
    if (!isInitialised) return;
    let r: FieldRenderer | null = null;
    let cancelled = false;
    // Pixi measures text when it's created, so the word font must be loaded first.
    fontsReady().then(() => {
      if (cancelled) return;
      r = new FieldRenderer(latest.current.reducedMotion);
      app.stage.addChild(r.root);
      renderer.current = r;
    });
    return () => {
      cancelled = true;
      renderer.current = null;
      // The Application may already have torn down the stage (and our root with it).
      if (r && !r.root.destroyed) {
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
