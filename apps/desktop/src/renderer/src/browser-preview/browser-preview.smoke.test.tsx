/**
 * @vitest-environment jsdom
 */
/**
 * Smoke test for the browser-preview harness.
 *
 * Runs the *real* renderer (App.tsx → zustand store → components) inside jsdom
 * with `window.codesign` provided by the browser shim and backed by the same RPC
 * table the dev server serves. This is what proves the harness boots: without it
 * a drifted shim or mock shape would only surface as a blank page in a browser.
 *
 *   pnpm --filter @open-codesign/desktop test:browser-preview
 */
import { initI18n } from '@open-codesign/i18n';
import { act, cleanup } from '@testing-library/react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installBrowserCodesignApi } from '../../../../browser-preview/browser-shim';
import { createMockRpc } from '../../../../browser-preview/mock-rpc';
import { DEMO_DESIGN_ID } from '../../../../browser-preview/seed';
import { App } from '../App';
import { useCodesignStore } from '../store';

const rpc = createMockRpc();

/** Browser APIs jsdom does not implement but the renderer touches on mount. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  root = null;
  rootMargin = '';
  thresholds = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeAll(async () => {
  // Compile-time global normally injected by the Vite configs; declared in
  // src/renderer/src/vite-env.d.ts, absent at runtime under vitest.
  const globals = globalThis as Record<string, unknown>;
  globals['__APP_VERSION__'] ??= '0.0.0-browser-preview';
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver ??=
    IntersectionObserverStub as unknown as typeof IntersectionObserver;

  // Same wire format as the dev server, minus HTTP.
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    if (!url.includes('/__codesign_preview/')) {
      throw new Error(`smoke test: unexpected fetch ${url}`);
    }
    const payload = JSON.parse(init?.body ?? '{}') as {
      method?: string;
      args?: Record<string, unknown>;
    };
    const method = payload.method ?? '';
    if (!rpc.has(method)) {
      return new Response(JSON.stringify({ error: `not implemented: ${method}` }), {
        status: 501,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    try {
      return new Response(JSON.stringify({ result: rpc.call(method, payload.args ?? {}) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }) as unknown as typeof fetch;

  installBrowserCodesignApi();
  await initI18n('es-AR');
});

afterEach(() => {
  cleanup();
});

async function waitFor(assertion: () => void, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await act(async () => {
        await Promise.resolve();
      });
      assertion();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError;
}

describe('browser-preview harness', () => {
  it('installs window.codesign over the mock RPC', async () => {
    expect(window.codesign).toBeDefined();
    const designs = await window.codesign?.snapshots.listDesigns();
    expect(designs?.map((design) => design.id)).toContain(DEMO_DESIGN_ID);
  });

  it('boots the real renderer and loads the seeded design', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });

    await waitFor(() => {
      const state = useCodesignStore.getState();
      expect(state.configLoaded).toBe(true);
      expect(state.designs.map((design) => design.id)).toContain(DEMO_DESIGN_ID);
      expect(state.currentDesignId).toBe(DEMO_DESIGN_ID);
    });

    await waitFor(() => {
      expect(container.textContent ?? '').toContain('Demo · Informe ejecutivo');
    });

    await act(async () => {
      root.unmount();
    });
  });

  it('resolves the workspace preview source for the seeded design', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });

    await waitFor(() => {
      const preview = useCodesignStore.getState().previewSource;
      expect(typeof preview).toBe('string');
      expect((preview ?? '').toLowerCase()).toContain('<!doctype html');
    });

    await act(async () => {
      root.unmount();
    });
  });
});
