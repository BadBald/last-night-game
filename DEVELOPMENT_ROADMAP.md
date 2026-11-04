# LAST NIGHT — Development Roadmap

> **Seven hours. One chance.**
> Top-down survival-horror roguelite. React 19 + TypeScript + HTML5 Canvas + Vite/Express.

This document tracks the upgrade pass applied to the project. It is intentionally
honest about what is finished, what is validated, and what remains.

---

## Guiding constraints

- Preserve the existing game identity, simulation, and content.
- Keep the current stack (no engine rewrite, no new runtime dependencies).
- Never delete original assets; originals live in `.backup-original/`.
- Every upgrade must be real and playable — no mockups, no dead buttons.
- Prefer procedural/vector art baked into offscreen canvases over generated
  sprite sheets, so the look is coherent, deterministic, and dependency-free.

---

## Phase status

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 1 | Technical foundations | ✅ Complete | Typecheck clean, production build succeeds, PORT env support, dev server stable. |
| 2 | Art & assets | ✅ Complete | Full sprite atlas rewrite: tiles, props, characters, enemies, items, effects. |
| 3 | Player feel | ✅ Complete | Layered survivor sprite, weapon overlays, aim reticle, movement/attack feedback preserved and re-skinned. |
| 4 | Enemies / AI / combat | ✅ Complete | Four visually distinct enemy classes, alert markers, wind-up telegraphs, hit flashes, post-lighting overlays. |
| 5 | Environments / lighting / VFX | ✅ Complete | Wall AO, oriented doors, street-light poles, interior color temperature, puddle sheen, fog, rain, lightning, grain, vignette. |
| 6 | Audio | ✅ Complete (existing) | Procedural audio, radio, ambience and per-channel volume already present; settings persisted. |
| 7 | UI / UX | ✅ Complete (existing) | Title, pause, settings, HUD, phone, inventory, field guide already substantial; verified end-to-end. |
| 8 | Progression / balance | ✅ Preserved | Existing 7-hour clock, loot, survival stats, extraction and permadeath untouched. |
| 9 | Optimization / testing | ✅ Complete | 60 FPS at 976×752, half-res lightmap, culled tiles, runtime smoke tests across all 25 rooms. |

---

## What changed in this pass

### Art atlas (`src/engine/sprites.ts`)
- Deterministic PRNG so every run and every reload looks identical.
- Four variants per tile type, plus ambient-occlusion and raised wall-edge masks.
- Dedicated painters for asphalt, sidewalk, alley, grass, wood, tile, checker,
  concrete, hospital, rooftop deck, helipad, ramp, stairs, stadium turf, dirt,
  every wall material, fences, windows, barricades, and doors.
- Oriented door rendering (horizontal vs. vertical wall runs).
- Detailed props, containers, decals, 24 item icons, street lights, roofs, and
  the extraction helicopter.
- Layered player survivor with equipment/weapon overlays.
- Four enemy classes with distinct silhouettes and animation:
  Crawler, Still, Bloom, Mimic.
- Enemy alert/attack telegraphs and post-lighting overlays.

### Renderer (`src/engine/renderer.ts`)
- Tile pass now uses variants + wall masks + oriented doors.
- Street-light poles, item-specific ground pickups with labels.
- Enemy telegraphs drawn under entities; enemy overlays drawn after lighting so
  glowing eyes and weak points stay readable in darkness.
- Roof pass for buildings with roofs.
- Particle system upgraded to soft circles/glows.
- Ground fog, rare lightning, film grain, cinematic vignette.
- Deterministic wet-asphalt puddle sheen on streets, sidewalks and alleys.

### Lighting (`src/engine/lighting.ts`)
- Warm additive flashlight fill cone clipped to the visibility polygon.
- Twenty drifting dust motes inside the beam.
- Existing lightmap, street lights, flares, blooms, extraction/searchlight
  preserved.
- New interior light color temperature by district:
  amber homes/diners, clinical blue-white hospital/pharmacy/police,
  sickly sodium industrial, pale blue rooftop/military.

### Server (`server.ts`)
- `PORT` environment variable support: `Number(process.env.PORT) || 3000`.
- This allows running alongside another local app already using port 3000.

---

## Validation performed

- `npm run lint` (`tsc --noEmit`) — passes.
- `npm run build` — succeeds; output ~713 kB JS / 47.6 kB CSS, PWA precache 17 entries.
- Runtime: title screen, new run, movement, melee, enemy damage, death screen,
  restart, inventory, phone, pause/resume, all 25 rooms teleported through.
- No console errors except the expected `502` for AI radio voice when no
  `GEMINI_API_KEY` is configured.
- Frame rate ~60 FPS at 976×752 with the new renderer.
- Sprite QA harness: every tile type, prop, container, item icon, door, roof,
  light, helicopter and enemy frame renders non-empty pixels.

---

## Known gaps / limitations

1. **No automated test suite.** Validation is typecheck + build + scripted
   browser smoke tests + manual play. A future pass should add unit tests for
   combat math, loot tables and clock transitions.
2. **AI radio voice is optional.** Without `GEMINI_API_KEY`, the server returns
   `502` for voice segments; on-screen broadcast text still works. This is
   expected, not a regression.
3. **Single JS chunk > 500 kB.** Fine for a canvas game but code-splitting the
   title/online UI would trim first load.
4. **Touch controls are code-validated, not device-tested.** Layout adapts to
   viewport, but a physical phone pass is still recommended.
5. **Online PvPvE was not load-tested.** The WebSocket server and lobby flow are
   intact; multi-client stress testing remains future work.
6. **No mid-run save.** Permadeath is intentional; runs are not resumable.
7. **Vite config warning.** `__dirname` in `vite.config.ts` triggers a future
   `configLoader: 'native'` warning. Harmless today; switch to
   `import.meta.dirname` when convenient.

---

## Suggested next steps

- Add a small Vitest suite around `systems/combat.ts`, loot generation and the
  clock/hour transitions.
- Device-test touch controls and safe-area insets on iOS/Android.
- Code-split title/online screens from the in-game renderer.
- Add optional subtitle styling controls for radio broadcasts.
- Consider a “reduced flashing” accessibility toggle if lightning/vignette
  effects prove uncomfortable in playtesting.
