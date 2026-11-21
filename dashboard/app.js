/* Radar Zero — the page logic. Data arrives in window.RADAR from data.js.
   Everything on this page is computed from that one object, so the board,
   the radar, the detail view and the screenshots can never disagree. */

// ---------------------------------------------------------------- the model
// How the value is worked out — the same four multipliers as lib/model.ts.
// A protocol with no token yet is worth its TVL times three small boosts:
//   implied = TVL x growth x age x chains, rounded to whole dollars.
//
//   growth = 1 + clamp(7d TVL change %, -40, 150) / 100
//            A protocol growing fast is worth more than its TVL alone;
//            the cap keeps one wild week from owning the board.
//   age    = 1 + 0.12 x min(years since listing, 4)
//            Older means it survived more than one cycle.
//   chains = 1 + 0.04 x min(number of chains, 6)
//            More chains means more reach.
// A row's implied value in data.js is exactly this function on that row.
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function impliedValue(p) {
  const growth = 1 + clamp(p.change7d == null ? 0 : p.change7d, -40, 150) / 100;
  const age = 1 + 0.12 * Math.min(p.ageYears || 0, 4);
  const chains = 1 + 0.04 * Math.min((p.chains || []).length, 6);
  return Math.max(1, Math.round(p.tvl * growth * age * chains));
}

// ---------------------------------------------------------------- helpers
const D = window.RADAR;
const setAside = D.setAside || [];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function fmtUsd(v) {
  if (v == null) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
}
function fmtFull(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
function fmtPct(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}
function fmtAge(y) {
  if (!y) return '—';
  return y.toFixed(1) + 'y';
}
function fmtMult(m) { return '×' + m.toFixed(2); }

// ---------------------------------------------------------------- state
const state = { q: '', status: 'pretoken', category: '', chain: '', minTvl: 0, sort: 'rank', selected: null };
const bySlug = new Map(D.rows.map((r) => [r.slug, r]));
const watchSet = new Set(D.watchlist || []);
const categories = [...new Set(D.rows.map((r) => r.category).filter(Boolean))].sort();
const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();

function filteredRows() {
  let rows = D.rows;
  if (state.q) {
    const q = state.q.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q));
  }
  if (state.category) rows = rows.filter((r) => r.category === state.category);
  if (state.chain) rows = rows.filter((r) => r.chains.includes(state.chain));
  if (state.minTvl) rows = rows.filter((r) => r.tvl >= state.minTvl);
  rows = rows.slice();
  const byGrowth = (r) => (r.change7d == null ? -Infinity : r.change7d);
  if (state.sort === 'implied') rows.sort((a, b) => b.implied - a.implied || a.slug.localeCompare(b.slug));
  else if (state.sort === 'tvl') rows.sort((a, b) => b.tvl - a.tvl || a.slug.localeCompare(b.slug));
  else if (state.sort === 'growth') rows.sort((a, b) => byGrowth(b) - byGrowth(a) || a.slug.localeCompare(b.slug));
  else if (state.sort === 'age') rows.sort((a, b) => b.ageYears - a.ageYears || a.slug.localeCompare(b.slug));
  else rows.sort((a, b) => (D.rows.indexOf(a) - D.rows.indexOf(b)));
  return rows;
}

