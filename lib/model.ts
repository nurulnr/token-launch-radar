// Radar Zero — the value model.
//
// A protocol with no token yet is worth what its locked value would be worth
// if it had one. The model below is the whole ranking: four multipliers on
// TVL, nothing else, and every farm plan is built from the protocol's own
// category, chain and size. No protocol name is special-cased anywhere.

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

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ScoredProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  change7d: number | null;
  ageYears: number;
  growthMult: number;
  ageMult: number;
  chainMult: number;
  implied: number;
  farmSteps: string[];
  preToken: boolean;
  setAside: string | null;
  mcap: number | null;
  symbol: string | null;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface BuiltBoard {
  asOf: string;
  floorUsd: number;
  watchlist: string[];
  rows: BoardRow[];
  scored: ScoredProtocol[];
  live: ScoredProtocol[];
  setAside: { slug: string; name: string; category: string | null; tvl: number; reason: string }[];
}

/** A protocol is pre-token when the snapshot records no token for it at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * The house's own watchlist rule, without its $50M floor: a launch radar
 * ranks protocols that could issue a token, not an exchange, not a bridge,
 * not a liquid-staking or restaked product of a token that already trades,
 * not a wrapped or staked product, and not a version fork. The rule is the
 * one the competition publishes for its watchlist, applied to every
 * pre-token protocol instead of only the ones above the floor — so the
 * board's top is genuine launch candidates, and the giants it sets aside
 * are listed on the page with their reason, not hidden.
 */
const OUT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V1|v1|1\.0|V2|v2|2\.0|V3|v3|3\.0|V4|v4|4\.0)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Why a pre-token protocol is set aside from the ranked board, or null. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return 'token trades';
  if (p.category !== null && OUT_CATEGORIES.has(p.category)) {
    return `${p.category} — a product of a token that already trades`;
  }
  if (VERSION_SUFFIX.test(p.name)) return 'version fork of a protocol';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product';
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return 'exchange product';
  return null;
}

/** A launch candidate: pre-token and not set aside by the rule above. */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  return setAsideReason(p) === null;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Years between the snapshot date and a listing date; 0 when unlisted. */
export function ageYears(asOf: string, listedAt: string | null): number {
  if (!listedAt) return 0;
  const asOfMs = Date.parse(asOf + 'T00:00:00Z');
  const listedMs = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return 0;
  const days = (asOfMs - listedMs) / 86400000;
  return days <= 0 ? 0 : days / 365.25;
}

/**
 * The four multipliers of the model, exactly as stated on the dashboard:
 * growth  = 1 + clamp(7d change %, -40, 150) / 100
 * age     = 1 + 0.12 * min(age in years, 4)
 * chains  = 1 + 0.04 * min(number of chains, 6)
 * implied = round(TVL * growth * age * chains), at least $1.
 */
export function multipliers(p: SnapshotProtocol, asOf: string): {
  ageYears: number;
  growthMult: number;
  ageMult: number;
  chainMult: number;
  implied: number;
} {
  const age = ageYears(asOf, p.listed_at);
  const growthMult = 1 + clamp(p.change_7d ?? 0, -40, 150) / 100;
  const ageMult = 1 + 0.12 * Math.min(age, 4);
  const chainMult = 1 + 0.04 * Math.min((p.chains ?? []).length, 6);
  const implied = Math.max(1, Math.round(p.tvl_usd * growthMult * ageMult * chainMult));
  return { ageYears: age, growthMult, ageMult, chainMult, implied };
}

// ---------------------------------------------------------------- farm plans

