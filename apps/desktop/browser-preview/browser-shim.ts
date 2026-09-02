/**
 * Browser-side stand-in for the Electron preload bridge.
 *
 * In the packaged app `window.codesign` is built by `src/preload/index.ts` on
 * top of `ipcRenderer`. A plain browser has neither, so this module exposes the
 * same shape and routes every call to the mock backend served by
 * `mock-api-server.ts` on the same dev server.
 *
 * Injected into the dev HTML by `vite.config.browser.mjs`; it is not imported by
 * any renderer module and never ships in a production build.
 *
 * Everything that would need a real model call, a filesystem dialog, or a
 * spawned process is intentionally left to the proxy fallback below, which
 * resolves to `undefined` (the renderer guards those paths with optional
 * chaining) instead of throwing.
 */
import type {
  ChatAppendInput,
  CommentCreateInput,
  ListEventsInput,
  ReportEventInput,
  SnapshotCreateInput,
} from '@open-codesign/shared';
import type {
  CodesignApi,
  ExportInvokePayload,
  ImageGenerationSettingsView,
  PreviewMode,
  ValidateKeyError,
  ValidateKeyResult,
} from '../src/preload/index';

/** Parameter types lifted from the preload so the shim matches them exactly. */
type AgentStreamEventLike = Parameters<CodesignApi['chat']['onAgentEvent']>[0] extends (
  event: infer E,
) => void
  ? E
  : never;
type AskRequestLike = Parameters<CodesignApi['ask']['onRequest']>[0] extends (
  request: infer R,
) => void
  ? R
  : never;

const ENDPOINT = '/__codesign_preview/rpc';

type AnyListener = (event: never) => void;

const listeners = new Map<string, Set<AnyListener>>();

/**
 * Registers a listener on a mock event channel. Generic on the callback so each
 * call site keeps the exact signature declared by the preload.
 */
function subscribe<T extends (event: never) => void>(
  channel: string,
  callback: T,
): ReturnType<CodesignApi['onUpdateAvailable']> {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(callback);
  // The preload returns `ipcRenderer.removeListener(...)` here; the renderer
  // only ever calls the value as a cleanup function and discards the result.
  const unsubscribe = () => {
    set?.delete(callback);
  };
  return unsubscribe as unknown as ReturnType<CodesignApi['onUpdateAvailable']>;
}

/** Test hook: lets a devtools console (or a test) push events into the UI. */
function emit(channel: string, event: unknown): void {
  for (const listener of listeners.get(channel) ?? []) (listener as (e: unknown) => void)(event);
}

/**
 * One RPC round-trip against the mock backend. `T` is inferred from the call
 * site, so the return type is checked against the preload's `CodesignApi` when
 * `implemented` is assigned to it — a drifted shape fails typecheck.
 */
async function invoke<T = never>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok)
    throw new Error(body.error ?? `browser-preview RPC ${method} failed (${res.status})`);
  return body.result as T;
}

/** Swallow errors from fire-and-forget calls (logging, subscriptions, ...). */
function soft<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    console.warn('[browser-preview]', err);
    return fallback;
  });
}

const NOT_AVAILABLE = 'Requiere la app de escritorio (proceso principal de Electron).';

