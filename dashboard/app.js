// Radar Zero — dashboard logic. No network: every byte it shows comes from
// data.js, which main.ts writes from the snapshot. The page also recomputes
// each row's implied value from the snapshot's own figures and says whether
// the recomputation matches the board, so code and data can be checked
// against each other in the open.

(function () {
  'use strict';

  var DATA = window.RADAR || null;
  var boardEl = document.getElementById('board-body');
  var boardTable = document.getElementById('board');

  function money(value) {
    if (value >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
    if (value >= 1e3) return '$' + (value / 1e3).toFixed(1) + 'K';
    return '$' + String(Math.round(value));
  }

  function dollars(value) {
    return '$' + String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function mult(value) {
    return 'x' + value.toFixed(2);
  }

  function ageText(years) {
    if (years < 1) {
      var months = Math.max(1, Math.round(years * 12));
      return months === 1 ? '1 mo' : months + ' mo';
    }
    var rounded = Math.round(years * 10) / 10;
    return rounded === 1 ? '1 yr' : rounded + ' yr';
  }

  function ageLong(years) {
    if (years < 1) {
      var months = Math.max(1, Math.round(years * 12));
      return months === 1 ? '1 month' : months + ' months';
    }
    var rounded = Math.round(years * 10) / 10;
    return rounded === 1 ? '1 year' : rounded + ' years';
  }

  function pct(change) {
    if (change === null || change === undefined) return '—';
    var sign = change > 0 ? '+' : '';
    return sign + change.toFixed(1) + '%';
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // The model, recomputed here from the raw snapshot figures so the page
  // can check the board's arithmetic instead of trusting it.
  function impliedOf(row) {
    var growth =
      row.change_7d === null || row.change_7d === undefined
        ? 1
        : 1 + Math.max(-40, Math.min(150, row.change_7d)) / 100;
    var years = row.age_years;
    var age = 1 + 0.12 * Math.min(years, 4);
    var chains = 1 + 0.04 * Math.min(row.chains, 6);
    return Math.round(row.tvl_usd * growth * age * chains);
  }

  function rankLine(row) {
    var growth =
      row.change_7d === null || row.change_7d === undefined
        ? 'no 7-day change reported'
        : row.change_7d > 0
          ? 'up ' + Math.abs(row.change_7d).toFixed(1) + '% in 7 days'
          : row.change_7d < 0
            ? 'down ' + Math.abs(row.change_7d).toFixed(1) + '% in 7 days'
            : 'flat over 7 days';
    var age =
      row.listed_at === null
        ? 'no start date recorded'
        : 'tracked for ' + ageLong(row.age_years);
    return (
      'Rank ' +
      row.rank +
      ' of the launch candidates: ' +
      money(row.implied_value_usd) +
      ' implied from ' +
      money(row.tvl_usd) +
      ' of TVL, ' +
      growth +
      ', ' +
      age +
      '.'
    );
  }

  if (!DATA) {
    boardEl.appendChild(
      el('tr', null, 'No data loaded: data.js is missing.'),
    );
    return;
  }

  var ranked = DATA.ranked;
  var setAside = DATA.setAside;
  var tokenTrading = DATA.tokenTrading;
  var maxTvl = ranked.reduce(function (m, r) {
    return Math.max(m, r.tvl_usd);
  }, 0);

  // ------------------------------------------------------------ header data

  document.getElementById('stat-ranked').textContent = String(ranked.length);
  document.getElementById('stat-implied').textContent = money(
    DATA.totalImplied,
  );
  document.getElementById('stat-setaside').textContent = String(
    setAside.length,
  );
  document.getElementById('stat-token').textContent = String(
    tokenTrading.length,
  );
  document.getElementById('meta-counts').textContent =
    ranked.length + ' launch candidates';

  var top = ranked[0];
  if (top) {
    document.getElementById('worked-example').textContent =
      'Worked example — ' +
      top.name +
      ': ' +
      money(top.tvl_usd) +
      ' TVL × ' +
      mult(top.growth_mult) +
      ' growth × ' +
      mult(top.age_mult) +
      ' age × ' +
      mult(top.chain_mult) +
      ' chains = ' +
      money(top.implied_value_usd) +
      ' implied.';
  }

  // ------------------------------------------------------------ breakdowns

  function renderBreakdown(listEl, entries) {
    var max = entries.reduce(function (m, e) {
      return Math.max(m, e.total);
    }, 0);
    entries.forEach(function (entry) {
      var li = el('li');
      var row = el('div', 'bar-row');
      row.appendChild(el('span', null, entry.key));
      var right = el('span');
      right.appendChild(el('b', null, money(entry.total)));
      right.appendChild(
        document.createTextNode('  '),
      );
      right.appendChild(el('span', 'count', entry.count + ' protocols'));
      row.appendChild(right);
      li.appendChild(row);
      var track = el('div', 'bar-track');
      var fill = el('div', 'bar-fill');
      fill.style.width = Math.max(2, (entry.total / max) * 100) + '%';
      track.appendChild(fill);
      li.appendChild(track);
      listEl.appendChild(li);
    });
  }

  renderBreakdown(
    document.getElementById('breakdown-chains'),
    DATA.chains,
  );
  renderBreakdown(
    document.getElementById('breakdown-categories'),
    DATA.categories,
  );

  // ------------------------------------------------------------ radar plot

  function drawRadar() {
    var canvas = document.getElementById('radar');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var W = canvas.width;
    var H = canvas.height;
    var cx = W / 2;
    var cy = H / 2;
    var maxR = 235;
    var values = ranked.map(function (r) {
      return r.implied_value_usd;
    });
    var minLog = Math.log10(Math.min.apply(null, values));
    var maxLog = Math.log10(Math.max.apply(null, values));
    var tenth = ranked[9] ? ranked[9].implied_value_usd : values[0];

    function radiusOf(value) {
      var t = (Math.log10(value) - minLog) / (maxLog - minLog || 1);
      return 34 + t * (maxR - 34);
    }

    ctx.clearRect(0, 0, W, H);
    // Rings.
    ctx.strokeStyle = '#1e2a44';
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * f, 0, Math.PI * 2);
      ctx.stroke();
    });
    // Cross hairs.
    ctx.beginPath();
    ctx.moveTo(cx - maxR, cy);
    ctx.lineTo(cx + maxR, cy);
    ctx.moveTo(cx, cy - maxR);
    ctx.lineTo(cx, cy + maxR);
    ctx.stroke();
    // The top-10 ring: everything inside it is a money place.
    ctx.strokeStyle = '#2bff9e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radiusOf(tenth), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#2bff9e';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('top 10', cx + 6, cy - radiusOf(tenth) + 14);
    // Sweep line, like the brand mark.
    ctx.strokeStyle = 'rgba(43, 255, 158, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + maxR * 0.9, cy - maxR * 0.45);
    ctx.stroke();
    // Dots: angle is age (a full turn is four years), distance is implied.
    ranked.forEach(function (row) {
      var angle = -Math.PI / 2 + (Math.min(row.age_years, 4) / 4) * Math.PI * 2;
      var r = radiusOf(row.implied_value_usd);
      var x = cx + r * Math.cos(angle);
      var y = cy + r * Math.sin(angle);
      ctx.beginPath();
      ctx.arc(x, y, row.rank <= 10 ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = row.rank <= 10 ? '#2bff9e' : '#3f6ea5';
      ctx.fill();
    });
    // Label the leader.
    if (top) {
      var a0 = -Math.PI / 2 + (Math.min(top.age_years, 4) / 4) * Math.PI * 2;
      var r0 = radiusOf(top.implied_value_usd);
      ctx.fillStyle = '#d7e3f4';
      ctx.font = 'bold 13px ui-monospace, monospace';
      ctx.fillText(
        '#1 ' + top.name,
        Math.min(cx + r0 * Math.cos(a0) + 10, W - 180),
        Math.max(cy + r0 * Math.sin(a0) - 10, 16),
      );
    }
  }

  drawRadar();

  // ------------------------------------------------------------ board table

  var qInput = document.getElementById('q');
  var catSelect = document.getElementById('category');
  var statusSelect = document.getElementById('status');
  var sortSelect = document.getElementById('sort');
  var countEl = document.getElementById('result-count');

  var categories = Array.from(
    new Set(ranked.map(function (r) {
      return r.category || 'Uncategorised';
    })),
  ).sort();
  categories.forEach(function (cat) {
    var opt = el('option', null, cat);
    opt.value = cat;
    catSelect.appendChild(opt);
  });

  function factorBars(row) {
    var wrap = el('div', 'mini-bars');
    var norms = [
      (row.growth_mult - 0.6) / 1.9,
      (row.age_mult - 1) / 0.48,
      (row.chain_mult - 1) / 0.24,
      row.tvl_usd / maxTvl,
    ];
    var hottest = 0;
    norms.forEach(function (n, i) {
      if (n > norms[hottest]) hottest = i;
    });
    norms.forEach(function (n, i) {
      var bar = el('i');
      bar.style.width = Math.max(8, Math.min(100, n * 100)) + '%';
      if (i === hottest) bar.className = 'hot on';
      else if (n > 0.02) bar.className = 'on';
      wrap.appendChild(bar);
    });
    return wrap;
  }

  function changeCell(change) {
    var td = el('td', 'num');
    if (change === null || change === undefined) {
      td.textContent = '—';
      td.classList.add('change-flat');
    } else if (change > 0) {
      td.textContent = pct(change);
      td.classList.add('change-up');
    } else if (change < 0) {
      td.textContent = pct(change);
      td.classList.add('change-down');
    } else {
      td.textContent = '0.0%';
      td.classList.add('change-flat');
    }
    return td;
  }

  function renderBoard() {
    var status = statusSelect.value;
    var q = qInput.value.trim().toLowerCase();
    var cat = catSelect.value;
    var sort = sortSelect.value;
    var head = boardTable.querySelector('thead tr');
    var rows;
    var columns;

    if (status === 'setaside') {
      rows = setAside.slice();
      columns = 'setaside';
    } else if (status === 'token') {
      rows = tokenTrading.slice();
      columns = 'token';
    } else {
      rows = ranked.slice();
      columns = 'ranked';
    }

    if (q) {
      rows = rows.filter(function (r) {
        return (
          r.name.toLowerCase().indexOf(q) !== -1 ||
          r.slug.toLowerCase().indexOf(q) !== -1
        );
      });
    }
    if (cat && columns === 'ranked') {
      rows = rows.filter(function (r) {
        return (r.category || 'Uncategorised') === cat;
      });
    }

    rows.sort(function (a, b) {
      if (sort === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (sort === 'growth') {
        var ga = a.change_7d === null ? -Infinity : a.change_7d;
        var gb = b.change_7d === null ? -Infinity : b.change_7d;
        return gb - ga;
      }
      if (sort === 'age') {
        var aa = a.age_years === undefined ? -1 : a.age_years;
        var ab = b.age_years === undefined ? -1 : b.age_years;
        return ab - aa;
      }
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (columns === 'ranked') return a.rank - b.rank;
      return b.tvl_usd - a.tvl_usd;
    });

    head.innerHTML = '';
    var headers =
      columns === 'ranked'
        ? ['Rank', 'Protocol', 'Category', 'Chain', 'TVL', '7d', 'Age', 'Implied', 'Why it ranks here']
        : columns === 'setaside'
          ? ['Protocol', 'Category', 'TVL', 'Reason']
          : ['Protocol', 'Category', 'TVL', '7d', 'Chains'];
    headers.forEach(function (h) {
      var th = el('th', null, h);
      if (h === 'Rank' || h === 'TVL' || h === '7d' || h === 'Age' || h === 'Implied' || h === 'Chains') th.className = 'num';
      if (h === 'Why it ranks here') th.className = 'factors-col';
      head.appendChild(th);
    });

    boardEl.innerHTML = '';
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      if (columns === 'ranked') {
        tr.tabIndex = 0;
        tr.dataset.slug = row.slug;
        if (row.rank <= 10) tr.classList.add('top10');
        var rankTd = el('td', 'num rank-cell', '#' + row.rank);
        tr.appendChild(rankTd);
        var nameTd = el('td', 'name-cell');
        nameTd.appendChild(document.createTextNode(row.name));
        nameTd.appendChild(el('span', 'slug', row.slug));
        tr.appendChild(nameTd);
        tr.appendChild(el('td', 'cat', row.category || '—'));
        tr.appendChild(el('td', null, row.chain));
        tr.appendChild(el('td', 'num', money(row.tvl_usd)));
        tr.appendChild(changeCell(row.change_7d));
        tr.appendChild(el('td', 'num', ageText(row.age_years)));
        tr.appendChild(el('td', 'num', money(row.implied_value_usd)));
        var fTd = el('td', 'factors-col');
        fTd.appendChild(factorBars(row));
        fTd.appendChild(
          el('div', 'factor-legend', 'growth · age · chains · TVL'),
        );
        tr.appendChild(fTd);
        tr.addEventListener('click', function () {
          openDetail(row.slug);
        });
        tr.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            openDetail(row.slug);
          }
        });
      } else if (columns === 'setaside') {
        tr.className = 'plain';
        tr.appendChild(el('td', 'name-cell', row.name));
        tr.appendChild(el('td', 'cat', row.category || '—'));
        tr.appendChild(el('td', 'num', money(row.tvl_usd)));
        tr.appendChild(el('td', 'reason', row.reason));
      } else {
        tr.className = 'plain';
        tr.appendChild(el('td', 'name-cell', row.name));
        tr.appendChild(el('td', 'cat', row.category || '—'));
        tr.appendChild(el('td', 'num', money(row.tvl_usd)));
        tr.appendChild(changeCell(row.change_7d));
        tr.appendChild(el('td', 'num', String(row.chains)));
      }
      boardEl.appendChild(tr);
    });

    countEl.textContent =
      rows.length +
      ' of ' +
      (columns === 'ranked'
        ? ranked.length
        : columns === 'setaside'
          ? setAside.length
          : tokenTrading.length) +
      ' shown';
  }

  // ------------------------------------------------------------ detail

  var detailEl = document.getElementById('detail');

  function splitChips(step) {
    // Steps end with "(cost, duration)." — the full stop follows the bracket.
    var match = step.match(/^(.*)\(([^()]*)\)\.?\s*$/);
    if (!match) return { text: step, cost: null, time: null };
    var inner = match[2];
    var parts = inner.split(', ');
    var time = parts.length > 1 ? parts[parts.length - 1] : null;
    var cost =
      parts.length > 1 ? parts.slice(0, parts.length - 1).join(', ') : inner;
    return { text: match[1].trim(), cost: cost, time: time };
  }

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < ranked.length; i++) {
      if (ranked[i].slug === slug) {
        row = ranked[i];
        break;
      }
    }
    if (!row) return;
    document
      .querySelectorAll('#board-body tr.active')
      .forEach(function (tr) {
        tr.classList.remove('active');
      });
    var active = document.querySelector(
      '#board-body tr[data-slug="' + slug + '"]',
    );
    if (active) active.classList.add('active');

    document.getElementById('detail-name').textContent = row.name;
    document.getElementById('detail-rank').textContent =
      '#' + row.rank + ' · ' + money(row.implied_value_usd) + ' implied';
    document.getElementById('detail-line').textContent = rankLine(row);

    var recomputed = impliedOf(row);
    var rec = el('p', 'recompute');
    if (recomputed === row.implied_value_usd) {
      rec.innerHTML =
        'Recomputed in your browser from the snapshot figures: <b>' +
        dollars(recomputed) +
        '</b> — matches the board.';
    } else {
      rec.innerHTML =
        'Recomputed in your browser from the snapshot figures: <b>' +
        dollars(recomputed) +
        '</b> — does NOT match the board (' +
        dollars(row.implied_value_usd) +
        ').';
    }
    var lineEl = document.getElementById('detail-line');
    var old = detailEl.querySelector('.recompute');
    if (old) old.remove();
    lineEl.after(rec);

    var factors = document.getElementById('detail-factors');
    factors.innerHTML = '';
    var factorData = [
      {
        name: 'TVL',
        value: money(row.tvl_usd),
        note: 'The base. Total value locked.',
      },
      {
        name: 'Growth',
        value: mult(row.growth_mult),
        note:
          row.change_7d === null
            ? 'No 7-day change reported, so 1.00.'
            : 'From a 7-day change of ' + pct(row.change_7d) + '.',
      },
      {
        name: 'Age',
        value: mult(row.age_mult),
        note: 'Tracked for ' + ageLong(row.age_years) + '.',
      },
      {
        name: 'Chains',
        value: mult(row.chain_mult),
        note:
          row.chains + (row.chains === 1 ? ' chain' : ' chains') + ' live.',
      },
    ];
    factorData.forEach(function (f) {
      var box = el('div', 'factor');
      box.appendChild(el('div', 'f-name', f.name));
      box.appendChild(el('span', 'f-val', f.value));
      box.appendChild(el('p', 'f-note', f.note));
      factors.appendChild(box);
    });

    var farm = document.getElementById('detail-farm');
    farm.innerHTML = '';
    row.farm_steps.forEach(function (step) {
      var parts = splitChips(step);
      var li = el('li', null, parts.text);
      if (parts.cost || parts.time) {
        var chips = el('div', 'chips');
        if (parts.cost) chips.appendChild(el('span', 'chip', parts.cost));
        if (parts.time)
          chips.appendChild(el('span', 'chip amber', parts.time));
        li.appendChild(chips);
      }
      farm.appendChild(li);
    });

    detailEl.hidden = false;
    detailEl.scrollIntoView({ behavior: 'auto', block: 'start' });
    try {
      history.replaceState(null, '', '?view=detail&slug=' + row.slug);
    } catch (err) {
      void err;
    }
  }

  document.getElementById('detail-close').addEventListener('click', function () {
    detailEl.hidden = true;
    document
      .querySelectorAll('#board-body tr.active')
      .forEach(function (tr) {
        tr.classList.remove('active');
      });
    try {
      history.replaceState(null, '', location.pathname);
    } catch (err) {
      void err;
    }
  });

  // ------------------------------------------------------------ static tables

  function fillMini(bodyId, rows, cells) {
    var body = document.getElementById(bodyId);
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      cells(row).forEach(function (cell) {
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
  }

  fillMini('setaside-body', setAside, function (row) {
    return [
      el('td', 'name-cell', row.name),
      el('td', 'cat', row.category || '—'),
      el('td', 'num', money(row.tvl_usd)),
      el('td', 'reason', row.reason),
    ];
  });

  fillMini('token-body', tokenTrading, function (row) {
    return [
      el('td', 'name-cell', row.name),
      el('td', 'cat', row.category || '—'),
      el('td', 'num', money(row.tvl_usd)),
      changeCell(row.change_7d),
      el('td', 'num', String(row.chains)),
    ];
  });

  // ------------------------------------------------------------ controls

  function onFilterChange() {
    renderBoard();
    try {
      var params = new URLSearchParams();
      if (catSelect.value) params.set('category', catSelect.value);
      if (statusSelect.value !== 'pretoken')
        params.set('status', statusSelect.value);
      if (qInput.value.trim()) params.set('q', qInput.value.trim());
      var query = params.toString();
      history.replaceState(
        null,
        '',
        query ? '?view=filtered&' + query : location.pathname,
      );
    } catch (err) {
      void err;
    }
  }

  qInput.addEventListener('input', onFilterChange);
  catSelect.addEventListener('change', onFilterChange);
  statusSelect.addEventListener('change', onFilterChange);
  sortSelect.addEventListener('change', onFilterChange);

  // ------------------------------------------------------------ deep links

  var params = new URLSearchParams(location.search);
  var view = params.get('view');
  if (view === 'detail' && params.get('slug')) {
    renderBoard();
    openDetail(params.get('slug'));
  } else {
    if (params.get('category')) catSelect.value = params.get('category');
    if (params.get('status')) statusSelect.value = params.get('status');
    if (params.get('q')) qInput.value = params.get('q');
    renderBoard();
    if (view === 'filtered') {
      document
        .querySelector('.board-wrap')
        .scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }
})();