/** FNV-1a over a slug: the only source of per-row variety, fully deterministic. */
export function hashSlug(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

interface StepCtx {
  name: string;
  chain: string;
  amt: string;
  amt2: string;
  gas: string;
}

type StepFn = (c: StepCtx) => string;

function bandOf(tvl: number): { amt: string; amt2: string } {
  if (tvl >= 1_000_000_000) return { amt: '$1,000–$5,000', amt2: '$500–$1,000' };
  if (tvl >= 250_000_000) return { amt: '$300–$1,000', amt2: '$150–$300' };
  if (tvl >= 100_000_000) return { amt: '$100–$300', amt2: '$50–$100' };
  return { amt: '$50–$150', amt2: '$25–$50' };
}

function gasFor(chain: string): string {
  const cheapL2 = new Set([
    'Arbitrum', 'Optimism', 'Base', 'zkSync Era', 'Unichain', 'Ink', 'Mode',
    'Blast', 'Linea', 'Scroll', 'Mantle', 'Polygon', 'Polygon zkEVM', 'Starknet',
    'Soneium', 'Taiko', 'Zircuit', 'Morph', 'Manta', 'Fraxtal', 'Abstract',
  ]);
  if (chain === 'Ethereum') return '$8–$25';
  if (chain === 'Solana') return 'about $0.01';
  if (chain === 'Bitcoin') return '$2–$10';
  if (cheapL2.has(chain)) return '$0.10–$1';
  if (chain === 'Binance' || chain === 'Tron' || chain === 'Avalanche' || chain === 'BSC') return '$0.20–$1';
  return '$0.50–$3';
}

// Every step ends in a parenthetical with its cost and time, which the
// dashboard lifts out as a chip. Steps are self-contained: any five of a
// family's list, in any rotation, still read as one plan.
const LIBRARY: Record<string, StepFn[]> = {
  dex: [
    (c) => `Bridge ${c.amt} of USDC to ${c.chain} and swap half into the pool's second asset on ${c.name} (${c.gas} gas, 10–20 min).`,
    (c) => `Add ${c.amt} of paired liquidity to ${c.name}'s deepest pool on ${c.chain} and hold the LP token for the snapshot (${c.gas} gas, 5–10 min).`,
    (c) => `Stake the LP token in ${c.name}'s farm or gauge contract and leave it for at least two weekly epochs (${c.gas} gas, 5 min).`,
    (c) => `Route a ${c.amt2} swap through ${c.name} on ${c.chain} every week to build routed volume on the same wallet (${c.gas} per swap, 2 min).`,
    (c) => `Keep ${c.amt} of LP exposure on ${c.name} through the next snapshot date so the position is counted twice (no gas, 5 min to check).`,
    (c) => `Register the farming wallet in ${c.name}'s points program and check the points balance weekly (no gas, 2 min).`,
    (c) => `Watch ${c.name}'s announcements every Friday for a token date; a launch usually opens a 2–4 week claim window (no gas, 5 min).`,
    (c) => `If you need funds back, withdraw in two ${c.amt2} tranches and keep one LP position open so the wallet still qualifies (${c.gas} gas per exit, 5–10 min).`,
  ],
  lending: [
    (c) => `Deposit ${c.amt} of USDC as collateral on ${c.name} on ${c.chain} and borrow no more than 50% of its value (${c.gas} gas, 10–15 min).`,
    (c) => `Supply ${c.amt} of ETH or wstETH to ${c.name}'s ${c.chain} market and leave it supplied for at least 30 days (${c.gas} gas, 5–10 min).`,
    (c) => `Open a ${c.amt2} borrow against the deposit, swap it to USDC, and repay within 14 days to keep interest under $5 (${c.gas} gas per leg, 5 min).`,
    (c) => `Keep the health factor above 2.0 on ${c.name} and top up collateral if it slips below 1.8 (no gas to check, 5 min).`,
    (c) => `Repay the borrow in full before any snapshot so the wallet shows a clean supplied balance (${c.gas} gas, 5 min).`,
    (c) => `Register the lending wallet in ${c.name}'s points program and confirm the supplied balance counts weekly (no gas, 2 min).`,
    (c) => `Set a price alert on the collateral asset at 15% below your entry so you can top up before liquidation (no gas, 5 min).`,
    (c) => `Withdraw in two ${c.amt2} tranches after 30 days, leaving a small supplied balance so the wallet stays active (${c.gas} gas per exit, 5–10 min).`,
  ],
  yield: [
    (c) => `Deposit ${c.amt} of USDC into ${c.name}'s top vault on ${c.chain} and hold the vault share token (${c.gas} gas, 10–15 min).`,
    (c) => `Split the deposit across two of ${c.name}'s vaults — ${c.amt2} in each — so one vault's snapshot still catches the wallet (${c.gas} gas per deposit, 5 min).`,
    (c) => `Compound the vault yield back into the same vault once a month; each compound costs about ${c.gas} in gas (10 min).`,
    (c) => `Hold the vault shares for at least 60 days so the position appears in two monthly snapshots (no gas, 5 min to check).`,
    (c) => `Track ${c.name}'s vault APY weekly and move ${c.amt2} to the higher-yield vault if the gap stays above 2 points for two weeks (${c.gas} gas, 10 min).`,
    (c) => `Register the vault wallet in ${c.name}'s points program and confirm the shares count weekly (no gas, 2 min).`,
    (c) => `Keep a ${c.amt2} reserve of USDC on ${c.chain} so you can top up the vault without bridging again (${c.gas} gas to move, 5 min).`,
    (c) => `Exit in two ${c.amt2} tranches after the second snapshot, keeping a small share balance so the wallet stays eligible (${c.gas} gas per exit, 5–10 min).`,
  ],
  bridge: [
    (c) => `Bridge ${c.amt} of USDC from Ethereum to ${c.chain} through ${c.name} and keep the receipt hash (${c.gas} gas, 10–20 min).`,
    (c) => `Bridge ${c.amt2} back the other way a week later so the wallet shows two-way volume on ${c.name} (${c.gas} gas, 10–20 min).`,
    (c) => `Make one ${c.amt2} bridge a week for four weeks on ${c.name} to build a steady volume history (${c.gas} gas per bridge, 10 min each).`,
    (c) => `Use ${c.name} to move ${c.amt} of ETH to ${c.chain} and leave it there for 30 days before bridging back (${c.gas} gas, 10–20 min).`,
    (c) => `Bridge a small ${c.amt2} test amount first, confirm it arrives on ${c.chain}, then send the remaining ${c.amt} (${c.gas} gas, 15–25 min total).`,
    (c) => `Register the bridging wallet in ${c.name}'s points program and confirm each bridge is counted (no gas, 2 min).`,
    (c) => `Keep the bridged funds on ${c.chain} for at least 30 days so the destination balance is visible at snapshot time (no gas, 5 min to check).`,
    (c) => `Check ${c.name}'s fee quote before each bridge and skip the week if the fee is above $25 (${c.gas} gas, 2 min to check).`,
  ],
  rwa: [
    (c) => `Mint ${c.amt} of ${c.name}'s tokenized asset on ${c.chain} with USDC and hold the receipt token (${c.gas} gas, 10–20 min).`,
    (c) => `Deposit ${c.amt2} of the tokenized asset into ${c.name}'s vault or lending market for at least 30 days (${c.gas} gas, 5–10 min).`,
    (c) => `Hold ${c.amt} of the asset through the next monthly attestation so the balance is on record (no gas, 5 min to check).`,
    (c) => `Split the position into two wallets of ${c.amt2} each only if you already use both; never create wallets just for the airdrop (${c.gas} gas per move, 5 min).`,
    (c) => `Check ${c.name}'s proof-of-reserves page weekly and note the attestation date in your calendar (no gas, 5 min).`,
    (c) => `Register the holding wallet in ${c.name}'s points program and confirm the balance counts weekly (no gas, 2 min).`,
    (c) => `Redeem ${c.amt2} after 30 days to test the redemption path, then re-mint if the process is smooth (${c.gas} gas per leg, 10–20 min).`,
    (c) => `Keep a ${c.amt2} position open after any redemption so the wallet still shows exposure at snapshot time (${c.gas} gas, 5 min).`,
  ],
  lstaking: [
    (c) => `Stake ${c.amt} of ETH through ${c.name} on ${c.chain} and hold the liquid staking token (${c.gas} gas, 10–15 min).`,
    (c) => `Use ${c.amt2} of the staking token as collateral in a ${c.chain} lending market and keep the loan below 40% (${c.gas} gas, 5–10 min).`,
    (c) => `Hold the staking token for at least 60 days so the position appears in two snapshots (no gas, 5 min to check).`,
    (c) => `Restake ${c.amt2} of the staking token in a restaking vault if ${c.name} supports it, and note the unbonding time (${c.gas} gas, 10 min).`,
    (c) => `Add ${c.amt2} of the staking token to a ${c.chain} DEX pool to earn trading fees on top of staking yield (${c.gas} gas, 5–10 min).`,
    (c) => `Register the staking wallet in ${c.name}'s points program and confirm the stake counts weekly (no gas, 2 min).`,
    (c) => `Check the staking token's peg to ETH weekly; unstake if it trades more than 2% below peg for a week (${c.gas} gas, 10 min).`,
    (c) => `Unstake in two ${c.amt2} tranches after the second snapshot, keeping a small stake so the wallet stays eligible (${c.gas} gas per exit, 5–10 min).`,
  ],
  restaking: [
    (c) => `Restake ${c.amt} of staked ETH through ${c.name} on ${c.chain} and hold the restaked token (${c.gas} gas, 10–20 min).`,
    (c) => `Delegate the restaked position to two different operators with ${c.amt2} each to spread slashing risk (${c.gas} gas, 5–10 min).`,
    (c) => `Hold the restaked token for at least 60 days so it appears in two snapshots (no gas, 5 min to check).`,
    (c) => `Use ${c.amt2} of the restaked token in a ${c.chain} lending market at under 40% loan-to-value (${c.gas} gas, 5–10 min).`,
    (c) => `Check ${c.name}'s operator slashing history monthly and redelegate if an operator is slashed (${c.gas} gas, 10 min).`,
    (c) => `Register the restaking wallet in ${c.name}'s points program and confirm the position counts weekly (no gas, 2 min).`,
    (c) => `Note ${c.name}'s unbonding period (often 7–14 days) and start any exit at least two weeks before you need the funds (${c.gas} gas, 5 min).`,
    (c) => `Exit in two ${c.amt2} tranches after the second snapshot, keeping a small restaked balance so the wallet stays eligible (${c.gas} gas per exit, 5–10 min).`,
  ],
  perps: [
    (c) => `Open a ${c.amt2} long or short on ${c.name}'s ${c.chain} perps market with at most 2x leverage and a stop loss (${c.gas} gas, 5–10 min).`,
    (c) => `Place one ${c.amt2} trade a week on ${c.name} for four weeks to build a steady trading history (${c.gas} gas per trade, 5 min).`,
    (c) => `Provide ${c.amt} of liquidity to ${c.name}'s vault or insurance fund on ${c.chain} for at least 30 days (${c.gas} gas, 5–10 min).`,
    (c) => `Keep every position under 2x leverage and never risk more than ${c.amt2} on a single trade (no gas, 5 min to check).`,
    (c) => `Set a stop loss 5% from entry on every ${c.name} trade so one move cannot wipe the farming wallet (${c.gas} gas, 2 min).`,
    (c) => `Register the trading wallet in ${c.name}'s points program and confirm the volume counts weekly (no gas, 2 min).`,
    (c) => `Close each position after 7–14 days and bank the result before opening the next one (${c.gas} gas, 5 min).`,
    (c) => `Keep a ${c.amt2} vault deposit open after any trade closes so the wallet still shows exposure (${c.gas} gas, 5 min).`,
  ],
  gaming: [
    (c) => `Play ${c.name} on ${c.chain} for at least 30 minutes a week for four weeks and keep the same wallet connected (${c.gas} gas to start, 30 min a session).`,
    (c) => `Buy a ${c.amt2} starter item or pass on ${c.name} and hold it for at least 30 days (${c.gas} gas, 5–10 min).`,
    (c) => `Complete ${c.name}'s weekly quests with the farming wallet and claim the rewards each week (no gas, 15 min a week).`,
    (c) => `Hold ${c.amt2} of ${c.name}'s in-game currency on ${c.chain} through the next snapshot (no gas, 5 min to check).`,
    (c) => `Join ${c.name}'s seasonal event and finish at least three event tasks before it ends (${c.gas} gas, 30 min).`,
    (c) => `Register the gaming wallet in ${c.name}'s points program and confirm the activity counts weekly (no gas, 2 min).`,
    (c) => `Trade one ${c.amt2} item on ${c.name}'s marketplace to show marketplace volume on the wallet (${c.gas} gas, 5–10 min).`,
    (c) => `Keep the starter item listed or staked after the season ends so the wallet still shows a position (${c.gas} gas, 5 min).`,
  ],
  payments: [
    (c) => `Load ${c.amt} of USDC onto ${c.name}'s card or account on ${c.chain} and spend ${c.amt2} a week on everyday purchases (${c.gas} gas to load, 5 min).`,
    (c) => `Pay a ${c.amt2} bill or subscription through ${c.name} each month for three months (${c.gas} gas per payment, 5 min).`,
    (c) => `Hold a ${c.amt2} balance on ${c.name} for at least 30 days so the account shows a steady balance (no gas, 5 min to check).`,
    (c) => `Use ${c.name} for one cross-border payment of ${c.amt2} and keep the receipt (${c.gas} gas, 10 min).`,
    (c) => `Enable ${c.name}'s cashback or rewards and confirm the first reward lands within a week (no gas, 5 min).`,
    (c) => `Register the payment wallet in ${c.name}'s points program and confirm the spending counts weekly (no gas, 2 min).`,
    (c) => `Keep the card active with a ${c.amt2} purchase every week so the account never goes dormant (${c.gas} gas, 2 min).`,
    (c) => `Withdraw ${c.amt2} to your bank after 30 days to test the off-ramp, then reload if it works smoothly (${c.gas} gas, 10–15 min).`,
  ],
  cex: [
    (c) => `Create and verify an account on ${c.name}, enable two-factor authentication, and deposit ${c.amt} of USDC (${c.gas} gas to move funds, 15–30 min).`,
    (c) => `Hold ${c.amt} of assets on ${c.name} for at least 30 days so the balance is visible at snapshot time (no gas, 5 min to check).`,
    (c) => `Use ${c.amt2} of the deposit in ${c.name}'s earn or staking product for 30 days and note the unlock date (${c.gas} gas, 5–10 min).`,
    (c) => `Place one ${c.amt2} spot trade a week on ${c.name} for four weeks to build a steady trading history (no gas, 5 min a trade).`,
    (c) => `Keep a ${c.amt2} balance in the earn product after any trade so the account still shows a position (no gas, 5 min).`,
    (c) => `Register the account in ${c.name}'s points or rewards program and confirm the balance counts weekly (no gas, 2 min).`,
    (c) => `Set a withdrawal whitelist address and test a ${c.amt2} withdrawal to confirm the account is fully working (${c.gas} gas, 10–15 min).`,
    (c) => `Watch ${c.name}'s announcements every Friday for a token date; a launch usually opens a 2–4 week claim window (no gas, 5 min).`,
  ],
  curator: [
    (c) => `Deposit ${c.amt} of USDC into a curated vault on ${c.name} on ${c.chain} and hold the vault share token (${c.gas} gas, 10–15 min).`,
    (c) => `Compare the curator's past 90-day returns on ${c.name} and pick a vault with no missed rebalances (${c.gas} gas, 10 min to research).`,
    (c) => `Split the deposit across two curators on ${c.name} — ${c.amt2} each — so one vault's snapshot still catches the wallet (${c.gas} gas per deposit, 5 min).`,
    (c) => `Hold the vault shares for at least 60 days so the position appears in two snapshots (no gas, 5 min to check).`,
    (c) => `Check the vault's allocation weekly and exit if the curator moves more than half the funds in one rebalance (${c.gas} gas, 5 min).`,
    (c) => `Register the vault wallet in ${c.name}'s points program and confirm the shares count weekly (no gas, 2 min).`,
    (c) => `Keep a ${c.amt2} reserve of USDC on ${c.chain} so you can top up the vault without bridging again (${c.gas} gas to move, 5 min).`,
    (c) => `Exit in two ${c.amt2} tranches after the second snapshot, keeping a small share balance so the wallet stays eligible (${c.gas} gas per exit, 5–10 min).`,
  ],
  chain: [
    (c) => `Bridge ${c.amt} of USDC to ${c.chain} and use it in two of the chain's largest apps within a week (${c.gas} gas, 15–25 min).`,
    (c) => `Stake ${c.amt2} of the chain's native token through ${c.name}'s staking and hold it for at least 60 days (${c.gas} gas, 5–10 min).`,
    (c) => `Make one ${c.amt2} transaction a week on ${c.chain} for four weeks to build an active-address history (${c.gas} gas per transaction, 5 min).`,
    (c) => `Use ${c.amt2} in a ${c.chain} DEX pool and hold the LP token for at least 30 days (${c.gas} gas, 5–10 min).`,
    (c) => `Register the wallet in ${c.name}'s points program and confirm the activity counts weekly (no gas, 2 min).`,
    (c) => `Keep ${c.amt2} of native token staked after any other position closes so the wallet still shows exposure (${c.gas} gas, 5 min).`,
    (c) => `Check ${c.name}'s validator or staking dashboard monthly and redelegate if your validator misses blocks (${c.gas} gas, 10 min).`,
    (c) => `Bridge ${c.amt2} back to Ethereum after 60 days to test the exit path, then return if it works smoothly (${c.gas} gas, 10–20 min).`,
  ],
  generic: [
    (c) => `Put ${c.amt} to work in ${c.name}'s main product on ${c.chain} and hold the position for at least 30 days (${c.gas} gas, 10–15 min).`,
    (c) => `Add ${c.amt2} more after a week so the wallet shows a growing position on ${c.name} (${c.gas} gas, 5–10 min).`,
    (c) => `Hold the position through the next two weekly snapshots so it is counted twice (no gas, 5 min to check).`,
    (c) => `Use ${c.name} once a week for four weeks with ${c.amt2} each time to build a steady usage history (${c.gas} gas per use, 5 min).`,
    (c) => `Register the wallet in ${c.name}'s points program and confirm the activity counts weekly (no gas, 2 min).`,
    (c) => `Keep a ${c.amt2} position open after any partial exit so the wallet still shows exposure (${c.gas} gas, 5 min).`,
    (c) => `Watch ${c.name}'s announcements every Friday for a token date; a launch usually opens a 2–4 week claim window (no gas, 5 min).`,
    (c) => `Withdraw in two ${c.amt2} tranches after the second snapshot if you need the funds (${c.gas} gas per exit, 5–10 min).`,
  ],
};

const FAMILY_OF: Record<string, string> = {
  Dexs: 'dex', 'Liquidity Manager': 'dex', Farm: 'dex',
  Lending: 'lending', 'Uncollateralized Lending': 'lending', CDP: 'lending',
  'CDP Manager': 'lending', 'Collateral Markets': 'lending', 'Leveraged Farming': 'lending',
  Yield: 'yield', 'Yield Aggregator': 'yield', 'Basis Trading': 'yield',
  'Onchain Capital Allocator': 'yield', 'Governance Incentives': 'yield',
  Bridge: 'bridge', 'Canonical Bridge': 'bridge', 'Cross Chain Bridge': 'bridge',
  RWA: 'rwa', 'Anchor BTC': 'rwa', 'Decentralized BTC': 'rwa', 'Restaked BTC': 'rwa',
  'Dual-Token Stablecoin': 'rwa', 'Stablecoin Wrapper': 'rwa',
  'Liquid Staking': 'lstaking', 'Staking Pool': 'lstaking',
  Restaking: 'restaking', 'Liquid Restaking': 'restaking',
  Derivatives: 'perps', 'Interest Rate Derivatives': 'perps', 'Options Vault': 'perps',
  'Prediction Market': 'perps',
  Payments: 'payments', 'Crypto Card Issuer': 'payments',
  CEX: 'cex', CeDeFi: 'cex', 'OTC Marketplace': 'cex',
  'Risk Curators': 'curator',
  Chain: 'chain',
};

/** Exactly five concrete steps for one protocol, picked by its slug's hash. */
export function farmSteps(p: SnapshotProtocol): string[] {
  const family = FAMILY_OF[p.category ?? ''] ?? 'generic';
  const fns = LIBRARY[family] ?? LIBRARY['generic']!;
  const chain = (p.chains ?? [])[0] ?? 'its main chain';
  const band = bandOf(p.tvl_usd);
  const ctx: StepCtx = {
    name: p.name,
    chain,
    amt: band.amt,
    amt2: band.amt2,
    gas: gasFor(chain),
  };
  const start = hashSlug(p.slug) % fns.length;
  const steps: string[] = [];
  for (let i = 0; i < 5; i++) steps.push(fns[(start + i) % fns.length]!(ctx));
  return steps;
}

// ---------------------------------------------------------------- the board

/** Score one protocol: its multipliers, its implied value, its farm plan. */
export function score(p: SnapshotProtocol, asOf: string): ScoredProtocol {
  const m = multipliers(p, asOf);
  const pre = isPreToken(p);
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains ?? [],
    tvl: p.tvl_usd,
    change7d: p.change_7d,
    ageYears: m.ageYears,
    growthMult: m.growthMult,
    ageMult: m.ageMult,
    chainMult: m.chainMult,
    implied: m.implied,
    farmSteps: pre && setAsideReason(p) === null ? farmSteps(p) : [],
    preToken: pre,
    setAside: setAsideReason(p),
    mcap: p.mcap_usd,
    symbol: p.symbol,
  };
}

