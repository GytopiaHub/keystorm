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

```bash
npm run sim        # balance simulation: bot typists play the campaign with and without the shop
SIM=items npx vitest run src/sim --silent=false   # value of each skill and upgrade at each bot's hardest level
```

## Adding a skill or upgrade

- **Skill:** add its id to `SKILL_IDS` in `src/engine/types.ts`, its data (colour, icon, unlock level, prices, tiers) to `src/data/skills.json`, and its behaviour to `SKILL_BEHAVIOURS` in `src/engine/skills.ts`. Instant skills give a `cast` function; timed skills declare whether they freeze words or change fall speed. Add a 160×160 icon to `src/assets/icons/`.
- **Upgrade:** add its id to `UPGRADE_IDS`, its data to `src/data/upgrades.json`, and read `upgradeValue(id)` where it takes effect in `src/engine/engine.ts`.

The shop, HUD, charge words and save data pick new entries up automatically. Run `npm run sim` afterwards to check the balance.

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
| `assets/` | Source art (generated images). `npm run art` keys, crops and compresses them into `src/assets/`. |

All tuning values (level curve, prices, skill tiers, rewards, caps) live in `src/data/*.json`, not in code.
