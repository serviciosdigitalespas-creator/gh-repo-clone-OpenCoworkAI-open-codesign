/**
 * Seed data for the browser-preview mock backend.
 *
 * Kept in its own module (no `vite` import) so the shapes can be validated
 * against the real zod schemas in `@open-codesign/shared`:
 *
 *   pnpm --filter @open-codesign/desktop exec tsx scripts/validate-browser-seed.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_ARTIFACT_PATH = resolve(
  HERE,
  '../resources/templates/scaffolds/reports/executive-brief.html',
);

export const DEMO_DESIGN_ID = 'demo-design';
export const DEMO_SNAPSHOT_ID = 'demo-snapshot';
export const DEMO_ARTIFACT_ENTRY = 'index.html';
const DEMO_WORKSPACE_PATH = '/browser-preview/demo-design';
const DEMO_PROVIDER = 'anthropic';
const DEMO_MODEL = 'claude-sonnet-4-6';

export interface FileRecord {
  path: string;
  content: string;
  updatedAt: string;
}

export interface DesignRecord {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  thumbnailText: string | null;
  deletedAt: string | null;
  workspacePath: string | null;
  workspaceMode: 'blank-canvas' | 'work-on-project';
  previewMode: 'managed-file' | 'connected-url' | 'external-app' | 'none';
  previewUrl: string | null;
}

export interface SnapshotRecord {
  schemaVersion: 1;
  id: string;
  designId: string;
  parentId: string | null;
  type: 'initial' | 'edit' | 'fork';
  prompt: string | null;
  artifactType: 'html' | 'react' | 'svg';
  artifactSource: string;
  createdAt: string;
  message?: string;
}

export interface ChatRecord {
  schemaVersion: 1;
  id: number;
  designId: string;
  seq: number;
  kind: 'user' | 'assistant_text' | 'tool_call' | 'artifact_delivered' | 'error';
  payload: unknown;
  snapshotId: string | null;
  createdAt: string;
}

export interface SeedState {
  designs: DesignRecord[];
  snapshots: Record<string, SnapshotRecord[]>;
  files: Record<string, FileRecord[]>;
  chat: Record<string, ChatRecord[]>;
  comments: Record<string, unknown[]>;
  preferences: Record<string, unknown>;
  onboarding: Record<string, unknown>;
  locale: string;
}

export function loadDemoArtifact(): string {
  try {
    return readFileSync(DEMO_ARTIFACT_PATH, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return [
      '<!doctype html>',
      '<html lang="es"><head><meta charset="utf-8"><title>Preview</title></head>',
      '<body style="font-family:system-ui;padding:2rem"><h1>Preview de navegador</h1>',
      `<p>No se pudo leer <code>${DEMO_ARTIFACT_PATH}</code>: ${reason}</p>`,
      '</body></html>',
    ].join('\n');
  }
}

export function kindForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.jsx') return 'jsx';
  if (ext === '.tsx') return 'tsx';
  if (ext === '.css') return 'css';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'js';
  if (ext === '.md') return 'markdown';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return 'image';
  return 'text';
}

export function createSeedState(): SeedState {
  const now = new Date().toISOString();
  const artifact = loadDemoArtifact();
  const design: DesignRecord = {
    schemaVersion: 1,
    id: DEMO_DESIGN_ID,
    name: 'Demo · Informe ejecutivo',
    createdAt: now,
    updatedAt: now,
    thumbnailText: null,
    deletedAt: null,
    workspacePath: DEMO_WORKSPACE_PATH,
    workspaceMode: 'blank-canvas',
    previewMode: 'managed-file',
    previewUrl: null,
  };
  const snapshot: SnapshotRecord = {
    schemaVersion: 1,
    id: DEMO_SNAPSHOT_ID,
    designId: DEMO_DESIGN_ID,
    parentId: null,
    type: 'initial',
    prompt: 'Diseño de ejemplo servido por la vista previa de navegador.',
    artifactType: 'html',
    artifactSource: artifact,
    createdAt: now,
  };
  const files: FileRecord[] = [
    { path: DEMO_ARTIFACT_ENTRY, content: artifact, updatedAt: now },
    {
      path: 'DESIGN.md',
      content: [
        '# Demo · Informe ejecutivo',
        '',
        'Artefacto de ejemplo para la vista previa de navegador.',
        '',
        '- Fuente: `apps/desktop/resources/templates/scaffolds/reports/executive-brief.html`',
        '- Entrada de preview: `index.html` (fuente HTML autónoma, sin dependencias externas)',
        '- Editá el archivo desde el panel de archivos y la vista previa se refresca.',
        '',
      ].join('\n'),
      updatedAt: now,
    },
  ];
  const chat: ChatRecord[] = [
    {
      schemaVersion: 1,
      id: 1,
      designId: DEMO_DESIGN_ID,
      seq: 0,
      kind: 'user',
      payload: { text: 'Diseño de ejemplo servido por la vista previa de navegador.' },
      snapshotId: null,
      createdAt: now,
    },
    {
      schemaVersion: 1,
      id: 2,
      designId: DEMO_DESIGN_ID,
      seq: 1,
      kind: 'assistant_text',
      payload: {
        text:
          'Este diseño viene sembrado por el mock del bridge. La generación real con un modelo ' +
          'requiere el proceso principal de Electron con una API key configurada.',
      },
      snapshotId: null,
      createdAt: now,
    },
    {
      schemaVersion: 1,
      id: 3,
      designId: DEMO_DESIGN_ID,
      seq: 2,
      kind: 'artifact_delivered',
      payload: { filename: DEMO_ARTIFACT_ENTRY, createdAt: now },
      snapshotId: DEMO_SNAPSHOT_ID,
      createdAt: now,
    },
  ];

  return {
    designs: [design],
    snapshots: { [DEMO_DESIGN_ID]: [snapshot] },
    files: { [DEMO_DESIGN_ID]: files },
    chat: { [DEMO_DESIGN_ID]: chat },
    comments: { [DEMO_DESIGN_ID]: [] },
    preferences: {
      updateChannel: 'stable',
      generationTimeoutSec: 1200,
      checkForUpdatesOnStartup: false,
      dismissedUpdateVersion: '',
      diagnosticsLastReadTs: Date.now(),
      memoryEnabled: true,
      workspaceMemoryAutoUpdate: true,
      userMemoryAutoUpdate: false,
      proxyUrl: '',
    },
    onboarding: {
      hasKey: true,
      provider: DEMO_PROVIDER,
      modelPrimary: DEMO_MODEL,
      baseUrl: null,
      designSystem: null,
    },
    locale: 'es-AR',
  };
}
