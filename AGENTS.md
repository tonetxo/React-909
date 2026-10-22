# GrooveGal (O Grove Son) — Agent Guide

Commands:
- `npm run dev` — Vite dev server on port 3000
- `npm run start` — Vite dev + wait-on + Electron (requires display server)
- `npm run build` — Vite production build to `dist/`
- `npm run preview` — Vite preview of build output
- `npm run electron:dev` — Launch Electron alone
- `npm run electron:build` — `vite build && electron-builder`
- `npx tsc --noEmit` — typecheck (`noUnusedLocals` on)
- `npm test` — Vitest unit tests (`services/projectIO.test.ts`)

Architecture:
- **AudioEngine** singleton (`services/audioService.ts`) manages AudioContext, worklets, bus routing, scheduling
- **SequencerEngine** (`sequencer/SequencerEngine.ts`) bridges React state and AudioEngine
- **React state** lives entirely in `App.tsx` (the `state/` dir is empty)
- AudioWorklet (`vocoder-processor.js`) is loaded via `new URL('./vocoder-processor.js', import.meta.url)`, which Vite emits as a hashed asset

Build & Dev:
- Dev server: `http://0.0.0.0:3000` (not Vite default 5173)
- `@/` path alias resolves to project root
- Tailwind CSS v4 built locally via `@tailwindcss/vite` (config in `index.css`); production builds inject a strict CSP
- `electron.cjs` is CommonJS (rest of project is ESM). `easymidi` is Node-only (used by `electron-slave.js`)
- PWA via `vite-plugin-pwa` with `autoUpdate`, offline-capable

TypeScript:
- `noEmit: true`, `moduleResolution: "bundler"`, `allowJs: true`
- `typeRoots: ["./types", "node_modules/@types"]` — custom MIDI API types in `types/midi.d.ts`
- `experimentalDecorators: true` / `useDefineForClassFields: false`

Project Data:
- Root `.json` files (`pobas*.json`, `song_multimetrica*.json`, `*x*.json`, `tie_error.json`, `gemini-*.json`) are **song/pattern exports** from the app, not config
- `GEMINI.md` / `QWEN.md` are AI code-review prompts (in Spanish), not project instructions
- `tatus` is a stale git-log artifact, can be ignored
- `metadata.json` is stale OpenCode metadata, can be ignored

Validation scripts:
- `bash validate-sync-fixes.sh` — checks critical MIDI sync fixes are present
- `bash check-midi-clock.sh` — diagnose MIDI clock output
- `bash cleanup-midi.sh` — kill zombie MIDI slave processes

Repo convention: project name "GrooveGal", display name "O Grove Son". Galician language UI and docs.
