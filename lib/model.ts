// Radar Zero, round 2 — value model, eligibility and farm plans.
//
// Everything in this file derives from the sealed snapshot alone. There is
// no list of names kept by hand and no outside data: the snapshot's own
// figures (TVL, seven-day change, tracking start, chain count) decide the
// ranking, the set-aside list and every farm step.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface RankedRow {
  slug: string;
  name: string;
  category: string | null;
  chain: string;
  chains: number;
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_years: number;
  growth_mult: number;
  age_mult: number;
  chain_mult: number;
  implied_value_usd: number;
  rank: number;
  farm_steps: string[];
}

export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

export interface TokenRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  change_7d: number | null;
  chains: number;
}

export interface BreakdownEntry {
  key: string;
  total: number;
  count: number;
}

export interface Board {
  asOf: string;
  floorUsd: number;
  ranked: RankedRow[];
  setAside: SetAsideRow[];
  tokenTrading: TokenRow[];
  chains: BreakdownEntry[];
  categories: BreakdownEntry[];
  totalImplied: number;
}

// ---------------------------------------------------------------- constants

const DAYS_PER_YEAR = 365.25;
const GROWTH_LOW = -40;
const GROWTH_HIGH = 150;
const AGE_RATE = 0.12;
const AGE_CAP_YEARS = 4;
const CHAIN_RATE = 0.04;
const CHAIN_CAP = 6;

// Categories the house rule keeps off the launch board: a centralised
// exchange, a bridge, or a wrapped, staked or restaked product of a token
// that already trades. A protocol in one of these records no token of its
// own to launch, so it is set aside, never ranked.
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

// An exchange name at the start of a protocol's name.
const EXCHANGE_PREFIX =
  /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

// A whole word wrapped, staked or staking anywhere in the name.
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

// A version marker at the end of the name: a space, then V or v with one
// digit (V1, V2, V3), optionally with a point release, or a dotted number
// (2.0). Two-digit versions such as V12 are not markers under this rule.
const VERSION_SUFFIX = /\s+[Vv][1-9](\.\d+)?$|\s+\d+\.\d+$/;

// ---------------------------------------------------------------- the model

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

// How long the protocol has run, in years, from the day DefiLlama began
// tracking it to the snapshot's date. No start date on record means no age
// is claimed: zero years.
export function ageYears(listedAt: string | null, asOf: string): number {
  if (!listedAt) return 0;
  const start = Date.parse(listedAt + 'T00:00:00Z');
  const end = Date.parse(asOf + 'T00:00:00Z');
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return (end - start) / 86400000 / DAYS_PER_YEAR;
}

// The growth multiplier: the seven-day TVL change in per cent, clamped to
// the range the model trusts, turned into a multiplier. No change reported
// means no growth is claimed: a neutral 1.
export function growthMult(change7d: number | null): number {
  if (change7d === null || change7d === undefined) return 1;
  return 1 + clamp(change7d, GROWTH_LOW, GROWTH_HIGH) / 100;
}

// The age multiplier: a protocol that has run longer with no token earns
// more, up to four years of credit.
export function ageMult(years: number): number {
  return 1 + AGE_RATE * Math.min(years, AGE_CAP_YEARS);
}

// The chain multiplier: a protocol live on more chains earns more, up to
// six chains of credit.
export function chainMult(chainCount: number): number {
  return 1 + CHAIN_RATE * Math.min(chainCount, CHAIN_CAP);
}

// The implied value: what the protocol's token would be worth if its record
// stayed as it is. TVL is the base; growth, age and chain count multiply
// it. The result is a whole number of dollars.
export function impliedValue(p: Protocol, asOf: string): number {
  const years = ageYears(p.listed_at, asOf);
  const value =
    p.tvl_usd *
    growthMult(p.change_7d) *
    ageMult(years) *
    chainMult(p.chains.length);
  return Math.round(value);
}

// ---------------------------------------------------------------- eligibility

