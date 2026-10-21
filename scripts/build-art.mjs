// Turns the generated source art in assets/ into game-ready WebP files in src/assets/.
// Source images have opaque black backgrounds; this keys them out where transparency is needed.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = (f) => join(root, 'assets', f);
const out = (f) => join(root, 'src/assets', f);
mkdirSync(out('icons'), { recursive: true });

/** Field aspect (960×560). */
const FIELD_ASPECT = 960 / 560;

/** Icon order in the 4×4 sheet, left to right, top to bottom. */
const ICONS = [
  'fire', 'bomb', 'chain', 'ice',
  'slow', 'rewind', 'shrink', 'wind',
  'shield', 'magnet', 'double', 'luck',
  'overdrive', 'gamble', 'coin', 'storm',
];

/**
 * Black-matte key: treat the image as premultiplied over black. Alpha ramps up with
 * brightness between `lo` and `hi`; colour is divided back out so glows keep their hue.
 */
async function keyBlack(input, lo, hi) {
  const { data, info } = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const m = Math.max(data[i], data[i + 1], data[i + 2]);
    const a = Math.min(1, Math.max(0, (m - lo) / (hi - lo)));
    data[i + 3] = Math.round(a * 255);
    if (a > 0 && a < 1) {
      for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, Math.round(data[i + c] / a));
    }
  }
  return sharp(data, { raw: info });
}

/** Luminance mask: white pixels whose alpha is the source brightness. */
async function lumaMask(input, gamma = 1) {
  const { data, info } = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(Math.pow(l, gamma) * 255);
  }
  return sharp(data, { raw: info });
}

/** Centre-crop to the play field's aspect ratio. */
async function cropToField(file) {
  const img = sharp(src(file));
  const { width, height } = await img.metadata();
  const w = Math.min(width, Math.round(height * FIELD_ASPECT));
  const h = Math.min(height, Math.round(w / FIELD_ASPECT));
  return img.extract({ left: Math.round((width - w) / 2), top: Math.round((height - h) / 2), width: w, height: h });
}

async function icons() {
  const sheet = sharp(src('icons-sheet.png'));
  const { width } = await sheet.metadata();
  const cell = Math.floor(width / 4);
  await Promise.all(
    ICONS.map(async (name, i) => {
      const cellImg = sharp(src('icons-sheet.png')).extract({
        left: (i % 4) * cell,
        top: Math.floor(i / 4) * cell,
        width: cell,
        height: cell,
      });
      const keyed = await keyBlack(cellImg, 3, 26);
      await keyed.resize(160, 160).webp({ quality: 88, alphaQuality: 90 }).toFile(out(`icons/${name}.webp`));
    }),
  );
}

async function clouds() {
  for (const n of [1, 2, 3]) {
    // Clouds hang from the top; the lower third of each source is empty.
    const meta = await sharp(src(`clouds-${n}.png`)).metadata();
    const strip = sharp(src(`clouds-${n}.png`))
      .extract({ left: 0, top: 0, width: meta.width, height: Math.round(meta.height * 0.66) })
      .resize({ width: 1024 });
    const masked = await lumaMask(sharp(await strip.png().toBuffer()), 1.15);
    const buf = await masked.png().toBuffer();
    const { width, height } = await sharp(buf).metadata();
    // Place the strip next to its mirror image so it tiles without a seam.
    const mirrored = await sharp(buf).flop().toBuffer();
    await sharp({ create: { width: width * 2, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        { input: buf, left: 0, top: 0 },
        { input: mirrored, left: width, top: 0 },
      ])
      .webp({ quality: 78, alphaQuality: 80 })
      .toFile(out(`clouds-${n}.webp`));
  }
}

async function main() {
  await icons();
  await clouds();
  await (await cropToField('sky-field.png')).webp({ quality: 82 }).toFile(out('sky.webp'));
  // Frames stay on black: the renderer adds them with additive blending.
  await (await cropToField('frost-frame.png')).webp({ quality: 80 }).toFile(out('frost.webp'));
  await (await cropToField('fire-frame.png')).webp({ quality: 80 }).toFile(out('fire.webp'));
  await sharp(src('menu-art.png')).webp({ quality: 80 }).toFile(out('menu.webp'));
  const logo = await keyBlack(sharp(src('logo.png')), 4, 40);
  await sharp(await logo.png().toBuffer()).trim({ threshold: 1 }).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 88, alphaQuality: 90 }).toFile(out('logo.webp'));
  console.log('art built into src/assets/');
}

main();
