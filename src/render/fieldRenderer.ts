import { CanvasTextMetrics, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { CONFIG } from '../engine/config';
import type { GameEngine } from '../engine/engine';
import type { EngineEvent, SkillId, Word } from '../engine/types';

const FIELD = CONFIG.gameplay.field;
const W = FIELD.width;
const H = FIELD.height;

const FONT = '"Cascadia Mono", "JetBrains Mono", Consolas, "DejaVu Sans Mono", "Courier New", monospace';
const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

const hex = (c: string) => parseInt(c.replace('#', ''), 16);
const skillColor = (s: SkillId) => hex(CONFIG.skills[s].color);

const WEATHER_TINT: Record<SkillId, { color: number; alpha: number }> = {
  FIRE: { color: 0xff3b1f, alpha: 0.3 },
  BOMB: { color: 0xfff6d5, alpha: 0.35 },
  CHAIN: { color: 0xf7e463, alpha: 0.12 },
  ICE: { color: 0x7fdbff, alpha: 0.26 },
  SLOW: { color: 0x9aa6b8, alpha: 0.3 },
  REWIND: { color: 0x9d7bff, alpha: 0.2 },
  SHRINK: { color: 0xc9e4ff, alpha: 0.16 },
  WIND: { color: 0x5ce1b5, alpha: 0.16 },
  SHIELD: { color: 0x4d9dff, alpha: 0.14 },
  MAGNET: { color: 0xff6fb5, alpha: 0.16 },
  DOUBLE: { color: 0xa6ff4d, alpha: 0.1 },
  LUCK: { color: 0xffd23f, alpha: 0.22 },
  OVERDRIVE: { color: 0xff0033, alpha: 0.2 },
  GAMBLE: { color: 0xd17bff, alpha: 0.22 },
};

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
}

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
}

interface Bolt {
  points: { x: number; y: number }[];
  life: number;
}

interface Ring {
  x: number;
  y: number;
  radius: number;
  life: number;
}

interface WordView {
  root: Container;
  bg: Graphics;
  icon: Text | null;
  typed: Text;
  rest: Text;
  key: string;
}

interface Palette {
  fill: number;
  fillAlpha: number;
  stroke: number;
  strokeWidth: number;
  text: number;
}

const palette = (w: Word): Palette => {
  switch (w.kind) {
    case 'coin':
      return { fill: 0x3a2c05, fillAlpha: 0.92, stroke: 0xffd23f, strokeWidth: 2.5, text: 0xffe58a };
    case 'black':
      return {
        fill: 0x0d0f14,
        fillAlpha: 0.96,
        stroke: w.speedMul > 1 ? 0xff4d4d : 0x8a93a6,
        strokeWidth: 2,
        text: 0xffffff,
      };
    case 'charge':
      return { fill: 0x141a30, fillAlpha: 0.94, stroke: skillColor(w.skill!), strokeWidth: 2.5, text: 0xffffff };
    default:
      return { fill: 0x18213b, fillAlpha: 0.88, stroke: 0x3d4f80, strokeWidth: 1.5, text: 0xf2f5ff };
  }
};

/**
 * Draws the play field from engine state. It is imperative on purpose: React mounts it once
 * per attempt and it then updates on Pixi's ticker without involving React.
 */
export class FieldRenderer {
  readonly root = new Container();
  private stage = new Container();
  private sky = new Graphics();
  private tint = new Graphics();
  private back = new Graphics();
  private pileLayer = new Container();
  private pileBg = new Graphics();
  private wordLayer = new Container();
  private front = new Graphics();
  /** Frost border and lightning flashes sit above everything. */
  private overlay = new Graphics();

  private views = new Map<number, WordView>();
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
  private nextAmbientFlash = 6;

  private textStyle: TextStyle;
  private pileStyle: TextStyle;
  private charWidth: number;