// Why a pre-token protocol is set aside instead of ranked, or null when it
// is a launch candidate. The rule is the house watchlist rule with the
// $50,000,000 floor taken off: the floor is never the whole board, so a
// smaller protocol with the same shape is just as much a candidate.
export function setAsideReason(p: Protocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
    return 'Excluded category: ' + p.category;
  }
  if (EXCHANGE_PREFIX.test(p.name)) {
    return 'Exchange-branded name';
  }
  if (WRAPPED_WORD.test(p.name)) {
    return 'Wrapped or staked product';
  }
  if (VERSION_SUFFIX.test(p.name)) {
    return 'Versioned release';
  }
  return null;
}

function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// ---------------------------------------------------------------- formatting

export function formatUsd(value: number): string {
  if (value >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
  if (value >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
  if (value >= 1e3) return '$' + (value / 1e3).toFixed(1) + 'K';
  return '$' + String(Math.round(value));
}

export function formatMoney(value: number): string {
  return '$' + String(Math.round(value));
}

export function formatMult(value: number): string {
  return 'x' + value.toFixed(2);
}

export function formatAge(years: number): string {
  if (years < 1) {
    const months = Math.max(1, Math.round(years * 12));
    return months === 1 ? '1 month' : months + ' months';
  }
  const rounded = Math.round(years * 10) / 10;
  return rounded === 1 ? '1 year' : rounded + ' years';
}

export function formatPct(change: number): string {
  return Math.abs(change).toFixed(1) + '%';
}

// ---------------------------------------------------------------- farm plans

// A reader's position size follows the protocol's TVL band: a bigger
// protocol supports a bigger position, and no step asks for more than the
// band allows.
function positionSize(tvl: number): number {
  if (tvl < 25_000_000) return 100;
  if (tvl < 100_000_000) return 250;
  if (tvl < 500_000_000) return 500;
  if (tvl < 2_000_000_000) return 1000;
  return 2000;
}

// A top-up is a quarter of the position, rounded to the nearest five.
function topUp(amount: number): number {
  return Math.max(5, Math.round(amount / 4 / 5) * 5);
}

// How long to hold, from the protocol's age: older protocols reward a
// longer hold.
function holdDays(years: number): number {
  if (years < 1) return 30;
  if (years < 2) return 45;
  if (years < 4) return 60;
  return 90;
}

// Rough gas for one transaction on a chain, in whole dollars. Estimates
// only; every step says "about".
const GAS_BY_CHAIN: Record<string, number> = {
  Ethereum: 8,
  Arbitrum: 0.5,
  Base: 0.3,
  Solana: 0.05,
  Binance: 0.3,
  'BNB Chain': 0.3,
  Polygon: 0.1,
  Optimism: 0.4,
  Avalanche: 0.5,
  Gnosis: 0.3,
  Fantom: 0.2,
  Linea: 0.3,
  zkSync: 0.4,
  Scroll: 0.3,
  Blast: 0.3,
  Mode: 0.2,
  Sei: 0.05,
  Sui: 0.05,
  Aptos: 0.05,
  Near: 0.05,
  Cosmos: 0.1,
  Cronos: 0.2,
  Mantle: 0.2,
  Berachain: 0.3,
  Sonic: 0.2,
  Hyperliquid: 0.05,
  Unichain: 0.3,
  Katana: 0.3,
  Monad: 0.1,
  Arc: 0.3,
  Corn: 0.3,
  'Robinhood Chain': 0.3,
  'Plume Mainnet': 0.2,
  Pharos: 0.2,
  Citrea: 0.3,
  Etherlink: 0.3,
  Ink: 0.3,
  Abstract: 0.3,
  Story: 0.3,
  MegaETH: 0.2,
};

function gasOn(chain: string): string {
  const gas = GAS_BY_CHAIN[chain] ?? 1;
  if (gas >= 1) return '$' + String(gas);
  return '$' + gas.toFixed(2);
}

function formatGasAmount(chain: string): string {
  return 'about ' + gasOn(chain) + ' in gas';
}

// The three actions of a farm plan depend on what the protocol is: a DEX is
// farmed by swapping and adding liquidity, a lender by supplying, a vault
// by depositing, and so on. Each family states its entry, its core position
// and its weekly cadence in its own words.
interface Family {
  entry: (name: string, chain: string, amount: string, gas: string) => string;
  core: (
    name: string,
    chain: string,
    amount: string,
    gas: string,
    hold: number,
  ) => string;
  repeat: (
    name: string,
    chain: string,
    small: string,
    gas: string,
  ) => string;
}

const FAMILIES: Record<string, Family> = {
  Dexs: {
    entry: (n, c, a, g) =>
      `Swap ${a} through ${n}'s pools on ${c} to open the wallet (${g}, about 10 minutes).`,
    core: (n, c, a, g, h) =>
      `Add ${a} of liquidity to ${n}'s deepest pool on ${c} and leave it earning for ${h} days (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, _s, g) =>
      `Swap a small trade on ${n} once a week for 8 weeks so the wallet shows steady use (about ${g} a week, 8 weeks).`,
  },
  Lending: {
    entry: (n, c, a, g) =>
      `Supply ${a} of stablecoins to ${n} on ${c} to open the wallet (${g}, about 10 minutes).`,
    core: (n, _c, a, g, h) =>
      `Keep ${a} supplied on ${n} for ${h} days and let the interest build (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, s, g) =>
      `Top up the supply by ${s} every two weeks for 8 weeks (about ${g} each time, 8 weeks).`,
  },
  Yield: {
    entry: (n, c, a, g) =>
      `Deposit ${a} into ${n}'s vault on ${c} to open the wallet (${g}, about 10 minutes).`,
    core: (n, c, a, g, h) =>
      `Keep ${a} in ${n}'s vault on ${c} for ${h} days and let it compound (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, _s, g) =>
      `Compound the yield back into the vault once a week for 8 weeks (about ${g} a week, 8 weeks).`,
  },
  'Yield Aggregator': {
    entry: (n, c, a, g) =>
      `Deposit ${a} into ${n}'s vault on ${c} to open the wallet (${g}, about 10 minutes).`,
    core: (n, c, a, g, h) =>
      `Keep ${a} in ${n}'s best vault on ${c} for ${h} days and let it compound (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, _s, g) =>
      `Compound the yield back into the vault once a week for 8 weeks (about ${g} a week, 8 weeks).`,
  },
  RWA: {
    entry: (n, c, a, g) =>
      `Buy ${a} of ${n}'s tokenised assets on ${c} to open the wallet (${g}, about 10 minutes).`,
    core: (n, _c, a, g, h) =>
      `Hold ${a} of ${n}'s tokenised assets for ${h} days (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, _s, g) =>
      `Reinvest the yield into ${n} once a month for 2 months (about ${g} each time, 8 weeks).`,
  },
  'Risk Curators': {
    entry: (n, c, a, g) =>
      `Allocate ${a} to ${n}'s curated vault on ${c} to open the wallet (${g}, about 10 minutes).`,
    core: (n, c, a, g, h) =>
      `Keep ${a} allocated with ${n}'s curator on ${c} for ${h} days (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, s, g) =>
      `Review the curator's allocations once a month and rebalance by ${s} (about ${g} each time, 8 weeks).`,
  },
  'Onchain Capital Allocator': {
    entry: (n, c, a, g) =>
      `Allocate ${a} to ${n}'s curated vault on ${c} to open the wallet (${g}, about 10 minutes).`,
    core: (n, c, a, g, h) =>
      `Keep ${a} allocated with ${n}'s best-performing curator on ${c} for ${h} days (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, s, g) =>
      `Review the curator's allocations once a month and rebalance by ${s} (about ${g} each time, 8 weeks).`,
  },
  Derivatives: {
    entry: (n, c, a, g) =>
      `Open a ${a} hedged position on ${n} on ${c} to open the wallet (${g}, about 10 minutes).`,
    core: (n, _c, a, g, h) =>
      `Hold a ${a} hedged position on ${n} for ${h} days and keep collateral above the liquidation line (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, _s, g) =>
      `Rebalance the hedge once a week for 8 weeks (about ${g} a week, 8 weeks).`,
  },
  'Basis Trading': {
    entry: (n, c, a, g) =>
      `Open a ${a} hedged position on ${n} on ${c} to open the wallet (${g}, about 10 minutes).`,
    core: (n, _c, a, g, h) =>
      `Hold a ${a} basis position on ${n} for ${h} days and keep collateral above the liquidation line (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, _s, g) =>
      `Rebalance the basis position once a week for 8 weeks (about ${g} a week, 8 weeks).`,
  },
  CDP: {
    entry: (n, c, a, g) =>
      `Lock ${a} of collateral to mint ${n}'s stablecoin on ${c} (${g}, about 10 minutes).`,
    core: (n, _c, a, g, h) =>
      `Keep ${a} of collateral locked with ${n} for ${h} days and the ratio above 150% (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, s, g) =>
      `Top up collateral by ${s} whenever the ratio nears 150% over the next 8 weeks (about ${g} each time, 8 weeks).`,
  },
  Farm: {
    entry: (n, c, a, g) =>
      `Stake ${a} in ${n}'s farm on ${c} to open the wallet (${g}, about 10 minutes).`,
    core: (n, _c, a, g, h) =>
      `Keep ${a} staked in ${n}'s farm for ${h} days and harvest weekly (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, _s, g) =>
      `Harvest the rewards and re-stake them once a week for 8 weeks (about ${g} a week, 8 weeks).`,
  },
  'Liquidity Manager': {
    entry: (n, c, a, g) =>
      `Deposit ${a} into ${n}'s managed liquidity on ${c} (${g}, about 10 minutes).`,
    core: (n, c, a, g, h) =>
      `Keep ${a} in ${n}'s managed range on ${c} for ${h} days (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, _s, g) =>
      `Let the manager rebalance weekly and check the range once a month for 8 weeks (about ${g} a week, 8 weeks).`,
  },
  Chain: {
    entry: (n, c, a, g) =>
      `Bridge ${a} to ${c} and use ${n}'s apps to open the wallet (${g}, about 10 minutes).`,
    core: (n, _c, a, g, h) =>
      `Use ${n}'s native apps weekly with ${a} on the chain for ${h} days (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, _s, g) =>
      `Do one on-chain action on ${n} every week for 8 weeks (about ${g} a week, 8 weeks).`,
  },
  'Anchor BTC': {
    entry: (n, c, a, g) =>
      `Mint ${a} of ${n}'s BTC-backed asset on ${c} (${g}, about 10 minutes).`,
    core: (n, _c, a, g, h) =>
      `Hold ${a} of ${n}'s BTC-backed asset for ${h} days (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, s, g) =>
      `Add ${s} to the position once a month for 2 months (about ${g} each time, 8 weeks).`,
  },
  'Decentralized BTC': {
    entry: (n, c, a, g) =>
      `Mint ${a} of ${n}'s BTC-backed asset on ${c} (${g}, about 10 minutes).`,
    core: (n, _c, a, g, h) =>
      `Hold ${a} of ${n}'s BTC-backed asset for ${h} days (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, s, g) =>
      `Add ${s} to the position once a month for 2 months (about ${g} each time, 8 weeks).`,
  },
  CeDeFi: {
    entry: (n, c, a, g) =>
      `Deposit ${a} with ${n} on ${c} to open the wallet (${g}, about 10 minutes).`,
    core: (n, _c, a, g, h) =>
      `Keep ${a} deposited with ${n} for ${h} days (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, s, g) =>
      `Check the yield and top up by ${s} monthly for 2 months (about ${g} each time, 8 weeks).`,
  },
  'Options Vault': {
    entry: (n, c, a, g) =>
      `Deposit ${a} into ${n}'s options vault on ${c} (${g}, about 10 minutes).`,
    core: (n, c, a, g, h) =>
      `Keep ${a} in ${n}'s options vault through the full epoch of ${h} days (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, _s, g) =>
      `Roll the vault position at each epoch end over the next 8 weeks (about ${g} each time, 8 weeks).`,
  },
  Privacy: {
    entry: (n, c, a, g) =>
      `Use ${n}'s private pools on ${c} with ${a} to open the wallet (${g}, about 10 minutes).`,
    core: (n, _c, a, g, h) =>
      `Keep ${a} in ${n}'s private pools for ${h} days (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, _s, g) =>
      `Rotate the private pool position once a month for 2 months (about ${g} each time, 8 weeks).`,
  },
  'Leveraged Farming': {
    entry: (n, c, a, g) =>
      `Open a ${a} leveraged farm on ${n} on ${c} (${g}, about 10 minutes).`,
    core: (n, _c, a, g, h) =>
      `Hold a ${a} leveraged farm on ${n} for ${h} days and watch the health factor daily (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, _s, g) =>
      `Deleverage a little each week for 8 weeks to keep the health factor safe (about ${g} a week, 8 weeks).`,
  },
  Restaking: {
    entry: (n, c, a, g) =>
      `Restake ${a} through ${n} on ${c} to open the wallet (${g}, about 10 minutes).`,
    core: (n, _c, a, g, h) =>
      `Keep ${a} restaked with ${n} for ${h} days (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, _s, g) =>
      `Claim and restake the rewards once a week for 8 weeks (about ${g} a week, 8 weeks).`,
  },
  'Staking Pool': {
    entry: (n, c, a, g) =>
      `Stake ${a} with ${n}'s pool on ${c} to open the wallet (${g}, about 10 minutes).`,
    core: (n, _c, a, g, h) =>
      `Keep ${a} staked with ${n}'s pool for ${h} days (${g} to enter, ${g} to exit, ${h} days).`,
    repeat: (n, _c, _s, g) =>
      `Claim and re-stake the rewards once a week for 8 weeks (about ${g} a week, 8 weeks).`,
  },
};

const DEFAULT_FAMILY: Family = {
  entry: (n, c, a, g) =>
    `Use ${n} on ${c} with ${a} to open the wallet (${g}, about 10 minutes).`,
  core: (n, c, a, g, h) =>
    `Keep ${a} working in ${n} on ${c} for ${h} days (${g} to enter, ${g} to exit, ${h} days).`,
  repeat: (n, _c, _s, g) =>
    `Do one action on ${n} every week for 8 weeks so the wallet stays active (about ${g} a week, 8 weeks).`,
};

function familyFor(category: string | null): Family {
  if (category !== null && category in FAMILIES) return FAMILIES[category];
  return DEFAULT_FAMILY;
}

// The risk step reads the protocol's own seven-day change: a rising
// protocol is scaled into, a falling one is held small until the trend
// turns, and no change reported means starting at the base size.
function riskStep(
  name: string,
  change7d: number | null,
  amount: string,
  small: string,
  gas: string,
): string {
  if (change7d === null || change7d === undefined) {
    return `No 7-day change is reported for ${name}, so start at ${amount} and re-check the trend in 30 days before adding more (no extra cost, 30 days).`;
  }
  if (change7d > 10) {
    return `TVL rose ${formatPct(change7d)} in 7 days, so add ${small} more in two tranches over 14 days instead of all at once (about ${gas} gas, 14 days).`;
  }
  if (change7d > 0) {
    return `TVL is up ${formatPct(change7d)} in 7 days; add ${small} after 14 days if the rise holds (about ${gas} gas, 14 days).`;
  }
  if (change7d > -10) {
    return `TVL slipped ${formatPct(change7d)} in 7 days, so hold at ${amount} and re-check in 14 days before adding more (no extra cost, 14 days).`;
  }
  return `TVL fell ${formatPct(change7d)} in 7 days. Keep the position small at ${amount} and only add more after two straight weeks of growth (no extra cost, 14 days).`;
}

// The staying step reads the protocol's age: the longer it has run with no
// token, the longer the reader should stay in.
function stayStep(name: string, years: number): string {
  const age = formatAge(years);
  if (years < 1) {
    return `${name} has run ${age} with no token. Leave the position untouched for 30 days, since early airdrops usually reward wallets that stay (no extra cost, 30 days).`;
  }
  if (years < 2) {
    return `${name} has run ${age} with no token. Keep the position open for at least 45 days and do not withdraw before then (no extra cost, 45 days).`;
  }
  if (years < 4) {
    return `${name} has run ${age} with no token. Keep the position open for at least 60 days; long-running protocols reward patience (no extra cost, 60 days).`;
  }
  return `${name} has run ${age} with no token. Keep the position open for at least 90 days; it has outlasted most of the field (no extra cost, 90 days).`;
}

// Five steps per protocol, each naming the protocol, its chain and concrete
// amounts, costs and durations. Every step ends with a cost and a duration
// in brackets, which the dashboard lifts out as a chip.
export function farmStepsFor(row: RankedRow): string[] {
  const amount = positionSize(row.tvl_usd);
  const amountStr = formatMoney(amount);
  const smallStr = formatMoney(topUp(amount));
  const gas = formatGasAmount(row.chain);
  const gasShort = gasOn(row.chain);
  const hold = holdDays(row.age_years);
  const family = familyFor(row.category);
  const steps = [
    family.entry(row.name, row.chain, amountStr, gas),
    family.core(row.name, row.chain, amountStr, gasShort, hold),
    family.repeat(row.name, row.chain, smallStr, gasShort),
    riskStep(row.name, row.change_7d, amountStr, smallStr, gasShort),
    stayStep(row.name, row.age_years),
  ];
  for (const step of steps) {
    const trimmed = step.trim();
    if (trimmed.length < 20 || trimmed.length > 600) {
      throw new Error(
        'Farm step out of range for ' + row.slug + ': ' + trimmed.length,
      );
    }
  }
  return steps;
}

// ---------------------------------------------------------------- the board

// One line a reader can check: why this protocol sits at its rank, in the
// snapshot's own numbers. The implied value, the TVL, the seven-day move
// and the age are all stated, so the rank never looks arbitrary.
export function rankLine(row: RankedRow): string {
  const growth =
    row.change_7d === null || row.change_7d === undefined
      ? 'no 7-day change reported'
      : row.change_7d > 0
        ? 'up ' + formatPct(row.change_7d) + ' in 7 days'
        : row.change_7d < 0
          ? 'down ' + formatPct(row.change_7d) + ' in 7 days'
          : 'flat over 7 days';
  const age =
    row.listed_at === null
      ? 'no start date recorded'
      : 'tracked for ' + formatAge(row.age_years);
  return (
    'Rank ' +
    row.rank +
    ' of the launch candidates: ' +
    formatUsd(row.implied_value_usd) +
    ' implied from ' +
    formatUsd(row.tvl_usd) +
    ' of TVL, ' +
    growth +
    ', ' +
    age +
    '.'
  );
}

function topEntries(
  rows: RankedRow[],
  key: (r: RankedRow) => string,
  limit: number,
): BreakdownEntry[] {
  const totals = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const k = key(row);
    const slot = totals.get(k) ?? { total: 0, count: 0 };
    slot.total += row.implied_value_usd;
    slot.count += 1;
    totals.set(k, slot);
  }
  return [...totals.entries()]
    .map(([k, v]) => ({ key: k, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
    .slice(0, limit);
}

// Build the board from the snapshot: rank the launch candidates by implied
// value, set the rest of the pre-token protocols aside with their reason,
// and list the protocols whose token already trades separately.
export function buildBoard(snapshot: Snapshot): Board {
  const asOf = snapshot.as_of;
  const ranked: RankedRow[] = [];
  const setAside: SetAsideRow[] = [];
  const tokenTrading: TokenRow[] = [];
  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) {
      tokenTrading.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        chains: p.chains.length,
      });
      continue;
    }
    const reason = setAsideReason(p);
    if (reason !== null) {
      setAside.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        tvl_usd: p.tvl_usd,
        reason,
      });
      continue;
    }
    const years = ageYears(p.listed_at, asOf);
    const row: RankedRow = {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chain: p.chains[0] ?? 'Unknown',
      chains: p.chains.length,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_years: years,
      growth_mult: growthMult(p.change_7d),
      age_mult: ageMult(years),
      chain_mult: chainMult(p.chains.length),
      implied_value_usd: impliedValue(p, asOf),
      rank: 0,
      farm_steps: [],
    };
    ranked.push(row);
  }
  // Highest implied value first; a tie breaks on the slug so the order is
  // the same on every run.
  ranked.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  for (let i = 0; i < ranked.length; i++) {
    ranked[i].rank = i + 1;
    ranked[i].farm_steps = farmStepsFor(ranked[i]);
  }
  tokenTrading.sort((a, b) => b.tvl_usd - a.tvl_usd);
  setAside.sort((a, b) => b.tvl_usd - a.tvl_usd);
  const totalImplied = ranked.reduce(
    (sum, row) => sum + row.implied_value_usd,
    0,
  );
  return {
    asOf,
    floorUsd: snapshot.floor_usd,
    ranked,
    setAside,
    tokenTrading,
    chains: topEntries(ranked, (r) => r.chain, 5),
    categories: topEntries(
      ranked,
      (r) => r.category ?? 'Uncategorised',
      5,
    ),
    totalImplied,
  };
}
