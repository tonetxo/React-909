# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

GrooveGal (display name "O Grove Son") is a TR-909-inspired web drum machine / step sequencer with a bassline synth, a mic vocoder, song mode and MIDI clock output. React 19 + TypeScript + Vite + Web Audio API, optionally wrapped in Electron. UI text and docs are in Galician.

## Commands

- `npm run dev` — Vite dev server on `http://0.0.0.0:3000` (not 5173, despite what README says)
- `npm run start` — dev server + Electron (waits on port 3000; needs a display server)
- `npm run build` / `npm run preview` — production build to `dist/`
- `npm run electron:build` — build + electron-builder (AppImage / NSIS) into `release/`
- `npx tsc --noEmit` — typecheck (`noUnusedLocals` is on). No linter/formatter.
- `npm test` — Vitest (`vitest run`). Single file: `npx vitest run services/projectIO.test.ts`; single test: add `-t "<name>"`. Tests cover the pure project load/validation code; the root `.json` exports are used as fixtures.
- `bash validate-sync-fixes.sh` — grep-based check that MIDI sync fixes are still present; MIDI helpers: `bash check-midi-clock.sh`, `bash cleanup-midi.sh` (kills zombie MIDI slave processes)

## Architecture

Three layers, top to bottom:

1. **`App.tsx`** — owns *all* React state (patterns, song sequence, tempo/swing, vocoder params, selection). The `state/` dir is empty. Projects persist to `localStorage` and import/export as JSON (`ProjectData` in `types.ts`). All parsing, migration of old formats and validation of that untrusted JSON goes through `services/projectIO.ts` (`parseProjectData`, `mergePatternData`, `resizeSequence`) — keep it pure and tested.
2. **`sequencer/SequencerEngine.ts`** — bridges React and audio. Holds the pattern list and song sequence, and reports back through `SequencerCallbacks` (`onStepChange`, `onPatternChange`, `onSongStepChange`, …). In song mode it queues the *next* pattern into the AudioEngine when step 0 of the current one plays, then commits the index change (and notifies React) when the next step 0 arrives. At end of song it calls `setStopAtEndOfPattern(true)`.
3. **`services/audioService.ts`** — `audioEngine` singleton (`AudioEngine`). Lazily creates the AudioContext (`ensureAudioInitialized`), per-instrument channel strips → drum/bass buses → effects (reverb, delay, flanger) → master gain, plus the vocoder worklet and mic input.

### Scheduling (audioService)

- Classic lookahead scheduler: `setTimeout` every 50 ms, schedules steps up to 150 ms ahead on `AudioContext` time. Steps are 16ths (`60 / tempo / 4`); swing lengthens even steps and shortens odd ones.
- Pattern swaps (`queuePattern`) and stop-at-end only take effect at the last step of the sequence, so transitions are sample-accurate.
- UI step callbacks fire via `setTimeout` aligned to each step's audio time.
- **MIDI clock** is sent by `MidiService` (Web MIDI) as 6 timestamped ticks per step (24 PPQN). Tick timestamps are computed in `performance.now()` space from anchors (`anchorAudioTime`/`anchorPerfTime`) set at `start()` to avoid drift, plus `outputLatency` and the manual `window.MIDI_LATENCY_OFFSET`. Tick times derive from audio-clock step times, so tempo changes don't drift. At end of song the stop (and timestamped MIDI Stop) is deferred via `setTimeout` to when the last step finishes, not when it is scheduled. Changes here are what `validate-sync-fixes.sh` checks — run it after touching sync code.
- Sound synthesis lives in `services/synthesis.ts` (`playInstrument` for drums, `BasslineSynth` for the bass, which uses prev/next step for slides/ties).

### AudioWorklets

- `services/vocoder-processor.js` (registers `vocoder-processor-new`) is the only worklet, loaded at runtime via `addModule(new URL('./vocoder-processor.js', import.meta.url))`. Its carrier is an internal oscillator; the UI's vocoder type / carrier source options are not wired to it yet.
- MIDI output listing goes through `MidiService.subscribeOutputs` (exposed as `audioEngine.subscribeMidiOutputs`), which also handles hot-plug.
- Worklets are separate Rollup inputs in `vite.config.ts` with unhashed output `services/[name].js`; keep that mapping if adding/renaming one (electron-builder also packages `services/*.js`).

### Electron / MIDI

- `electron.cjs` is CommonJS (rest of project is ESM). The renderer runs sandboxed (`contextIsolation`, no `nodeIntegration`) and only `midi`/`midiSysex` (Electron reports every Web MIDI request as `midiSysex`) and `media` (mic) are granted via `setPermissionRequestHandler` — keep renderer code browser-only.
- `electron-slave.js` is a standalone Node MIDI clock receiver (uses `easymidi`, Node-only — never import it from browser code). See `MIDI_CLOCK_SETUP.md` and `ELECTRON_SETUP.md`.
- Custom Web MIDI types are in `types/midi.d.ts` (`WebMidi.*` namespace), picked up via `typeRoots`.

## Conventions and gotchas

- Tailwind CSS v4 is built locally via the `@tailwindcss/vite` plugin; all config lives in `index.css` (no `tailwind.config.js`). Class names must appear literally in the files listed by its `@source` lines (incl. `constants.ts`); don't build them with string interpolation. Its `@theme` pins Tailwind v3's font stack and sRGB palette, and a base layer restores v3's border colour and button cursor, so the UI looks as it did under v3 — add a v3 colour family there before using a new one, or it will get v4's oklch colours.
- Production builds inject a strict Content-Security-Policy meta tag (`cspPlugin` in `vite.config.ts`): no inline scripts and no remote origins — extend the policy there if a new source is needed.
- `@/` aliases the project root. TS uses `moduleResolution: "bundler"`, `allowJs`, `experimentalDecorators`, `useDefineForClassFields: false`.
- PWA via `vite-plugin-pwa` (`autoUpdate`); assets in `public/`.
- Root `.json` files (`pobas*.json`, `song_multimetrica*.json`, `5x4.json`, `6x8.json`, `tie_error.json`, `gemini-*.json`, …) are exported songs/projects useful as fixtures, **not** config. `metadata.json` and `tatus` are stale artifacts.
- `GEMINI.md` / `QWEN.md` are Spanish code-review prompts for other AI tools, not project instructions. `MIGRATION_PLAN.md` describes a planned native Android port (Kotlin/Oboe) that must keep the JSON project format compatible.
- Commits are in English with `feat:`/`Fix:`/`Refactor:` style prefixes; user-facing strings stay in Galician.
