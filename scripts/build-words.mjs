// Builds src/data/words.json from data/words-*.txt.
// Dedupes, drops blocklisted words and skill names, and buckets by length.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'data');

const tokens = (text) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join(' ')
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

const blocked = new Set(tokens(readFileSync(join(srcDir, 'blocklist.txt'), 'utf8')));
const skills = JSON.parse(readFileSync(join(root, 'src/data/skills.json'), 'utf8'));
for (const s of skills.skills) blocked.add(s.id.toLowerCase());

const words = new Set();
for (const file of readdirSync(srcDir).filter((f) => /^words-.*\.txt$/.test(f)).sort()) {
  for (const w of tokens(readFileSync(join(srcDir, file), 'utf8'))) {
    if (/^[a-z]{3,}$/.test(w) && !blocked.has(w)) words.add(w);
  }
}

const buckets = { '3-4': [], '5-6': [], '7-8': [], '9+': [] };
for (const w of [...words].sort()) {
  const n = w.length;
  const key = n <= 4 ? '3-4' : n <= 6 ? '5-6' : n <= 8 ? '7-8' : '9+';
  buckets[key].push(w);
}

writeFileSync(join(root, 'src/data/words.json'), JSON.stringify({ buckets }, null, 0) + '\n');
const counts = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]));
console.log(`words.json: ${words.size} words`, counts);