// ---------------------------------------------------------------- header
function renderHeader() {
  const live = D.live.length;
  $('snapshotLine').innerHTML =
    'Snapshot <b>' + esc(D.asOf) + '</b><br>' +
    esc(D.rows.length + live + setAside.length) + ' protocols · <b>' + D.rows.length + ' ranked</b> · ' +
    live + ' token trades · ' + setAside.length + ' set aside · ' + D.watchlistCount + ' on the watchlist';
  const hot = D.rows.filter((r) => r.change7d != null)
    .sort((a, b) => b.change7d - a.change7d).slice(0, 5);
  $('ticker').innerHTML = '<b>HOTTEST 7D</b> &nbsp;' + hot.map((r) =>
    '<span class="hot">' + esc(r.slug) + ' ' + fmtPct(r.change7d) + '</span>').join(' &nbsp;·&nbsp; ');
  const top = D.rows[0];
  const med = D.rows[Math.floor(D.rows.length / 2)].implied;
  $('stats').innerHTML =
    '<dt>Ranked</dt><dd>' + D.rows.length + '</dd>' +
    '<dt>Token trades</dt><dd>' + live + '</dd>' +
    '<dt>Set aside</dt><dd>' + setAside.length + '</dd>' +
    '<dt>Watchlist</dt><dd>' + D.watchlistCount + ' / ' + D.rows.length + ' on the board</dd>' +
    '<dt>Median implied</dt><dd>' + fmtUsd(med) + '</dd>' +
    '<dt>Top implied</dt><dd>' + fmtUsd(top.implied) + ' — ' + esc(top.slug) + '</dd>';
  $('top10').innerHTML = D.rows.slice(0, 10).map((r, i) =>
    '<li data-slug="' + esc(r.slug) + '"><span class="rk">' + String(i + 1).padStart(2, '0') +
    '</span><span class="nm">' + esc(r.name) + ' <span class="sl">' + esc(r.slug) + '</span></span>' +
    '<span class="vl">' + fmtUsd(r.implied) + '</span></li>').join('');
  $('top10').querySelectorAll('li').forEach((li) =>
    li.addEventListener('click', () => showDetail(li.dataset.slug, true)));
  const w = D.rows[0];
  $('workedExample').textContent =
    'Worked example — ' + w.name + ': ' + fmtUsd(w.tvl) + ' TVL × ' + fmtMult(w.growthMult) +
    ' growth × ' + fmtMult(w.ageMult) + ' age × ' + fmtMult(w.chainMult) + ' chains = ' + fmtFull(w.implied) + '.';
}

// ---------------------------------------------------------------- radar
function drawRadar() {
  const cv = $('radar');
  const ctx = cv.getContext('2d');
  const W = 360, cx = 180, cy = 180, R = 166;
  ctx.fillStyle = '#070c18';
  ctx.fillRect(0, 0, W, W);
  ctx.strokeStyle = '#1c2b47';
  ctx.lineWidth = 1;
  for (const f of [0.33, 0.66, 1]) {
    ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  // the sweep: one fixed line, north-east, with a faint wedge behind it.
  const sweep = -Math.PI / 3;
  ctx.fillStyle = 'rgba(43,255,158,0.05)';
  ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R, sweep - 0.5, sweep); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(43,255,158,0.7)';
  ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.lineTo(cx + R * Math.cos(sweep), cy + R * Math.sin(sweep)); ctx.stroke();
  // blips: angle from 7d growth, radius from log TVL, size from implied value.
  const logs = D.rows.map((r) => Math.log10(Math.max(1, r.tvl)));
  const lo = Math.min(...logs), hi = Math.max(...logs);
  const maxImp = D.rows[0].implied;
  const top10 = new Set(D.rows.slice(0, 10).map((r) => r.slug));
  for (const r of D.rows) {
    const g = clamp(r.change7d == null ? 0 : r.change7d, -40, 150);
    const ang = ((g + 40) / 190) * Math.PI * 2 - Math.PI / 2;
    const rad = 26 + ((Math.log10(Math.max(1, r.tvl)) - lo) / (hi - lo)) * (R - 44);
    const x = cx + rad * Math.cos(ang), y = cy + rad * Math.sin(ang);
    const size = 1.5 + 5 * Math.sqrt(r.implied / maxImp);
    ctx.fillStyle = top10.has(r.slug) ? '#ffb000' : 'rgba(43,255,158,0.85)';
    ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
  }
  // labels for the top 10: one slot each down the right edge, with a thin
  // leader line from the blip, so clustered blips stay readable.
  ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
  D.rows.slice(0, 10).forEach((r, i) => {
    const g = clamp(r.change7d == null ? 0 : r.change7d, -40, 150);
    const ang = ((g + 40) / 190) * Math.PI * 2 - Math.PI / 2;
    const rad = 26 + ((Math.log10(Math.max(1, r.tvl)) - lo) / (hi - lo)) * (R - 44);
    const x = cx + rad * Math.cos(ang), y = cy + rad * Math.sin(ang);
    const sy = 26 + i * 33, sx = 235;
    ctx.strokeStyle = 'rgba(255,176,0,0.45)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(sx - 6, sy + 3); ctx.stroke();
    // A dark backing so blips never show through the label text.
    const label = String(i + 1).padStart(2, '0') + ' ' + r.slug;
    const value = fmtUsd(r.implied);
    const w = Math.max(ctx.measureText(label).width, ctx.measureText(value).width);
    ctx.fillStyle = '#070c18';
    ctx.fillRect(sx - 3, sy - 9, w + 6, 26);
    ctx.fillStyle = '#ffb000';
    ctx.fillText(label, sx, sy + 3);
    ctx.fillStyle = '#2bff9e';
    ctx.fillText(value, sx, sy + 14);
  });
  ctx.fillStyle = '#7d8fb3';
  ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillText('7d growth → angle', 14, 20);
  ctx.fillText('TVL (log) → distance', 14, W - 12);
}

