/**
 * RPC method table shared by the dev-server middleware and the jsdom smoke test,
 * so both exercise the exact same mock behaviour.
 */
import {
  type ChatRecord,
  createSeedState,
  type DesignRecord,
  type FileRecord,
  kindForPath,
  type SeedState,
  type SnapshotRecord,
} from './seed';

export type RpcArgs = Record<string, unknown>;

/** Index-signature-safe argument reads (`noPropertyAccessFromIndexSignature`). */
function str(args: RpcArgs, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : String(value ?? '');
}

function strOrNull(args: RpcArgs, key: string): string | null {
  const value = args[key];
  return typeof value === 'string' ? value : null;
}

export function fileEntry(file: FileRecord) {
  return {
    path: file.path,
    kind: kindForPath(file.path),
    size: Buffer.byteLength(file.content, 'utf8'),
    updatedAt: file.updatedAt,
  };
}

export function notFound(what: string): Error & { status?: number } {
  const err = new Error(`browser-preview: ${what} not found`) as Error & { status?: number };
  err.status = 404;
  return err;
}

function designById(state: SeedState, id: string): DesignRecord {
  const design = state.designs.find((row) => row.id === id);
  if (!design) throw notFound(`design ${id}`);
  return design;
}

function filesOf(state: SeedState, designId: string): FileRecord[] {
  designById(state, designId);
  state.files[designId] ??= [];
  return state.files[designId];
}

