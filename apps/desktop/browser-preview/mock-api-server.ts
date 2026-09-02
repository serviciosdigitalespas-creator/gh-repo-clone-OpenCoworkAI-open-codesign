/**
 * Browser-preview mock backend (HTTP side).
 *
 * The desktop app talks to its main process through `window.codesign`, which the
 * Electron preload builds on top of `ipcRenderer`. That bridge does not exist in
 * a plain browser, so `browser-preview/browser-shim.ts` implements the same API
 * surface over HTTP and this module is the other end of that wire.
 *
 * It is a Vite `configureServer` middleware: it only exists while
 * `vite.config.browser.mjs` runs, never in a production build, and it never
 * touches the real design database, the keychain, or any provider endpoint.
 *
 * The method table lives in `./mock-rpc.ts` so the jsdom smoke test drives the
 * exact same behaviour over a direct call instead of a second copy.
 */
import type { Plugin } from 'vite';
import { createMockRpc, type RpcArgs } from './mock-rpc';
import { DEMO_DESIGN_ID, DEMO_SNAPSHOT_ID } from './seed';

export function browserPreviewMockApi(): Plugin {
  const rpc = createMockRpc();

  return {
    name: 'codesign:browser-preview-mock-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__codesign_preview', (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const send = (status: number, body: unknown) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(body));
          };
          if (req.method === 'GET' && req.url === '/health') {
            send(200, {
              ok: true,
              demoDesignId: DEMO_DESIGN_ID,
              demoSnapshotId: DEMO_SNAPSHOT_ID,
              designs: rpc.state.designs.length,
            });
            return;
          }
          if (req.method !== 'POST') {
            send(405, { error: 'use POST /__codesign_preview/rpc' });
            return;
          }
          let payload: { method?: string; args?: RpcArgs };
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          } catch {
            send(400, { error: 'invalid JSON body' });
            return;
          }
          const method = typeof payload.method === 'string' ? payload.method : '';
          if (!rpc.has(method)) {
            server.config.logger.warn(`[browser-preview] método sin mock: ${method}`);
            send(501, { error: `not implemented in browser preview: ${method}` });
            return;
          }
          try {
            send(200, { result: rpc.call(method, payload.args ?? {}) });
          } catch (err) {
            const status = (err as { status?: number }).status ?? 500;
            send(status, { error: err instanceof Error ? err.message : String(err) });
          }
        });
      });
    },
  };
}
