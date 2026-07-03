# ✦ Lodestar

**The self-hosted student life OS.** One login, one Pi, one assistant — six apps folded into
one product:

| Module | Descended from | What it does |
| ------ | -------------- | ------------ |
| ◈ **Tasks** | dynamic-todo / dynamicTo-Do | Type task titles; **Gemini** scores importance, cognitive load and minutes, then hands back the *order of execution*. "Between lectures" filter for ≤30-min low-load quick wins. |
| ☾ **Calendar** | Whenabouts | Shared group events, terms & breaks, availability, the overlap **find-a-date** finder, private iCal feeds. |
| △ **Study** | Study Velocity Tracker | Semesters, courses by ECTS, lecture slots, session logging (+ a pomodoro that logs itself), **required velocity** and predicted grades. |
| ❏ **Notes** | Shared Notes | Live collaborative sticky notes — **Yjs CRDT**, keystroke-level sync, checklists, colors, presence. |
| ☰ **Backlog** | Hoard | Books/movies/TV/anime/manga/games/music with statuses, ratings, and an **AI critic** that roasts you. |
| ◉ **Watchers** | checkRosenberg | Watch any page for new items (CSS/regex), push via **ntfy**, optionally spawn a task. |

Plus: habit streaks (from Mizu), a notification hub, global search (Ctrl-K), and **the assistant** —
a wry morning telegram, a Sunday weekly review, and natural-language capture (`+ email prof by friday`).

**The point is the connections** (see [`CONTRACT.md`](CONTRACT.md) §6): deadlines and lecture gaps
feed the task scorer; behind-pace courses auto-create study tasks and propose bookable calendar
blocks; checklist items promote to scored tasks; watcher hits notify and spawn tasks; free evenings
surface your backlog.

Everything works **without any API key** (heuristic fallbacks); add `GEMINI_API_KEY` to wake the
assistant up properly.

---

## Dev quickstart (Windows/Mac/Linux)

```sh
corepack enable pnpm          # or: npm i -g pnpm
pnpm install
pnpm db:dev                   # Postgres 17 in Docker on 127.0.0.1:5433
copy .env.example .env        # set at least JWT_SECRET; GEMINI_API_KEY optional
pnpm dev                      # shared (tsc -w) + server (:3000) + web (:5173)
```

Open http://localhost:5173 — the **first registered user needs no invite code** and becomes admin.
After that, registration is invite-only (create a group in Settings, share its code) unless
`REGISTRATION_OPEN=true`.

Tests & checks:

```sh
pnpm test          # vitest — the ported formulas are contract-tested
pnpm typecheck
pnpm build
```

## Deploy on the Raspberry Pi

```sh
git clone <this repo> && cd lodestar
cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)
GEMINI_API_KEY=...            # optional
NTFY_DEFAULT_TOPIC=...        # optional
EOF
docker compose up -d --build
curl -s http://127.0.0.1:3030/healthz   # {"ok":true,...}
```

The app binds **127.0.0.1:3030** (adjust in `docker-compose.yml` if that slot in the Pi's
per-app 30xx port map is taken). Then add a Cloudflare Tunnel ingress:

```yaml
# ~/.cloudflared/config.yml
ingress:
  - hostname: lodestar.example.com
    service: http://localhost:3030
```

> A Cloudflare 502 almost always means the local port isn't listening — check
> `docker compose ps` and the port mapping first.

Notes for the Pi: bcryptjs is pure JS (no native builds on arm64); the whole app is one Node
process + one Postgres; the scheduler runs in-process (no cron needed). Watchers use plain
`fetch` — JS-rendered pages aren't supported (no headless browser on the Pi).

## Configuration

See [`.env.example`](.env.example) and [`CONTRACT.md`](CONTRACT.md) §2 for every variable.
Highlights: `GEMINI_API_KEY` (assistant + enrichment; optional), `TMDB_API_KEY` (movie/TV search;
books/anime/manga are keyless), `NTFY_DEFAULT_TOPIC` / per-user topic in Settings (push).

## Repo layout

```
lodestar/
├── CONTRACT.md        the single source of truth — identifiers, routes, formulas
├── shared/            pure TS: wire types + the four ported formula libraries
├── server/            Fastify 5 + pg + Yjs + scheduler (one process)
│   └── migrations/    plain SQL, auto-applied at boot
├── web/               React 18 + Vite + Tailwind PWA ("Night Almanac" design system)
├── docker-compose.yml prod (app + postgres, 127.0.0.1:3030)
└── docker-compose.dev.yml  dev database only
```

## Deliberate v1 scope cuts

Recurring events, RSVP proposals/voting, the corkboard's free-drag layout & sketch tabs,
Hoard's Elo arena, IGDB/Last.fm search, Playwright-rendered watchers, magic-link auth, and
web-push are all deferred — the sources they'd port from remain in the BucketFillers folder.
