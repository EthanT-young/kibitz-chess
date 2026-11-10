# Kibitz: free chess game review

A full game review that runs entirely in the browser: Stockfish 19 analyses every
position, each move gets a verdict (Brilliant, Great, Best, Excellent, Good, Book,
Inaccuracy, Mistake, Miss, Blunder), and a coach explains in plain English *why*
a move was good or bad. It's free, needs no account, and the analysis runs on
your own computer.

- Import games from Chess.com or Lichess by username, paste a PGN or a plain
  move list, or open a Lichess game link.
- A summary report with accuracy for both players, move-quality counts, an
  estimated game rating, opening / middlegame / endgame grades, and an
  evaluation graph.
- A move-by-move review with an eval bar, best-move and threat arrows, the verdict
  badge on the board, and the coach's explanation, e.g.
  *"This allows Qg5, attacking the knight on e5 and the pawn on g2. The best move
  was Nxd4, which trades knights."*
- Retry your mistakes: the board rewinds and the coach checks your new try.
- Explore mode: drag pieces to try your own lines with live engine analysis.
- Export an annotated PGN with evaluations, symbols and the coach's notes.
- Recent reviews stay in your browser, and you can pick board themes, piece
  sets and sounds.

## Run it locally

Requires Node.js 20.19+ or 22.12+.

```bash
npm install      # also copies the Stockfish WASM files into public/engine
npm run dev      # http://localhost:5173
```

## Host it yourself

`npm run build` produces a static site in `dist/`. Copy that folder to any web
server; there's no backend. All paths are relative, so it also works from a
sub-folder. Hosting is cheap: the engine runs on each visitor's own computer.

Server requirements:

- Serve `.wasm` files as `application/wasm` (Caddy, nginx and Apache do by default
  with their standard MIME tables).
- HTTPS is recommended (the app fetches from the HTTPS Chess.com/Lichess APIs).

The built `index.html` already carries a Content-Security-Policy `<meta>` tag.
On your own server you can also send it as a real header, which additionally
blocks other sites from framing Kibitz. Example `Caddyfile` (Caddy gets HTTPS
certificates automatically and already serves `.wasm` with the right type):

```caddy
kibitz.example.com {
    root * /var/www/kibitz
    encode zstd gzip
    file_server

    header {
        Content-Security-Policy "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' https://api.chess.com https://lichess.org; img-src 'self'; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        X-Content-Type-Options nosniff
        Referrer-Policy no-referrer
    }
    # Hashed build files never change; let browsers keep them.
    header /assets/* Cache-Control "public, max-age=31536000, immutable"
    header /engine/* Cache-Control "public, max-age=604800"
}
```

Deploy by building locally and copying `dist/` over, e.g.
`npm run build && rsync -a --delete dist/ server:/var/www/kibitz/`.

Server load is tiny. Stockfish runs in each visitor's browser, so the server
only hands out static files: about 1.6 MB compressed on a first visit (mostly
the engine) and almost nothing on repeat visits.
A small 2-CPU VM can serve far more visitors than it will ever see.

### With Docker

The `Dockerfile` builds the site with Node and serves `dist/` with Caddy on
port 8080, sending the same security and cache headers as the example above.
`docker-compose.yml` runs the container as an unprivileged user with a
read-only filesystem, no Linux capabilities and small CPU and memory limits.
It creates an internal Docker network, `kibitz-internal`, with no route to
the internet or the host. Your front proxy joins that network to reach it:

```bash
docker compose up -d --build
docker network connect kibitz-internal <your-proxy-container>
```

