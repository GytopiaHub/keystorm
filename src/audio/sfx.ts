import { Howl, Howler } from 'howler';

/**
 * All sounds are synthesised at startup into small WAV data URIs, so the game ships
 * original audio with no asset files.
 */
const RATE = 22050;

type Voice = (t: number, d: number) => number;

function wav(duration: number, voice: Voice): string {
  const n = Math.floor(RATE * duration);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, voice(i / RATE, duration)));
    v.setInt16(44 + i * 2, s * 0x7fff, true);
  }
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

const TAU = Math.PI * 2;
const env = (t: number, d: number, attack = 0.005) => Math.min(1, t / attack) * Math.max(0, 1 - t / d) ** 2;
const sine = (f: number, t: number) => Math.sin(TAU * f * t);
const square = (f: number, t: number) => (sine(f, t) > 0 ? 1 : -1);
const noise = () => Math.random() * 2 - 1;

const tones = (freqs: number[], step: number, wave: (f: number, t: number) => number = sine): Voice => (t) => {
  const i = Math.min(freqs.length - 1, Math.floor(t / step));
  const local = t - i * step;
  return wave(freqs[i], t) * env(local, step * 1.6) * 0.5;
};

const voices = {
  key: { d: 0.03, v: ((t, d) => noise() * env(t, d) * 0.25) as Voice },
  clear: { d: 0.16, v: ((t, d) => sine(660 + 900 * (t / d), t) * env(t, d) * 0.45) as Voice },
  coin: { d: 0.28, v: tones([988, 1319], 0.09) },
  charge: { d: 0.3, v: tones([523, 784, 1047], 0.08) },
  mistake: { d: 0.25, v: ((t, d) => square(110 - 40 * (t / d), t) * env(t, d) * 0.3) as Voice },
  noCharge: { d: 0.14, v: ((t, d) => square(220, t) * env(t, d) * 0.2) as Voice },
  land: { d: 0.22, v: ((t, d) => (sine(70, t) * 0.7 + noise() * 0.3) * env(t, d) * 0.6) as Voice },
  skill: {
    d: 0.6,
    v: ((t, d) => (noise() * 0.5 + sine(200 + 600 * (t / d), t) * 0.5) * env(t, d, 0.05) * 0.5) as Voice,
  },
  thunder: {
    d: 0.9,
    v: ((t, d) => noise() * env(t, d, 0.01) * (0.6 + 0.4 * sine(7, t)) * 0.7) as Voice,
  },
  combo: { d: 0.42, v: tones([523, 659, 784, 1047], 0.08) },
  complete: { d: 0.9, v: tones([523, 659, 784, 1047, 1319], 0.13) },
  fail: { d: 0.9, v: tones([392, 330, 262, 196], 0.18, square) },
} satisfies Record<string, { d: number; v: Voice }>;

export type SoundId = keyof typeof voices;

let sounds: Partial<Record<SoundId, Howl>> | null = null;

function init(): Partial<Record<SoundId, Howl>> {
  const out: Partial<Record<SoundId, Howl>> = {};
  try {
    for (const [id, { d, v }] of Object.entries(voices)) {
      out[id as SoundId] = new Howl({ src: [wav(d, v)], format: ['wav'], volume: id === 'key' ? 0.25 : 0.8 });
    }
  } catch {
    // No audio support: play() becomes a no-op.
  }
  return out;
}

export function play(id: SoundId): void {
  sounds ??= init();
  sounds[id]?.play();
}

export function setVolume(volume: number): void {
  Howler.volume(volume);
}