  constructor(private reducedMotion: boolean) {
    this.textStyle = new TextStyle({ fontFamily: FONT, fontSize: 22, fontWeight: '600', fill: 0xffffff });
    this.pileStyle = new TextStyle({ fontFamily: FONT, fontSize: 15, fill: 0xbfe3ff });
    this.charWidth = CanvasTextMetrics.measureText('MMMMMMMMMM', this.textStyle).width / 10;

    this.root.addChild(this.stage);
    this.pileLayer.addChild(this.pileBg);
    // Weather tints the sky behind the words, so text stays readable.
    this.stage.addChild(this.sky, this.tint, this.back, this.pileLayer, this.wordLayer, this.front, this.overlay);
    this.drawSky();
    for (let i = 0; i < 90; i++) this.rain.push(this.newDrop(true));
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    if (on) {
      this.particles = [];
      this.shake = 0;
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  // ---- events ---------------------------------------------------------------------------

  handle(events: EngineEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'cleared':
          if (e.cause !== 'levelEnd') this.burst(e.word, e.cause === 'fire' ? 0xff7a1a : this.wordColor(e.word));
          else this.burst(e.word, 0x8899bb, 6);
          break;
        case 'landed':
          this.splash(e.word.x, H - 4, e.shielded ? 0x4d9dff : 0x6fb8ff);
          if (!e.shielded) this.shake = Math.max(this.shake, 3);
          break;
        case 'mistake':
          if (!e.forgiven) this.shake = Math.max(this.shake, 7);
          break;
        case 'skillFired': {
          const delay = e.via === 'GAMBLE' ? 0.9 : 0;
          this.weathers.push({ skill: e.skill, t: -delay, duration: Math.max(1.2, e.duration) });
          if (e.skill === 'BOMB' && !delay) this.flash = 0.5;
          break;
        }
        case 'bomb':
          this.flash = 0.7;
          this.rings.push({ x: e.x, y: e.y, radius: e.radius, life: 0.6 });
          this.bolts.push({ points: this.boltPath(e.x + 30, -10, e.x, e.y), life: 0.35 });
          this.shake = Math.max(this.shake, 10);
          break;
        case 'chain':
          for (const to of e.to) this.bolts.push({ points: this.boltPath(e.from.x, e.from.y, to.x, to.y), life: 0.45 });
          break;
        case 'pileRemoved':
          for (let i = 0; i < 40; i++) {
            this.spawn(Math.random() * W * 0.3, H - Math.random() * 100, 300 + Math.random() * 300, -40, 1, 3, 0x9fe8ff, 0);
          }
          break;
      }
    }
  }

  private wordColor(w: Word): number {
    if (w.kind === 'coin') return 0xffd23f;
    if (w.kind === 'charge') return skillColor(w.skill!);
    if (w.kind === 'black') return 0x9aa3b5;
    return 0x9fd0ff;
  }

  // ---- frame ----------------------------------------------------------------------------

  update(engine: GameEngine, dt: number): void {
    this.time += dt;
    for (const w of this.weathers) w.t += dt;
    this.weathers = this.weathers.filter((w) => w.t < w.duration);

    this.syncPile(engine);
    this.syncWords(engine);
    this.drawTint(engine, dt);
    this.drawBack(engine, dt);
    this.drawFront(engine, dt);

    if (!this.reducedMotion && this.shake > 0.1) {
      this.stage.position.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= Math.pow(0.0005, dt);
    } else {
      this.stage.position.set(0, 0);
      this.shake = 0;
    }
  }

  private isActive(engine: GameEngine, skill: SkillId): boolean {
    const timed = engine.effects[skill as keyof typeof engine.effects];
    return !!timed || this.weathers.some((w) => w.skill === skill && w.t >= 0);
  }

  // ---- words ----------------------------------------------------------------------------

