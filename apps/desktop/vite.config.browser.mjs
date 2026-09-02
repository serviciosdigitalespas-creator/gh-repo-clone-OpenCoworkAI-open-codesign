/**
 * Browser-only Vite config for the renderer.
 *
 * `electron.vite.config.ts` drives the real app: Electron main + preload +
 * renderer, launched through `pnpm --filter @open-codesign/desktop dev`. That
 * needs a real Electron window, so it cannot be shown in a browser tab.
 *
 * This config serves *only* the renderer (`src/renderer`) on a normal HTTP dev
 * server and swaps the Electron bridge for `browser-preview/browser-shim.ts`,
 * backed by `browser-preview/mock-api-server.ts`. Use it for UI work and live
 * previews; it does not replace the desktop app.
 *
 *   node_modules/.bin/vite --config vite.config.browser.mjs
 *   pnpm --filter @open-codesign/desktop dev:browser
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { browserPreviewMockApi } from './browser-preview/mock-api-server';
import pkg from './package.json' with { type: 'json' };

const SHIM_SRC = `/@fs${new URL('./browser-preview/browser-shim.ts', import.meta.url).pathname}`;

export default defineConfig({
  root: 'src/renderer',
  define: { __APP_VERSION__: JSON.stringify(`${pkg.version}-browser`) },
  server: {
    // 0.0.0.0 + any origin so the dev server can be reached through a proxy
    // (sandboxes, containers, tunnels) instead of only from localhost.
    host: '0.0.0.0',
    port: Number(process.env.PORT ?? 5174),
    strictPort: true,
    allowedHosts: true,
    cors: { origin: true },
  },
  plugins: [
    react(),
    browserPreviewMockApi(),
    {
      name: 'codesign:inject-browser-shim',
      apply: 'serve',
      // Inline module so the shim installs `window.codesign` before
      // src/main.tsx runs — main.tsx awaits `window.codesign.locale.getCurrent()`
      // during bootstrap. Module scripts execute in document order.
      transformIndexHtml() {
        return [
          {
            tag: 'script',
            attrs: { type: 'module' },
            children: `import { installBrowserCodesignApi } from '${SHIM_SRC}';\ninstallBrowserCodesignApi();`,
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  ],
});