// ---------------------------------------------------------------- board table
function rowHtml(r, rankShown) {
  const cls = r.change7d == null ? '' : (r.change7d >= 0 ? 'up' : 'down');
  return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="sel"' : '') + '>' +
    '<td class="rk' + (rankShown > 10 ? ' dim' : '') + '">' + rankShown + '</td>' +
    '<td><span class="nm">' + esc(r.name) + '</span><br><span class="sl">' + esc(r.slug) + '</span>' +
    ' <span class="cat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
    '<td class="num">' + fmtUsd(r.tvl) + '</td>' +
    '<td class="num ' + cls + '">' + fmtPct(r.change7d) + '</td>' +
    '<td class="num">' + fmtAge(r.ageYears) + '</td>' +
    '<td class="num" style="color:var(--green)">' + fmtUsd(r.implied) + '</td>' +
    '<td><span class="status">NO TOKEN</span></td></tr>';
}

function renderBoard() {
  const rows = filteredRows();
  const rankOf = new Map(D.rows.map((r, i) => [r.slug, i + 1]));
  $('boardBody').innerHTML = rows.map((r) => rowHtml(r, rankOf.get(r.slug))).join('') ||
    '<tr><td colspan="7" class="muted">No protocols match these filters.</td></tr>';
  $('boardBody').querySelectorAll('tr[data-slug]').forEach((tr) =>
    tr.addEventListener('click', () => showDetail(tr.dataset.slug, true)));
  $('resultLine').textContent = 'Showing ' + rows.length + ' of ' + D.rows.length + ' pre-token protocols' +
    (state.status === 'live' || state.status === 'all' ? ' · ' + D.live.length + ' token trades below' : '');
  // While a detail panel is open the tables stay hidden behind it.
  const inDetail = !$('detail').hidden;
  $('boardWrap').hidden = inDetail || state.status === 'live';
  $('liveWrap').hidden = inDetail || (state.status !== 'live' && state.status !== 'all');
  $('setAsideWrap').hidden = inDetail || state.status === 'live';
  if (!inDetail && state.status !== 'live') renderSetAside();
  if (!inDetail && state.status !== 'pretoken') renderLive();
}

function renderSetAside() {
  $('setAsideBody').innerHTML = setAside.map((r) =>
    '<tr><td><span class="nm">' + esc(r.name) + '</span><br><span class="sl">' + esc(r.slug) + '</span></td>' +
    '<td class="cat">' + esc(r.category || 'Uncategorised') + '</td>' +
    '<td class="num">' + fmtUsd(r.tvl) + '</td>' +
    '<td class="muted">' + esc(r.reason) + '</td></tr>').join('');
}

