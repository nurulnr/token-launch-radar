# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/nurulnr/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/nurulnr/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Radar Zero** — every launch candidate, ranked by implied value. The board ranks the 199 protocols in the snapshot that could still launch a token, by a value the page states in full: TVL × a capped 7-day growth multiplier × an age multiplier × a chains multiplier. Exchanges, bridges, liquid-staking and wrapped or staked products are set aside by the snapshot's own watchlist rule (applied without its $50M floor) and listed on the page with their reason; the 416 protocols whose token already trades sit in a separate table. Each ranked row carries a five-step farming plan built from that protocol's own category, chain and size, with real amounts, gas and durations.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

The program reads the snapshot, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/` to the output, and writes `dossier.json` with make.fun's `buildDossier`. It is deterministic: two runs write identical bytes. Node 22, standard library only, no network.

## The model

```
implied = TVL × growth × age × chains
growth = 1 + clamp(7d change %, −40, +150) / 100
age    = 1 + 0.12 × min(years since listing, 4)
chains = 1 + 0.04 × min(number of chains, 6)
```

The same formula lives in `lib/model.ts` and, in plain JavaScript, in `dashboard/app.js` as `impliedValue(p)`.

This entry is MIT licensed.
