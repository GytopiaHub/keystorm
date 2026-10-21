import { Assets, CanvasTextMetrics, Container, Graphics, Sprite, Text, TextStyle, Texture, TilingSprite } from 'pixi.js';
import { ART, iconUrl } from '../assets/art';
import { CONFIG } from '../engine/config';
import type { GameEngine } from '../engine/engine';
import type { EngineEvent, SkillId, Word } from '../engine/types';

// One field is drawn at a time; `FieldRenderer.create` sets these from the engine's field.
let FIELD = CONFIG.gameplay.field;
let W = FIELD.width;
let H = FIELD.height;
const WORD_H = FIELD.wordHeight;

export const WORD_FONT = `"JetBrains Mono", "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace`;
const DISPLAY_FONT = `"Exo 2", sans-serif`;

const ROMAN = ['', 'I', 'II', 'III'];
const COMBO_COLORS = [0x000000, 0x38bdf8, 0xd946ef, 0xf97316, 0xfacc15];

const hex = (c: string) => parseInt(c.replace('#', ''), 16);
const skillColor = (s: SkillId) => hex(CONFIG.skills[s].color);

/** Textures are preloaded by FieldCanvas; this just looks them up. */
const tex = (url: string): Texture => Assets.get<Texture>(url) ?? Texture.from(url);

function iconSprite(name: string, size: number): Sprite {
  const s = new Sprite(tex(iconUrl(name)));
  s.anchor.set(0.5);
  s.width = s.height = size;
  return s;
}

const wordIcon = (w: Word) => (w.kind === 'coin' ? 'coin' : w.kind === 'black' ? 'storm' : CONFIG.skills[w.skill!].icon);

/** Sky tint while a skill's weather shows. Skills not listed tint with their own colour. */
const WEATHER_TINT: Partial<Record<SkillId, { color: number; alpha: number }>> = {
  FIRE: { color: 0xff3b1f, alpha: 0.34 },
  ICE: { color: 0x7fdbff, alpha: 0.28 },
  SLOW: { color: 0x9aa6b8, alpha: 0.3 },
  WIND: { color: 0x5ce1b5, alpha: 0.2 },
};
const tintFor = (s: SkillId) => WEATHER_TINT[s] ?? { color: skillColor(s), alpha: 0.2 };

interface Weather {
  skill: SkillId;
  t: number;
  duration: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: number;
  gravity: number;
  streak: boolean;
}

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  near: boolean;
}

interface Bolt {
  paths: { x: number; y: number }[][];
  life: number;
  max: number;
  color: number;
}

interface Ring {
  x: number;
  y: number;
  radius: number;
  life: number;
  max: number;
  color: number;
}

interface WordView {
  root: Container;
  halo: Graphics;
  bg: Graphics;
  icon: Sprite | null;
  typed: Text;
  rest: Text;
  key: string;
  age: number;
  width: number;
}

interface Dying {
  view: WordView;
  life: number;
  max: number;
  mode: 'pop' | 'sink';
}

interface Floater {
  node: Container;
  life: number;
  max: number;
  vy: number;
  delay: number;
  banner: boolean;
}

interface Palette {
  fill: number;
  stroke: number;
  text: number;
  glow: number;
}

const palette = (w: Word): Palette => {
  switch (w.kind) {
    case 'coin':
      return { fill: 0x3d2a00, stroke: 0xffd23f, text: 0xfff1b8, glow: 0xffc21a };
    case 'black':
      return { fill: 0x06070b, stroke: w.speedMul > 1 ? 0xff3b3b : 0x7c8496, text: 0xffffff, glow: w.speedMul > 1 ? 0xff2020 : 0x5b6478 };
    case 'charge': {
      const c = skillColor(w.skill!);
      return { fill: 0x0e1328, stroke: c, text: 0xffffff, glow: c };
    }
    default:
      return { fill: 0x121a33, stroke: 0x4f6bb0, text: 0xeef3ff, glow: 0x6f8fe0 };
  }
};

const easeOutBack = (k: number) => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2;

/**
 * Soft edge glow: a white elliptical gradient that is clear in the middle and solid at the
 * edges, drawn once to a canvas and tinted per use. `clear` is the fraction left untouched.
 */
function edgeGlow(clear: number): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  // Squash a circle into the field's aspect so the glow hugs all four edges.
  ctx.setTransform(1, 0, 0, H / W, 0, 0);
  const g = ctx.createRadialGradient(W / 2, W / 2, W * clear * 0.5, W / 2, W / 2, W * 0.72);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, W);
  return new Sprite(Texture.from(canvas));
}

/**
 * Draws the play field from engine state. It is imperative on purpose: React mounts it once
 * per attempt and it then updates on Pixi's ticker without involving React.
 */
export class FieldRenderer {
  static create(engine: GameEngine, reducedMotion: boolean): FieldRenderer {
    FIELD = engine.field;
    W = FIELD.width;
    H = FIELD.height;
    return new FieldRenderer(reducedMotion);
  }