function normalizePath(path: string): string {
  return path.replace(/^\.?\//, '').replace(/^\/+/, '');
}

/** `ConnectionTestError` shape from src/main/connection-ipc.ts. */
function browserPreviewUnavailable() {
  return {
    ok: false as const,
    code: 'NETWORK' as const,
    message: 'Vista previa de navegador',
    hint: 'Las pruebas de conexión requieren la app de escritorio (proceso principal de Electron).',
  };
}

/** Mirrors `ImageGenerationSettingsSchema` defaults (packages/shared/src/config.ts). */
function imageGenerationDefaults() {
  return {
    enabled: false,
    provider: 'openai',
    credentialMode: 'inherit',
    model: 'gpt-image-2',
    baseUrl: '',
    quality: 'high',
    size: '1536x1024',
    outputFormat: 'png',
    hasCustomKey: false,
    maskedKey: null,
    inheritedKeyAvailable: false,
  };
}

function providerRows() {
  return [
    {
      provider: 'anthropic',
      maskedKey: 'sk-demo-••••••••',
      baseUrl: null,
      isActive: true,
      label: 'Anthropic Claude',
      name: 'anthropic',
      builtin: true,
      wire: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
      hasKey: true,
    },
  ];
}

export function createMockRpc(state: SeedState = createSeedState()) {
  function createDesign(name: string): DesignRecord {
    const now = new Date().toISOString();
    const id = `design-${Date.now().toString(36)}`;
    const design: DesignRecord = {
      schemaVersion: 1,
      id,
      name: name.trim() ? name.trim() : 'Nuevo diseño',
      createdAt: now,
      updatedAt: now,
      thumbnailText: null,
      deletedAt: null,
      workspacePath: `/browser-preview/${id}`,
      workspaceMode: 'blank-canvas',
      previewMode: 'managed-file',
      previewUrl: null,
    };
    state.designs.push(design);
    state.snapshots[id] = [];
    state.files[id] = [];
    state.chat[id] = [];
    state.comments[id] = [];
    return design;
  }

  const methods: Record<string, (args: RpcArgs) => unknown> = {
    'locale.getSystem': () => state.locale,
    'locale.getCurrent': () => state.locale,
    'locale.set': (args) => {
      const locale = strOrNull(args, 'locale');
      if (locale !== null) state.locale = locale;
      return state.locale;
    },

    'onboarding.getState': () => state.onboarding,
    'onboarding.skip': () => state.onboarding,
    'onboarding.validateKey': () => ({
      ok: false,
      code: 'browser_preview',
      message: 'No disponible en la vista previa de navegador',
    }),
    'onboarding.saveKey': () => state.onboarding,

    'settings.listProviders': () => providerRows(),
    'settings.getPaths': () => ({
      userData: '/browser-preview',
      designs: '/browser-preview',
      logs: '/browser-preview/logs',
      templates: '/browser-preview/templates',
    }),

    'preferences.get': () => state.preferences,
    'preferences.update': (args) => {
      state.preferences = { ...state.preferences, ...args };
      return state.preferences;
    },

    'memory.getUser': () => {
      const content =
        '# Memoria de usuario\n\nLa memoria persistente vive en el proceso principal.\n';
      return {
        path: '/browser-preview/MEMORY.md',
        content,
        hash: 'browser-preview',
        mtimeMs: Date.now(),
        updatedAt: new Date().toISOString(),
        source: 'user',
      };
    },

    generationStatus: () => ({ schemaVersion: 1, running: [] }),

    'snapshots.listDesigns': () => state.designs.filter((design) => design.deletedAt === null),
    'snapshots.getDesign': (args) =>
      state.designs.find((design) => design.id === str(args, 'id')) ?? null,
    'snapshots.createDesign': (args) => createDesign(str(args, 'name')),
    'snapshots.renameDesign': (args) => {
      const design = designById(state, str(args, 'id'));
      design.name = str(args, 'name');
      design.updatedAt = new Date().toISOString();
      return design;
    },
    'snapshots.setThumbnail': (args) => {
      const design = designById(state, str(args, 'id'));
      design.thumbnailText = strOrNull(args, 'thumbnailText');
      return design;
    },
    'snapshots.softDeleteDesign': (args) => {
      const design = designById(state, str(args, 'id'));
      design.deletedAt = new Date().toISOString();
      return design;
    },
    'snapshots.duplicateDesign': (args) => {
      const source = designById(state, str(args, 'id'));
      return createDesign(str(args, 'name') || `${source.name} (copia)`);
    },
    'snapshots.updateWorkspace': (args) => {
      const design = designById(state, str(args, 'id'));
      design.workspacePath = strOrNull(args, 'workspacePath');
      return design;
    },
    'snapshots.checkWorkspaceFolder': () => ({ exists: true }),
    'snapshots.updatePreview': (args) => {
      const design = designById(state, str(args, 'id'));
      design.previewMode = (strOrNull(args, 'previewMode') ??
        'managed-file') as DesignRecord['previewMode'];
      design.previewUrl = strOrNull(args, 'previewUrl');
      return design;
    },
    'snapshots.detectPreview': () => ({
      schemaVersion: 1,
      found: false,
      url: null,
      candidates: [],
      message: 'Detección de preview deshabilitada en la vista previa de navegador.',
    }),
    'snapshots.list': (args) => {
      const designId = str(args, 'designId');
      designById(state, designId);
      return [...(state.snapshots[designId] ?? [])].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    },
    'snapshots.get': (args) => {
      const id = str(args, 'id');
      for (const rows of Object.values(state.snapshots)) {
        const hit = rows.find((row) => row.id === id);
        if (hit) return hit;
      }
      return null;
    },
    'snapshots.create': (args) => {
      const designId = str(args, 'designId');
      designById(state, designId);
      const snapshot: SnapshotRecord = {
        schemaVersion: 1,
        id: `snapshot-${Date.now().toString(36)}`,
        designId,
        parentId: strOrNull(args, 'parentId'),
        type: (strOrNull(args, 'type') ?? 'edit') as SnapshotRecord['type'],
        prompt: strOrNull(args, 'prompt'),
        artifactType: (strOrNull(args, 'artifactType') ?? 'html') as SnapshotRecord['artifactType'],
        artifactSource: str(args, 'artifactSource'),
        createdAt: new Date().toISOString(),
      };
      state.snapshots[designId] = [snapshot, ...(state.snapshots[designId] ?? [])];
      return snapshot;
    },
    'snapshots.delete': (args) => {
      const id = str(args, 'id');
      for (const designId of Object.keys(state.snapshots)) {
        state.snapshots[designId] = (state.snapshots[designId] ?? []).filter(
          (row) => row.id !== id,
        );
      }
      return null;
    },

    'files.list': (args) => filesOf(state, str(args, 'designId')).map(fileEntry),
    'files.listDir': (args) => {
      const files = filesOf(state, str(args, 'designId'));
      const dir = normalizePath(str(args, 'path') || '.');
      const prefix = dir === '' || dir === '.' ? '' : `${dir}/`;
      const seen = new Map<string, unknown>();
      for (const file of files) {
        if (prefix && !file.path.startsWith(prefix)) continue;
        const rest = prefix ? file.path.slice(prefix.length) : file.path;
        const slash = rest.indexOf('/');
        if (slash === -1) {
          seen.set(file.path, {
            path: file.path,
            name: rest,
            type: 'file',
            kind: kindForPath(file.path),
            size: Buffer.byteLength(file.content, 'utf8'),
            updatedAt: file.updatedAt,
          });
        } else {
          const name = rest.slice(0, slash);
          seen.set(`${prefix}${name}`, { path: `${prefix}${name}`, name, type: 'directory' });
        }
      }
      return [...seen.values()];
    },
    'files.read': (args) => {
      const files = filesOf(state, str(args, 'designId'));
      const normalized = normalizePath(str(args, 'path'));
      const file = files.find((row) => row.path === normalized);
      if (!file) throw notFound(`file ${normalized}`);
      return { ...fileEntry(file), content: file.content };
    },
    'files.write': (args) => {
      const files = filesOf(state, str(args, 'designId'));
      const normalized = normalizePath(str(args, 'path'));
      const content = str(args, 'content');
      const updatedAt = new Date().toISOString();
      const existing = files.find((row) => row.path === normalized);
      if (existing) {
        existing.content = content;
        existing.updatedAt = updatedAt;
        return { ...fileEntry(existing), content: existing.content };
      }
      const created: FileRecord = { path: normalized, content, updatedAt };
      files.push(created);
      return { ...fileEntry(created), content: created.content };
    },
    'files.subscribe': () => ({ ok: true }),
    'files.unsubscribe': () => ({ ok: true }),
    'files.importToWorkspace': () => [],

    'chat.list': (args) => {
      const designId = str(args, 'designId');
      designById(state, designId);
      return state.chat[designId] ?? [];
    },
    'chat.append': (args) => {
      const designId = str(args, 'designId');
      designById(state, designId);
      const rows = (state.chat[designId] ??= []);
      const row: ChatRecord = {
        schemaVersion: 1,
        id: rows.length + 1,
        designId,
        seq: rows.length,
        kind: (strOrNull(args, 'kind') ?? 'user') as ChatRecord['kind'],
        payload: args['payload'],
        snapshotId: strOrNull(args, 'snapshotId'),
        createdAt: new Date().toISOString(),
      };
      rows.push(row);
      return row;
    },
    'chat.seedFromSnapshots': () => ({ inserted: 0 }),
    'chat.updateToolStatus': () => ({ ok: true }),

    'comments.list': (args) => state.comments[str(args, 'designId')] ?? [],
    'comments.listPendingEdits': (args) => state.comments[str(args, 'designId')] ?? [],
    'comments.add': (args) => {
      const designId = str(args, 'designId');
      const rows = (state.comments[designId] ??= []);
      const row = {
        schemaVersion: 1,
        id: `comment-${Date.now().toString(36)}`,
        ...args,
        designId,
        createdAt: new Date().toISOString(),
      };
      rows.push(row);
      return row;
    },
    'comments.update': (args) => {
      const rows = state.comments[str(args, 'designId')] ?? [];
      const id = str(args, 'id');
      const row = rows.find((entry) => (entry as { id?: string }).id === id);
      if (!row) return null;
      Object.assign(
        row as Record<string, unknown>,
        (args['patch'] ?? {}) as Record<string, unknown>,
      );
      return row;
    },
    'comments.remove': (args) => {
      const designId = str(args, 'designId');
      const rows = state.comments[designId] ?? [];
      const id = str(args, 'id');
      const next = rows.filter((entry) => (entry as { id?: string }).id !== id);
      state.comments[designId] = next;
      return { removed: next.length !== rows.length };
    },
    'comments.markApplied': () => [],

    'diagnostics.listEvents': () => ({ schemaVersion: 1, events: [], total: 0 }),
    'diagnostics.exportDiagnostics': () => '/browser-preview/diagnostics.json',
    'diagnostics.isFingerprintRecentlyReported': () => ({ schemaVersion: 1, reported: false }),
    'diagnostics.recordRendererError': () => ({ schemaVersion: 1, eventId: null }),
    'diagnostics.reportEvent': () => ({ schemaVersion: 1, ok: false }),

    'ask.pending': () => [],

    'imageGeneration.get': () => imageGenerationDefaults(),

    'codexOAuth.status': () => ({
      loggedIn: false,
      email: null,
      accountId: null,
      expiresAt: null,
    }),

    'connection.test': () => browserPreviewUnavailable(),
    'connection.testActive': () => browserPreviewUnavailable(),
    'connection.testProvider': () => browserPreviewUnavailable(),

    'models.list': () => ({ ok: true, models: [] }),
    'models.listForProvider': () => ({ ok: true, models: [] }),
  };

  return {
    state,
    has: (method: string) => method in methods,
    call(method: string, args: RpcArgs = {}): unknown {
      const handler = methods[method];
      if (!handler) {
        const err = new Error(`not implemented in browser preview: ${method}`) as Error & {
          status?: number;
        };
        err.status = 501;
        throw err;
      }
      return handler(args);
    },
  };
}
