import clouds1 from './clouds-1.webp';
import clouds2 from './clouds-2.webp';
import clouds3 from './clouds-3.webp';
import fire from './fire.webp';
import frost from './frost.webp';
import logo from './logo.webp';
import menu from './menu.webp';
import sky from './sky.webp';

/** Built by `npm run art` from the source images in /assets. */
export const ART = { sky, clouds: [clouds1, clouds2, clouds3], frost, fire, menu, logo };

const icons = import.meta.glob('./icons/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>;

/** URL of an icon by name, e.g. a skill's `icon` field, 'coin' or 'storm'. */
export function iconUrl(name: string): string {
  return icons[`./icons/${name}.webp`];
}

/** Everything the play field draws from images, for preloading. */
export const FIELD_TEXTURES = [sky, clouds1, clouds2, clouds3, frost, fire, ...Object.values(icons)];