(Or list `kibitz-internal` as an external network in the proxy's compose file.)

The front proxy handles HTTPS and forwards to `kibitz:8080`. Kibitz can live
under a sub-path as long as the proxy strips the prefix and redirects the bare
path to the version with a trailing slash. With Caddy:

```caddy
redir /kibitz /kibitz/ 308
handle_path /kibitz/* {
    reverse_proxy kibitz:8080
}
```

## How the review works

**Engine.** Stockfish 19 "lite" compiled to WebAssembly (~1.8 MB), one copy per
Web Worker, several running in parallel (one per spare CPU core, capped on
low-memory devices). Each position is searched to a fixed depth (12 / 16 / 20
for Fast / Standard / Deep) with the top 3 lines. The hash is cleared before
every position, so the same game always gets the same review.

**Move classification** is based on *expected points lost*: how much the move
lowered the mover's winning chances (using Lichess's eval→win% curve).

| Verdict | Rule |
| --- | --- |
| Best | The engine's top move |
| Excellent | Loses ≤ 2% |
| Good | Loses ≤ 5% |
| Inaccuracy | Loses ≤ 10% |
| Mistake | Loses ≤ 20% |
| Blunder | Loses more than 20% |
| Brilliant | A real sacrifice (≥ 2 points of material left en prise, not a desperado or an in-between move) that is best or near-best, when you weren't already completely winning and aren't worse afterwards |
| Great | The only good move: the best move, with the second-best at least 15% worse (simple recaptures and even trades excluded) |
| Miss | A mistake that let the opponent off the hook: the best line won material or forced mate, and your move didn't |
| Book | The position is in the opening database |
| Forced | The only legal move |

**Accuracy** is calibrated to track Chess.com's. Their formula isn't public, so
it was fitted against 96 player-games Chess.com had reviewed (official
accuracies from their public API): each move scores 0-100 from how much it
lowered your winning chances, and the game score is the average, skipping book
and forced moves. On those games it lands within about ±6 points of Chess.com's
number.

**Game rating** is anchored on your actual rating, the way Chess.com describes
theirs: it starts from your rating and moves 40% of the way toward the rating
that typically plays with your accuracy (rounded to 50). It needs the players'
ratings in the PGN, so pasted games without ratings show none. It's an estimate
from one game; expect it to be in the right neighbourhood, not identical.

**The coach** (`src/lib/coach`) is rule-based, not an AI model, so it is free and
instant. It replays the engine's lines and runs small tactical detectors:
static exchange evaluation, hanging pieces, forks, pins and skewers, mate
threats, discovered checks, promotions. It reads the engine's line as far as
the evaluation says the material swing goes, then phrases the most important
finding. When it knows which side you played (imported by username) it says
"you" and "your opponent"; otherwise it uses White and Black.

## Project layout

```
src/lib/engine     UCI wrapper, parallel engine pool
src/lib/analysis   classification, accuracy, phases, report builder
src/lib/coach      explanations and the game summary
src/lib/chess      PGN reader, tactics detectors, opening book
src/app            browser glue: workers, importers, history, settings
src/components     board, eval bar, graph, panels
```

## Tests

```bash
npm test             # fast unit tests
npm run test:engine  # full reviews of famous games with the real engine (~1 min)
npm run typecheck
```

CI (`.github/workflows/ci.yml`) runs the type-check, unit tests and build on
every push and pull request.

`tests/engine/calibrate.test.ts` compares verdicts at two depths for any PGNs you
drop into `tests/fixtures/local/` (git-ignored).

## Credits and licenses

Kibitz is free software under the **GPL-3.0-or-later** (see `LICENSE`), as
required by Stockfish.

- [Stockfish](https://stockfishchess.org) (GPLv3), via
  [stockfish.js](https://github.com/nmrugg/stockfish.js)
- [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause)
- Opening names: [Lichess chess-openings](https://github.com/lichess-org/chess-openings) (CC0)
- Pieces: "cburnett" by Colin M.L. Burnett and "merida" by Armando Hernández
  Marroquín (GPLv2+), from the Lichess project
- Barlow typeface by Jeremy Tribby (SIL Open Font License)

Kibitz is an independent project, not affiliated with Chess.com or Lichess. It
uses their public game APIs to fetch games and doesn't include any of their
code, artwork or branding.
