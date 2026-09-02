# Browser preview harness

Runs the desktop renderer in a normal browser tab, without Electron.

`apps/desktop` is an Electron app: `src/main` is a Node process, `src/preload`
exposes `window.codesign` through `contextBridge`, and `src/renderer` is a React
app that only ever talks to the outside world through that object. A browser has
neither the main process nor the bridge, so this directory supplies both halves
of a replacement — good enough to see and click through the UI, not a substitute
for the desktop app.

```bash
pnpm install
pnpm --filter @open-codesign/desktop dev:browser   # vite on http://localhost:5174
```

The dev server binds `0.0.0.0`, accepts any origin and serves over plain HTTP, so
it can be reached through a tunnel or sandbox proxy rather than only from
localhost. Override the port with `PORT=5200`.

## What is real and what is mocked

| Real (this repo's code)                                             | Mocked                                              |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| `src/renderer/**` — App, zustand store, hub, workspace, settings     | `window.codesign` — `browser-shim.ts`                |
| `@open-codesign/i18n`, `@open-codesign/ui`, `@open-codesign/shared`  | main process — `mock-rpc.ts` behind `POST /rpc`      |
| preview pipeline (`preview/workspace-source.ts`, iframe `srcDoc`)    | designs, snapshots, files, chat — in memory (`seed.ts`) |
| the artifact shown: `resources/templates/scaffolds/reports/executive-brief.html` | providers, keychain, exports, OAuth, Ollama |

Anything that needs a real model call, a native dialog, or a spawned process
(`generate`, `export`, provider CRUD, Codex OAuth, Ollama) rejects with a
"requires the desktop app" error instead of pretending to work; the renderer
already renders its own failure states for those paths.

## Files

- `browser-shim.ts` — implements `window.codesign` over HTTP. Injected into the
  dev HTML by `vite.config.browser.mjs` before `src/main.tsx` runs.
- `mock-rpc.ts` — the RPC method table. Shared by the dev server and the jsdom
  smoke test so both drive identical behaviour.
- `mock-api-server.ts` — Vite `configureServer` middleware exposing the table at
  `POST /__codesign_preview/rpc` (`GET /__codesign_preview/health` for a ping).
- `seed.ts` — in-memory state: one demo design whose artifact is the repo's own
  executive-brief scaffold.
- `../vite.config.browser.mjs` — renderer-only Vite config (`root: src/renderer`).

## Checks

```bash
# shim covers the preload's API surface (fails if a method is missing/mistyped)
node_modules/.bin/tsc --noEmit -p tsconfig.browser-preview.json

# seed matches the zod schemas the renderer consumes
pnpm --filter @open-codesign/desktop exec tsx scripts/validate-browser-seed.ts

# boots the real App in jsdom against the shim and loads the seeded design
pnpm --filter @open-codesign/desktop test:browser-preview
```

Nothing here is part of a production build: the middleware is `apply: 'serve'`,
the shim is injected only in `transformIndexHtml`, and `electron-vite build`
never reads this directory.
