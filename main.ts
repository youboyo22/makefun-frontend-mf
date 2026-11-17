// MISSION CONTROL hand-in program (Node 22, standard library only, no network).
// Copies the static frontend (app/) and its three live-data screenshots (screenshots/) from this
// repository to the output directory, then writes dossier.json with the kit's own library, which
// the gate rebuilds and compares byte for byte.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts     (outside the grader)

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const repo = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Start each handed-in directory clean, so a second run writes the same bytes as the first.
mkdirSync(out, { recursive: true });
for (const dir of ['app', 'screenshots']) {
  rmSync(join(out, dir), { recursive: true, force: true });
  if (existsSync(join(repo, dir))) cpSync(join(repo, dir), join(out, dir), { recursive: true });
  else mkdirSync(join(out, dir), { recursive: true });
}

// The scorer's caps: only text_max_bytes shapes the dossier; the rest refuse what the gate would.
const caps = { text_max_bytes: 163840, screenshots: { max: 3, max_bytes: 262144 }, app_max_files: 993, app_max_bytes: 16777216 };
writeFileSync(join(out, 'dossier.json'), buildDossier(out, caps));