  readonly root = new Container();
  private stage = new Container();
  private sky = new Sprite(tex(ART.sky));
  private skyShade = new Graphics();
  private clouds: TilingSprite[] = [];
  private fireFrame = new Sprite(tex(ART.fire));
  private tint = new Graphics();
  private back = new Graphics();
  private water = new Graphics();
  private pileLayer = new Container();
  private wordLayer = new Container();
  private front = new Graphics();
  private floatLayer = new Container();
  private overlay = new Graphics();
  private vignette = edgeGlow(0.55);
  private dangerGlow = edgeGlow(0.7);
  private comboGlow = edgeGlow(0.85);
  private frost = new Sprite(tex(ART.frost));

  private views = new Map<number, WordView>();
  private deaths = new Map<number, { mode: 'pop' | 'sink' }>();
  private dying: Dying[] = [];
  private floaters: Floater[] = [];
  private pileTexts: Text[] = [];
  private pileKey = '';
  private particles: Particle[] = [];
  private rain: Drop[] = [];
  private weathers: Weather[] = [];
  private bolts: Bolt[] = [];
  private rings: Ring[] = [];
  private shake = 0;
  private time = 0;
  private flash = 0;
  private hurt = 0;
  private surfaceY = H - 6;
  private nextAmbientBolt = 3;
  private dangerLabel: Text;
  /** Skill whose charge the next `cleared` event granted (the engine emits it just before). */
  private pendingCharge: SkillId | null = null;

  private textStyle: TextStyle;
  private pileStyle: TextStyle;
  private charWidth: number;

  private constructor(private reducedMotion: boolean) {
    this.textStyle = new TextStyle({ fontFamily: WORD_FONT, fontSize: 22, fontWeight: '700', fill: 0xffffff });
    this.pileStyle = new TextStyle({ fontFamily: WORD_FONT, fontSize: 14, fontWeight: '700', fill: 0xd6f1ff, letterSpacing: 2 });
    this.charWidth = CanvasTextMetrics.measureText('MMMMMMMMMM', this.textStyle).width / 10;

    this.vignette.tint = 0x000000;
    this.vignette.alpha = 0.75;
    this.dangerGlow.tint = 0xff1a3c;
    this.comboGlow.alpha = 0;
    // The frames are painted on black, so additive blending drops the black out.
    for (const frame of [this.frost, this.fireFrame]) {
      frame.width = W;
      frame.height = H;
      frame.blendMode = 'add';
      frame.alpha = 0;
    }
    // Anchored at the bottom so the flames can flicker upward.
    this.fireFrame.anchor.set(0, 1);
    this.fireFrame.y = H;
    this.front.blendMode = 'add';

    this.dangerLabel = new Text({
      text: 'DANGER',
      style: new TextStyle({ fontFamily: DISPLAY_FONT, fontSize: 11, fontWeight: '900', fill: 0xff4d6a, letterSpacing: 3 }),
    });
    this.dangerLabel.anchor.set(1, 1);

    this.root.addChild(this.stage);
    this.stage.addChild(this.sky, this.skyShade);
    this.buildClouds();
    this.stage.addChild(
      this.tint,
      this.back,
      this.water,
      this.pileLayer,
      this.dangerLabel,
      this.wordLayer,
      this.front,
      this.floatLayer,
      this.frost,
      this.fireFrame,
      this.comboGlow,
      this.dangerGlow,
      this.vignette,
      this.overlay,
    );
    this.drawSky();
    for (let i = 0; i < 110; i++) this.rain.push(this.newDrop(true));
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    if (on) {
      this.particles = [];
      this.shake = 0;
    }
  }

  destroy(): void {
    // Art textures are shared across attempts; only the generated glows belong to this renderer.
    const textures = [this.vignette, this.dangerGlow, this.comboGlow].map((s) => s.texture);
    this.root.destroy({ children: true });
    for (const t of textures) t.destroy(true);
  }

  // ---- events ---------------------------------------------------------------------------

