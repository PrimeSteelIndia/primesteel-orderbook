function renderPicker() {
  const cats = ['All', ...S.categories];
  view.innerHTML = `
    <div class="page-head">
      <h1>New order</h1>
      <p>Tap + to add. Tap the number to change it.</p>
    </div>

    <div class="searchbar" style="margin-bottom:12px">
      ${icon('search')}
      <input id="q" type="search" placeholder="Search item, e.g. 202 20G" value="${esc(S.itemQuery)}"
             autocomplete="off" enterkeyhint="search">
      <button class="icon-btn ${S.itemQuery ? '' : 'hidden'}" id="clearQ" aria-label="Clear search">${icon('close', 'i i-sm')}</button>
    </div>

    <div class="chips" style="margin-bottom:12px" id="cats">
      ${cats.map(c => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${(c === 'All' ? '' : c) === S.category || (c === 'All' && !S.category)}">${esc(c)}</button>`).join('')}
    </div>

    <div id="grid"></div>
    <div class="grid-note" id="gridNote"></div>
  `;

  const input = $('#q');
  input.addEventListener('input', debounce(e => {
    S.itemQuery = e.target.value.trim();
    $('#clearQ').classList.toggle('hidden', !S.itemQuery);
    paintGrid();
  }, 90));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  $('#clearQ').addEventListener('click', () => {
    S.itemQuery = '';
    input.value = '';
    $('#clearQ').classList.add('hidden');
    paintGrid();
    input.focus();
  });
  $('#cats').addEventListener('click', e => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    const cat = btn.dataset.cat;
    S.category = cat === 'All' ? '' : cat;
    $$('#cats .chip').forEach(c => c.setAttribute('aria-pressed',
      String((c.dataset.cat === 'All' ? '' : c.dataset.cat) === S.category)));
    paintGrid();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const grid = $('#grid');
  grid.addEventListener('click', e => {
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    const open = e.target.closest('[data-open]');
    if (inc) { bumpItem(Number(inc.dataset.inc), 1); return; }
    if (dec) { bumpItem(Number(dec.dataset.dec), -1); return; }
    if (open) {
      const id = Number(open.dataset.open);
      openQtySheet(id, cartLine(id));
    }
  });
  grid.addEventListener('focusin', e => {
    if (e.target.matches('[data-qty]')) e.target.select();
  });
  grid.addEventListener('change', e => {
    const inp = e.target.closest('[data-qty]');
    if (inp) applyCardQty(Number(inp.dataset.qty), inp);
  });
  grid.addEventListener('keydown', e => {
    if (e.target.matches('[data-qty]') && e.key === 'Enter') e.target.blur();
  });

  paintGrid();
  paintCartFoot();
  paintTabbar();
}

function itemCardHtml(item) {
  const line = cartLine(item.id);
  const mainUnit = item.main_unit || 'kg';
  const weightBit = item.weight_per_pc > 0 ? ` · ${kg(item.weight_per_pc, 2)}/pc` : '';
  const shown = line ? (line.entry_qty !== undefined ? line.entry_qty : line.pcs) : '';
  return `
    <div class="item-card ${line ? 'in-cart' : ''}" data-item="${item.id}">
      <span class="item-name" data-open="${item.id}" title="Units and note">${esc(item.name)}</span>
      <span class="item-facts"><b>${money(item.rate)}</b>/${esc(mainUnit)}${weightBit}</span>
      <div class="card-step">
        <button type="button" data-dec="${item.id}" aria-label="One less">−</button>
        <input data-qty="${item.id}" inputmode="decimal" value="${shown}" placeholder="–" aria-label="Quantity for ${esc(item.name)}">
        <button type="button" data-inc="${item.id}" aria-label="One more">+</button>
      </div>
    </div>`;
}

function paintGrid() {
  const host = $('#grid');
  if (!host) return;
  const q = S.itemQuery;
  const filtered = S.items.filter(i => (!S.category || i.category === S.category) && matchItem(i, q));

  if (!filtered.length) {
    host.innerHTML = `<div class="empty" style="padding:32px 0">
      ${icon('search', 'i i-lg')}
      <h3>No item matches</h3>
      <p class="small">Try a shorter word, like “202” or “20G”.</p></div>`;
    $('#gridNote').textContent = '';
    return;
  }

  if (!q && !S.category) {
    const groups = new Map();
    for (const it of filtered) {
      const key = it.category || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    host.innerHTML = Array.from(groups.entries()).map(([cat, list]) => `
      <section class="shelf">
        <div class="shelf-head">
          <span class="shelf-title">${esc(cat)}</span>
          <span class="shelf-count">${list.length}</span>
        </div>
        <div class="shelf-rail">${list.map(itemCardHtml).join('')}</div>
      </section>`).join('');
    $('#gridNote').textContent = `${S.items.length} items in ${groups.size} categories`;
  } else {
    host.innerHTML = `<div class="item-grid">${filtered.map(itemCardHtml).join('')}</div>`;
    $('#gridNote').textContent = `${filtered.length} item${filtered.length === 1 ? '' : 's'}${q ? ' found' : ''}`;
  }
}

function setLineFromQty(item, line, qty, unit) {
  const calc = calcItemEntry(item, qty, unit);
  if (line) {
    line.entry_qty = qty;
    line.entry_unit = calc.entryUnit;
    line.qty = calc.effectiveQty;
    line.unit = calc.effectiveUnit;
    line.pcs = calc.pcs;
  }
  return calc;
}

function bumpItem(itemId, delta) {
  const item = itemById(itemId);
  if (!item) return;
  const mainU = item.main_unit || 'kg';
  const line = cartLine(itemId);
  const cur = line ? Number(line.entry_qty !== undefined ? line.entry_qty : line.pcs) || 0 : 0;
  const unit = line ? (line.entry_unit || line.unit || mainU) : mainU;
  const next = Math.round((cur + delta) * 1000) / 1000;

  if (next <= 0) {
    if (line) {
      S.cart = S.cart.filter(l => l !== line);
      persistCart();
      refreshCard(itemId);
      paintCartFoot();
    }
    return;
  }

  if (line) {
    setLineFromQty(item, line, next, unit);
  } else {
    const calc = calcItemEntry(item, next, unit);
    S.cart.push({
      item_id: itemId,
      pcs: calc.pcs,
      qty: calc.effectiveQty,
      unit: calc.effectiveUnit,
      entry_qty: next,
      entry_unit: calc.entryUnit,
      narration: '',
      actual_weight: null,
    });
  }
  persistCart();
  refreshCard(itemId);
  paintCartFoot();
}

function applyCardQty(itemId, inputEl) {
  const item = itemById(itemId);
  if (!item) return;
  const mainU = item.main_unit || 'kg';
  const line = cartLine(itemId);
  const unit = line ? (line.entry_unit || line.unit || mainU) : mainU;
  const val = Math.round((Number(inputEl.value) || 0) * 1000) / 1000;

  if (val <= 0) {
    if (line) {
      S.cart = S.cart.filter(l => l !== line);
      persistCart();
    }
    inputEl.value = '';
    refreshCard(itemId);
    paintCartFoot();
    return;
  }

  if (line) {
    setLineFromQty(item, line, val, unit);
  } else {
    const calc = calcItemEntry(item, val, unit);
    S.cart.push({
      item_id: itemId,
      pcs: calc.pcs,
      qty: calc.effectiveQty,
      unit: calc.effectiveUnit,
      entry_qty: val,
      entry_unit: calc.entryUnit,
      narration: '',
      actual_weight: null,
    });
  }
  persistCart();
  inputEl.value = val;
  refreshCard(itemId);
  paintCartFoot();
}

function refreshCard(itemId) {
  const host = $('#grid');
  if (!host) return;
  const card = host.querySelector(`[data-item="${itemId}"]`);
  if (!card) return;
  const line = cartLine(itemId);
  card.classList.toggle('in-cart', Boolean(line));
  const inp = card.querySelector('[data-qty]');
  if (inp) {
    inp.value = line ? (line.entry_qty !== undefined ? line.entry_qty : line.pcs) : '';
  }
}