  private syncWords(engine: GameEngine): void {
    const highlighted = engine.highlighted();
    const buf = engine.buffer;
    const frozen = !!engine.effects.ICE;
    const seen = new Set<number>();
    for (const w of engine.words) {
      seen.add(w.id);
      let view = this.views.get(w.id);
      if (!view) {
        view = this.createView(w);
        this.views.set(w.id, view);
        this.wordLayer.addChild(view.root);
      }
      const hl = highlighted.has(w.id) ? buf.length : 0;
      const danger = engine.dangerWordId === w.id;
      const key = `${w.text}|${hl}|${danger}|${frozen}|${w.speedMul}`;
      if (key !== view.key) {
        this.drawView(view, w, hl, danger, frozen);
        view.key = key;
      }
      const width = this.viewWidth(w);
      view.root.position.set(w.x - width / 2, w.y);
      if (danger && !this.reducedMotion) view.root.alpha = 0.75 + 0.25 * Math.sin(this.time * 12);
      else view.root.alpha = 1;
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        view.root.destroy({ children: true });
        this.views.delete(id);
      }
    }
  }

  private createView(w: Word): WordView {
    const root = new Container();
    const bg = new Graphics();
    const typed = new Text({ text: '', style: this.textStyle.clone() });
    const rest = new Text({ text: '', style: this.textStyle.clone() });
    let icon: Text | null = null;
    if (w.kind !== 'normal') {
      const glyph = w.kind === 'coin' ? '$' : w.kind === 'black' ? '⚡' : CONFIG.skills[w.skill!].icon;
      icon = new Text({
        text: glyph,
        style: new TextStyle({
          fontFamily: w.kind === 'coin' ? FONT : EMOJI,
          fontSize: w.kind === 'coin' ? 18 : 15,
          fontWeight: '800',
          fill: w.kind === 'coin' ? 0x3a2c05 : 0xffffff,
        }),
      });
      icon.anchor.set(0.5);
    }
    root.addChild(bg, typed, rest);
    if (icon) root.addChild(icon);
    return { root, bg, icon, typed, rest, key: '' };
  }

  private viewWidth(w: Word): number {
    return w.text.length * this.charWidth + FIELD.wordPadding + (w.kind === 'normal' ? 0 : 26);
  }

  private drawView(view: WordView, w: Word, hl: number, danger: boolean, frozen: boolean): void {
    const p = palette(w);
    const width = this.viewWidth(w);
    const h = FIELD.wordHeight;
    const g = view.bg;
    g.clear();

    if (w.kind === 'black') {
      // Thundercloud: a pill with puffs on top.
      for (const [cx, r] of [
        [width * 0.3, 11],
        [width * 0.55, 14],
        [width * 0.8, 10],
      ] as const) {
        g.circle(cx, 4, r).fill({ color: p.fill, alpha: p.fillAlpha });
      }
      g.roundRect(0, 0, width, h, h / 2).fill({ color: p.fill, alpha: p.fillAlpha });
      g.roundRect(0, 0, width, h, h / 2).stroke({ width: p.strokeWidth, color: p.stroke });
    } else {
      g.roundRect(0, 0, width, h, 8).fill({ color: p.fill, alpha: p.fillAlpha });
      if (w.kind === 'charge') g.roundRect(0, 0, width, h, 8).fill({ color: p.stroke, alpha: 0.18 });
      g.roundRect(0, 0, width, h, 8).stroke({ width: p.strokeWidth, color: p.stroke });
      if (w.kind === 'coin') g.roundRect(3, 3, width - 6, h - 6, 6).stroke({ width: 1, color: 0xffd23f, alpha: 0.6 });
    }
    if (hl > 0) g.roundRect(-2, -2, width + 4, h + 4, 10).stroke({ width: 2, color: 0x5cff9d, alpha: 0.9 });
    if (danger) g.roundRect(-4, -4, width + 8, h + 8, 12).stroke({ width: 3, color: 0xff3b3b });
    if (frozen) g.roundRect(0, 0, width, h, 8).fill({ color: 0xbfefff, alpha: 0.28 });

    let x = FIELD.wordPadding / 2;
    if (view.icon) {
      const cx = 14;
      const color = w.kind === 'coin' ? 0xffd23f : w.kind === 'black' ? 0x333a4a : p.stroke;
      g.circle(cx, h / 2, 10).fill({ color });
      view.icon.position.set(cx, h / 2);
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

  // ---- pile -----------------------------------------------------------------------------

  private syncPile(engine: GameEngine): void {
    const key = engine.pile.map((r) => r.text).join(',') + `|${engine.dangerRows}`;
    if (key === this.pileKey) return;
    this.pileKey = key;
    for (const t of this.pileTexts) t.destroy();
    this.pileTexts = [];
    const g = this.pileBg;
    g.clear();
    const rh = FIELD.rowHeight;
    engine.pile.forEach((row, i) => {
      const y = H - (i + 1) * rh;
      const depth = i / Math.max(1, engine.dangerRows - 1);
      const color = lerpColor(0x1f5f99, 0x2b8fd6, depth);
      g.rect(0, y, W, rh - 2).fill({ color, alpha: 0.78 });
      g.rect(0, y, W, 2).fill({ color: 0x9fdcff, alpha: 0.5 });
      const t = new Text({ text: row.text, style: this.pileStyle });
      t.anchor.set(0.5);
      t.position.set(W / 2, y + rh / 2 - 1);
      t.alpha = 0.6;
      this.pileLayer.addChild(t);
      this.pileTexts.push(t);
    });
  }

  // ---- background, weather and particles ------------------------------------------------

  private drawSky(): void {
    const g = this.sky;
    const bands = 28;
    for (let i = 0; i < bands; i++) {
      g.rect(0, (i * H) / bands, W, H / bands + 1).fill({ color: lerpColor(0x070a14, 0x1a2340, i / bands) });
    }
    // Storm clouds along the top.
    for (let i = 0; i < 14; i++) {
      const x = (i / 13) * W;
      g.ellipse(x, 8 + (i % 3) * 6, 70 + (i % 4) * 14, 28).fill({ color: 0x0c1020, alpha: 0.9 });
    }
  }

  private drawTint(engine: GameEngine, dt: number): void {
    const g = this.tint;
    g.clear();
    const layers: { skill: SkillId; strength: number }[] = [];
    for (const w of this.weathers) {
      // Skills fired by GAMBLE wait for the tornado to finish.
      if (w.t < 0) continue;
      const fadeIn = Math.min(1, w.t / 0.2);
      const fadeOut = Math.min(1, (w.duration - w.t) / 0.4);
      layers.push({ skill: w.skill, strength: Math.max(0, Math.min(fadeIn, fadeOut)) });
    }
    for (const key of ['CHAIN', 'ICE', 'SLOW', 'MAGNET', 'OVERDRIVE'] as const) {
      if (engine.effects[key] && !layers.some((l) => l.skill === key)) layers.push({ skill: key, strength: 1 });
    }
    for (const { skill, strength } of layers) {
      const tint = WEATHER_TINT[skill];
      let alpha = tint.alpha * strength;
      if (skill === 'OVERDRIVE' && !this.reducedMotion) alpha *= 0.6 + 0.4 * Math.max(0, Math.sin(this.time * 9));
      g.rect(0, 0, W, H).fill({ color: tint.color, alpha });
    }

    const o = this.overlay;
    o.clear();
    if (engine.effects.ICE && !this.reducedMotion) {
      // Frost creeping in from the edges.
      for (let i = 0; i < 6; i++) {
        const inset = i * 8;
        o.rect(inset, inset, W - inset * 2, H - inset * 2).stroke({ width: 8, color: 0xe6fbff, alpha: 0.12 - i * 0.018 });
      }
    }

    if (!this.reducedMotion) {
      this.nextAmbientFlash -= dt;
      if (this.nextAmbientFlash <= 0) {
        this.flash = Math.max(this.flash, 0.18);
        this.nextAmbientFlash = 7 + Math.random() * 10;
      }
      if (this.flash > 0) {
        o.rect(0, 0, W, H).fill({ color: 0xffffff, alpha: Math.min(0.5, this.flash) * 0.5 });
        this.flash = Math.max(0, this.flash - dt * 2.5);
      }
    } else {
      this.flash = 0;
    }
  }

  private newDrop(anywhere: boolean): Drop {
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : -20 - Math.random() * 40,
      len: 8 + Math.random() * 12,
      speed: 380 + Math.random() * 220,
    };
  }

  private drawBack(engine: GameEngine, dt: number): void {
    const g = this.back;
    g.clear();
    if (this.reducedMotion) return;

    const overdrive = !!engine.effects.OVERDRIVE;
    const slow = engine.effects.SLOW ? 0.25 : 1;
    const rewind = this.isActive(engine, 'REWIND');
    const wind = this.isActive(engine, 'WIND');
    const ice = !!engine.effects.ICE;
    const target = overdrive ? 240 : 90;
    while (this.rain.length < target) this.rain.push(this.newDrop(true));
    if (this.rain.length > target) this.rain.length = target;

    const dir = rewind ? -1 : 1;
    const slant = wind ? 0.9 : overdrive ? 0.35 : 0.12;
    const speedMul = (overdrive ? 1.8 : 1) * slow;
    for (const d of this.rain) {
      d.y += d.speed * speedMul * dir * dt;
      d.x += d.speed * speedMul * slant * dt;
      if (d.y > H + 20 || d.y < -40 || d.x > W + 20) {
        Object.assign(d, this.newDrop(false));
        if (dir < 0) d.y = H + 10;
        if (d.x > W) d.x -= W;
      }
      if (ice) {
        g.circle(d.x, d.y, 1.6).fill({ color: 0xffffff, alpha: 0.7 });
      } else {
        g.moveTo(d.x, d.y).lineTo(d.x - d.len * slant * 0.6, d.y - d.len * dir);
      }
    }
    if (!ice) g.stroke({ width: 1.2, color: 0x8fb4ff, alpha: overdrive ? 0.55 : 0.35 });

    if (this.isActive(engine, 'SLOW')) {
      for (let i = 0; i < 7; i++) {
        const x = ((this.time * 12 + i * 160) % (W + 300)) - 150;
        g.ellipse(x, 140 + (i % 3) * 120, 180, 60).fill({ color: 0xcdd6e4, alpha: 0.06 });
      }
    }
    if (this.isActive(engine, 'LUCK')) {
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.22 + Math.sin(this.time + i) * 0.03;
        const x2 = W / 2 + Math.cos(a) * H * 1.6;
        const y2 = Math.sin(a) * -H * 1.6;
        g.poly([W / 2 - 20, -10, W / 2 + 20, -10, x2 + 60, y2, x2 - 60, y2]).fill({ color: 0xffe28a, alpha: 0.06 });
      }
    }
    if (this.isActive(engine, 'DOUBLE')) {
      const colors = [0xff4d4d, 0xffa64d, 0xfff04d, 0x6dff6d, 0x4dc3ff, 0x8c6dff];
      for (const [cx, base] of [
        [W * 0.5, 420],
        [W * 0.5, 500],
      ] as const) {
        colors.forEach((c, i) => {
          const r = base - i * 9;
          g.moveTo(cx - r, H + 40).arc(cx, H + 40, r, Math.PI, 0).stroke({ width: 8, color: c, alpha: 0.18 });
        });
      }
    }
  }

  private drawFront(engine: GameEngine, dt: number): void {
    const g = this.front;
    g.clear();
    const rh = FIELD.rowHeight;

    // Danger line.
    const dy = H - engine.dangerRows * rh;
    for (let x = 0; x < W; x += 24) g.rect(x, dy - 1, 14, 2).fill({ color: 0xff4d4d, alpha: 0.8 });

    if (engine.shieldLeft > 0) {
      const top = H - engine.pile.length * rh;
      g.ellipse(W / 2, top + 6, W * 0.55, 44 + engine.pile.length * 2).stroke({ width: 3, color: 0x7fc4ff, alpha: 0.7 });
      g.ellipse(W / 2, top + 6, W * 0.55, 44 + engine.pile.length * 2).fill({ color: 0x4d9dff, alpha: 0.08 });
    }

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
      g.circle(p.x, p.y, p.size).fill({ color: p.color, alpha: Math.min(1, p.life / p.max) });
    }

    for (const b of this.bolts) {
      b.life -= dt;
      g.moveTo(b.points[0].x, b.points[0].y);
      for (const pt of b.points.slice(1)) g.lineTo(pt.x, pt.y);
      g.stroke({ width: 3, color: 0xfff7b0, alpha: Math.max(0, b.life * 2.5) });
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);

    for (const r of this.rings) {
      r.life -= dt;
      const k = 1 - r.life / 0.6;
      g.circle(r.x, r.y, r.radius * k).stroke({ width: 4, color: 0xffe08a, alpha: Math.max(0, r.life * 1.6) });
    }
    this.rings = this.rings.filter((r) => r.life > 0);

    if (this.weathers.some((w) => w.skill === 'GAMBLE' && w.t >= 0)) {
      // Tornado: stacked spinning ellipses.
      for (let i = 0; i < 12; i++) {
        const y = 60 + i * 34;
        const rx = 20 + i * 9;
        const cx = W / 2 + Math.sin(this.time * 6 + i * 0.6) * 18;
        g.ellipse(cx, y, rx, 8).stroke({ width: 2, color: 0xd9b3ff, alpha: 0.5 });
      }
    }
  }

  private emitWeatherParticles(engine: GameEngine, dt: number): void {
    const rate = (n: number) => Math.random() < n * dt;
    const many = (n: number, fn: () => void) => {
      const count = Math.floor(n * dt) + (Math.random() < (n * dt) % 1 ? 1 : 0);
      for (let i = 0; i < count; i++) fn();
    };
    if (this.isActive(engine, 'FIRE')) {
      many(140, () =>
        this.spawn(Math.random() * W, H - Math.random() * 40, (Math.random() - 0.5) * 60, -120 - Math.random() * 160, 1.4, 2.5, Math.random() < 0.5 ? 0xff7a1a : 0xffc04d, -30),
      );
    }
    if (this.isActive(engine, 'SHRINK')) {
      many(60, () => this.spawn(Math.random() * W, -10, 0, 500 + Math.random() * 200, 1.2, 2.6, 0xeaf6ff, 200));
    }
    if (this.isActive(engine, 'WIND')) {
      many(50, () => this.spawn(-10, Math.random() * H, 700 + Math.random() * 300, (Math.random() - 0.5) * 40, 1.4, 1.6, 0xc8fff0, 0));
    }
    if (this.isActive(engine, 'MAGNET')) {
      many(40, () => {
        const a = Math.random() * Math.PI * 2;
        const r = 260;
        const x = W / 2 + Math.cos(a) * r;
        const y = H * 0.55 + Math.sin(a) * r * 0.5;
        this.spawn(x, y, (W / 2 - x) * 1.2 + Math.sin(a) * 120, (H * 0.75 - y) * 1.2, 0.9, 2, 0xff9fd0, 0);
      });
    }
    if (engine.effects.CHAIN && rate(3)) {
      const x = Math.random() * W;
      this.bolts.push({ points: this.boltPath(x, 0, x + (Math.random() - 0.5) * 120, 120 + Math.random() * 120), life: 0.2 });
    }
    if (this.isActive(engine, 'SHIELD')) {
      many(20, () => this.spawn(Math.random() * W, H - engine.pile.length * FIELD.rowHeight - 20, 0, -30, 0.8, 1.6, 0xbfe0ff, 0));
    }
  }

  private spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, color: number, gravity: number): void {
    if (this.reducedMotion || this.particles.length > 900) return;
    this.particles.push({ x, y, vx, vy, life, max: life, size, color, gravity });
  }

  private burst(w: Word, color: number, n = 14): void {
    const cx = w.x;
    const cy = w.y + FIELD.wordHeight / 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 180;
      this.spawn(cx + (Math.random() - 0.5) * w.width, cy, Math.cos(a) * s, Math.sin(a) * s, 0.6, 2.4, color, 300);
    }
  }

  private splash(x: number, y: number, color: number): void {
    for (let i = 0; i < 10; i++) {
      this.spawn(x + (Math.random() - 0.5) * 30, y, (Math.random() - 0.5) * 120, -100 - Math.random() * 120, 0.6, 2, color, 500);
    }
  }

  private boltPath(x1: number, y1: number, x2: number, y2: number): { x: number; y: number }[] {
    const pts = [{ x: x1, y: y1 }];
    const segs = 7;
    for (let i = 1; i < segs; i++) {
      const k = i / segs;
      pts.push({ x: x1 + (x2 - x1) * k + (Math.random() - 0.5) * 30, y: y1 + (y2 - y1) * k + (Math.random() - 0.5) * 16 });
    }
    pts.push({ x: x2, y: y2 });
    return pts;
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
