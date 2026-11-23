// Radar Zero, round 3 — the dashboard. One static page, no network: it reads
// the board its program wrote (window.RADAR) and renders four views from it:
// the board, a protocol's detail, a filtered table, and the top-10 spotlight.
// Views are picked by the query string, so every view has its own link.

var D = window.RADAR;
var params = new URLSearchParams(location.search);

/** Escape text for HTML. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** $2.75B, $376.0M, $51.1M. */
function abbr(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
}

/** $3,935,886,348. */
function full(n) {
  return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** +8.3% or -2.2%, with the sign. */
function pct(n) {
  if (n == null) return 'n/a';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

/** 1.5 years, 2 months, 1 month. */
function ageText(years) {
  if (years == null || years <= 0) return 'no start date on record';
  if (years < 1) {
    var m = Math.max(1, Math.round(years * 12));
    return m + (m === 1 ? ' month' : ' months');
  }
  return years.toFixed(1) + ' years';
}

/** The model's three multipliers and the implied value, from a row's raw figures. */
function recompute(row) {
  var g = row.change_7d == null ? 0 : Math.min(150, Math.max(-40, row.change_7d));
  var growth = 1 + g / 100;
  var age = 1 + 0.12 * Math.min(row.age_years, 4);
  var chains = 1 + 0.04 * Math.min(row.chain_count, 6);
  return Math.round(row.tvl_usd * growth * age * chains);
}

/** The four factor strengths of a row, each 0..1 across the board. */
var FACTORS = (function () {
  var rows = D.ranked;
  function range(get) {
    var lo = Infinity, hi = -Infinity;
    rows.forEach(function (r) { var v = get(r); if (v < lo) lo = v; if (v > hi) hi = v; });
    return { lo: lo, hi: hi };
  }
  return {
    growth: range(function (r) { return r.growth_mult; }),
    age: range(function (r) { return r.age_mult; }),
    chains: range(function (r) { return r.chain_mult; }),
    tvl: range(function (r) { return Math.log(r.tvl_usd); }),
  };
})();

function strength(range, v) {
  if (range.hi <= range.lo) return 0.5;
  return Math.max(0.05, Math.min(1, (v - range.lo) / (range.hi - range.lo)));
}

/** Four mini-bars: growth, age, chains, TVL. The strongest factor is amber.
    Compact cards drop the key line, since it repeats on every card. */
function factorBars(row, compact) {
  var vals = [
    strength(FACTORS.growth, row.growth_mult),
    strength(FACTORS.age, row.age_mult),
    strength(FACTORS.chains, row.chain_mult),
    strength(FACTORS.tvl, Math.log(row.tvl_usd)),
  ];
  var hot = 0;
  vals.forEach(function (v, i) { if (v > vals[hot]) hot = i; });
  var bars = vals.map(function (v, i) {
    return '<i class="' + (i === hot ? 'hot' : '') + '" style="height:' + Math.round(4 + v * 18) + 'px"></i>';
  }).join('');
  var key = compact ? '' : '<div class="fbar-key">growth &middot; age &middot; chains &middot; TVL</div>';
  return '<div class="fbars">' + bars + '</div>' + key;
}

/** Split a farm step into its action, its cost and its time. */
function splitStep(step) {
  var parts = step.split(' Cost: ');
  var action = parts[0] || step;
  var rest = (parts[1] || '').split(' Time: ');
  return { action: action, cost: rest[0] || '', time: (rest[1] || '').replace(/\.$/, '') };
}

/** One farm step as HTML, with cost and time chips. */
function stepHtml(step, i) {
  var s = splitStep(step);
  return '<li><span class="n">' + (i + 1) + '</span><span class="t">' + esc(s.action) +
    '<span class="chips"><span class="chip">' + esc(s.cost) + '</span>' +
    '<span class="chip time">' + esc(s.time) + '</span></span></span></li>';
}

/** The page header. Compact on the spotlight view so all ten cards fit one screen. */
function headerHtml(compact) {
  return '<header class="top' + (compact ? ' compact' : '') + '"><div class="brand"><div class="mark"></div><div>' +
    '<h1>Radar Zero</h1><p>Every launch candidate, ranked by implied value.</p></div></div>' +
    '<div class="meta">Snapshot ' + esc(D.as_of) + ' &middot; Source DefiLlama<br>' +
    D.ranked.length + ' launch candidates</div></header>';
}

/** The model strip: the formula, the four factors, the worked example. */
function modelHtml() {
  var top = D.ranked[0];
  return '<section class="panel"><h2>How the value is worked out</h2>' +
    '<div class="formula">Implied value = TVL &times; growth &times; age &times; chains</div>' +
    '<div class="factors"><div><b>Growth</b> &mdash; 1 + the 7-day TVL change, clamped to &minus;40% &hellip; +150%. No change reported counts as 1.</div>' +
    '<div><b>Age</b> &mdash; 1 + 0.12 &times; years tracked, up to 4 years. No start date on record counts as 0 years.</div>' +
    '<div><b>Chains</b> &mdash; 1 + 0.04 &times; chains live, up to 6. More chains, more reach.</div>' +
    '<div><b>TVL</b> &mdash; the base. Total value locked, as the snapshot reports it.</div></div>' +
    '<div class="worked">Worked example &mdash; ' + esc(top.name) + ': ' + abbr(top.tvl_usd) + ' TVL &times; ' +
    top.growth_mult.toFixed(2) + ' growth &times; ' + top.age_mult.toFixed(2) + ' age &times; ' +
    top.chain_mult.toFixed(2) + ' chains = ' + abbr(top.implied_value_usd) + ' implied.</div>' +
    '<p class="fine">The implied value is this radar&rsquo;s own claim: what the token would be worth if the protocol&rsquo;s record stayed as it is. It is not a price, a prediction or investment advice. Every figure comes from the snapshot alone; no name list, no outside data.</p></section>';
}

/** The four stat cards. */
function statsHtml() {
  return '<section class="stats">' +
    '<div class="stat"><div class="v">' + D.ranked.length + '</div><div class="k">Launch candidates</div></div>' +
    '<div class="stat"><div class="v">' + abbr(D.total_implied_usd) + '</div><div class="k">Total implied value</div></div>' +
    '<div class="stat"><div class="v">' + D.set_aside.length + '</div><div class="k">Set aside</div></div>' +
    '<div class="stat"><div class="v">' + D.token_trading.length + '</div><div class="k">Token already trading</div></div></section>';
}

/** One breakdown bar row. */
function breakdownRows(bars, max) {
  return bars.slice(0, 8).map(function (b) {
    return '<div class="bar-row"><span>' + esc(b.name) + '</span>' +
      '<span class="bar-track"><span class="bar-fill" style="display:block;width:' + Math.round(100 * b.implied_usd / max) + '%"></span></span>' +
      '<span class="n green">' + abbr(b.implied_usd) + '</span><span class="c">' + b.count + ' protocol' + (b.count === 1 ? '' : 's') + '</span></div>';
  }).join('');
}

/** The radar plot and the two breakdowns. */
function plotHtml() {
  var chainMax = D.chains.length ? D.chains[0].implied_usd : 1;
  var catMax = D.categories.length ? D.categories[0].implied_usd : 1;
  var top8 = D.ranked.slice(0, 8).map(function (r) { return r.rank + ' ' + r.name; }).join(' &middot; ');
  return '<section class="split"><div class="panel"><h2>Radar plot</h2>' +
    '<p class="muted">Each dot is a launch candidate: distance is implied value, angle is age. The green ring marks the top 10.</p>' +
    '<canvas class="radar" id="radar"></canvas>' +
    '<p class="caption">Distance is implied value on a log scale; angle is age, youngest at the top and oldest to the left. The six largest names are labelled on the plot; the top 8 are: ' + esc(top8) + '.</p></div>' +
    '<div class="panel"><h2>Where the value sits</h2>' +
    '<div class="bar-head">By chain</div>' + breakdownRows(D.chains, chainMax) +
    '<div class="bar-head">By category</div>' + breakdownRows(D.categories, catMax) +
    '</div></section>';
}

/** Draw the radar plot: dots by implied value and age, top-10 ring, top names labelled. */
function drawRadar() {
  var c = document.getElementById('radar');
  if (!c) return;
  var w = c.clientWidth || 560, h = 240;
  c.width = w; c.height = h;
  var ctx = c.getContext('2d');
  var cx = w / 2, cy = h / 2 + 6, R = Math.min(w, h) / 2 - 26;
  var rows = D.ranked;
  var lo = Math.log(rows[rows.length - 1].implied_value_usd);
  var hi = Math.log(rows[0].implied_value_usd);
  function radius(v) { return R * (0.08 + 0.92 * (Math.log(v) - lo) / (hi - lo)); }
  // Age sweeps 270 degrees from the top: youngest at the top, oldest to the left.
  function angle(r) { return -Math.PI / 2 + (Math.min(r.age_years, 4) / 4) * Math.PI * 1.5; }
  function point(r) {
    var a = angle(r);
    var rad = radius(r.implied_value_usd);
    return { x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) };
  }
  ctx.strokeStyle = '#1e2a45'; ctx.lineWidth = 1;
  [0.33, 0.66, 1].forEach(function (f) {
    ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); ctx.stroke();
  });
  var top10 = radius(rows[9].implied_value_usd);
  ctx.strokeStyle = '#2bff9e'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, top10, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#2bff9e'; ctx.font = '11px sans-serif';
  ctx.fillText('top 10', cx + 4, cy - top10 - 4);
  rows.forEach(function (r) {
    var p = point(r);
    ctx.fillStyle = r.rank <= 10 ? '#ffb000' : '#2bff9e';
    ctx.globalAlpha = r.rank <= 10 ? 1 : 0.45;
    ctx.beginPath(); ctx.arc(p.x, p.y, r.rank <= 10 ? 4 : 2.5, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
  // Label the six largest by name, pushed apart so no two labels overlap.
  var labels = rows.slice(0, 6).map(function (r) {
    var p = point(r);
    var a = angle(r);
    return {
      dot: p,
      x: p.x + Math.cos(a) * 12,
      y: p.y + Math.sin(a) * 12,
      text: r.rank + ' · ' + r.name,
    };
  });
  labels.sort(function (a, b) { return a.y - b.y; });
  for (var i = 1; i < labels.length; i++) {
    if (labels[i].y < labels[i - 1].y + 15) labels[i].y = labels[i - 1].y + 15;
  }
  ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle';
  labels.forEach(function (L) {
    var tw = ctx.measureText(L.text).width;
    var right = L.dot.x >= cx;
    var tx = right ? L.x : L.x - tw;
    tx = Math.max(4, Math.min(w - tw - 4, tx));
    ctx.strokeStyle = '#33507e'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L.dot.x, L.dot.y);
    ctx.lineTo(right ? tx : tx + tw, L.y);
    ctx.stroke();
    ctx.fillStyle = '#dbe4f5';
    ctx.fillText(L.text, tx, L.y);
  });
}

/** One ranked row of the board table. */
function boardRowHtml(r) {
  var change = r.change_7d == null ? '<span class="muted">n/a</span>' :
    '<span class="' + (r.change_7d >= 0 ? 'green' : 'red') + ' num">' + pct(r.change_7d) + '</span>';
  return '<tr class="' + (r.rank <= 10 ? 'top10' : '') + '"><td class="rank">#' + r.rank + '</td>' +
    '<td><a href="?view=detail&slug=' + encodeURIComponent(r.slug) + '">' + esc(r.name) + '</a><br><span class="slug">' + esc(r.slug) + '</span></td>' +
    '<td>' + esc(r.category || '—') + '</td><td>' + esc(r.chain) + '</td>' +
    '<td class="num">' + abbr(r.tvl_usd) + '</td><td>' + change + '</td>' +
    '<td>' + ageText(r.age_years) + '</td><td class="num green">' + abbr(r.implied_value_usd) + '</td>' +
    '<td>' + factorBars(r) + '</td></tr>';
}

/** The filter bar above the board table. */
function filtersHtml(state) {
  var cats = [];
  D.ranked.forEach(function (r) { if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category); });
  cats.sort();
  var opts = cats.map(function (c) {
    return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('');
  return '<div class="filters"><input id="q" type="search" placeholder="Search a protocol&hellip;" value="' + esc(state.q) + '">' +
    '<select id="fcat"><option value="">All categories</option>' + opts + '</select>' +
    '<select id="fstatus"><option value="ranked"' + (state.status === 'ranked' ? ' selected' : '') + '>Pre-token, ranked</option>' +
    '<option value="set-aside"' + (state.status === 'set-aside' ? ' selected' : '') + '>Set aside</option>' +
    '<option value="trading"' + (state.status === 'trading' ? ' selected' : '') + '>Token already trading</option></select>' +
    '<select id="fsort"><option value="rank"' + (state.sort === 'rank' ? ' selected' : '') + '>Sort: rank</option>' +
    '<option value="tvl"' + (state.sort === 'tvl' ? ' selected' : '') + '>Sort: TVL</option>' +
    '<option value="change"' + (state.sort === 'change' ? ' selected' : '') + '>Sort: 7-day change</option>' +
    '<option value="age"' + (state.sort === 'age' ? ' selected' : '') + '>Sort: age</option></select>' +
    '<span class="count" id="count"></span></div>';
}

/** Apply the filter state to the ranked rows. */
function applyFilters(state) {
  var rows = D.ranked.slice();
  if (state.category) rows = rows.filter(function (r) { return r.category === state.category; });
  if (state.q) {
    var q = state.q.toLowerCase();
    rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) !== -1 || r.slug.indexOf(q) !== -1; });
  }
  if (state.sort === 'tvl') rows.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
  else if (state.sort === 'change') rows.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
  else if (state.sort === 'age') rows.sort(function (a, b) { return b.age_years - a.age_years; });
  return rows;
}