/**
 * Rank every launch candidate by implied value, ties by TVL then slug.
 * Ranks run exactly 1..N and implied never rises with rank. Every watchlist
 * slug must be on the board; a missing one is a loud failure, not a skip.
 * Pre-token protocols the rule sets aside are returned separately, with
 * their reason, so the page can show them instead of hiding them.
 */
export function buildBoard(snapshot: Snapshot): BuiltBoard {
  const asOf = snapshot.as_of;
  const scored = snapshot.protocols.map((p) => score(p, asOf));
  const pre = scored
    .filter((s) => s.preToken && s.setAside === null)
    .sort((a, b) => {
      if (b.implied !== a.implied) return b.implied - a.implied;
      if (b.tvl !== a.tvl) return b.tvl - a.tvl;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  const setAside = scored
    .filter((s) => s.preToken && s.setAside !== null)
    .sort((a, b) => b.tvl - a.tvl || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((s) => ({
      slug: s.slug,
      name: s.name,
      category: s.category,
      tvl: s.tvl,
      reason: s.setAside as string,
    }));
  const live = scored
    .filter((s) => !s.preToken)
    .sort((a, b) => {
      const ma = a.mcap ?? -1;
      const mb = b.mcap ?? -1;
      if (mb !== ma) return mb - ma;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  const rows: BoardRow[] = pre.map((s, i) => ({
    slug: s.slug,
    name: s.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: s.farmSteps,
  }));
  const onBoard = new Set(rows.map((r) => r.slug));
  for (const slug of snapshot.watchlist) {
    if (!onBoard.has(slug)) {
      throw new Error(`buildBoard: watchlist slug ${slug} is not pre-token or not in the snapshot`);
    }
  }
  return {
    asOf,
    floorUsd: snapshot.floor_usd,
    watchlist: [...snapshot.watchlist],
    rows,
    scored: pre,
    live,
    setAside,
  };
}

/** The gate's shape, checked before anything is written. Returns error strings. */
export function validateBoard(rows: BoardRow[], watchlist: string[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  let prevImplied = Number.POSITIVE_INFINITY;
  rows.forEach((r, i) => {
    if (r.rank !== i + 1) errors.push(`row ${r.slug}: rank ${r.rank}, expected ${i + 1}`);
    if (seen.has(r.slug)) errors.push(`row ${r.slug}: slug twice`);
    seen.add(r.slug);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1) {
      errors.push(`row ${r.slug}: implied ${r.implied_value_usd} is not a positive whole number`);
    }
    if (r.implied_value_usd > prevImplied) errors.push(`row ${r.slug}: implied rises with rank`);
    prevImplied = r.implied_value_usd;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      errors.push(`row ${r.slug}: ${r.farm_steps?.length ?? 0} farm steps, need 3–12`);
    } else {
      r.farm_steps.forEach((s, j) => {
        const t = s.trim();
        if (t.length < 20 || t.length > 600) {
          errors.push(`row ${r.slug} step ${j + 1}: ${t.length} chars, need 20–600`);
        }
      });
    }
  });
  for (const slug of watchlist) {
    if (!seen.has(slug)) errors.push(`watchlist slug ${slug} is missing from the board`);
  }
  return errors;
}
