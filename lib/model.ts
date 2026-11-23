// Radar Zero, round 3 — the model: one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the house rule keeps, by an implied
// value built only from the snapshot's own figures:
//
//   growth  = clamp(change_7d, -40, +150) per cent, 0 when unreported
//   growth  x = 1 + growth / 100
//   age     x = 1 + 0.12 x min(age in years, 4), 0 when no start date
//   chains  x = 1 + 0.04 x min(chains live, 6)
//   implied = TVL x growth x age x chains, rounded to whole dollars
//
// No protocol name is ever special-cased: the same function scores every row.
// A protocol is pre-token when its record carries no token at all. The house
// rule sets aside the exchanges, the bridges, the liquid-staking and
// wrapped or staked products, and the version forks; a set-aside protocol is
// shown with its reason and the value it would have had, clearly not ranked.
// Protocols whose token already trades sit in their own table, apart.

/** One protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One ranked row of the board. */
export interface RankedRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chain: string;
  chain_count: number;
  tvl_usd: number;
  change_7d: number | null;
  age_years: number;
  growth_mult: number;
  age_mult: number;
  chain_mult: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** One protocol the house rule sets aside, with its reason and its would-be value. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  chain: string;
  tvl_usd: number;
  reason: string;
  would_be_usd: number;
}

/** One protocol whose token already trades, shown apart from the board. */
export interface TradingRow {
  slug: string;
  name: string;
  category: string | null;
  chain: string;
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One bar of a breakdown: a chain or a category, its implied value and its count. */
export interface BreakdownBar {
  name: string;
  implied_usd: number;
  count: number;
}

/** Everything the dashboard renders, from the snapshot alone. */
export interface Board {
  as_of: string;
  floor_usd: number;
  watchlist_size: number;
  total_implied_usd: number;
  ranked: RankedRow[];
  set_aside: SetAsideRow[];
  token_trading: TradingRow[];
  chains: BreakdownBar[];
  categories: BreakdownBar[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const GROWTH_FLOOR = -40;
const GROWTH_CAP = 150;
const AGE_RATE = 0.12;
const AGE_CAP_YEARS = 4;
const CHAIN_RATE = 0.04;
const CHAIN_CAP = 6;

/** Years from `listedAt` to `asOf`, at least zero; zero when no start date. */
export function ageYears(asOf: string, listedAt: string | null): number {
  if (listedAt === null) return 0;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (a - b) / DAY_MS / 365.25);
}

/** The three multipliers and the implied value one protocol gets. */
export function scoreValue(p: SnapshotProtocol, asOf: string): {
  implied: number;
  growthMult: number;
  ageMult: number;
  chainMult: number;
  age: number;
} {
  const raw = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growth = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, raw));
  const growthMult = 1 + growth / 100;
  const age = ageYears(asOf, p.listed_at);
  const ageMult = 1 + AGE_RATE * Math.min(age, AGE_CAP_YEARS);
  const chainMult = 1 + CHAIN_RATE * Math.min(p.chains.length, CHAIN_CAP);
  const implied = Math.max(1, Math.round(p.tvl_usd * growthMult * ageMult * chainMult));
  return { implied, growthMult, ageMult, chainMult, age };
}

/** Whether a protocol's record carries no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name ending in a version fork: V1 to V9 (or v), or a 2.0-style number. */
const VERSIONED = /\s(V\d(\.\d+)?|v\d(\.\d+)?|\d+\.\d+)$/;

/** The categories the house rule sets aside. */
const SET_ASIDE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** The exchange names the house rule sets aside. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** The house rule's reason a pre-token protocol is set aside, or null when it stays. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) return p.category;
  if (VERSIONED.test(p.name)) return 'version fork';
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'wrapped or staked product';
  if (EXCHANGE_NAMES.some((n) => p.name.startsWith(n))) return 'exchange product';
  return null;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one farm transaction costs on a chain, in whole dollars of gas. */
