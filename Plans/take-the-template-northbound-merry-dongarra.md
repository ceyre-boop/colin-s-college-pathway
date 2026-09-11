# Northbound v3 "True North": a local-host site built on Active Theory's experience design

## Context
Northbound Studio's current site ("The Descent", `~/Northbound-Studio--1`, branch `work-v2` = `main` @ 088c6d2) works but lacks the "wow" needed to justify premium pricing (CONTEXT.md). Colin wants a local-host version that nearly replicates activetheory.net's *experience*, translated into Northbound's brand. His favorite reference is the AT case-study view (`/work/prometheus`):
- the project shown on a curved, warped screen
- a smeared and scratched background made from the project's own footage
- a monospace meta column on the left
- SCROLL TO CLOSE
- a `<< PREV – NEXT >>` stepper
- dot pagination
- a cyan AI prompt

The build also adds new Northbound features that the site doesn't have and that nobody has planned.

**The originality line.** We recreate AT's experience grammar: the loader, one continuous 3D world, glass screens, the case view, decode text, the pill nav, the AI prompt, shared presence. We copy none of their code, assets, fonts, music, or copy. Their site is Hydra, which is closed. Ours is Three.js, GSAP, Lenis, and our own GLSL.

## Where it lives
- Repo `~/Northbound-Studio--1`. New branch `v3-truenorth` off `work-v2`. Never commit to `main` (standing rule from Plans/radiant-graham).
- Everything goes under a new `v3/` directory, so the production Descent at `/` is untouched even after a merge.
- Local run: `bun run v3`, which runs `bun v3/server.ts` on **http://localhost:5173/v3/**.
- Commit per phase and push the branch. Pushing the branch gives a Vercel preview for free.

