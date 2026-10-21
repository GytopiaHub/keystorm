# Keystorm

A single-player falling-word typing game, built from [docs/SRS.md](docs/SRS.md). Words fall like rain; type them and press Space or Enter to clear them before they pile up past the danger line. Earn coins, buy skills and upgrades in the shop, and climb an endless series of levels.

## Running

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # static site in dist/ (deploy anywhere static)
npm run preview    # serve the production build
```

## Tests

```bash
npm test           # Vitest: headless engine tests + React Testing Library UI tests
npm run test:e2e   # Playwright (run `npx playwright install chromium` once first)
```

The game engine runs without a browser and takes a seed, so tests are repeatable.

## Layout

| Path | What it is |
| --- | --- |
| `src/engine/` | Game simulation: plain TypeScript, fixed-step loop, seeded RNG. No DOM access. |
| `src/render/` | PixiJS play field (words, pile, weather effects), mounted through `@pixi/react`. |
| `src/state/` | Zustand store, progress and shop rules, versioned localStorage persistence. |
| `src/ui/` | React screens: menu, HUD, shop, results, settings. Tailwind for styling. |
| `src/audio/` | Sound effects synthesised at startup and played through Howler. |
| `src/data/` | Tuning data: level table, skills, upgrades, gameplay constants, word list. |
| `data/` | Source word lists and blocklist. `npm run words` rebuilds `src/data/words.json`. |

All tuning values (level curve, prices, skill tiers, rewards, caps) live in `src/data/*.json`, not in code.