  handle(events: EngineEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'cleared': {
          this.deaths.set(e.word.id, { mode: 'pop' });
          if (e.cause === 'levelEnd') break;
          const color = e.cause === 'skill' ? 0xff7a1a : palette(e.word).glow;
          this.shatter(e.word, color);
          const cy = e.word.y + WORD_H / 2;
          if (e.points > 0) this.popup(`+${e.points}`, e.word.x, cy - 6, e.word.kind === 'coin' ? 0xffd23f : 0xffffff, 22);
          if (e.word.kind === 'coin') this.popup(`+${e.coins} coins`, e.word.x, cy + 18, 0xffd23f, 15, 0.08);
          if (this.pendingCharge) {
            const s = this.pendingCharge;
            this.popup(`+1 ${s}`, e.word.x, cy + 18, skillColor(s), 16, 0.08, CONFIG.skills[s].icon);
            this.pendingCharge = null;
          }
          break;
        }
        case 'chargeGained':
          this.pendingCharge = e.skill;
          break;
        case 'landed':
          this.deaths.set(e.word.id, { mode: 'sink' });
          this.splash(e.word.x, this.surfaceY, 0x8fd8ff, 18);
          this.shake = Math.max(this.shake, 4);
          break;
        case 'mistake':
          this.shake = Math.max(this.shake, 8);
          this.hurt = 1;
          this.popup(`−${CONFIG.gameplay.scoring.mistakePenalty}`, W / 2, H - 70, 0xff4d6a, 26);
          break;
        case 'skillFired': {
          this.weathers.push({ skill: e.skill, t: 0, duration: Math.max(1.2, e.duration) });
          const def = CONFIG.skills[e.skill];
          this.banner(`${e.skill} ${ROMAN[e.tier]}`, hex(def.color), H * 0.38, 46, 1.2, 0, def.icon);
          if (e.skill === 'FIRE') this.shake = Math.max(this.shake, 6);
          break;
        }
        case 'comboTier': {
          const tier = CONFIG.gameplay.combo.tiers.findIndex((t) => t.multiplier === e.multiplier);
          this.banner(`×${e.multiplier} COMBO`, COMBO_COLORS[Math.max(0, tier)] || 0xd946ef, H * 0.26, 34, 1.1);
          break;
        }
        case 'pileRemoved':
          for (let i = 0; i < 70; i++) {
            this.spawn(Math.random() * W * 0.4, this.surfaceY + Math.random() * 60, 500 + Math.random() * 500, -60 + Math.random() * 40, 1, 2, 0xb8f3ff, 0, true);
          }
          break;
        case 'levelComplete':
          this.flash = 0.6;
          this.banner('LEVEL CLEAR', 0x5cffb0, H * 0.45, 56, 1.4);
          for (let i = 0; i < 120; i++) {
            const colors = [0x5cffb0, 0x38bdf8, 0xffd23f, 0xd946ef];
            this.spawn(Math.random() * W, H + 10, (Math.random() - 0.5) * 200, -400 - Math.random() * 400, 1.6, 3, colors[i % 4], 420);
          }
          break;
        case 'levelFailed':
          this.hurt = 1.5;
          this.shake = Math.max(this.shake, 16);
          this.banner('FLOODED', 0xff4d6a, H * 0.45, 56, 1.4);
          break;
      }
    }
  }

  // ---- frame ----------------------------------------------------------------------------

  update(engine: GameEngine, dt: number): void {
    this.time += dt;
    for (const w of this.weathers) w.t += dt;
    this.weathers = this.weathers.filter((w) => w.t < w.duration);

    const targetSurface = engine.landingY;
    this.surfaceY += (targetSurface - this.surfaceY) * Math.min(1, dt * (this.reducedMotion ? 60 : 8));

    this.moveClouds(dt);
    this.syncPile(engine);
    this.syncWords(engine, dt);
    this.updateDying(dt);
    this.drawTint(engine);
    this.drawBack(engine, dt);
    this.drawWater(engine);
    this.drawFront(engine, dt);
    this.updateFloaters(dt);
    this.drawOverlays(engine, dt);

    if (!this.reducedMotion && this.shake > 0.1) {
      this.stage.position.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= Math.pow(0.0008, dt);
    } else {
      this.stage.position.set(0, 0);
      this.shake = 0;
    }
  }

  /** 0–1 strength of a skill's weather, fading in and out. */
  private strength(engine: GameEngine, skill: SkillId): number {
    let s = 0;
    const timed = engine.effects[skill];
    if (timed) s = Math.min(1, timed.remaining / 0.4, (timed.duration - timed.remaining) / 0.2);
    for (const w of this.weathers) {
      if (w.skill !== skill || w.t < 0) continue;
      s = Math.max(s, Math.min(1, w.t / 0.2, (w.duration - w.t) / 0.4));
    }
    return Math.max(0, s);
  }

  // ---- words ----------------------------------------------------------------------------

  private syncWords(engine: GameEngine, dt: number): void {
    const highlighted = engine.highlighted();
    const buf = engine.buffer;
    const frozen = engine.frozen;
    const seen = new Set<number>();
    for (const w of engine.words) {
      seen.add(w.id);
      let view = this.views.get(w.id);
      if (!view) {
        view = this.createView(w);
        this.views.set(w.id, view);
        this.wordLayer.addChild(view.root);
      }
      view.age += dt;
      const hl = highlighted.has(w.id) ? buf.length : 0;
      const key = `${w.text}|${hl}|${frozen}|${w.speedMul}`;
      if (key !== view.key) {
        this.drawView(view, w, hl, frozen);
        view.key = key;
      }

      let x = w.x;
      let rotation = 0;
      if (!this.reducedMotion && w.kind === 'black') {
        rotation = Math.sin(this.time * 3 + w.id) * 0.03;
        if (w.speedMul > 1) x += (Math.random() - 0.5) * 2 * Math.min(4, w.speedMul);
      }
      view.root.position.set(x, w.y + WORD_H / 2);
      view.root.rotation = rotation;

      const k = this.reducedMotion ? 1 : Math.min(1, view.age / 0.25);
      const scale = (this.reducedMotion ? 1 : 0.4 + 0.6 * easeOutBack(k)) * (hl ? 1.08 : 1);
      view.root.scale.set(scale);
      view.root.alpha = Math.min(1, k * 1.5);

      const pulse = this.reducedMotion ? 0.7 : 0.55 + 0.45 * Math.sin(this.time * 4 + w.id);
      view.halo.alpha = hl ? 1 : w.kind === 'normal' ? 0.35 : pulse;
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.views.delete(id);
      const death = this.deaths.get(id);
      this.deaths.delete(id);
      if (this.reducedMotion || !death) {
        view.root.destroy({ children: true });
      } else {
        this.dying.push({ view, life: death.mode === 'pop' ? 0.28 : 0.35, max: death.mode === 'pop' ? 0.28 : 0.35, mode: death.mode });
      }
    }
  }

  private updateDying(dt: number): void {
    for (const d of this.dying) {
      d.life -= dt;
      const k = 1 - Math.max(0, d.life) / d.max;
      const r = d.view.root;
      if (d.mode === 'pop') {
        r.scale.set(1 + 0.7 * k);
        r.alpha = (1 - k) ** 1.5;
        d.view.halo.alpha = 1;
      } else {
        r.y += 60 * dt;
        r.scale.set(1 + 0.3 * k, 1 - 0.6 * k);
        r.alpha = 1 - k;
      }
    }
    for (const d of this.dying.filter((d) => d.life <= 0)) d.view.root.destroy({ children: true });
    this.dying = this.dying.filter((d) => d.life > 0);
  }

  private createView(w: Word): WordView {
    const root = new Container();
    const halo = new Graphics();
    const bg = new Graphics();
    const typed = new Text({ text: '', style: this.textStyle.clone() });
    const rest = new Text({ text: '', style: this.textStyle.clone() });
    halo.blendMode = 'add';
    const icon = w.kind === 'normal' ? null : iconSprite(wordIcon(w), 38);
    root.addChild(halo, bg, typed, rest);
    if (icon) root.addChild(icon);
    return { root, halo, bg, icon, typed, rest, key: '', age: 0, width: 0 };
  }

  private viewWidth(w: Word): number {
    return w.text.length * this.charWidth + FIELD.wordPadding + (w.kind === 'normal' ? 0 : 26);
  }

  private drawView(view: WordView, w: Word, hl: number, frozen: boolean): void {
    const p = palette(w);
    const width = this.viewWidth(w);
    const h = WORD_H;
    view.width = width;
    view.root.pivot.set(width / 2, h / 2);
    const glow = hl ? 0x5cff9d : p.glow;

    const halo = view.halo;
    halo.clear();
    for (let i = 4; i >= 1; i--) {
      const spread = i * 3;
      halo
        .roundRect(-spread, -spread, width + spread * 2, h + spread * 2, 10 + spread)
        .fill({ color: glow, alpha: 0.07 + (4 - i) * 0.03 });
    }

    const g = view.bg;
    g.clear();
    if (w.kind === 'black') {
      // Thundercloud: a pill with puffs on top.
      for (const [cx, r] of [
        [width * 0.28, 11],
        [width * 0.52, 15],
        [width * 0.78, 11],
      ] as const) {
        g.circle(cx, 3, r).fill({ color: p.fill });
        g.circle(cx, 3, r).stroke({ width: 1.5, color: p.stroke, alpha: 0.6 });
      }
      g.roundRect(0, 0, width, h, h / 2).fill({ color: p.fill });
      g.roundRect(0, 0, width, h, h / 2).stroke({ width: 2, color: p.stroke });
    } else {
      g.roundRect(0, 0, width, h, 9).fill({ color: p.fill, alpha: 0.95 });
      // Glassy top highlight.
      g.roundRect(2, 2, width - 4, h / 2 - 2, 7).fill({ color: 0xffffff, alpha: 0.07 });
      if (w.kind === 'charge') g.roundRect(0, 0, width, h, 9).fill({ color: p.stroke, alpha: 0.2 });
      if (w.kind === 'coin') g.roundRect(0, 0, width, h, 9).fill({ color: 0xffb300, alpha: 0.18 });
      g.roundRect(0, 0, width, h, 9).stroke({ width: w.kind === 'normal' ? 1.5 : 2.5, color: p.stroke });
      if (w.kind === 'coin') g.roundRect(3, 3, width - 6, h - 6, 7).stroke({ width: 1, color: 0xfff1b8, alpha: 0.7 });
      if (w.kind === 'charge') {
        // Dashed inner outline so charge words differ from others by shape, not colour alone.
        for (let x = 8; x < width - 8; x += 10) g.rect(x, h - 4, 5, 1.5).fill({ color: p.stroke, alpha: 0.9 });
      }
    }
    if (hl > 0) g.roundRect(-1, -1, width + 2, h + 2, 10).stroke({ width: 2, color: 0x5cff9d });
    if (frozen) {
      g.roundRect(0, 0, width, h, 9).fill({ color: 0xbfefff, alpha: 0.32 });
      g.roundRect(0, 0, width, h, 9).stroke({ width: 2, color: 0xe6fbff, alpha: 0.9 });
      for (let x = 10; x < width; x += 22) g.moveTo(x, 0).lineTo(x + 6, 9).lineTo(x + 2, 14);
      g.stroke({ width: 1, color: 0xffffff, alpha: 0.7 });
    }

    let x = FIELD.wordPadding / 2;
    if (view.icon) {
      // The icon pokes out past the badge's left edge, like a sticker.
      view.icon.position.set(10, h / 2);
      x += 26;
    }

    view.typed.text = w.text.slice(0, hl);
    view.typed.style.fill = 0x5cff9d;
    view.rest.text = w.text.slice(hl);
    view.rest.style.fill = p.text;
    const ty = (h - view.rest.height) / 2;
    view.typed.position.set(x, ty);
    view.rest.position.set(x + hl * this.charWidth, ty);
  }

  // ---- floating text --------------------------------------------------------------------

  /** A line of text with an optional icon in front, centred on its own origin. */
  private label(text: string, style: TextStyle, icon?: string): Container {
    const c = new Container();
    const t = new Text({ text, style });
    t.anchor.set(0, 0.5);
    let x = 0;
    if (icon) {
      const size = Number(style.fontSize) * 1.35;
      const sprite = iconSprite(icon, size);
      sprite.position.set(size / 2, 0);
      c.addChild(sprite);
      x = size + Number(style.fontSize) * 0.25;
    }
    t.position.set(x, 0);
    c.addChild(t);
    c.pivot.set((x + t.width) / 2, 0);
    return c;
  }

  private popup(text: string, x: number, y: number, color: number, size: number, delay = 0, icon?: string): void {
    const style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: size,
      fontWeight: '900',
      fill: color,
      stroke: { color: 0x05070f, width: 4 },
    });
    const node = this.label(text, style, icon);
    node.position.set(x, y);
    node.alpha = 0;
    this.floatLayer.addChild(node);
    this.floaters.push({ node, life: 0.9, max: 0.9, vy: this.reducedMotion ? 0 : -55, delay, banner: false });
  }

  private banner(text: string, color: number, y: number, size: number, life: number, delay = 0, icon?: string): void {
    const style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: size,
      fontWeight: '900',
      fill: color,
      letterSpacing: 4,
      stroke: { color: 0x05070f, width: 6 },
      dropShadow: { color, blur: 18, distance: 0, alpha: 0.9 },
    });
    const node = this.label(text, style, icon);
    node.position.set(W / 2, y);
    node.alpha = 0;
    this.floatLayer.addChild(node);
    // Only one banner at a time: a new one hurries any showing banner off screen.
    if (!delay) {
      for (const f of this.floaters) if (f.banner && f.delay <= 0) f.life = Math.min(f.life, 0.15);
    }
    this.floaters.push({ node, life, max: life, vy: 0, delay, banner: true });
  }

  private updateFloaters(dt: number): void {
    for (const f of this.floaters) {
      if (f.delay > 0) {
        f.delay -= dt;
        continue;
      }
      f.life -= dt;
      const age = f.max - f.life;
      if (f.banner) {
        const k = Math.min(1, age / 0.18);
        // Slams in from large, then holds.
        f.node.scale.set(this.reducedMotion ? 1 : 1 + 0.8 * (1 - k) ** 3);
        f.node.alpha = Math.min(1, age / 0.08, f.life / 0.35);
      } else {
        f.node.y += f.vy * dt;
        f.node.alpha = Math.min(1, age / 0.06, f.life / 0.4);
        if (!this.reducedMotion) f.node.scale.set(1 + 0.4 * Math.max(0, 1 - age / 0.12));
      }
    }
    for (const f of this.floaters.filter((f) => f.life <= 0)) f.node.destroy({ children: true });
    this.floaters = this.floaters.filter((f) => f.life > 0);
  }

  // ---- pile -----------------------------------------------------------------------------

  private syncPile(engine: GameEngine): void {
    const key = engine.pile.map((r) => r.text).join(',');
    if (key === this.pileKey) return;
    this.pileKey = key;
    for (const t of this.pileTexts) t.destroy();
    this.pileTexts = engine.pile.map((row, i) => {
      const t = new Text({ text: row.text.toUpperCase(), style: this.pileStyle });
      t.anchor.set(0.5);
      t.position.set(W / 2 + ((i * 137) % 300) - 150, H - (i + 0.5) * engine.rowHeight);
      t.alpha = 0.45;
      this.pileLayer.addChild(t);
      return t;
    });
  }

  private drawWater(engine: GameEngine): void {
    const g = this.water;
    g.clear();
    const top = this.surfaceY;
    const t = this.reducedMotion ? 0 : this.time;
    const wave = (x: number) => top + Math.sin(x * 0.018 + t * 1.8) * 3 + Math.sin(x * 0.047 - t * 2.6) * 1.6;

    // Sample every 16px and always end exactly at the right edge, whatever the field width.
    const xs: number[] = [];
    for (let x = 0; x < W; x += 16) xs.push(x);
    xs.push(W);
    const pts: number[] = [];
    for (const x of xs) pts.push(x, wave(x));
    g.poly([...pts, W, H, 0, H]).fill({ color: 0x1569b0, alpha: 0.82 });

    // Depth bands: darker toward the bottom.
    const rh = engine.rowHeight;
    for (let i = 0; i < engine.pile.length; i++) {
      const y = H - (i + 1) * rh;
      g.rect(0, y + rh - 1.5, W, 1.5).fill({ color: 0x9fdcff, alpha: 0.12 });
      g.rect(0, y, W, rh).fill({ color: 0x020814, alpha: Math.max(0, 0.42 - i * 0.04) });
    }

    // Caustic shimmer and foam line.
    if (!this.reducedMotion) {
      for (let i = 0; i < 6; i++) {
        const x = ((t * 30 + i * 190) % (W + 200)) - 100;
        g.ellipse(x, top + 12 + (i % 3) * 18, 70, 4).fill({ color: 0x9fe8ff, alpha: 0.08 });
      }
    }
    g.moveTo(0, wave(0));
    for (const x of xs) g.lineTo(x, wave(x));
    g.stroke({ width: 2.5, color: 0xc8f2ff, alpha: 0.85 });
    g.moveTo(0, wave(0) + 5);
    for (const x of xs) g.lineTo(x, wave(x) + 5);
    g.stroke({ width: 6, color: 0x5cc8ff, alpha: 0.18 });

    if (!this.reducedMotion && engine.pile.length > 0 && Math.random() < 0.25) {
      this.spawn(Math.random() * W, H - Math.random() * (H - top), 0, -30 - Math.random() * 30, 1.2, 1.5, 0x9fe8ff, 0);
    }
  }

  // ---- background, weather and particles ------------------------------------------------

  private drawSky(): void {
    // Cover the field without stretching the painting, keeping its horizon centred.
    const scale = Math.max(W / this.sky.texture.width, H / this.sky.texture.height);
    this.sky.scale.set(scale);
    this.sky.anchor.set(0.5);
    this.sky.position.set(W / 2, H / 2);
    // Knock the painting back so white words stay the brightest thing on screen.
    this.skyShade.rect(0, 0, W, H).fill({ color: 0x03050c, alpha: 0.38 });
  }

  private static CLOUD_LAYERS = [
    { height: 230, color: 0x46507e, alpha: 0.45, speed: 6 },
    { height: 190, color: 0x232b52, alpha: 0.72, speed: 11 },
    { height: 150, color: 0x0d1230, alpha: 0.92, speed: 18 },
  ];

  private buildClouds(): void {
    FieldRenderer.CLOUD_LAYERS.forEach((l, i) => {
      const texture = tex(ART.clouds[i]);
      const c = new TilingSprite({ texture, width: W, height: l.height });
      c.tileScale.set(l.height / texture.height);
      c.tilePosition.x = -i * 300;
      c.tint = l.color;
      c.alpha = l.alpha;
      this.clouds.push(c);
      this.stage.addChild(c);
    });
  }

  private moveClouds(dt: number): void {
    const wind = this.weathers.some((w) => w.skill === 'WIND') ? 12 : 1;
    // Lightning lights the clouds from inside.
    const lit = Math.min(1, this.flash * 1.6);
    this.clouds.forEach((c, i) => {
      const l = FieldRenderer.CLOUD_LAYERS[i];
      if (!this.reducedMotion) c.tilePosition.x -= l.speed * wind * dt;
      c.tint = lerpColor(l.color, 0xc9d3ff, lit * (0.9 - i * 0.2));
    });
  }

  private drawTint(engine: GameEngine): void {
    const g = this.tint;
    g.clear();
    for (const skill of CONFIG.skillOrder) {
      const s = this.strength(engine, skill);
      if (s <= 0) continue;
      const tint = tintFor(skill);
      const alpha = tint.alpha * s;
      // Heavier at the top, like weather filling the sky.
      g.rect(0, 0, W, H).fill({ color: tint.color, alpha: alpha * 0.6 });
      g.rect(0, 0, W, H * 0.5).fill({ color: tint.color, alpha: alpha * 0.5 });
    }
  }

  private newDrop(anywhere: boolean): Drop {
    const near = Math.random() < 0.4;
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : -20 - Math.random() * 40,
      len: near ? 16 + Math.random() * 14 : 7 + Math.random() * 7,
      speed: near ? 620 + Math.random() * 200 : 320 + Math.random() * 120,
      near,
    };
  }

  private drawBack(engine: GameEngine, dt: number): void {
    const g = this.back;
    g.clear();
    if (this.reducedMotion) return;

    // Ambient lightning in the clouds.
    this.nextAmbientBolt -= dt;
    if (this.nextAmbientBolt <= 0) {
      const x = 80 + Math.random() * (W - 160);
      this.bolts.push({ paths: this.boltTree(x, 0, x + (Math.random() - 0.5) * 200, 120 + Math.random() * 140, 3), life: 0.3, max: 0.3, color: 0xcfe0ff });
      this.flash = Math.max(this.flash, 0.3);
      this.nextAmbientBolt = 5 + Math.random() * 9;
    }

    const slow = engine.effects.SLOW ? 0.25 : 1;
    const wind = this.strength(engine, 'WIND') > 0;
    const ice = engine.frozen;
    const target = Math.round(110 * (W / 960));
    while (this.rain.length < target) this.rain.push(this.newDrop(true));
    if (this.rain.length > target) this.rain.length = target;

    const slant = wind ? 1.1 : 0.14;
    for (const d of this.rain) {
      d.y += d.speed * slow * dt;
      d.x += d.speed * slow * slant * dt;
      const hitWater = d.y > this.surfaceY;
      if (hitWater && d.near && Math.random() < 0.35) this.splash(d.x, this.surfaceY, 0xa8dcff, 2);
      if (hitWater || d.x > W + 20) {
        Object.assign(d, this.newDrop(false));
        if (d.x > W) d.x -= W;
      }
    }
    for (const near of [false, true]) {
      for (const d of this.rain) {
        if (d.near !== near) continue;
        if (ice) g.circle(d.x, d.y, near ? 2.2 : 1.2).fill({ color: 0xffffff, alpha: near ? 0.85 : 0.45 });
        else g.moveTo(d.x, d.y).lineTo(d.x - d.len * slant * 0.6, d.y - d.len);
      }
      if (!ice) g.stroke({ width: near ? 1.6 : 1, color: near ? 0xa9c8ff : 0x6d88c4, alpha: near ? 0.45 : 0.25 });
    }

    const fog = this.strength(engine, 'SLOW');
    if (fog > 0) {
      for (let i = 0; i < 9; i++) {
        const x = ((this.time * 14 + i * 140) % (W + 400)) - 200;
        g.ellipse(x, 100 + (i % 4) * 110, 220, 70).fill({ color: 0xcdd6e4, alpha: 0.07 * fog });
      }
    }
  }

  private drawFront(engine: GameEngine, dt: number): void {
    const g = this.front;
    g.clear();
    // Danger line, glowing harder as the pile nears it.
    const dy = engine.dangerY;
    const near = engine.pile.length / engine.dangerRows;
    const pulse = this.reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(this.time * (4 + near * 10));
    g.rect(0, dy - 3, W, 6).fill({ color: 0xff2040, alpha: (0.08 + near * 0.25) * pulse });
    for (let x = 0; x < W; x += 24) g.rect(x, dy - 1, 14, 2).fill({ color: 0xff4d6a, alpha: 0.6 + 0.4 * near * pulse });
    this.dangerLabel.position.set(W - 8, dy - 4);
    this.dangerLabel.alpha = 0.5 + 0.5 * near * pulse;

    if (this.reducedMotion) {
      this.particles = [];
      this.bolts = [];
      this.rings = [];
      return;
    }

    this.emitWeatherParticles(engine, dt);

    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.particles) {
      const a = Math.min(1, p.life / p.max);
      if (p.streak) {
        g.moveTo(p.x, p.y).lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035).stroke({ width: p.size, color: p.color, alpha: a });
      } else {
        g.circle(p.x, p.y, p.size * (0.5 + a * 0.5)).fill({ color: p.color, alpha: a });
      }
    }

    for (const b of this.bolts) {
      b.life -= dt;
      const a = Math.max(0, b.life / b.max);
      for (const [width, alpha, color] of [
        [12, 0.12, b.color],
        [5, 0.35, b.color],
        [2, 1, 0xffffff],
      ] as const) {
        for (const path of b.paths) {
          g.moveTo(path[0].x, path[0].y);
          for (const pt of path.slice(1)) g.lineTo(pt.x, pt.y);
        }
        g.stroke({ width, color, alpha: alpha * a });
      }
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);

    for (const r of this.rings) {
      r.life -= dt;
      const k = 1 - r.life / r.max;
      const radius = r.radius * (0.2 + 0.8 * Math.sqrt(k));
      g.circle(r.x, r.y, radius).stroke({ width: 14 * (1 - k), color: r.color, alpha: Math.max(0, 1 - k) * 0.5 });
      g.circle(r.x, r.y, radius).stroke({ width: 3, color: 0xffffff, alpha: Math.max(0, 1 - k) });
    }
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  private emitWeatherParticles(engine: GameEngine, dt: number): void {
    const many = (n: number, fn: () => void) => {
      const count = Math.floor(n * dt) + (Math.random() < (n * dt) % 1 ? 1 : 0);
      for (let i = 0; i < count; i++) fn();
    };
    const fire = this.weathers.find((w) => w.skill === 'FIRE' && w.t >= 0);
    if (fire) {
      // A wall of flame sweeps across, then embers linger.
      const sweep = fire.t / 0.7;
      if (sweep < 1) {
        many(500, () =>
          this.spawn(sweep * W + (Math.random() - 0.5) * 60, H - Math.random() * H, 60 + Math.random() * 80, -150 - Math.random() * 200, 0.6, 5, Math.random() < 0.5 ? 0xff5a1a : 0xffb02e, -80),
        );
      }
      many(160, () =>
        this.spawn(Math.random() * W, H - Math.random() * 60, (Math.random() - 0.5) * 60, -120 - Math.random() * 160, 1.4, 2.5, Math.random() < 0.5 ? 0xff7a1a : 0xffc04d, -30),
      );
    }
    if (this.strength(engine, 'WIND') > 0) {
      many(90, () => this.spawn(-20, Math.random() * H, 900 + Math.random() * 500, (Math.random() - 0.5) * 60, 1.2, 1.6, 0xc8fff0, 0, true));
    }
    if (engine.multiplier >= 3) {
      many(25, () => this.spawn(Math.random() * W, this.surfaceY, (Math.random() - 0.5) * 30, -90 - Math.random() * 60, 1.4, 2, 0xfacc15, 0));
    }
  }

  private drawOverlays(engine: GameEngine, dt: number): void {
    const o = this.overlay;
    o.clear();

    this.frost.alpha = this.strength(engine, 'ICE');

    // Flames rise during FIRE, and smoulder at the edges while the combo is maxed out.
    const fire = Math.max(this.strength(engine, 'FIRE'), engine.multiplier >= 3 ? 0.25 : 0);
    const flicker = this.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(this.time * 17) * Math.sin(this.time * 7.3);
    this.fireFrame.alpha = fire * flicker;
    this.fireFrame.height = H * (this.reducedMotion ? 1 : 1 + 0.04 * Math.sin(this.time * 11));

    const tierIdx = CONFIG.gameplay.combo.tiers.findIndex((t) => t.multiplier === engine.multiplier);
    if (tierIdx > 0) {
      this.comboGlow.tint = COMBO_COLORS[tierIdx];
      const pulse = this.reducedMotion ? 0.8 : 0.7 + 0.3 * Math.sin(this.time * 3);
      this.comboGlow.alpha = (0.15 + tierIdx * 0.1) * pulse;
    } else {
      this.comboGlow.alpha = Math.max(0, this.comboGlow.alpha - dt * 2);
    }

    const near = engine.pile.length / engine.dangerRows;
    const danger = near >= 0.7 ? (near - 0.6) / 0.4 : 0;
    const beat = this.reducedMotion ? 0.7 : 0.5 + 0.5 * Math.sin(this.time * 7);
    this.dangerGlow.alpha = Math.min(1, danger * beat + this.hurt * 0.8);
    this.hurt = Math.max(0, this.hurt - dt * 2.5);

    // Full-screen layers cost fill rate even when transparent, so skip them when unseen.
    for (const layer of [this.frost, this.fireFrame, this.comboGlow, this.dangerGlow]) layer.visible = layer.alpha > 0.01;

    if (!this.reducedMotion && this.flash > 0) {
      o.rect(0, 0, W, H).fill({ color: 0xe8f0ff, alpha: Math.min(0.6, this.flash) * 0.55 });
      this.flash = Math.max(0, this.flash - dt * 2.8);
    } else {
      this.flash = 0;
    }
  }

  private spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, color: number, gravity: number, streak = false): void {
    if (this.reducedMotion || this.particles.length > 1400) return;
    this.particles.push({ x, y, vx, vy, life, max: life, size, color, gravity, streak });
  }

  /** Burst a cleared word into letter-sized shards. */
  private shatter(w: Word, color: number): void {
    const cx = w.x;
    const cy = w.y + WORD_H / 2;
    const n = 10 + w.text.length * 3;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 120 + Math.random() * 260;
      this.spawn(cx + (Math.random() - 0.5) * w.width, cy + (Math.random() - 0.5) * 16, Math.cos(a) * s, Math.sin(a) * s - 60, 0.7, 2.6, color, 420, Math.random() < 0.4);
    }
    this.rings.push({ x: cx, y: cy, radius: Math.max(40, w.width * 0.6), life: 0.3, max: 0.3, color });
  }

  private splash(x: number, y: number, color: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.spawn(x + (Math.random() - 0.5) * 30, y, (Math.random() - 0.5) * 140, -80 - Math.random() * 160, 0.5, 1.6, color, 600);
    }
  }

  private boltPath(x1: number, y1: number, x2: number, y2: number, segs: number): { x: number; y: number }[] {
    const pts = [{ x: x1, y: y1 }];
    const len = Math.hypot(x2 - x1, y2 - y1);
    for (let i = 1; i < segs; i++) {
      const k = i / segs;
      const jitter = len * 0.08;
      pts.push({ x: x1 + (x2 - x1) * k + (Math.random() - 0.5) * jitter, y: y1 + (y2 - y1) * k + (Math.random() - 0.5) * jitter * 0.5 });
    }
    pts.push({ x: x2, y: y2 });
    return pts;
  }

  /** A main bolt with a few forks. */
  private boltTree(x1: number, y1: number, x2: number, y2: number, forks: number): { x: number; y: number }[][] {
    const main = this.boltPath(x1, y1, x2, y2, 10);
    const paths = [main];
    for (let i = 0; i < forks; i++) {
      const from = main[2 + Math.floor(Math.random() * (main.length - 4))];
      const ang = Math.atan2(y2 - y1, x2 - x1) + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6);
      const l = 40 + Math.random() * 80;
      paths.push(this.boltPath(from.x, from.y, from.x + Math.cos(ang) * l, from.y + Math.sin(ang) * l, 5));
    }
    return paths;
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255,
    ag = (a >> 8) & 255,
    ab = a & 255;
  const br = (b >> 16) & 255,
    bg = (b >> 8) & 255,
    bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
