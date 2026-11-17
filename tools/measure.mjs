// The local measure. This bounty has no local grader (an AI judge on the server reads three
// screenshots and a ~1,248-byte outline of the dossier text), so this prints what that judge is
// given to go on: the dossier's Totals line and per-file load figures, and an approximation of
// the outline (each source file's heading and its first declarations), cut at the same size.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts && node tools/measure.mjs

import { readFileSync } from 'node:fs';

const OUTLINE_BYTES = 1248;
const { text, images } = JSON.parse(readFileSync('out/dossier.json', 'utf8'));
const [load, sources] = text.split('\n## Sources\n');

console.log(load.split('\n').filter((line) => /^(Totals|First load|Loaded later|  app\/)/.test(line)).join('\n'));
console.log(`screenshots in the dossier: ${images.length}`);

const DECLARATION = /^(export |async |function |const |let |class )|^\s*<[^>]*\b(id=|<script|<link)|^<(script|link)/;
const outline = [load.match(/^Totals:.*$/m)[0]];
for (const line of sources.split('\n')) {
  if (line.startsWith('### app/')) outline.push(line);
  else if (DECLARATION.test(line)) outline.push(line.length > 110 ? line.slice(0, 110) + '…' : line);
}
const whole = outline.join('\n');
console.log(`\n---- outline as a judge might see it (first ${OUTLINE_BYTES} of ${whole.length} bytes) ----`);
console.log(whole.slice(0, OUTLINE_BYTES));
console.log(`---- cut here; headings left out: ${whole.slice(OUTLINE_BYTES).split('\n').filter((l) => l.startsWith('### ')).join(', ') || 'none'}`);