/** The set-aside table: reason and would-be value for every set-aside protocol. */
function setAsideHtml() {
  var rows = D.set_aside.map(function (r) {
    return '<tr><td><a href="?view=detail&slug=' + encodeURIComponent(r.slug) + '">' + esc(r.name) + '</a><br><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td><td>' + esc(r.chain) + '</td>' +
      '<td class="num">' + abbr(r.tvl_usd) + '</td><td>' + esc(r.reason) + '</td>' +
      '<td class="num">' + abbr(r.would_be_usd) + ' <span class="pill">not ranked</span></td></tr>';
  }).join('');
  return '<section class="panel"><h2>Set aside &mdash; ' + D.set_aside.length + ' protocols</h2>' +
    '<p class="muted">These records show no token of their own, but the house rule keeps them off the launch board: a centralised exchange, a bridge, or a wrapped, staked or restaked product of a token that already trades, or a version fork of another protocol. The last column shows the value each would have had under the same model &mdash; the rule was applied, not just asserted. A version fork is a name ending in V1 to V9, v, or a 2.0-style number.</p>' +
    '<table class="board"><thead><tr><th>Protocol</th><th>Category</th><th>Chain</th><th>TVL</th><th>Reason</th><th>Would-be implied</th></tr></thead><tbody>' + rows + '</tbody></table></section>';
}