const implemented = {
  detectProvider: () => Promise.resolve('anthropic'),
  cancelGeneration: () => Promise.resolve(),
  generationStatus: () => invoke('generationStatus'),
  generateTitle: (prompt: string) => Promise.resolve(prompt.slice(0, 48)),
  pickInputFiles: () => Promise.resolve([]),
  checkForUpdates: () => Promise.resolve(),
  downloadUpdate: () => Promise.resolve(),
  installUpdate: () => Promise.resolve(),
  onUpdateAvailable: (cb: (info: unknown) => void) => subscribe('codesign:update-available', cb),
  openExternal: (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
    return Promise.resolve();
  },

  // Real model runs and exports need the Electron main process (provider calls,
  // Puppeteer PDF, pptxgenjs, zip). They fail loudly instead of pretending.
  generate: () => Promise.reject(new Error(NOT_AVAILABLE)),
  applyComment: () => Promise.reject(new Error(NOT_AVAILABLE)),
  export: (payload: ExportInvokePayload) => {
    console.warn('[browser-preview] export ignorado:', payload.format);
    return Promise.reject(new Error(NOT_AVAILABLE));
  },
  doneVerify: () => Promise.resolve({ errors: [] }),
  pickDesignSystemDirectory: () => Promise.reject(new Error(NOT_AVAILABLE)),
  clearDesignSystem: () => Promise.reject(new Error(NOT_AVAILABLE)),

  locale: {
    getSystem: () => invoke<string>('locale.getSystem'),
    getCurrent: () => invoke<string>('locale.getCurrent'),
    set: (locale: string) => invoke<string>('locale.set', { locale }),
  },

  onboarding: {
    getState: () => invoke('onboarding.getState'),
    validateKey: () => invoke('onboarding.validateKey'),
    saveKey: (input: Record<string, unknown>) => invoke('onboarding.saveKey', input),
    skip: () => invoke('onboarding.skip'),
  },

  settings: {
    listProviders: () => soft([], () => invoke('settings.listProviders')),
    getPaths: () => invoke('settings.getPaths'),
    addProvider: (input: Record<string, unknown>) => invoke('settings.addProvider', input),
    deleteProvider: (provider: string) => invoke('settings.deleteProvider', { provider }),
    setActiveProvider: (input: Record<string, unknown>) =>
      invoke('settings.setActiveProvider', input),
    resetOnboarding: () => invoke('settings.resetOnboarding', {}),
    chooseStorageFolder: (kind: string) => invoke('settings.chooseStorageFolder', { kind }),
    openFolder: (path: string) => {
      console.info('[browser-preview] openFolder ignorado:', path);
      return Promise.resolve();
    },
    openTemplatesFolder: () => Promise.resolve(),
    toggleDevtools: () => Promise.resolve(),
    validateKey: (input: Parameters<CodesignApi['settings']['validateKey']>[0]) =>
      invoke<ValidateKeyResult | ValidateKeyError>('settings.validateKey', { ...input }),
  },

  preferences: {
    get: () => invoke('preferences.get'),
    update: (patch: Record<string, unknown>) => invoke('preferences.update', patch),
  },

  memory: {
    getUser: () => soft(null, () => invoke('memory.getUser')),
    updateUser: (content: string) => invoke('memory.updateUser', { content }),
    openUserMemory: () => Promise.resolve(),
    consolidateUserMemoryNow: () => Promise.resolve({ updated: false, candidateCount: 0 }),
    clearUserMemoryCandidates: () => Promise.resolve(),
  },

  imageGeneration: {
    get: () => invoke('imageGeneration.get'),
    update: (patch: Partial<ImageGenerationSettingsView> & { apiKey?: string }) =>
      invoke('imageGeneration.update', { ...patch }),
  },

  codexOAuth: {
    status: () => invoke('codexOAuth.status'),
    login: () => Promise.reject(new Error(NOT_AVAILABLE)),
    cancelLogin: () => Promise.resolve(false),
    logout: () => invoke('codexOAuth.logout'),
  },

  connection: {
    test: (input: Record<string, unknown>) => invoke('connection.test', input),
    testActive: () => invoke('connection.testActive'),
    testProvider: (providerId: string) => invoke('connection.testProvider', { providerId }),
  },

  models: {
    list: (input: Record<string, unknown>) =>
      soft({ ok: true as const, models: [] }, () => invoke('models.list', input)),
    listForProvider: (providerId: string) =>
      soft({ ok: true as const, models: [] }, () =>
        invoke('models.listForProvider', { providerId }),
      ),
  },

  config: {
    // Provider CRUD lives in the encrypted config file + keychain of the main
    // process. Nothing to write here, so every mutation fails loudly and
    // detection reports "nothing found" (all fields of the shape are optional).
    setProviderAndModels: () => Promise.reject(new Error(NOT_AVAILABLE)),
    addProvider: () => Promise.reject(new Error(NOT_AVAILABLE)),
    updateProvider: () => Promise.reject(new Error(NOT_AVAILABLE)),
    removeProvider: () => Promise.reject(new Error(NOT_AVAILABLE)),
    setActiveProviderAndModel: () => Promise.reject(new Error(NOT_AVAILABLE)),
    testEndpoint: () => Promise.reject(new Error(NOT_AVAILABLE)),
    listEndpointModels: () => Promise.resolve({ ok: false as const, error: NOT_AVAILABLE }),
    detectExternalConfigs: () => Promise.resolve({}),
    importCodexConfig: () => Promise.reject(new Error(NOT_AVAILABLE)),
    importClaudeCodeConfig: () => Promise.reject(new Error(NOT_AVAILABLE)),
    importGeminiConfig: () => Promise.reject(new Error(NOT_AVAILABLE)),
    importOpencodeConfig: () => Promise.reject(new Error(NOT_AVAILABLE)),
  },

  ollama: {
    probe: () =>
      Promise.resolve({ ok: false as const, code: 'browser_preview', message: NOT_AVAILABLE }),
  },

  files: {
    list: (designId: string) => invoke('files.list', { designId }),
    listDir: (designId: string, path = '.') => invoke('files.listDir', { designId, path }),
    read: (designId: string, path: string) => invoke('files.read', { designId, path }),
    preview: (designId: string, path: string) => invoke('files.preview', { designId, path }),
    thumbnail: (designId: string, path: string) => invoke('files.thumbnail', { designId, path }),
    write: (designId: string, path: string, content: string) =>
      invoke('files.write', { designId, path, content }),
    importToWorkspace: (input: Parameters<CodesignApi['files']['importToWorkspace']>[0]) =>
      invoke('files.importToWorkspace', { ...input }),
    subscribe: (designId: string) => invoke('files.subscribe', { designId }),
    unsubscribe: (designId: string) => invoke('files.unsubscribe', { designId }),
    onChanged: (cb: (event: { schemaVersion: 1; designId: string }) => void) =>
      subscribe('codesign:files:v1:changed', cb),
  },

  snapshots: {
    listDesigns: () => soft([], () => invoke('snapshots.listDesigns')),
    createDesign: (name: string, workspacePath?: string | null) =>
      invoke('snapshots.createDesign', { name, workspacePath: workspacePath ?? null }),
    getDesign: (id: string) => invoke('snapshots.getDesign', { id }),
    renameDesign: (id: string, name: string) => invoke('snapshots.renameDesign', { id, name }),
    setThumbnail: (id: string, thumbnailText: string | null) =>
      invoke('snapshots.setThumbnail', { id, thumbnailText }),
    softDeleteDesign: (id: string) => invoke('snapshots.softDeleteDesign', { id }),
    duplicateDesign: (id: string, name: string) =>
      invoke('snapshots.duplicateDesign', { id, name }),
    pickWorkspaceFolder: () => Promise.resolve(null),
    updateWorkspace: (designId: string, workspacePath: string, migrateFiles: boolean) =>
      invoke('snapshots.updateWorkspace', { designId, workspacePath, migrateFiles }),
    openWorkspaceFolder: () => Promise.resolve(),
    checkWorkspaceFolder: (designId: string) =>
      invoke('snapshots.checkWorkspaceFolder', { designId }),
    updatePreview: (designId: string, previewMode: PreviewMode, previewUrl?: string | null) =>
      invoke('snapshots.updatePreview', { designId, previewMode, previewUrl: previewUrl ?? null }),
    detectPreview: (designId: string) => invoke('snapshots.detectPreview', { designId }),
    list: (designId: string) => soft([], () => invoke('snapshots.list', { designId })),
    get: (id: string) => invoke('snapshots.get', { id }),
    create: (input: SnapshotCreateInput) => invoke('snapshots.create', { ...input }),
    delete: (id: string) => invoke('snapshots.delete', { id }),
  },

  chat: {
    list: (designId: string) => soft([], () => invoke('chat.list', { designId })),
    append: (input: ChatAppendInput) => invoke('chat.append', { ...input }),
    seedFromSnapshots: (designId: string) => invoke('chat.seedFromSnapshots', { designId }),
    updateToolStatus: (input: Parameters<CodesignApi['chat']['updateToolStatus']>[0]) =>
      invoke('chat.updateToolStatus', { ...input }),
    onAgentEvent: (cb: (event: AgentStreamEventLike) => void) => subscribe('agent:event:v1', cb),
  },

  comments: {
    add: (input: CommentCreateInput) => invoke('comments.add', { ...input }),
    list: (designId: string, snapshotId?: string) =>
      soft([], () => invoke('comments.list', { designId, snapshotId })),
    listPendingEdits: (designId: string) =>
      soft([], () => invoke('comments.listPendingEdits', { designId })),
    update: (designId: string, id: string, patch: Record<string, unknown>) =>
      invoke('comments.update', { designId, id, patch }),
    remove: (designId: string, id: string) => invoke('comments.remove', { designId, id }),
    markApplied: (designId: string, ids: string[], snapshotId: string) =>
      invoke('comments.markApplied', { designId, ids, snapshotId }),
  },

  diagnostics: {
    log: (entry: {
      schemaVersion: 1;
      level: 'info' | 'warn' | 'error';
      scope: string;
      message: string;
      data?: Record<string, unknown>;
      stack?: string;
    }) => {
      // Console instead of the main-process log file: keeps devtools useful.
      const level = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'info';
      console[level](`[codesign:${entry.scope}]`, entry.message, entry.data ?? '');
      return Promise.resolve();
    },
    openLogFolder: () => Promise.resolve(),
    exportDiagnostics: () =>
      soft('/browser-preview/diagnostics.json', () => invoke('diagnostics.exportDiagnostics')),
    showItemInFolder: () => Promise.resolve(),
    listEvents: (input: ListEventsInput) => invoke('diagnostics.listEvents', { ...input }),
    reportEvent: (input: ReportEventInput) => invoke('diagnostics.reportEvent', { ...input }),
    recordRendererError: (
      input: Parameters<CodesignApi['diagnostics']['recordRendererError']>[0],
    ) => invoke('diagnostics.recordRendererError', { ...input }),
    isFingerprintRecentlyReported: () =>
      soft({ schemaVersion: 1 as const, reported: false }, () =>
        invoke('diagnostics.isFingerprintRecentlyReported', {}),
      ),
  },

  ask: {
    pending: () => soft([], () => invoke('ask.pending')),
    onRequest: (cb: (request: AskRequestLike) => void) => subscribe('ask:request', cb),
    resolve: (requestId: string, result: Parameters<CodesignApi['ask']['resolve']>[1]) =>
      invoke('ask.resolve', { requestId, ...result }),
  },
};

