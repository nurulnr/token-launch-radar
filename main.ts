// Radar Zero, round 3 — build entry point.
//
// Reads the sealed snapshot, builds the board, and writes the submission
// output: board.json, data.js, the dashboard, the screenshots and the
// dossier. Every write is deterministic: the same snapshot in gives the
// same bytes out, so two runs can be compared byte for byte.
//
// Usage: node main.ts --input /path/to/snapshot.json --output /path/to/out
// Flags may be left out: the snapshot defaults to /input/snapshot.json and
// the output to MAKEFUN_OUTPUT_DIR or /output.

import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, boardIssue, dataScript, parseSnapshot } from './lib/model.ts';
import type { Board, Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOSSIER_TEXT_MAX_BYTES = 65536;

function flagValue(argv: string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  if (at === -1 || at + 1 >= argv.length) return null;
  return argv[at + 1] as string;
}

function snapshotPath(argv: string[]): string {
  return (
    flagValue(argv, '--input') ??
    process.env.MAKEFUN_INPUT ??
    '/input/snapshot.json'
  );
}

function outputDir(argv: string[]): string {
  return (
    flagValue(argv, '--output') ??
    process.env.MAKEFUN_OUTPUT_DIR ??
    '/output'
  );
}

// The gate reads the `rows` array of board.json, so the ranked rows are
// exposed under that key as well as under `ranked`. The rest of the board
// travels with them: the set-aside table, the trading table and the
// breakdowns the dashboard renders.
function boardDocument(board: Board): string {
  return JSON.stringify({ rows: board.ranked, ...board }, null, 2) + '\n';
}

function main(): void {
  const argv = process.argv.slice(2);
  const input = snapshotPath(argv);
  const out = outputDir(argv);
  const snapshot = parseSnapshot(readFileSync(input, 'utf-8')) as Snapshot;
  const board = buildBoard(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    throw new Error(`The board fails a gate: ${issue}.`);
  }

  mkdirSync(join(out, 'dashboard'), { recursive: true });
  mkdirSync(join(out, 'screenshots'), { recursive: true });

  writeFileSync(join(out, 'board.json'), boardDocument(board), 'utf-8');
  writeFileSync(join(out, 'data.js'), dataScript(board), 'utf-8');

  // The dashboard ships as it stands: three source files, no build step.
  cpSync(join(HERE, 'dashboard'), join(out, 'dashboard'), {
    recursive: true,
  });
  cpSync(join(HERE, 'screenshots'), join(out, 'screenshots'), {
    recursive: true,
  });

  // The dossier is built from the finished output directory and written
  // last. It reads dashboard/ and screenshots/ only, so writing it does
  // not change what a second buildDossier call would produce. The gate
  // takes 3 or 4 screenshots, so a build with fewer stops here, loudly,
  // instead of failing inside the dossier builder.
  const shotCount = readdirSync(join(out, 'screenshots')).filter(
    (n) => !n.startsWith('.'),
  ).length;
  if (shotCount < 3 || shotCount > 4) {
    throw new Error(`screenshots/ holds ${shotCount} images, the gate takes 3 or 4.`);
  }
  const dossier = buildDossier(out, {
    text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
  });
  writeFileSync(join(out, 'dossier.json'), dossier);

  console.log(
    `Radar Zero round 3: ${board.ranked.length} ranked, ` +
      `${board.set_aside.length} set aside, ` +
      `${board.token_trading.length} token-trading, ` +
      `total implied ${board.total_implied_usd}.`,
  );
  for (const row of board.ranked.slice(0, 5)) {
    console.log(
      `  #${row.rank} ${row.name}: ${row.implied_value_usd} implied ` +
        `(TVL ${row.tvl_usd}, growth x${row.growth_mult.toFixed(2)}, ` +
        `age x${row.age_mult.toFixed(2)}, chains x${row.chain_mult.toFixed(2)}).`,
    );
  }
  console.log(`Wrote ${out} (dossier ${dossier.length} bytes).`);
}

main();