/** The token-trading table, capped at the 60 largest by market cap. */
function tradingHtml() {
  var rows = D.token_trading.slice(0, 60).map(function (r) {
    var change = r.change_7d == null ? '<span class="muted">n/a</span>' :
      '<span class="' + (r.change_7d >= 0 ? 'green' : 'red') + ' num">' + pct(r.change_7d) + '</span>';
    return '<tr><td>' + esc(r.name) + '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td><td>' + esc(r.chain) + '</td>' +
      '<td class="num">' + abbr(r.tvl_usd) + '</td><td class="num">' + (r.mcap_usd == null ? 'n/a' : abbr(r.mcap_usd)) + '</td>' +
      '<td>' + change + '</td></tr>';
  }).join('');
  return '<section class="panel"><h2>Token already trading &mdash; ' + D.token_trading.length + ' protocols</h2>' +
    '<p class="muted">These protocols record a token that already trades, so the board shows the market&rsquo;s own value for them, never a model&rsquo;s. Showing the 60 largest by market cap.</p>' +
    '<table class="board"><thead><tr><th>Protocol</th><th>Category</th><th>Chain</th><th>TVL</th><th>Market cap</th><th>7d</th></tr></thead><tbody>' + rows + '</tbody></table></section>';
}

/** The board view. */
function renderBoard() {
  var state = {
    q: params.get('q') || '',
    category: params.get('category') || '',
    status: params.get('status') || 'ranked',
    sort: params.get('sort') || 'rank',
  };
  var app = document.getElementById('app');
  app.innerHTML = headerHtml(false) + modelHtml() + statsHtml() + plotHtml() +
    '<section class="panel"><h2>Launch candidates</h2>' + filtersHtml(state) +
    '<div id="tablewrap"></div></section>' + setAsideHtml() + tradingHtml();
  drawRadar();
  function renderTable() {
    var rows = applyFilters(state);
    var el = document.getElementById('count');
    if (el) el.textContent = rows.length + ' of ' + D.ranked.length + ' shown';
    document.getElementById('tablewrap').innerHTML =
      '<table class="board"><thead><tr><th>Rank</th><th>Protocol</th><th>Category</th><th>Chain</th><th>TVL</th><th>7d</th><th>Age</th><th>Implied</th><th>Why it ranks here</th></tr></thead><tbody>' +
      rows.map(boardRowHtml).join('') + '</tbody></table>';
  }
  renderTable();
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderTable(); });
  document.getElementById('fcat').addEventListener('change', function (e) { state.category = e.target.value; renderTable(); });
  document.getElementById('fstatus').addEventListener('change', function (e) {
    state.status = e.target.value;
    if (state.status !== 'ranked') {
      var q = state.status === 'set-aside' ? 'set-aside' : 'trading';
      location.search = '?view=' + q;
    }
  });
  document.getElementById('fsort').addEventListener('change', function (e) { state.sort = e.target.value; renderTable(); });
}

