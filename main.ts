// Radar Zero — the entry program (Node 22, standard library only).
//
// Reads the sealed snapshot, ranks every launch candidate by the implied
// value in lib/model.ts, and writes the board, the dashboard's data, the
// dashboard and screenshots, and the dossier the judge reads.
//
//   node main.ts --input <snapshot.json|dir> --output <dir>
//   node main.ts                       (defaults: /input, /output)
//
// MAKEFUN_OUTPUT_DIR stands in for --output when the flag is absent. The
// output is deterministic: the same snapshot always writes the same bytes.

import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDossier } from './vendor/makefun-board.ts';
import { buildBoard, validateBoard } from './lib/model.ts';
import type { BoardRow, Snapshot } from './lib/model.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string): never {
  console.error(`radar-zero: ${message}`);
  process.exit(1);
}

function flagValue(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
}

/** Copy a tree, skipping dot-names; returns the copied file paths. */
function copyTree(src: string, dest: string): string[] {
  const copied: string[] = [];
  const walk = (from: string, to: string): void => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const s = join(from, entry.name);
      const d = join(to, entry.name);
      if (entry.isDirectory()) walk(s, d);
      else if (entry.isFile()) {
        copyFileSync(s, d);
        copied.push(d);
      } else {
        fail(`copy ${s}: neither a file nor a directory`);
      }
    }
  };
  walk(src, dest);
  return copied;
}

function main(): void {
  const argv = process.argv.slice(2);
  const inputArg = flagValue(argv, '--input') ?? '/input';
  const outputArg = flagValue(argv, '--output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

  // The snapshot is a file, or a directory holding snapshot.json.
  const snapshotPath = lstatSync(inputArg).isDirectory() ? join(inputArg, 'snapshot.json') : inputArg;
  if (!existsSync(snapshotPath)) fail(`snapshot not found: ${snapshotPath}`);
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot;

  // The board, validated before a single byte is written.
  const board = buildBoard(snapshot);
  const errors = validateBoard(board.rows, board.watchlist);
  if (errors.length > 0) {
    fail(`board is invalid:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }

  mkdirSync(outputArg, { recursive: true });

  // board.json: the ranked board the scorer checks.
  const boardJson: { rows: BoardRow[] } = { rows: board.rows };
  writeFileSync(join(outputArg, 'board.json'), JSON.stringify(boardJson, null, 2) + '\n');

  // data.js: everything the dashboard renders, in one global.
  const data = {
    asOf: board.asOf,
    floorUsd: board.floorUsd,
    watchlistCount: board.watchlist.length,
    rows: board.scored.map((s) => ({
      slug: s.slug,
      name: s.name,
      category: s.category,
      chains: s.chains,
      tvl: s.tvl,
      change7d: s.change7d,
      ageYears: s.ageYears,
      implied: s.implied,
      growthMult: s.growthMult,
      ageMult: s.ageMult,
      chainMult: s.chainMult,
      farmSteps: s.farmSteps,
    })),
    live: board.live.map((s) => ({
      slug: s.slug,
      name: s.name,
      category: s.category,
      tvl: s.tvl,
      mcap: s.mcap,
      symbol: s.symbol,
    })),
    setAside: board.setAside,
  };
  writeFileSync(join(outputArg, 'data.js'), `window.RADAR = ${JSON.stringify(data, null, 2)};\n`);

  // dashboard/ and screenshots/: copied as they are, dot-names skipped.
  const dashSrc = join(HERE, 'dashboard');
  const shotsSrc = join(HERE, 'screenshots');
  if (!existsSync(dashSrc)) fail('dashboard/ is missing from the repository');
  copyTree(dashSrc, join(outputArg, 'dashboard'));

  if (!existsSync(shotsSrc)) fail('screenshots/ is missing from the repository');
  const shotNames = readdirSync(shotsSrc, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name);
  for (const name of shotNames) {
    if (!SCREENSHOT_NAME.test(name)) fail(`screenshot name ${name} is not a dossier name`);
  }
  if (shotNames.length < 3) fail(`screenshots/ holds ${shotNames.length} images, need at least 3`);
  copyTree(shotsSrc, join(outputArg, 'screenshots'));

  // dossier.json: exactly what the library writes from dashboard/ and screenshots/.
  const dossier = buildDossier(outputArg, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  writeFileSync(join(outputArg, 'dossier.json'), dossier);

  const top = board.rows[0]!;
  console.log(
    `radar-zero: ${snapshot.protocols.length} protocols, ${board.watchlist.length} on the watchlist, ` +
      `${board.rows.length} launch candidates ranked, ${board.setAside.length} set aside, ${board.live.length} token trades; rank 1 is ${top.slug} at $${top.implied_value_usd.toLocaleString('en-US')}`,
  );
}

main();
