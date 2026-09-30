# Arcade Games

Six classic 8-bit arcade games that run entirely in the browser. No build
step, no framework, no dependencies — open a page and play.

Live site: <https://bishalxrauniyar.github.io/test-game/>

## Games

| Game | Genre | Controls |
| --- | --- | --- |
| [Snake](games/snake/) | Arcade | Arrows / WASD, `P` to pause |
| [Pong](games/pong/) | Versus | Arrows or WASD (P2: `W`/`S`), `P` to pause |
| [Breakout](games/breakout/) | Arcade | Arrows / WASD, `Space` to launch |
| [Space Invaders](games/invaders/) | Shooter | Arrows / WASD, `Space` to fire |
| [Tetris](games/tetris/) | Puzzle | Arrows / WASD, `Space` to hard drop |
| [Pac-Man](games/pacman/) | Maze | Arrows / WASD, `P` to pause |

Every game also has an on-screen pad for touch, and responds to swipe
gestures on the playfield.

## How it works

There is no bundler and no `package.json`. Each game is one HTML file plus
one JavaScript file, sharing a small engine.

- `assets/engine.js` — the shared runtime: fixed-timestep loop, 160×144
  logical canvas with integer scaling, keyboard/touch input, Web Audio
  blips, and `localStorage` high scores under `arcade.<bestKey>`.
- `assets/site.js` — mobile navigation and the footer year.
- `assets/thumbs.js` — animated pixel-art previews on the home page.
- `styles/site.css` — the shared 8-bit design system and CRT treatment.
- `assets/fonts/` — self-hosted Press Start 2P (SIL Open Font License 1.1;
  the licence text is in `assets/fonts/OFL.txt`).

The whole site makes no external requests at runtime.

## Running it locally

Any static file server works, because pages use relative paths:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight off the filesystem also works.

## Deploying

`.github/workflows/deploy.yml` publishes the repository root to GitHub Pages
on every push to `main`. In the repository settings, set **Pages → Build
and deployment → Source** to **GitHub Actions**.

## Licence

The code in this repository is yours to use. The bundled Press Start 2P
font is licensed separately under the SIL Open Font License 1.1 — see
`assets/fonts/OFL.txt`.
