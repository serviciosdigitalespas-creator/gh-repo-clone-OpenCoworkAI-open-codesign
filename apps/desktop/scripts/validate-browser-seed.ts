/**
 * Validates the browser-preview seed against the schemas the renderer really
 * consumes (`@open-codesign/shared`), so a drift between the mock backend and
 * the wire format fails here instead of as a blank preview.
 *
 *   pnpm --filter @open-codesign/desktop exec tsx scripts/validate-browser-seed.ts
 */
import { ChatMessageRowV1, DesignSnapshotV1, DesignV1 } from '@open-codesign/shared';
import { createSeedState, DEMO_ARTIFACT_ENTRY, DEMO_DESIGN_ID } from '../browser-preview/seed.ts';

const state = createSeedState();
const failures: string[] = [];

for (const design of state.designs) {
  const parsed = DesignV1.safeParse(design);
  if (!parsed.success) failures.push(`DesignV1 ${design.id}: ${parsed.error.message}`);
}

for (const [designId, snapshots] of Object.entries(state.snapshots)) {
  for (const snapshot of snapshots) {
    const parsed = DesignSnapshotV1.safeParse(snapshot);
    if (!parsed.success) {
      failures.push(`DesignSnapshotV1 ${designId}/${snapshot.id}: ${parsed.error.message}`);
    }
  }
}

for (const [designId, rows] of Object.entries(state.chat)) {
  for (const row of rows) {
    const parsed = ChatMessageRowV1.safeParse(row);
    if (!parsed.success) {
      failures.push(`ChatMessageRowV1 ${designId}#${row.id}: ${parsed.error.message}`);
    }
  }
}

// The preview entry must exist and must be the real scaffold, not the
// "could not read file" fallback that loadDemoArtifact() emits on error.
const demoFiles = state.files[DEMO_DESIGN_ID] ?? [];
const entry = demoFiles.find((file) => file.path === DEMO_ARTIFACT_ENTRY);
if (!entry) {
  failures.push(`files: falta la entrada de preview ${DEMO_ARTIFACT_ENTRY}`);
} else if (entry.content.includes('No se pudo leer')) {
  failures.push('files: el artefacto demo es el fallback, no se leyó el scaffold del repo');
} else if (!entry.content.trimStart().toLowerCase().startsWith('<!doctype html')) {
  failures.push('files: el artefacto demo no es un documento HTML completo');
}

const snapshot = state.snapshots[DEMO_DESIGN_ID]?.[0];
if (!snapshot || snapshot.artifactSource !== entry?.content) {
  failures.push('snapshots: artifactSource no coincide con el archivo de preview');
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}

console.log(
  `✓ seed válido: ${state.designs.length} diseño(s), ` +
    `${Object.values(state.snapshots).flat().length} snapshot(s), ` +
    `${demoFiles.length} archivo(s), ${state.chat[DEMO_DESIGN_ID]?.length ?? 0} mensaje(s) de chat`,
);
console.log(`✓ entrada de preview: ${DEMO_ARTIFACT_ENTRY} (${entry?.content.length} chars)`);
