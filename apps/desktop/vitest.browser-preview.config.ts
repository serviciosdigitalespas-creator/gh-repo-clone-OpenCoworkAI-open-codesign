import { defineConfig } from 'vite';

/**
 * jsdom runner for the browser-preview harness.
 *
 * Separate from the package's default `vitest run` on purpose: the main-process
 * suites need the real Electron binary, while this one exercises the renderer
 * against the browser shim. Run it with:
 *
 *   pnpm --filter @open-codesign/desktop test:browser-preview
 */
export default defineConfig({
  // The renderer reads this global, normally injected by electron.vite.config.ts
  // and vite.config.browser.mjs.
  define: { __APP_VERSION__: JSON.stringify('0.0.0-browser-preview') },
  test: {
    environment: 'jsdom',
    include: ['src/renderer/src/browser-preview/**/*.smoke.test.tsx'],
    testTimeout: 20_000,
  },
  esbuild: {
    jsx: 'automatic',
  },
});