function renderLive() {
  const live = D.live.slice().sort((a, b) => (b.mcap == null ? -1 : b.mcap) - (a.mcap == null ? -1 : a.mcap));
  $('liveBody').innerHTML = live.map((r) =>
    '<tr><td><span class="nm">' + esc(r.name) + '</span><br><span class="sl">' + esc(r.slug) + '</span></td>' +
    '<td class="cat">' + esc(r.category || 'Uncategorised') + '</td>' +
    '<td class="num">' + fmtUsd(r.tvl) + '</td>' +
    '<td class="num">' + fmtUsd(r.mcap) + '</td>' +
    '<td class="num">' + esc(r.symbol || '—') + '</td>' +
    '<td><span class="status live">TOKEN TRADES</span></td></tr>').join('');
}

// ---------------------------------------------------------------- detail
function chipFor(step) {
  // Every farm step ends in a parenthetical with its cost and time, which
  // the detail view lifts out as a chip. A trailing full stop is allowed.
  const m = step.match(/\(([^()]*)\)\.?\s*$/);
  return m ? { text: step.slice(0, m.index).trim(), chip: m[1] } : { text: step, chip: '' };
}

function showDetail(slug, push) {
  const r = bySlug.get(slug);
  if (!r) return;
  state.selected = slug;
  const rank = D.rows.indexOf(r) + 1;
  const steps = r.farmSteps.map((s) => {
    const c = chipFor(s);
    return '<li>' + esc(c.text) + (c.chip ? '<span class="chip">' + esc(c.chip) + '</span>' : '') + '</li>';
  }).join('');
  $('detail').innerHTML =
    '<button class="back" id="backBtn">← Back to the board</button>' +
    '<h2>' + esc(r.name) + (watchSet.has(slug) ? '<span class="badge">ON THE WATCHLIST</span>' : '') + '</h2>' +
    '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorised') + ' · ' +
    r.chains.map(esc).join(', ') + ' · rank ' + rank + ' of ' + D.rows.length + '</p>' +
    '<div class="big">' + fmtFull(r.implied) + ' <small>implied value</small></div>' +
    '<div class="factors-row">' +
    '<div class="factor"><div class="fl">TVL · BASE</div><div class="fv">' + fmtUsd(r.tvl) + '</div></div>' +
    '<div class="op">×</div>' +
    '<div class="factor"><div class="fl">7D GROWTH</div><div class="fv">' + fmtPct(r.change7d) + '</div><div class="fm">' + fmtMult(r.growthMult) + '</div></div>' +
    '<div class="op">×</div>' +
    '<div class="factor"><div class="fl">AGE</div><div class="fv">' + fmtAge(r.ageYears) + '</div><div class="fm">' + fmtMult(r.ageMult) + '</div></div>' +
    '<div class="op">×</div>' +
    '<div class="factor"><div class="fl">CHAINS</div><div class="fv">' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + '</div><div class="fm">' + fmtMult(r.chainMult) + '</div></div>' +
    '<div class="op">=</div>' +
    '<div class="factor result"><div class="fl">IMPLIED VALUE</div><div class="fv">' + fmtFull(r.implied) + '</div></div>' +
    '</div>' +
    '<p class="math">' + fmtUsd(r.tvl) + ' × ' + fmtMult(r.growthMult) + ' × ' + fmtMult(r.ageMult) + ' × ' + fmtMult(r.chainMult) + ' = ' + fmtFull(r.implied) + '</p>' +
    '<div class="statgrid">' +
    '<div><div class="sl">TVL</div><div class="sv">' + fmtFull(r.tvl) + '</div></div>' +
    '<div><div class="sl">7D CHANGE</div><div class="sv">' + fmtPct(r.change7d) + '</div></div>' +
    '<div><div class="sl">AGE</div><div class="sv">' + fmtAge(r.ageYears) + '</div></div>' +
    '<div><div class="sl">CHAINS</div><div class="sv">' + r.chains.length + '</div></div>' +
    '<div><div class="sl">STATUS</div><div class="sv">No token yet</div></div>' +
    '<div><div class="sl">WATCHLIST</div><div class="sv">' + (watchSet.has(slug) ? 'Yes' : 'No') + '</div></div>' +
    '</div>' +
    '<h2 style="margin-top:18px">HOW TO FARM IT</h2>' +
    '<ol class="steps">' + steps + '</ol>';
  $('detail').hidden = false;
  $('backBtn').addEventListener('click', () => showBoard(false));
  if (push) {
    history.replaceState(null, '', '?view=detail&slug=' + encodeURIComponent(slug));
    $('detail').scrollIntoView({ behavior: 'auto', block: 'start' });
  }
  renderBoard();
}