/**
 * Anything not implemented above (real generation, export, provider import,
 * OAuth) resolves to `undefined`. The renderer reaches these through optional
 * chaining and shows its own "not available" states, which beats throwing
 * inside an effect.
 *
 * `api` is assignable to `CodesignApi` without a cast on purpose: if the preload
 * gains or renames a method, `tsc -p tsconfig.browser-preview.json` fails here
 * instead of the preview silently degrading at runtime.
 */
function createApi(): CodesignApi {
  const api: CodesignApi = implemented;
  const target = api as unknown as Record<string | symbol, unknown>;
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (typeof prop === 'symbol') return undefined;
      return (..._args: unknown[]) => {
        console.warn(`[browser-preview] window.codesign.${prop}() no está disponible`);
        return Promise.resolve(undefined);
      };
    },
  }) as CodesignApi;
}

declare global {
  interface Window {
    codesign?: CodesignApi;
    __codesignBrowserPreview?: { emit: typeof emit; invoke: typeof invoke };
  }
}

export function installBrowserCodesignApi(): void {
  if (window.codesign) return;
  window.codesign = createApi();
  window.__codesignBrowserPreview = { emit, invoke };
  console.info(
    '[browser-preview] window.codesign conectado al mock (generación y exportación requieren Electron).',
  );
}