/** One protocol's detail view, with its farm plan and the recompute line. */
function renderDetail() {
  var slug = params.get('slug') || '';
  var row = null;
  D.ranked.forEach(function (r) { if (r.slug === slug) row = r; });
  var app = document.getElementById('app');
  if (!row) {
    app.innerHTML = headerHtml(false) + '<section class="panel"><h2>Not on the board</h2>' +
      '<p>No launch candidate matches that link. It may be set aside or already trading &mdash; both tables are on the board.</p>' +
      '<p><a href="?view=board">&larr; Back to the board</a></p></section>';
    return;
  }
  var change = row.change_7d == null ? 'no 7-day change reported' :
    (row.change_7d >= 0 ? 'up ' : 'down ') + Math.abs(row.change_7d).toFixed(1) + '% in 7 days';
  var again = recompute(row);
  var match = again === row.implied_value_usd ? 'matches the board' : 'differs from the board';
  app.innerHTML = headerHtml(false) +
    '<section class="panel"><div class="detail-head"><h2>' + esc(row.name) + '</h2>' +
    '<span class="implied">#' + row.rank + ' &middot; ' + abbr(row.implied_value_usd) + ' implied</span></div>' +
    '<div class="justify">Rank ' + row.rank + ' of the launch candidates: ' + abbr(row.implied_value_usd) + ' implied from ' +
    abbr(row.tvl_usd) + ' of TVL, ' + change + ', tracked for ' + ageText(row.age_years) + '.</div>' +
    '<div class="recompute">Recomputed in your browser from the snapshot figures: ' + full(again) + ' &mdash; ' + match + '.</div>' +
    '<div class="factor-boxes">' +
    '<div class="fbox"><div class="k">TVL</div><div class="v">' + abbr(row.tvl_usd) + '</div><div class="d">The base. Total value locked.</div></div>' +
    '<div class="fbox"><div class="k">Growth</div><div class="v">&times;' + row.growth_mult.toFixed(2) + '</div><div class="d">From a 7-day change of ' + pct(row.change_7d) + '.</div></div>' +
    '<div class="fbox"><div class="k">Age</div><div class="v">&times;' + row.age_mult.toFixed(2) + '</div><div class="d">Tracked for ' + ageText(row.age_years) + '.</div></div>' +
    '<div class="fbox"><div class="k">Chains</div><div class="v">&times;' + row.chain_mult.toFixed(2) + '</div><div class="d">' + row.chain_count + ' chain' + (row.chain_count === 1 ? '' : 's') + ' live.</div></div></div>' +
    '<h3>Farm plan &mdash; five steps</h3><ol class="steps">' +
    row.farm_steps.map(stepHtml).join('') + '</ol>' +
    '<p class="fine">Costs are rough gas estimates for the protocol&rsquo;s main chain. The plan is a starting point, not advice; check the protocol&rsquo;s own docs before moving money.</p></section>' +
    '<p class="back"><a href="?view=board">&larr; Back to the board</a> &middot; <a href="?view=spotlight">Top 10 spotlight &rarr;</a></p>' +
    setAsideHtml();
}