const GAS_USD: Record<string, number> = {
  Ethereum: 8,
  Base: 0.3,
  Solana: 0.05,
  Arbitrum: 0.5,
  Optimism: 0.4,
  Polygon: 0.1,
  Avalanche: 0.5,
  Binance: 0.3,
  Ink: 0.2,
  Monad: 0.1,
  Tron: 1,
  'Hyperliquid L1': 0.1,
  Sui: 0.05,
  Aptos: 0.05,
  Near: 0.05,
  Bitcoin: 2,
  Stellar: 0.05,
  Flare: 0.1,
  Arc: 0.1,
  Provenance: 0.1,
  Plasma: 0.1,
  Mantle: 0.2,
  'Robinhood Chain': 0.2,
  Ripple: 0.05,
  RISE: 0.1,
  Algorand: 0.05,
  'zkSync Era': 0.3,
  Berachain: 0.1,
  Bittensor: 0.1,
};

/** Gas for a protocol's main chain, falling back to a dollar. */
function gasFor(p: SnapshotProtocol): number {
  const c = chainOf(p);
  return GAS_USD[c] ?? 1;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 2000;
  if (p.tvl_usd >= 500_000_000) return 1500;
  if (p.tvl_usd >= 250_000_000) return 1000;
  if (p.tvl_usd >= 100_000_000) return 500;
  if (p.tvl_usd >= 50_000_000) return 250;
  return 100;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number): number {
  if (age < 0.5) return 90;
  if (age < 1) return 60;
  if (age < 2) return 45;
  return 30;
}

/** A money figure with no decimals when whole, two when not. */
function money(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('allocator')) {
    return `Allocate $${capital} to ${name}'s curated vault on ${chain} to open the position.`;
  }
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('lend')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('cdp')) return `Lock $${capital} of collateral in ${name} on ${chain} and mint against it.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('yield')) return `Deposit $${capital} into ${name}'s yield strategy on ${chain} and keep the shares.`;
  if (c.includes('leveraged farm') || c.includes('farm')) return `Open a $${capital} leveraged farm on ${name} on ${chain} and keep the position open.`;
  if (c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('staking') || c.includes('restaking')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} into ${name}'s managed range on ${chain} and keep the shares.`;
  if (c === 'chain') return `Move $${capital} onto ${chain} and use ${name}'s native app with it.`;
  if (c.includes('anchor btc') || c.includes('decentralized btc')) return `Mint $${capital} of ${name}'s bitcoin-backed asset on ${chain} and hold it.`;
  if (c.includes('cedefi')) return `Deposit $${capital} into ${name}'s CeDeFi vault on ${chain} and keep the shares.`;
  if (c.includes('stablecoin') || c.includes('dual-token')) return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('otc')) return `Place a $${capital} order on ${name}'s OTC desk on ${chain}.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain}.`;
  if (c.includes('governance')) return `Lock $${capital} in ${name}'s governance on ${chain} and vote.`;
  if (c.includes('card')) return `Order ${name}'s card, load it with $${capital} and spend from it on ${chain}.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('collateral')) return `Supply $${capital} of collateral to ${name}'s market on ${chain}.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('options')) return `Open a $${capital} options vault position with ${name} on ${chain}.`;
  if (c.includes('privacy')) return `Deposit $${capital} into ${name}'s privacy pool on ${chain}.`;
  if (c.includes('launchpad')) return `Commit $${capital} to ${name}'s next launch on ${chain}.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** One farm step as a single string: the action, then its cost and its time. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: five steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age and seven-day change), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number, change7d: number | null): string[] {
  const chain = chainOf(p);
  const gas = gasFor(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gasText = `$${money(gas)}`;
  const steps: string[] = [
    stepText(
      'Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      `no capital, about ${gasText} of gas to fund it`,
      '5 minutes',
    ),
    stepText(action, `$${capital} of capital and about ${gasText} of gas`, '15 minutes to set up'),
    stepText(
      `Do one qualifying action each week on ${p.name} — a deposit, a swap, a vote or a claim — so the wallet stays active.`,
      `about ${gasText} of gas a week`,
      '10 minutes a week',
    ),
    stepText(
      `Hold the position for at least ${hold} days so the activity spans more than one snapshot.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
  ];
  const change = change7d ?? 0;
  if (change >= 20) {
    const add = Math.max(50, Math.round(capital / 2 / 50) * 50);
    steps.push(
      stepText(
        `TVL jumped ${change.toFixed(1)}% in 7 days, so add $${add} now while the momentum is fresh, then re-check in 7 days.`,
        `$${add} of capital and about ${gasText} of gas`,
        '7 days',
      ),
    );
  } else if (change <= -10) {
    steps.push(
      stepText(
        `TVL slipped ${Math.abs(change).toFixed(1)}% in 7 days, so hold at $${capital} and re-check in 14 days before adding more.`,
        'no extra cost',
        '14 days',
      ),
    );
  } else if (change7d === null) {
    steps.push(
      stepText(
        'TVL reported no 7-day change, so keep the position as it is and review it once a month.',
        'no extra cost',
        '30 days',
      ),
    );
  } else {
    steps.push(
      stepText(
        `TVL moved ${change.toFixed(1)}% in 7 days, so keep the position as it is and review it once a month.`,
        'no extra cost',
        '30 days',
      ),
    );
  }
  return steps;
}