function showBoard(push) {
  state.selected = null;
  $('detail').hidden = true;
  $('scope').hidden = false;
  $('controls').hidden = false;
  $('boardWrap').hidden = state.status === 'live';
  $('liveWrap').hidden = state.status !== 'live' && state.status !== 'all';
  $('setAsideWrap').hidden = state.status === 'live';
  if (push) history.replaceState(null, '', location.pathname);
  renderBoard();
}

// ---------------------------------------------------------------- filters + deep links
function fillSelects() {
  const cat = $('fCategory');
  cat.innerHTML = '<option value="">All categories</option>' + categories.map((c) =>
    '<option value="' + esc(c) + '">' + esc(c) + ' (' + D.rows.filter((r) => r.category === c).length + ')</option>').join('');
  const ch = $('fChain');
  ch.innerHTML = '<option value="">All chains</option>' + chains.map((c) =>
    '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
}

function readStateFromUrl() {
  const p = new URLSearchParams(location.search);
  if (p.get('view') === 'detail' && p.get('slug')) return { view: 'detail', slug: p.get('slug') };
  if (p.get('view') === 'filtered') {
    state.category = p.get('category') || '';
    state.status = p.get('status') || 'pretoken';
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('q')) state.q = p.get('q');
    return { view: 'filtered' };
  }
  return { view: 'board' };
}

function syncFilterInputs() {
  $('q').value = state.q;
  $('fStatus').value = state.status;
  $('fCategory').value = state.category;
  $('fChain').value = state.chain;
  $('fTvl').value = String(state.minTvl);
  $('fSort').value = state.sort;
}

function bindFilters() {
  $('q').addEventListener('input', () => { state.q = $('q').value; renderBoard(); });
  $('fStatus').addEventListener('change', () => { state.status = $('fStatus').value; renderBoard(); });
  $('fCategory').addEventListener('change', () => { state.category = $('fCategory').value; renderBoard(); });
  $('fChain').addEventListener('change', () => { state.chain = $('fChain').value; renderBoard(); });
  $('fTvl').addEventListener('change', () => { state.minTvl = Number($('fTvl').value); renderBoard(); });
  $('fSort').addEventListener('change', () => { state.sort = $('fSort').value; renderBoard(); });
}

// ---------------------------------------------------------------- boot
if (!D || !Array.isArray(D.rows)) {
  document.body.innerHTML = '<p style="padding:40px">Radar Zero could not load its data (data.js missing).</p>';
} else {
  fillSelects();
  bindFilters();
  renderHeader();
  drawRadar();
  const deep = readStateFromUrl();
  syncFilterInputs();
  if (deep.view === 'detail') {
    $('scope').hidden = true;
    $('controls').hidden = true;
    showDetail(deep.slug, false);
  } else {
    if (deep.view === 'filtered') $('scope').hidden = true;
    renderBoard();
  }
}