/** A filtered table view, driven by the query string. */
function renderFiltered() {
  var category = params.get('category') || '';
  var state = { q: '', category: category, status: 'ranked', sort: 'rank' };
  var rows = applyFilters(state);
  var app = document.getElementById('app');
  app.innerHTML = headerHtml(false) +
    '<section class="panel"><h2>' + (category ? esc(category) + ' &mdash; ' : '') + 'pre-token launch candidates</h2>' +
    '<p class="muted">' + rows.length + ' protocols' + (category ? ' in ' + esc(category) : '') + ', ranked by implied value.</p>' +
    '<table class="board"><thead><tr><th>Rank</th><th>Protocol</th><th>Category</th><th>Chain</th><th>TVL</th><th>7d</th><th>Age</th><th>Implied</th><th>Why it ranks here</th></tr></thead><tbody>' +
    rows.map(boardRowHtml).join('') + '</tbody></table></section>' +
    '<p class="back"><a href="?view=board">&larr; Back to the board</a></p>';
}

/** The top-10 spotlight: the paid places, each with its factors and first step.
    The card shows the protocol's own action step (the second farm step), not
    the setup step every plan shares. */
function renderSpotlight() {
  var top = D.ranked.slice(0, 10);
  var cards = top.map(function (r) {
    var s = splitStep(r.farm_steps[1]);
    return '<div class="spot' + (r.rank === 1 ? ' first' : '') + '">' +
      '<div class="s-head"><span><span class="s-rank">#' + r.rank + '</span> <span class="s-name">' + esc(r.name) + '</span></span>' +
      '<span class="s-implied">' + abbr(r.implied_value_usd) + ' implied</span></div>' +
      factorBars(r, true) +
      '<div class="s-step">' + esc(s.action) + '</div>' +
      '<span class="chips"><span class="chip">' + esc(s.cost) + '</span><span class="chip time">' + esc(s.time) + '</span></span></div>';
  }).join('');
  var app = document.getElementById('app');
  app.innerHTML = headerHtml(true) +
    '<section class="panel"><h2>Top 10 &mdash; the paid places</h2>' +
    '<p class="muted">The final pays the top 10 &mdash; each card shows the factor breakdown and the first farm step. The amber bar is the factor doing the most work.</p>' +
    '<div class="spot-grid">' + cards + '</div>' +
    '<p class="note">Full farm plans and factor boxes for each protocol are on its detail page &mdash; pick any name above. <a href="?view=board">&larr; Back to the board</a></p></section>';
}

var view = params.get('view') || 'board';
if (view === 'detail') renderDetail();
else if (view === 'filtered') renderFiltered();
else if (view === 'spotlight') renderSpotlight();
else renderBoard();