/** Round a multiplier to four decimals for the board. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The board from a snapshot: ranked rows, set-aside rows, trading rows, breakdowns. */
export function buildBoard(snapshot: Snapshot): Board {
  const ranked: RankedRow[] = [];
  const setAside: SetAsideRow[] = [];
  const trading: TradingRow[] = [];
  for (const p of snapshot.protocols) {
    const chain = chainOf(p);
    if (!isPreToken(p)) {
      trading.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        chain,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
      });
      continue;
    }
    const reason = setAsideReason(p);
    const s = scoreValue(p, snapshot.as_of);
    if (reason !== null) {
      setAside.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        chain,
        tvl_usd: p.tvl_usd,
        reason,
        would_be_usd: s.implied,
      });
      continue;
    }
    ranked.push({
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chain,
      chain_count: p.chains.length,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_years: s.age,
      growth_mult: round4(s.growthMult),
      age_mult: round4(s.ageMult),
      chain_mult: round4(s.chainMult),
      implied_value_usd: s.implied,
      farm_steps: farmSteps(p, s.age, p.change_7d),
    });
  }
  ranked.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });
  setAside.sort((a, b) => b.would_be_usd - a.would_be_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  trading.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);

  const chainMap = new Map<string, BreakdownBar>();
  for (const r of ranked) {
    const bar = chainMap.get(r.chain) ?? { name: r.chain, implied_usd: 0, count: 0 };
    bar.implied_usd += r.implied_value_usd;
    bar.count += 1;
    chainMap.set(r.chain, bar);
  }
  const chains = [...chainMap.values()].sort((a, b) => b.implied_usd - a.implied_usd);

  const catMap = new Map<string, BreakdownBar>();
  for (const r of ranked) {
    const key = r.category ?? 'Uncategorised';
    const bar = catMap.get(key) ?? { name: key, implied_usd: 0, count: 0 };
    bar.implied_usd += r.implied_value_usd;
    bar.count += 1;
    catMap.set(key, bar);
  }
  const categories = [...catMap.values()].sort((a, b) => b.implied_usd - a.implied_usd);

  return {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    watchlist_size: snapshot.watchlist.length,
    total_implied_usd: ranked.reduce((sum, r) => sum + r.implied_value_usd, 0),
    ranked,
    set_aside: setAside,
    token_trading: trading,
    chains,
    categories,
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, farm steps. */
export function boardIssue(board: Board, snapshot: Snapshot): string | null {
  const slugs = new Set(board.ranked.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.ranked.length; i++) {
    const r = board.ranked[i]!;
    if (r.rank !== i + 1) return `row ${r.slug} carries rank ${r.rank}, expected ${i + 1}`;
    if (i > 0 && r.implied_value_usd > board.ranked[i - 1]!.implied_value_usd) {
      return `implied values rise at rank ${r.rank}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  if (board.ranked.length >= 2 && board.ranked[0]!.implied_value_usd === board.ranked[board.ranked.length - 1]!.implied_value_usd) {
    return 'every row shares the same implied value: a board that ranks nothing by value is not a ranking';
  }
  const setAsideSlugs = new Set(board.set_aside.map((r) => r.slug));
  for (const slug of snapshot.watchlist) {
    if (setAsideSlugs.has(slug)) return `watchlist slug ${slug} was set aside`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(board: Board): string {
  return `window.RADAR=${JSON.stringify(board)};\n`;
}
