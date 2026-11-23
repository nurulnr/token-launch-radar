// Radar Zero, round 2 — build entry point.
//
// Reads the sealed snapshot, builds the board, and writes the submission
// output: board.json, data.js, the dashboard, the screenshots and the
// dossier. Every write is deterministic: the same snapshot in gives the
// same bytes out, so two runs can be compared byte for byte.
//
// Usage: node main.ts --input /path/to/snapshot.json --output /path/to/out
// Flags may be left out: the snapshot defaults to /input/snapshot.json and
// the output to MAKEFUN_OUTPUT_DIR or /output.

import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard } from './lib/model.ts';
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

// The seven gates, checked here before anything is written: a build that
// fails a gate stops loudly instead of shipping a bad board.
function checkGates(board: Board, snapshot: Snapshot): void {
  const ranked = board.ranked;
  if (ranked.length < 100 || ranked.length > 4000) {
    throw new Error(
      `Board holds ${ranked.length} rows, outside the 100-4000 range.`,
    );
  }
  for (let i = 0; i < ranked.length; i++) {
    const row = ranked[i] as (typeof ranked)[number];
    if (row.rank !== i + 1) {
      throw new Error(
        `Row ${row.slug} carries rank ${row.rank}, expected ${i + 1}.`,
      );
    }
    if (i > 0) {
      const prev = ranked[i - 1] as (typeof ranked)[number];
      if (row.implied_value_usd > prev.implied_value_usd) {
        throw new Error(
          `Implied values rise at rank ${row.rank}: ${row.slug} above ${prev.slug}.`,
        );
      }
    }
    if (row.farm_steps.length !== 5) {
      throw new Error(
        `Row ${row.slug} carries ${row.farm_steps.length} farm steps, expected 5.`,
      );
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        throw new Error(
          `Farm step for ${row.slug} is ${trimmed.length} characters, outside 20-600.`,
        );
      }
    }
  }
  const onBoard = new Set(ranked.map((row) => row.slug));
  const missing = snapshot.watchlist.filter((slug) => !onBoard.has(slug));
  if (missing.length > 0) {
    throw new Error(
      `Watchlist slugs missing from the board: ${missing.join(', ')}.`,
    );
  }
  const setAside = new Set(board.setAside.map((row) => row.slug));
  for (const slug of snapshot.watchlist) {
    if (setAside.has(slug)) {
      throw new Error(`Watchlist slug ${slug} was set aside.`);
    }
  }
}

// The board as a canonical JSON document: keys in a fixed order, two-space
// indent, one trailing newline. Written the same way every run. The gate
// reads the `rows` array, so the ranked rows are exposed under that key
// as well as under `ranked`.
function canonicalJson(board: Board): string {
  return JSON.stringify({ rows: board.ranked, ...board }, null, 2) + '\n';
}

function main(): void {
  const argv = process.argv.slice(2);
  const input = snapshotPath(argv);
  const out = outputDir(argv);
  const snapshot = JSON.parse(readFileSync(input, 'utf-8')) as Snapshot;
  const board = buildBoard(snapshot);
  checkGates(board, snapshot);

  mkdirSync(join(out, 'dashboard'), { recursive: true });
  mkdirSync(join(out, 'screenshots'), { recursive: true });

  writeFileSync(join(out, 'board.json'), canonicalJson(board), 'utf-8');
  writeFileSync(
    join(out, 'data.js'),
    'window.RADAR = ' + JSON.stringify(board) + ';\n',
    'utf-8',
  );

  // The dashboard ships as it stands: three source files, no build step.
  cpSync(join(HERE, 'dashboard'), join(out, 'dashboard'), {
    recursive: true,
  });
  cpSync(join(HERE, 'screenshots'), join(out, 'screenshots'), {
    recursive: true,
  });

  // The dossier is built from the finished output directory and written
  // last. It reads dashboard/ and screenshots/ only, so writing it does
  // not change what a second buildDossier call would produce.
  const dossier = buildDossier(out, {
    text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
  });
  writeFileSync(join(out, 'dossier.json'), dossier);

  console.log(
    `Radar Zero round 2: ${board.ranked.length} ranked, ` +
      `${board.setAside.length} set aside, ` +
      `${board.tokenTrading.length} token-trading, ` +
      `total implied ${board.totalImplied}.`,
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
