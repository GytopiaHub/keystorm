import { Application, useApplication, useTick } from '@pixi/react';
import { Assets } from 'pixi.js';
import { FIELD_TEXTURES } from '../assets/art';
import { useEffect, useRef } from 'react';
import { CONFIG } from '../engine/config';
import type { GameEngine } from '../engine/engine';
import type { EngineEvent } from '../engine/types';
import { FieldRenderer } from './fieldRenderer';

let assetsLoaded: Promise<unknown> | null = null;
/** Fonts (Pixi measures text when it's created) and art textures, loaded once per session. */
function assetsReady(): Promise<unknown> {
  const fonts = Promise.race([
    Promise.all([document.fonts?.load('700 22px "JetBrains Mono"'), document.fonts?.load('900 40px "Exo 2"')]),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]).catch(() => undefined);
  assetsLoaded ??= Promise.all([fonts, Assets.load(FIELD_TEXTURES)]);
  return assetsLoaded;
}

interface Props {
  engine: GameEngine;
  paused: boolean;
  reducedMotion: boolean;
  /** Runs once per frame before drawing; returns the engine events to visualise. */
  onFrame: (dt: number) => EngineEvent[];
}

const { width, height } = CONFIG.gameplay.field;

/** Logical-to-screen scale never exceeds this, so words don't balloon on large monitors. */
const MAX_SCALE = 1.4;
/** Narrow windows get a taller field rather than one too thin to fit words side by side. */
const MIN_WIDTH = 720;
/** Upper bound on backing pixels per logical pixel, to keep 4K screens fast. */
const MAX_RESOLUTION = 3;

/**
 * Make the field fill its box: before play starts the engine's field is reshaped to the box's
 * aspect, then the canvas is sized to the box and rendered at the real on-screen pixel
 * density, so text and sprites are drawn at their displayed size instead of stretched by CSS.
 */
function useFillField(app: ReturnType<typeof useApplication>['app'], ready: boolean, engine: GameEngine) {
  useEffect(() => {
    if (!ready) return;
    const canvas = app.canvas;
    const box = canvas.parentElement;
    if (!box) return;
    const fit = () => {
      const bw = box.clientWidth;
      const bh = box.clientHeight;
      if (!bw || !bh) return;
      const s = Math.min(MAX_SCALE, bh / height, bw / MIN_WIDTH);
      // Only takes effect before the first frame; later resizes keep the field and fit it.
      engine.fitField(bw / s, bh / s);
      const field = engine.field;
      const scale = Math.min(bw / field.width, bh / field.height);
      const resolution = Math.min(MAX_RESOLUTION, (window.devicePixelRatio || 1) * scale);
      // Changing resolution makes Pixi re-render every text at the new density.
      if (app.renderer.resolution !== resolution || app.renderer.width !== field.width) {
        app.renderer.resize(field.width, field.height, resolution);
      }
      canvas.style.width = `${field.width * scale}px`;
      canvas.style.height = `${field.height * scale}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    // Moving the window to a screen with a different pixel ratio doesn't resize anything.
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [app, ready, engine]);
}

export function FieldCanvas(props: Props) {
  return (
    <Application
      width={width}
      height={height}
      background={0x070a14}
      antialias
      autoDensity={false}
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
  useFillField(app, isInitialised, engine);

  useEffect(() => {
    if (!isInitialised) return;
    let r: FieldRenderer | null = null;
    let cancelled = false;
    assetsReady().then(() => {
      if (cancelled) return;
      r = FieldRenderer.create(latest.current.engine, latest.current.reducedMotion);
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