## Translation: AT concept → Northbound
| Active Theory | Northbound "True North" |
|---|---|
| Bioluminescent deep-sea world | Arctic night above a frozen lake. Aurora sky (Northlight shader, promoted to 3D), star dust, drifting ice crystals. |
| Chrome "a" ring on crossing tubes | An iridescent chrome **N-compass needle** inside a ring, hung on two **aurora ribbons** that cross in a figure-8 (TubeGeometry). |
| `/` glyph ring loader + counter → `>>>` click | A **compass-rose loader**: degree ticks fill the ring, the counter reads `000°→360°`, then `>>> TRUE NORTH` and a click to enter, which also unlocks audio. |
| Scroll = one camera path, URL changes, loops | Scroll = **travel north** along a CatmullRom spline. The URL syncs `/v3/`, `/v3/work`, `/v3/contact` via the History API. Scroll loops back to the compass. |
| Glass screens spiralling a vertebrae sculpture | Glass screens spiralling an **ice monolith / lodestone**, playing each project's reel. |
| `WORK ~ CONTACT` pill whose squiggle is the audio toggle | Reuse Northbound's existing pill and waveform canvas. It now reacts to scroll velocity and drives real audio. This fixes the known bug where the toggle only flipped a label. |
| Music player `<< 1. artist – track >>` | A **generative ambient score** in WebAudio: our own synthesis, no licensed tracks. Player shows `<< N-01 · POLAR DRIFT >>`. Pitch and filter follow the camera's heading. |
| Decode/scramble text, RGB-split titles | `scramble.ts` for every label reveal and hover. Titles use RGB split in a shader. |
| Case view (Colin's favorite) | Full replica of the view. Details in Phase 4. |
| "Ask me anything" chat | **HEADING**, an AI concierge. It also scopes your project. Details in Phase 5. |
| Networked cursor tubes | **Constellation**: live visitors show as aurora trails, and every visitor leaves a permanent star. Details in Phase 5. |

## Brand carried over
- **Colors:** `#060608` background, `#E8E8ED` text, the single cyan accent `#00F0FF`. This matches AT's teal UI.
- **Fonts:** the self-hosted Syne, Instrument Sans, and JetBrains Mono, plus **Share Tech Mono** (OFL, via `@fontsource`) for AT's squared caps look.
- **BUDDY** appears as a billboard sprite guide in the world, and he is the voice of HEADING.
- **Content:** projects come from `js/site-config.js` (`CASES`, `DEMOS`) and the older repo's real clients. Reuse, don't retype.

## Stack
- **Libraries**, installed with `bun add`: `three`, `gsap`, `lenis`, `@fontsource/share-tech-mono`.
- **Bundling:** `Bun.build` bundles `v3/src/main.ts` into `v3/dist/`. TypeScript throughout.
- **Library size:** Three core is about 155 KB gzipped. This knowingly breaks the old "≤60 KB per library" rule. That rule was for the production Descent; v3 keeps the repo's overall **≤400 KB JS gzipped** gate.
- **Dev server:** `v3/server.ts` (Bun) serves static files and also provides:
  - `POST /api/heading`
  - a `/ws` WebSocket for Constellation
  - `data/stars.json`, which persists the stars.
- **Reused modules**, ported to ESM: the ideas in `js/gl/afford.js` (GPU tier probe) and `js/motion.js` (spring integrator). The Northlight filament math comes from `js/gl/northlight-shaders.js`.

## Phases (commit and push after each)

**P0 Scaffold.**
- Branch, `v3/` tree, `package.json` scripts (`v3`, `v3:build`, `v3:reels`, `v3:test`).
- `server.ts`, and a Playwright project pointed at `/v3/`.

**P1 World** (`v3/src/world/`).
- Renderer, and post-processing through EffectComposer: bloom, chromatic aberration, grain and scratches, vignette.
- Aurora sky dome.
- GPU particles for snow and stars, pushed by the cursor.
- The iridescent compass (MeshPhysicalMaterial with iridescence and clearcoat) and the aurora ribbons.
- Lenis drives the camera spline, with looping and route sync.

**P2 Chrome** (`v3/src/ui/`).
- Compass loader and click-to-enter gate.
- The pill nav and waveform, reacting to velocity.
- Scramble text.
- HUD with a real load time, a live heading in degrees, and Grand Ledge coordinates (`42.75°N 84.75°W`).
- The generative audio engine and player.

**P3 Work spiral.**
- Glass screens (transmission material) with video textures, arranged around the ice monolith.
- A left filter list: `WHAT ARE YOU LOOKING FOR? → WEBSITES / E-COMMERCE / BOOKING / AI / CUSTOM`.
- Titles glitch on hover.
- **Reels:** `scripts/capture-reels.ts` uses Playwright's video capture to scroll through each live project, then ffmpeg turns each into an 8-second, 720p webm and mp4 loop in `v3/media/`. There are 5 reels:
  - Atlas: nb-atlas.vercel.app
  - Vector: nb-vector.vercel.app
  - Halo: the placeholder, labelled Concept
  - Keystone South: keystonesouthconstruction.com
  - TABOOST shop: shop.taboost.me

**P4 Case view.** This is the headline feature, a near-exact replica of the screenshot. Opening a case:
- The chosen screen flies forward and curves. A custom vertex bulge plus a fragment barrel warp gives the chamfered edges and a CRT-glass sheen.
- The background becomes the same video texture through a directional smear shader, with scratch lines, grain, and a dark falloff.
- **Left meta column:**
  - Title, then `YEAR / CLIENT / TYPE`, then a one-line story in Share Tech Mono caps.
  - `LIVE PROJECT` and `CASE NOTES` underlined links, and `<- CLOSE`.
  - A cyan suggested HEADING prompt, e.g. `SHOW ME A BOOKING SITE`.
  - Dot pagination.
- `SCROLL TO CLOSE` at top center. Scroll-up or Esc reverses the flight.
- The `<< PREV – NEXT >>` stepper sits under the pill.
- Deep links to `/v3/work/:slug` work on a cold load.
- Northbound twist: a **`TRY IT LIVE`** toggle swaps the video for the real interactive iframe inside the curved screen, rendered as a CSS3D layer matched to the WebGL screen. On AT you only watch; here you can use the product.

**P5 New Northbound features.** These are the creative additions.
1. **HEADING, the concierge** (`/api/heading`).
   - You type something like "I run a roofing company and lose leads after 6pm". The camera flies to the best-fit project, and BUDDY answers in the case column.
   - He also builds a **live scoping card**: the recommended direction (Atlas, Vector, or Halo), add-ons, a price from the real pricing ($1,500 core, $99/mo, add-ons from $500), and a 48-hour timeline. Then one button: `SET THIS HEADING →`, which prefills the contact form.
   - A deterministic intent router is the source of truth, so it works offline. When `${PAI_DIR}/TOOLS/Inference.ts` is available, a `fast` call writes BUDDY's reply. It never invents metrics.
2. **Blueprint**, a "see your site before you pay" screen.
   - Type a business name and pick a direction. A glass screen in the world live-renders a styled hero mock of *your* site from the Atlas, Vector, or Halo template tokens. Pure templating, no LLM.
   - `Export` saves it as a PNG to attach to the inquiry.
3. **Constellation**, shared presence.
   - Other live visitors' cursors appear as faint aurora trails, over WebSocket.
   - On submitting contact or leaving the page, a visitor's star is placed in the sky with their initials. Real shipped clients (Keystone, TABOOST) are brighter named stars.
   - The sky becomes social proof that grows by itself.
4. **Contact as "Set your heading."**
   - The compass needle turns to point at the form.
   - Three fields: name, contact, need. They post to the existing Formspree `xpwzgvkn`, with the `ceyre@northbound-dev.com` fallback.
   - The `SPOTS_LEFT` scarcity line is read from site-config.
5. **Speed proof as physics.** The "48 HRS" claim is a scrubbable timelapse. Scrolling through that part of the path assembles a site out of ice-crystal particles, and the HUD shows *this* page's real load time.

**P6 Fallbacks, QA, and polish.**
- Mobile, where the path is touch-driven.
- `prefers-reduced-motion`: no camera flight, crossfades only.
- Without WebGL: a static DOM list plus case pages.
- Low-tier devices, via the tier probe: no transmission and half-resolution post-processing.

## Critical files
- **New:**
  - `v3/index.html`, `v3/server.ts`
  - `v3/src/{main.ts, world/*, ui/*, case/*, features/{heading,blueprint,constellation}.ts, audio/*}`
  - `v3/src/shaders/*.glsl`
  - `scripts/capture-reels.ts`
  - `tests/v3/*.spec.ts`
- **Read and reused:** `js/site-config.js`, `js/gl/afford.js`, `js/motion.js`, `js/gl/northlight-shaders.js`, `_ds/` tokens, `fonts/`, the `buddy-*.webp` images.
- **Edited:** `package.json` (scripts and dependencies) and `playwright.config.ts` (add a `v3` project). Nothing in the root `index.html` or `js/` changes.

## Verification
Each check below comes with a command whose real output I will report.
- `bun run v3:build`: builds with no errors, and the gzipped JS size is printed and ≤400 KB.
- `bun run v3:test` runs Playwright against `localhost:5173/v3/` and checks:
  - The loader reaches 360° and the click enters.
  - Scroll moves the URL to `/work`, then `/contact`.
  - The 5 screens render.
  - Clicking a screen opens `/work/:slug` with the meta column, the stepper, and SCROLL TO CLOSE, and Esc closes it.
  - A cold load of a deep link works.
  - HEADING with "roofing" routes to Atlas and prices at $1,500.
  - Two browser contexts see each other's Constellation trails.
  - The reduced-motion and no-WebGL fallbacks render.
  - There are zero console errors.
- `scripts/perf.mjs` pointed at `/v3/`: CLS 0, a median fps number reported at 4× CPU slowdown, and LCP reported. v3 is a WebGL-first experience, so LCP is reported, not gated at 1.2s.
- **Interceptor:** `interceptor open http://localhost:5173/v3/work/atlas-ridgeline`. I take a screenshot and compare it side by side with Colin's Prometheus screenshot for the case-view replica.
- A final reviewer agent pass over the diff before calling it done.
