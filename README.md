# LAST NIGHT

> **Seven hours. One chance.**
> A top-down survival-horror roguelite set in a quarantined city.

You have one night to scavenge, fight, and reach extraction before dawn.
Every run is different. Death is permanent. The clock never stops.

Built with **React 19 + TypeScript + HTML5 Canvas**, served by **Vite/Express**,
with a procedural art pipeline and no external sprite-sheet dependency.

---

## Features

- **7-hour / 30-minute run clock** with hour-by-hour escalation.
- **Quarantined city** of 25 explorable rooms, streets, rooftops and interiors.
- **Four enemy classes** — Crawler, Still, Bloom, Mimic — each with distinct
  silhouettes, behaviour and attack telegraphs.
- **Stealth and noise** systems, acoustic rings, crouch/sprint trade-offs.
- **Loot, inventory, weapon durability, survival stats** and dynamic events.
- **Extraction at dawn** with generator-powered floodlights and a helicopter
  searchlight.
- **PvPvE online mode** via WebSocket lobby, plus solo play.
- **Procedural audio**, radio broadcasts, and per-channel volume controls.
- **Gamepad, keyboard/mouse and touch** control schemes.
- **Accessibility**: screen-shake toggle, controller vibration toggle, acoustic
  ripple visibility, adjustable touch controls and independent audio channels.

---

## Requirements

- **Node.js 20+** (developed on Node 24).
- npm (or a compatible package manager).

---

## Run locally

```bash
# 1. Install dependencies
npm install --legacy-peer-deps

# 2. Start the dev server
npm run dev
```

Open **http://localhost:3000**.

If port 3000 is already in use, choose another port:

```powershell
# PowerShell (Windows)
$env:PORT='3100'; npm run dev
```

```bash
# macOS / Linux
PORT=3100 npm run dev
```

Then open **http://localhost:3100**.

> On Windows PowerShell, if `npm` is blocked by execution policy, use
> `npm.cmd` instead: `npm.cmd run dev`.

### Radio

Breaking-news radio broadcasts are served from bundled audio files
(`public/assets/radio/`). No API key or network access is required.

### Online matchmaking

Click **Online Match** and the system automatically drops you into the open
matchmaking queue — there are no room codes or passwords.

- **2–20 survivors** per match.
- A **50-second countdown** starts as soon as at least 2 survivors are queued,
  then launches with everyone available (even if the match is not full).
- A single survivor never starts a match; the queue waits for a second player.
- Every survivor receives a unique jacket colour.

The client connects to `/ws` on the same origin by default.

**Permanent cloud server (Render, free tier):**
https://last-night-game-cnjq.onrender.com

The Firebase-hosted client (https://lastnightgame.web.app) connects to that
server automatically. If you host the static client separately from the Node
game server, set `VITE_WS_URL` at build time:

```bash
VITE_WS_URL=wss://your-game-server.example.com/ws npm run build
```

> Firebase Hosting only serves static files and does not support WebSocket
> upgrades, so the online game server must run on a WebSocket-capable host.

---

## Controls

| Action | Keyboard / Mouse |
|---|---|
| Move | `WASD` |
| Aim / attack | Mouse |
| Sprint | `Shift` |
| Crouch | `Ctrl` |
| Interact | `E` |
| Flashlight | `F` |
| Phone (time, map, radio, light) | `Q` |
| Backpack / inventory | `Tab` |
| Pause | `Esc` |

Gamepad and touch layouts are shown in the in-game **Field Guide**.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Express + Vite dev server |
| `npm run lint` | TypeScript typecheck (`tsc --noEmit`) |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Preview the production build |
| `npm start` | Run the server directly with `tsx` |

---

## Project structure

```
src/
  engine/      canvas renderer, sprite atlas, lighting, camera, input, audio
  game/        GameEngine simulation and run loop
  systems/     combat, loot, clock, stealth and related systems
  data/        map, items, enemies, radio broadcasts
  ui/          title, HUD, pause, settings, inventory, phone, online lobby
  types.ts     shared types and enums
server.ts      Express + WebSocket server, radio voice endpoint
```

Art is generated procedurally into offscreen canvases at runtime, so there are
no binary sprite sheets to manage. Original pre-overhaul files are preserved in
`.backup-original/`.

---

## Documentation

- [`DEVELOPMENT_ROADMAP.md`](./DEVELOPMENT_ROADMAP.md) — upgrade phases, validation and known gaps.
- [`CHANGELOG.md`](./CHANGELOG.md) — what changed in the visual overhaul.

---

## Status

Solo play, combat, inventory, stealth, extraction and the full UI flow are
playable and validated. Online PvPvE and touch controls are implemented but
would benefit from multi-client and physical-device testing. See the roadmap
for the honest list of remaining gaps.
