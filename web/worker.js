/* Prime Steel - worker phone app
   Three jobs only: pick items, save the order, come back and enter weights. */
'use strict';

const S = {
  business: '',
  tagline: '',
  items: [],
  categories: [],
  cart: store.get('cart', []),
  worker: store.get('worker', ''),
  customerName: '',
  customerPhone: '',
  note: '',
  editingOrderId: null,
  editingOrderNo: '',
  itemQuery: '',
  category: '',
  subCategory: '',
  orders: [],
  ordersFilter: store.get('ordersFilter', 'OPEN'),
  activeOrder: null,
  weights: {},
  pending: 0,
  online: navigator.onLine,
  doneOrder: null,
  busy: false,
};

const WIFI_KEY = 'outbox';

const view = $('#view');
const foot = $('#foot');

function initWorkerAuth() {
  const gate = $('#workerLoginGate');
  if (!gate) return;
  WORKER_PIN = localStorage.getItem('ps.worker_pin') || '';

  const lockBtn = $('#lockWorkerBtn');
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      WORKER_PIN = '';
      localStorage.removeItem('ps.worker_pin');
      showWorkerGate();
      toast('Worker station locked', 'info');
    });
  }

  if (!WORKER_PIN) {
    showWorkerGate();
  }
}

function showWorkerGate() {
  const gate = $('#workerLoginGate');
  if (!gate) return;
  gate.classList.remove('hidden');
  const inp = $('#workerPinInput');
  const btn = $('#workerPinBtn');
  if (inp) inp.value = '';

  const unlock = async () => {
    const pin = (inp ? inp.value : '').trim();
    if (!pin) { toast('Please enter worker PIN', 'error'); return; }
    try {
      const res = await api('/api/pin/worker/check', { method: 'POST', body: JSON.stringify({ pin }) });
      if (!res.ok) {
        toast('Incorrect PIN', 'error');
        if (inp) inp.select();
        return;
      }
      WORKER_PIN = pin;
      localStorage.setItem('ps.worker_pin', pin);
      gate.classList.add('hidden');
      toast('Worker station unlocked', 'success');
      route();
    } catch (e) {
      toast(e.message || 'Unlock failed', 'error');
    }
  };

  if (btn) btn.onclick = unlock;
  if (inp) inp.onkeydown = e => { if (e.key === 'Enter') unlock(); };
  setTimeout(() => inp && inp.focus(), 100);
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  wireChrome();
  initWorkerAuth();
  renderSkeleton();
  try {
    const data = await api('/api/bootstrap');
    S.business = data.business;
    S.tagline = data.tagline;
    S.items = data.items;
    S.categories = data.categories;
    S.pending = data.stats.to_weigh;
    // Nothing is hardcoded: the owner clears these and types his own company
    // name, so show exactly what is configured (blank until he sets it).
    const biz = (S.business || '').trim();
    $('#businessName').textContent = biz;
    $('#brandSub').textContent = (S.tagline || '').trim();
    const markEl = document.querySelector('.brand-mark');
    if (markEl) markEl.textContent = brandInitials(biz);
    document.title = biz || 'Order Book';
    setOnline(true);
    sanitizeCart();
  } catch (err) {
    if (err.status === 401) {
      showWorkerGate();
      return;
    }
    setOnline(false);
    renderOffline(err);
    return;
  }
  route();
  refreshPending();
  setInterval(refreshPending, 25000);
  flushOutbox();
  setInterval(flushOutbox, 20000);
}

function sanitizeCart() {
  const ids = new Set(S.items.map(i => i.id));
  S.cart = S.cart.filter(l => ids.has(l.item_id) && l.pcs > 0);
  persistCart();
}

function persistCart() {
  store.set('cart', S.cart);
}

function itemById(id) {
  return S.items.find(i => i.id === id);
}

/* ------------------------------------------------------------------ */
/* chrome                                                              */
/* ------------------------------------------------------------------ */

function wireChrome() {
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { setOnline(true); flushOutbox(); });
  window.addEventListener('offline', () => setOnline(false));
}

function setOnline(ok) {
  S.online = ok;
  const el = $('#conn');
  if (!el) return;
  el.className = 'conn' + (ok ? '' : ' down');
  el.innerHTML = `<span class="dot"></span>${ok ? 'Connected' : 'No Wi-Fi'}`;
  el.title = ok ? 'Connected to the office computer' : 'Not connected to the office computer';
}

async function refreshPending() {
  if (!navigator.onLine) return;
  try {
    const data = await api('/api/orders?status=OPEN&limit=200');
    S.pending = data.orders.length;
    setOnline(true);
  } catch (err) {
    if (err.status === 401) {
      showWorkerGate();
      return;
    }
    setOnline(false);
  }
  paintTabbar();
}

function paintTabbar() {
  const badge = $('#pendingBadge');
  if (!badge) return;
  badge.textContent = S.pending;
  badge.classList.toggle('hidden', !S.pending);
}

function renderSkeleton() {
  view.innerHTML = `
    <div class="skel" style="height:52px;margin-bottom:14px"></div>
    <div class="item-grid">
      ${Array.from({ length: 6 }).map(() => '<div class="skel" style="height:98px"></div>').join('')}
    </div>`;
}

function renderOffline(err) {
  view.innerHTML = `
    <div class="empty" style="padding-top:40px">
      <svg class="i" viewBox="0 0 24 24" style="width:44px;height:44px;stroke:currentColor;stroke-width:1.7;fill:none;stroke-linecap:round"><path d="M5 12.5a10 10 0 0114 0M8.5 16a5.5 5.5 0 017 0"/><circle cx="12" cy="20" r="1"/><path d="M3 3l18 18"/></svg>
      <h3>Cannot reach the office computer</h3>
      <p class="small">Check that the phone is on the shop Wi-Fi, then try again.</p>
      <div style="margin-top:18px;display:flex;gap:8px;justify-content:center">
        <button class="btn" id="retryBtn">${icon('refresh')} Try again</button>
      </div>
      <p class="tiny muted" style="margin-top:20px">${esc(err.message || '')}</p>
    </div>`;
  $('#retryBtn').addEventListener('click', () => location.reload());
}

/* ------------------------------------------------------------------ */
/* router                                                              */
/* ------------------------------------------------------------------ */

function route() {
  const hash = location.hash || '#/';
  setTab(hash);
  if (hash.startsWith('#/review')) return renderReview();
  if (hash.startsWith('#/orders')) return renderOrders();
  if (hash.startsWith('#/order/')) return renderOrder(hash.slice('#/order/'.length));
  if (hash.startsWith('#/done/')) return renderDone(hash.slice('#/done/'.length));
  return renderPicker();
}

function setTab(hash) {
  const tab = hash.startsWith('#/orders') || hash.startsWith('#/order/') ? 'orders' : 'new';
  $$('.tabbar button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  paintTabbar();
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

/* ------------------------------------------------------------------ */
/* 1. item picker                                                      */
/* ------------------------------------------------------------------ */

function matchItem(item, query) {
  if (!query) return true;
  const name = item.name.toUpperCase();
  const compact = name.replace(/[^A-Z0-9]/g, '');
  const tokens = query.toUpperCase().split(/\s+/).filter(Boolean);
  if (tokens.every(t => name.includes(t))) return true;
  const q = query.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return q.length > 1 && compact.includes(q);
}

function cartLine(itemId) {
  return S.cart.find(l => l.item_id === itemId);
}

function calcItemEntry(item, entryQty, entryUnit, customRate = null) {
  const rawQty = Math.max(0, Number(entryQty) || 0);
  const u = (entryUnit || item.order_unit || item.main_unit || 'pcs').toLowerCase();
  const mainU = (item.main_unit || 'kg').toLowerCase();
  const altU = (item.alt_unit || '').toLowerCase();
  const altFactor = Number(item.alt_factor) || 0;
  const altU2 = (item.alt_unit2 || '').toLowerCase();
  const altU2Factor = Number(item.alt_unit2_factor) || 0;
  let lengthPerPc = Number(item.length_per_pc) || 0;
  let weightPerPc = Number(item.weight_per_pc) || 0;
  const rate = (customRate !== null && customRate !== undefined && !isNaN(Number(customRate)))
    ? Number(customRate)
    : (Number(item.rate) || 0);

  // Derive effective factors if not directly specified
  if (weightPerPc <= 0) {
    if (altU === 'pcs' && altFactor > 0) weightPerPc = altFactor;
    else if (altU2 === 'pcs' && altU2Factor > 0) weightPerPc = altU2Factor;
  }
  if (lengthPerPc <= 0) {
    if (altU === 'feet' && altFactor > 0 && altU2 === 'pcs' && altU2Factor > 0) {
      lengthPerPc = Math.round((altU2Factor / altFactor) * 100) / 100;
    } else if (altU2 === 'feet' && altU2Factor > 0 && altU === 'pcs' && altFactor > 0) {
      lengthPerPc = Math.round((altFactor / altU2Factor) * 100) / 100;
    }
  }

  let effectiveQty = rawQty;
  let effectiveUnit = u;
  let prefixPreview = '';

  if (u === 'inch' || u === 'in') {
    effectiveQty = Math.round((rawQty / 12.0) * 1000) / 1000;
    effectiveUnit = 'feet';
    prefixPreview = `${rawQty} in = ${effectiveQty} ft`;
  } else if (u === 'metre' || u === 'meter' || u === 'm') {
    if (mainU !== 'metre' && altU !== 'metre' && altU2 !== 'metre') {
      effectiveQty = Math.round((rawQty * 3.28084) * 1000) / 1000;
      effectiveUnit = 'feet';
      prefixPreview = `${rawQty} m = ${effectiveQty} ft`;
    }
  }

  // Derive main_qty (quantity in main_unit)
  let mainQty = 0;
  if (effectiveUnit === mainU) {
    mainQty = effectiveQty;
  } else if (altU && effectiveUnit === altU && altFactor > 0) {
    // alt_factor means "how many main units one alt unit is" for every unit
    // except kilograms. When the item is counted in pieces, a kilogram is a
    // measure of the material and alt_factor is the weight of one piece, so the
    // conversion goes the other way. Reading it as a multiplier turned 91 kg
    // into 2,757 pieces.
    if (altU === 'kg' && mainU !== 'kg') {
      mainQty = effectiveQty / altFactor;
    } else {
      mainQty = effectiveQty * altFactor;
    }
  } else if (altU2 && effectiveUnit === altU2 && altU2Factor > 0) {
    mainQty = effectiveQty * altU2Factor;
  } else if (effectiveUnit === 'pcs') {
    if (altU === 'pcs' && altFactor > 0) {
      mainQty = effectiveQty * altFactor;
    } else if (altU2 === 'pcs' && altU2Factor > 0) {
      mainQty = effectiveQty * altU2Factor;
    } else if (weightPerPc > 0 && mainU === 'kg') {
      mainQty = effectiveQty * weightPerPc;
    } else if (lengthPerPc > 0 && altU === 'feet' && altFactor > 0) {
      mainQty = effectiveQty * lengthPerPc * altFactor;
    } else {
      mainQty = effectiveQty;
    }
  } else if (effectiveUnit === 'feet') {
    if (altU === 'feet' && altFactor > 0) {
      mainQty = effectiveQty * altFactor;
    } else if (altU2 === 'feet' && altU2Factor > 0) {
      mainQty = effectiveQty * altU2Factor;
    } else if (lengthPerPc > 0) {
      const derivedPcs = effectiveQty / lengthPerPc;
      if (altU2 === 'pcs' && altU2Factor > 0) mainQty = derivedPcs * altU2Factor;
      else if (altU === 'pcs' && altFactor > 0) mainQty = derivedPcs * altFactor;
      else if (weightPerPc > 0 && mainU === 'kg') mainQty = derivedPcs * weightPerPc;
      else mainQty = derivedPcs;
    } else {
      mainQty = effectiveQty;
    }
  } else if (effectiveUnit === 'kg') {
    if (mainU === 'kg') {
      mainQty = effectiveQty;
    } else if (altU === 'kg' && altFactor > 0) {
      mainQty = effectiveQty / altFactor;
    } else if (altU2 === 'kg' && altU2Factor > 0) {
      mainQty = effectiveQty / altU2Factor;
    } else if (mainU === 'pcs' && weightPerPc > 0) {
      mainQty = effectiveQty / weightPerPc;
    } else {
      mainQty = effectiveQty;
    }
  } else {
    mainQty = effectiveQty;
  }

  // Derive weight in kg. This is needed before the amount because every item
  // in this business is priced in rupees per kilogram, whatever unit it is
  // counted in. A 30 kg sheet at 177 is 177 per kg, not 177 per sheet.
  let weight = 0;
  if (mainU === 'kg') {
    weight = mainQty;
  } else if (altU === 'kg' && altFactor > 0) {
    weight = mainQty * altFactor;
  } else if (altU2 === 'kg' && altU2Factor > 0) {
    weight = mainQty * altU2Factor;
  } else if (effectiveUnit === 'kg') {
    weight = effectiveQty;
  } else if (weightPerPc > 0) {
    weight = mainQty * weightPerPc;
  }

  // Derive pcs
  let pcs = 0;
  if (effectiveUnit === 'pcs') {
    pcs = effectiveQty;
  } else if (mainU === 'pcs') {
    pcs = mainQty;
  } else if (altU2 === 'pcs' && altU2Factor > 0) {
    pcs = mainQty / altU2Factor;
  } else if (altU === 'pcs' && altFactor > 0) {
    pcs = mainQty / altFactor;
  } else if (lengthPerPc > 0 && effectiveUnit === 'feet') {
    pcs = effectiveQty / lengthPerPc;
  } else if (weightPerPc > 0 && mainU === 'kg') {
    pcs = mainQty / weightPerPc;
  } else if (weightPerPc > 0 && effectiveUnit === 'kg') {
    pcs = effectiveQty / weightPerPc;
  } else {
    pcs = Math.max(1, effectiveQty);
  }

  // Derive feet
  let feet = 0;
  if (effectiveUnit === 'feet') {
    feet = effectiveQty;
  } else if (altU === 'feet' && altFactor > 0) {
    feet = mainQty / altFactor;
  } else if (altU2 === 'feet' && altU2Factor > 0) {
    feet = mainQty / altU2Factor;
  } else if (lengthPerPc > 0 && pcs > 0) {
    feet = pcs * lengthPerPc;
  }

  // Amount follows the weight. If an item somehow has no weight information at
  // all, fall back to the old unit-times-rate maths so the line is not zero.
  const amount = weight > 0 ? weight * rate : mainQty * rate;

  // Format preview string
  const parts = [];
  if (prefixPreview) parts.push(prefixPreview);
  if (effectiveUnit === 'pcs') {
    if (weight > 0) parts.push(`${Math.round(weight * 10) / 10} kg`);
    if (feet > 0) parts.push(`${Math.round(feet * 10) / 10} ft`);
  } else if (effectiveUnit === 'feet') {
    if (weight > 0) parts.push(`${Math.round(weight * 10) / 10} kg`);
    if (pcs > 0) parts.push(`${Math.round(pcs * 100) / 100} pcs`);
  } else if (effectiveUnit === 'kg') {
    if (pcs > 0 && (altU === 'pcs' || altU2 === 'pcs' || weightPerPc > 0)) parts.push(`${Math.round(pcs * 100) / 100} pcs`);
    if (feet > 0 && (altU === 'feet' || altU2 === 'feet')) parts.push(`${Math.round(feet * 10) / 10} ft`);
  } else {
    if (weight > 0) parts.push(`${Math.round(weight * 10) / 10} kg`);
    if (pcs > 0) parts.push(`${Math.round(pcs * 100) / 100} pcs`);
  }
  const preview = parts.join(' = ');

  const finalPcs = Math.max(1, Math.round(pcs || 1));
  return {
    rawQty,
    entryUnit: u,
    effectiveQty,
    effectiveUnit,
    mainQty,
    pcs: finalPcs,
    weight,
    amount,
    feet,
    preview,
  };
}

function cartTotals() {
  let pcs = 0, weight = 0, amount = 0;
  for (const line of S.cart) {
    const item = itemById(line.item_id);
    if (!item) continue;
    const calc = calcItemEntry(
      item,
      line.entry_qty !== undefined ? line.entry_qty : (line.qty || line.pcs),
      line.entry_unit || line.unit || 'pcs',
      line.rate
    );
    pcs += calc.pcs;
    weight += calc.weight;
    amount += calc.amount;
  }
  return { lines: S.cart.length, pcs, weight, amount };
}

const SUB_TOKENS = [
  '2B', 'PVC', 'MIRROR', 'COIL',
  '8X4', '8X3', '8X39', '1MX2M', "1MX8'", "2MX20''", "2MX44''", '6X4', '25X3', '30X3', '40X3',
  '12G', '14G', '16G', '18G', '20G', '22G', '24G', '26G', '27G', '28G', '29G', '2.5mm'
];

function matchSubCat(item, sub) {
  if (!sub) return true;
  const name = (item.name || '').toUpperCase();
  const tok = sub.toUpperCase();
  return name.includes(tok);
}

function getSubCategories(category) {
  const pool = S.items.filter(i => !category || i.category === category);
  const catUpper = (category || '').toUpperCase();
  const found = SUB_TOKENS.filter(tok => {
    if (tok.toUpperCase() === catUpper) return false;
    return pool.some(it => matchSubCat(it, tok));
  });
  return found.length ? ['All', ...found] : [];
}

function paintSubCats() {
  const host = $('#subCats');
  if (!host) return;
  const subs = getSubCategories(S.category);
  if (!subs.length) {
    host.innerHTML = '';
    host.classList.add('hidden');
    return;
  }
  host.classList.remove('hidden');
  host.innerHTML = subs.map(sc => {
    const val = sc === 'All' ? '' : sc;
    return `<button class="chip sub-chip" data-subcat="${esc(sc)}" aria-pressed="${val === S.subCategory}">${esc(sc)}</button>`;
  }).join('');
}

function renderPicker() {
  const cats = ['All', ...S.categories];
  const isEditing = Boolean(S.editingOrderId);
  view.innerHTML = `
    ${isEditing ? `
      <div class="note-box warn" style="margin-bottom:12px;justify-content:space-between;align-items:center">
        <span>Editing <b>${esc(S.editingOrderNo)}</b> — tap + / − to change items</span>
        <button class="btn btn-sm" id="backToReviewBtn" type="button" style="white-space:nowrap">Review changes</button>
      </div>` : ''}
    <div class="page-head">
      <h1>${isEditing ? `Edit ${esc(S.editingOrderNo)}` : 'New order'}</h1>
      <p>Tap + to add. Tap the item name for units or rate.</p>
    </div>

    <div class="searchbar" style="margin-bottom:10px">
      ${icon('search')}
      <input id="q" type="search" placeholder="Search item, e.g. 202 20G" value="${esc(S.itemQuery)}"
             autocomplete="off" enterkeyhint="search">
      <button class="icon-btn ${S.itemQuery ? '' : 'hidden'}" id="clearQ" aria-label="Clear search">${icon('close', 'i i-sm')}</button>
    </div>

    <div class="chips" style="margin-bottom:8px" id="cats">
      ${cats.map(c => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${(c === 'All' ? '' : c) === S.category || (c === 'All' && !S.category)}">${esc(c)}</button>`).join('')}
    </div>
    <div class="chips sub-chips" style="margin-bottom:12px" id="subCats"></div>

    <div id="grid"></div>
    <div class="grid-note" id="gridNote"></div>
  `;

  if (isEditing && $('#backToReviewBtn')) {
    $('#backToReviewBtn').addEventListener('click', () => go('#/review'));
  }

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
    S.subCategory = '';
    $$('#cats .chip').forEach(c => c.setAttribute('aria-pressed',
      String((c.dataset.cat === 'All' ? '' : c.dataset.cat) === S.category)));
    paintSubCats();
    paintGrid();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#subCats').addEventListener('click', e => {
    const btn = e.target.closest('[data-subcat]');
    if (!btn) return;
    const sc = btn.dataset.subcat;
    S.subCategory = sc === 'All' ? '' : sc;
    $$('#subCats .chip').forEach(c => c.setAttribute('aria-pressed',
      String((c.dataset.subcat === 'All' ? '' : c.dataset.subcat) === S.subCategory)));
    paintGrid();
  });
  paintSubCats();

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
  const filtered = S.items.filter(i =>
    (!S.category || i.category === S.category) &&
    (!S.subCategory || matchSubCat(i, S.subCategory)) &&
    matchItem(i, q)
  );

  if (!filtered.length) {
    host.innerHTML = `<div class="empty" style="padding:32px 0">
      ${icon('search', 'i i-lg')}
      <h3>No item matches</h3>
      <p class="small">Try a shorter word, like “202” or “20G”.</p></div>`;
    $('#gridNote').textContent = '';
    return;
  }

  if (!q && !S.category && !S.subCategory) {
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
  const defU = item.order_unit || item.main_unit || 'pcs';
  const line = cartLine(itemId);
  const cur = line ? Number(line.entry_qty !== undefined ? line.entry_qty : line.pcs) || 0 : 0;
  const unit = line ? (line.entry_unit || line.unit || defU) : defU;
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
  const defU = item.order_unit || item.main_unit || 'pcs';
  const line = cartLine(itemId);
  const unit = line ? (line.entry_unit || line.unit || defU) : defU;
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

function openQtySheet(itemId, existingLine = null) {
  const item = itemById(itemId);
  if (!item) return;
  const existing = existingLine || cartLine(itemId);

  // Available units for this item
  const unitSet = new Set();
  const mainU = (item.main_unit || 'kg').toLowerCase();
  unitSet.add(mainU);
  if (item.order_unit) unitSet.add(item.order_unit.toLowerCase());
  if (item.alt_unit) unitSet.add(item.alt_unit.toLowerCase());
  if (item.alt_unit2) unitSet.add(item.alt_unit2.toLowerCase());
  if (Number(item.length_per_pc) > 0 || mainU === 'feet' || (item.alt_unit || '').toLowerCase() === 'feet' || (item.alt_unit2 || '').toLowerCase() === 'feet') {
    unitSet.add('feet');
    unitSet.add('inch');
  }
  unitSet.add('pcs');
  if (mainU === 'kg' || (item.alt_unit || '').toLowerCase() === 'kg' || (item.alt_unit2 || '').toLowerCase() === 'kg' || Number(item.weight_per_pc) > 0 || Number(item.alt_factor) > 0) {
    unitSet.add('kg');
  }
  const units = Array.from(unitSet);

  const defU = (item.order_unit || item.main_unit || 'pcs').toLowerCase();
  let currentUnit = (existing ? (existing.entry_unit || existing.unit || defU) : defU).toLowerCase();
  if (!units.includes(currentUnit)) currentUnit = units[0];

  let rawQty = existing ? (existing.entry_qty !== undefined ? existing.entry_qty : (existing.qty || existing.pcs)) : 1;
  let customRate = (existing && existing.rate !== undefined && existing.rate !== null) ? Number(existing.rate) : Number(item.rate || 0);
  let narration = existing ? (existing.narration || '') : '';

  const renderCalc = () => {
    const calc = calcItemEntry(item, rawQty, currentUnit, customRate);
    return `
      <div>
        <div class="k">Est. weight</div>
        <div class="v">${kg(calc.weight, 1)}</div>
      </div>
      <div style="text-align:right">
        <div class="k">Est. amount</div>
        <div class="v">${money(calc.amount)}</div>
      </div>
      ${calc.preview ? `<div style="grid-column:1/-1;font-size:13px;color:#1d4ed8;margin-top:6px;font-weight:600">Calculated: ${esc(calc.preview)}</div>` : ''}`;
  };

  const subParts = [`${money(customRate)} / ${item.main_unit || 'kg'}`];
  if (item.alt_unit && item.alt_factor) subParts.push(`1 ${item.alt_unit} = ${item.alt_factor} ${item.main_unit || 'kg'}`);
  if (item.alt_unit2 && item.alt_unit2_factor) subParts.push(`1 ${item.alt_unit2} = ${item.alt_unit2_factor} ${item.main_unit || 'kg'}`);
  if (item.weight_per_pc > 0 && !item.alt_unit2_factor && item.alt_unit !== 'pcs') subParts.push(`${kg(item.weight_per_pc, 2)} / pc`);
  if (item.length_per_pc > 0) subParts.push(`${item.length_per_pc} ft / pc`);

  const { sheet, close } = openSheet({
    title: item.name,
    sub: subParts.join(' · '),
    body: `
      <div class="label" style="margin-top:4px">Unit</div>
      <div class="chips" id="unitChips" style="margin-bottom:12px">
        ${units.map(u => `<button type="button" class="chip" data-u="${esc(u)}" aria-pressed="${u === currentUnit}">${esc(u)}</button>`).join('')}
      </div>

      <div class="label" id="qtyLabel">Quantity (${currentUnit})</div>
      <div class="stepper">
        <button type="button" data-step="-1" aria-label="One less">−</button>
        <input id="qtyInput" inputmode="decimal" value="${rawQty}" aria-label="Quantity">
        <button type="button" data-step="1" aria-label="One more">+</button>
      </div>

      <div class="quick-qty" id="quickChips">
        ${[1, 5, 10, 20, 25, 50].map(n => `<button type="button" data-set="${n}">${n}</button>`).join('')}
      </div>

      <div class="label" style="margin-top:12px">Rate (₹ / ${esc(item.main_unit || 'kg')})</div>
      <div class="stepper">
        <button type="button" data-rstep="-1" aria-label="Decrease rate">−</button>
        <input id="rateInput" inputmode="decimal" value="${customRate}" aria-label="Rate">
        <button type="button" data-rstep="1" aria-label="Increase rate">+</button>
      </div>

      <div class="field" style="margin-top:12px;margin-bottom:10px">
        <label for="itemNarration">Item narration / note (optional)</label>
        <input class="input" id="itemNarration" placeholder="e.g. half sheet, cut 4ft, bend at 90°" value="${esc(narration)}">
      </div>

      <div class="estimate-box" id="estBox">${renderCalc()}</div>
      <button class="btn btn-primary btn-lg btn-block" id="addBtn">${existing ? 'Update item' : 'Add to order'}</button>
      ${existing ? '<button class="btn btn-ghost btn-block" id="removeBtn" style="margin-top:8px;color:#b42318">Remove from order</button>' : ''}
    `,
  });

  const input = $('#qtyInput', sheet);
  const rateInp = $('#rateInput', sheet);
  const narrInp = $('#itemNarration', sheet);

  const update = () => {
    input.value = rawQty;
    rateInp.value = customRate;
    $('#qtyLabel', sheet).textContent = `Quantity (${currentUnit})`;
    $('#estBox', sheet).innerHTML = renderCalc();
    $('#addBtn', sheet).textContent = existing ? 'Update item' : 'Add to order';
    $$('#unitChips .chip', sheet).forEach(c => c.setAttribute('aria-pressed', String(c.dataset.u === currentUnit)));
  };

  sheet.querySelector('#unitChips').addEventListener('click', e => {
    const btn = e.target.closest('[data-u]');
    if (!btn) return;
    currentUnit = btn.dataset.u;
    update();
  });

  sheet.addEventListener('click', e => {
    const step = e.target.closest('[data-step]');
    if (step) {
      rawQty = Math.max(0.1, Math.round((rawQty + Number(step.dataset.step)) * 100) / 100);
      update();
      return;
    }
    const rstep = e.target.closest('[data-rstep]');
    if (rstep) {
      customRate = Math.max(0, Math.round((customRate + Number(rstep.dataset.rstep)) * 100) / 100);
      update();
      return;
    }
    const set = e.target.closest('[data-set]');
    if (set) {
      rawQty = Number(set.dataset.set);
      update();
    }
  });

  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    rawQty = !isNaN(v) && v >= 0 ? v : 0;
    const estBox = $('#estBox', sheet);
    if (estBox) estBox.innerHTML = renderCalc();
  });
  input.addEventListener('blur', update);

  rateInp.addEventListener('input', () => {
    const v = parseFloat(rateInp.value);
    customRate = !isNaN(v) && v >= 0 ? v : 0;
    const estBox = $('#estBox', sheet);
    if (estBox) estBox.innerHTML = renderCalc();
  });
  rateInp.addEventListener('blur', update);

  narrInp.addEventListener('input', e => {
    narration = e.target.value;
  });

  $('#addBtn', sheet).addEventListener('click', () => {
    rawQty = Math.max(0.01, rawQty || 1);
    const calc = calcItemEntry(item, rawQty, currentUnit, customRate);
    const lineData = {
      item_id: itemId,
      pcs: calc.pcs,
      qty: calc.effectiveQty,
      unit: calc.effectiveUnit,
      entry_qty: calc.rawQty,
      entry_unit: calc.entryUnit,
      rate: customRate,
      narration: (narration || '').trim(),
      actual_weight: existing ? existing.actual_weight : null,
    };

    if (existing) {
      Object.assign(existing, lineData);
    } else {
      S.cart.push(lineData);
    }
    persistCart();
    close();

    if (location.hash.startsWith('#/review')) {
      renderReview();
    } else if (!location.hash || location.hash === '#/') {
      paintGrid();
      paintCartFoot();
    } else {
      go('#/');
    }
    toast(`${rawQty} ${currentUnit} × ${item.name.split(' ').slice(0, 2).join(' ')} added`, 'success');
  });

  const removeBtn = $('#removeBtn', sheet);
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      S.cart = S.cart.filter(l => l !== existing && l.item_id !== itemId);
      persistCart();
      close();
      paintGrid();
      paintCartFoot();
      if (location.hash.startsWith('#/review')) renderReview();
    });
  }
}

function paintCartFoot() {
  if (location.hash.startsWith('#/review') || location.hash.startsWith('#/order/') || location.hash.startsWith('#/done/')) return;
  const t = cartTotals();
  if (!t.lines) {
    foot.innerHTML = '';
    return;
  }
  foot.innerHTML = `
    <div class="cartbar">
      <div class="cart-sum">
        <b class="tabular">${money(t.amount)}</b>
        <span>${t.pcs} pcs · ${kg(t.weight, 1)} est.</span>
      </div>
      <button class="btn btn-primary" id="reviewBtn">${S.editingOrderId ? 'Review changes' : 'Review'} ${icon('arrowRight', 'i i-sm')}</button>
    </div>`;
  $('#reviewBtn').addEventListener('click', () => go('#/review'));
}

/* ------------------------------------------------------------------ */
/* 2. review + save                                                    */
/* ------------------------------------------------------------------ */

function renderReview() {
  if (!S.cart.length) {
    view.innerHTML = `<div class="empty">
      ${icon('box', 'i i-lg')}
      <h3>Your order is empty</h3>
      <p class="small">Add an item first.</p>
      <div style="margin-top:16px"><button class="btn btn-primary" onclick="location.hash='#/'">Pick items</button></div>
    </div>`;
    foot.innerHTML = '';
    return;
  }

  const t = cartTotals();
  const isEditing = Boolean(S.editingOrderId);

  view.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
      <button class="back" id="backBtn" style="margin:0">
        ${icon('chevron-left', 'i i-sm')} Add / edit items
      </button>
      ${isEditing ? `<button class="btn btn-sm btn-ghost" id="cancelEditBtn" type="button" style="color:var(--red)">Cancel edit</button>` : ''}
    </div>

    <div class="page-head" style="margin-bottom:14px">
      <h1>${isEditing ? `Edit ${esc(S.editingOrderNo || 'order')}` : 'Review order'}</h1>
    </div>

    <div class="section">
      <div class="section-title">Customer name <span style="color:var(--red)">*</span></div>
      <div class="cust-combo">
        <div class="searchbar cust-bar">
          ${icon('user')}
          <input id="custInput" type="text" placeholder="Type customer name..." value="${esc(S.customerName)}" autocomplete="off">
          <button type="button" class="icon-btn ${S.customerName ? '' : 'hidden'}" id="clearCust" aria-label="Clear">${icon('close', 'i i-sm')}</button>
        </div>
        <div class="cust-drop hidden" id="custDrop"></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>Items (${S.cart.length})</span>
        <button type="button" class="btn btn-sm btn-soft" id="addMoreItemsBtn">${icon('plus', 'i i-xs')} Add item</button>
      </div>
      <div class="rev-list" id="lines">
        ${S.cart.map((line, idx) => {
          const item = itemById(line.item_id);
          if (!item) return '';
          const qtyVal = line.entry_qty !== undefined ? line.entry_qty : line.pcs;
          const unitVal = line.entry_unit || line.unit || item.order_unit || item.main_unit || 'kg';
          const rateVal = (line.rate !== undefined && line.rate !== null) ? Number(line.rate) : Number(item.rate || 0);
          const calc = calcItemEntry(item, qtyVal, unitVal, rateVal);
          return `<div class="rev-card" data-line="${idx}">
            <div class="rev-card-top">
              <div class="rev-card-title">
                <span class="rev-name">${esc(item.name)}</span>
                ${line.narration ? `<span class="rev-note">${esc(line.narration)}</span>` : ''}
              </div>
              <button type="button" class="rev-del" data-del="${idx}" aria-label="Remove ${esc(item.name)}">${icon('trash', 'i i-sm')}</button>
            </div>
            <div class="rev-ctrl-row">
              <div class="rev-ctrl">
                <span class="rev-lbl">Qty (${esc(unitVal)})</span>
                <div class="mini-step">
                  <button type="button" data-qstep="${idx}" data-delta="-1" aria-label="Decrease">−</button>
                  <input data-rqty="${idx}" inputmode="decimal" value="${qtyVal}" aria-label="Quantity">
                  <button type="button" data-qstep="${idx}" data-delta="1" aria-label="Increase">+</button>
                </div>
              </div>
              <div class="rev-ctrl">
                <span class="rev-lbl">Rate (₹)</span>
                <div class="mini-step">
                  <button type="button" data-rstep="${idx}" data-delta="-1" aria-label="Decrease rate">−</button>
                  <input data-rrate="${idx}" inputmode="decimal" value="${rateVal}" aria-label="Rate">
                  <button type="button" data-rstep="${idx}" data-delta="1" aria-label="Increase rate">+</button>
                </div>
              </div>
            </div>
            <div class="rev-card-foot">
              <span>${kg(calc.weight, 1)} est.</span>
              <b>${money(calc.amount)}</b>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-title">Taken by</div>
      <div class="field">
        <input class="input" id="worker" placeholder="Your name" value="${esc(S.worker)}" autocomplete="name" style="font-size:16px">
      </div>
      <div style="height:10px"></div>
      <div class="field">
        <input class="input" id="note" placeholder="Order note (optional)" value="${esc(S.note || '')}" style="font-size:16px">
      </div>
    </div>

    <div class="total-box">
      <div class="tb-row tb-main">
        <span class="tb-k">Estimated total</span>
        <span class="tb-v">${money(t.amount)}</span>
      </div>
      <div class="tb-row">
        <span class="tb-k">${t.pcs} pcs · ${t.lines} item${t.lines === 1 ? '' : 's'}</span>
        <span class="tb-v">${kg(t.weight, 1)}</span>
      </div>
    </div>
    <div style="height:14px"></div>
  `;

  $('#backBtn').addEventListener('click', () => go('#/'));
  if ($('#addMoreItemsBtn')) {
    $('#addMoreItemsBtn').addEventListener('click', () => go('#/'));
  }
  if (isEditing && $('#cancelEditBtn')) {
    $('#cancelEditBtn').addEventListener('click', () => {
      const orderId = S.editingOrderId;
      S.editingOrderId = null;
      S.editingOrderNo = '';
      S.cart = [];
      persistCart();
      go('#/order/' + orderId);
    });
  }

  $('#note').addEventListener('input', e => { S.note = e.target.value.trim(); });
  $('#worker').addEventListener('input', e => {
    S.worker = e.target.value.trim();
    store.set('worker', S.worker);
  });

  // Direct typable customer name bar with live suggestions (no Walk-in option)
  const custInp = $('#custInput');
  const custDrop = $('#custDrop');
  const clearCust = $('#clearCust');
  let custStamp = 0;

  const showCustMatches = async (val) => {
    const q = (val || '').trim();
    const stamp = ++custStamp;
    try {
      const data = await api('/api/customers?q=' + encodeURIComponent(q));
      if (stamp !== custStamp) return;
      const list = data.customers || [];
      if (!list.length) {
        custDrop.classList.add('hidden');
        custDrop.innerHTML = '';
        return;
      }
      custDrop.innerHTML = list.slice(0, 12).map(c => `
        <button type="button" class="cust-opt" data-pick="${esc(c.name)}" data-phone="${esc(c.phone || '')}">
          <span class="co-name">${esc(c.name)}</span>
          ${c.phone ? `<span class="co-phone">${esc(c.phone)}</span>` : ''}
        </button>`).join('');
      custDrop.classList.remove('hidden');
    } catch (err) {
      custDrop.classList.add('hidden');
    }
  };

  custInp.addEventListener('input', debounce(e => {
    S.customerName = e.target.value;
    clearCust.classList.toggle('hidden', !S.customerName.trim());
    showCustMatches(e.target.value);
  }, 140));
  custInp.addEventListener('focus', () => showCustMatches(custInp.value));
  clearCust.addEventListener('click', () => {
    S.customerName = '';
    S.customerPhone = '';
    custInp.value = '';
    clearCust.classList.add('hidden');
    showCustMatches('');
    custInp.focus();
  });
  custDrop.addEventListener('click', e => {
    const opt = e.target.closest('[data-pick]');
    if (!opt) return;
    S.customerName = opt.dataset.pick || '';
    if (opt.dataset.phone) S.customerPhone = opt.dataset.phone;
    custInp.value = S.customerName;
    clearCust.classList.toggle('hidden', !S.customerName.trim());
    custDrop.classList.add('hidden');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.cust-combo') && custDrop) custDrop.classList.add('hidden');
  }, { once: false });

  const updateLineQty = (idx, val) => {
    const line = S.cart[idx];
    if (!line) return;
    const item = itemById(line.item_id);
    if (!item) return;
    const next = Math.round((Number(val) || 0) * 1000) / 1000;
    if (next <= 0) {
      S.cart.splice(idx, 1);
      persistCart();
      renderReview();
      return;
    }
    const unit = line.entry_unit || line.unit || item.order_unit || item.main_unit || 'kg';
    const calc = calcItemEntry(item, next, unit, line.rate);
    line.entry_qty = next;
    line.entry_unit = calc.entryUnit;
    line.qty = calc.effectiveQty;
    line.unit = calc.effectiveUnit;
    line.pcs = calc.pcs;
    persistCart();
    renderReview();
  };

  const updateLineRate = (idx, val) => {
    const line = S.cart[idx];
    if (!line) return;
    const nextRate = Math.max(0, Math.round((Number(val) || 0) * 100) / 100);
    line.rate = nextRate;
    persistCart();
    renderReview();
  };

  $('#lines').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const idx = Number(del.dataset.del);
      const line = S.cart[idx];
      if (!line) return;
      const item = itemById(line.item_id);
      S.cart.splice(idx, 1);
      persistCart();
      toast(`${item ? item.name : 'Item'} removed`, 'default');
      renderReview();
      return;
    }
    const qstep = e.target.closest('[data-qstep]');
    if (qstep) {
      const idx = Number(qstep.dataset.qstep);
      const line = S.cart[idx];
      if (!line) return;
      const cur = Number(line.entry_qty !== undefined ? line.entry_qty : line.pcs) || 0;
      updateLineQty(idx, cur + Number(qstep.dataset.delta));
      return;
    }
    const rstep = e.target.closest('[data-rstep]');
    if (rstep) {
      const idx = Number(rstep.dataset.rstep);
      const line = S.cart[idx];
      if (!line) return;
      const item = itemById(line.item_id);
      const curRate = (line.rate !== undefined && line.rate !== null) ? Number(line.rate) : Number((item && item.rate) || 0);
      updateLineRate(idx, curRate + Number(rstep.dataset.delta));
    }
  });
  $('#lines').addEventListener('focusin', e => {
    if (e.target.matches('[data-rqty], [data-rrate]')) e.target.select();
  });
  $('#lines').addEventListener('change', e => {
    const qinp = e.target.closest('[data-rqty]');
    if (qinp) { updateLineQty(Number(qinp.dataset.rqty), qinp.value); return; }
    const rinp = e.target.closest('[data-rrate]');
    if (rinp) { updateLineRate(Number(rinp.dataset.rrate), rinp.value); }
  });
  $('#lines').addEventListener('keydown', e => {
    if (e.target.matches('[data-rqty], [data-rrate]') && e.key === 'Enter') e.target.blur();
  });

  foot.innerHTML = `
    <div class="footbar">
      <div class="fb-row">
        <div>
          <div class="fb-k">Estimate</div>
          <div class="fb-total">${money(t.amount)}</div>
        </div>
        <div style="text-align:right">
          <div class="fb-k">Weight</div>
          <div class="fb-v">${kg(t.weight, 1)}</div>
        </div>
      </div>
      <div class="row" style="gap:9px">
        <button class="btn btn-lg" id="shareEstBtn" style="flex:0 0 auto;background:#fff;border:1px solid #cbd5e1;color:var(--navy)">
          ${icon('share', 'i i-sm')} Estimate
        </button>
        <button class="btn btn-success btn-lg" id="saveBtn" style="flex:1">${isEditing ? 'Save changes' : 'Save order'}</button>
      </div>
    </div>`;

  $('#saveBtn').addEventListener('click', saveOrder);
  $('#shareEstBtn').addEventListener('click', () => {
    if (!S.cart.length) {
      toast('Add an item first', 'error');
      return;
    }
    openShareSheet(estimateFromCart());
  });
}

async function saveOrder() {
  if (S.busy) return;
  const t = cartTotals();
  if (!t.lines) return;
  if (!S.customerName.trim()) {
    toast('Enter customer name first', 'error');
    const c = $('#custInput');
    if (c) { c.focus(); c.scrollIntoView({ block: 'center' }); }
    return;
  }
  if (!S.worker.trim()) {
    toast('Type your name in “Taken by” first', 'error');
    const w = $('#worker');
    if (w) { w.focus(); w.scrollIntoView({ block: 'center' }); }
    return;
  }
  S.busy = true;
  const btn = $('#saveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  const linesPayload = S.cart.map(l => ({
    item_id: l.item_id,
    pcs: l.pcs,
    qty: l.qty !== undefined ? l.qty : l.pcs,
    unit: l.unit || 'pcs',
    entry_qty: l.entry_qty !== undefined ? l.entry_qty : (l.qty || l.pcs),
    entry_unit: l.entry_unit || l.unit || 'pcs',
    rate: (l.rate !== undefined && l.rate !== null) ? Number(l.rate) : undefined,
    narration: l.narration || '',
    actual_weight: l.actual_weight !== undefined ? l.actual_weight : null,
  }));

  const payload = {
    client_id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
    customer_name: (S.customerName || '').trim(),
    customer_phone: (S.customerPhone || '').trim(),
    worker: S.worker.trim(),
    note: (S.note || '').trim(),
    lines: linesPayload,
  };

  try {
    if (S.editingOrderId) {
      const res = await api('/api/orders/' + S.editingOrderId + '/update', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const orderId = S.editingOrderId;
      S.editingOrderId = null;
      S.editingOrderNo = '';
      S.cart = [];
      persistCart();
      toast('Order updated', 'success');
      go('#/order/' + orderId);
      return;
    }

    const res = await api('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
    S.cart = [];
    S.customerName = '';
    S.customerPhone = '';
    S.note = '';
    persistCart();
    S.doneOrder = res.order;
    store.set('lastOrder', res.order.id);
    go('#/done/' + res.order.id);
    toast('Order saved', 'success');
    refreshPending();
  } catch (err) {
    if (err.status === 0 && !S.editingOrderId) {
      queueOutbox({ type: 'order', payload });
      S.cart = [];
      persistCart();
      toast('No Wi-Fi — order saved on this phone and will send itself', 'error');
      go('#/orders');
    } else {
      toast(err.message, 'error');
    }
  } finally {
    S.busy = false;
    if (btn) { btn.disabled = false; btn.textContent = S.editingOrderId ? 'Save changes to order' : 'Save order'; }
  }
}

/* ------------------------------------------------------------------ */
/* 3. orders list                                                      */
/* ------------------------------------------------------------------ */

async function renderOrders() {
  view.innerHTML = `
    <div class="page-head">
      <h1>Orders</h1>
      <p>Open an order to enter or correct scale weights, or edit details.</p>
    </div>
    <div class="chips" id="ofilter" style="margin-bottom:14px">
      <button class="chip" data-f="OPEN" aria-pressed="${S.ordersFilter === 'OPEN'}">To weigh</button>
      <button class="chip" data-f="WEIGHED" aria-pressed="${S.ordersFilter === 'WEIGHED'}">Sent</button>
      <button class="chip" data-f="" aria-pressed="${S.ordersFilter === ''}">All</button>
    </div>
    <div id="olist"><div class="skel" style="height:96px;margin-bottom:10px"></div><div class="skel" style="height:96px"></div></div>`;
  foot.innerHTML = '';
  $('#ofilter').addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    S.ordersFilter = b.dataset.f;
    store.set('ordersFilter', S.ordersFilter);
    $$('#ofilter .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.f === S.ordersFilter)));
    loadOrders();
  });
  loadOrders();
}

async function loadOrders() {
  const list = $('#olist');
  if (!list) return;
  try {
    const q = S.ordersFilter ? `?status=${S.ordersFilter}` : '';
    const data = await api('/api/orders' + q);
    S.orders = data.orders;
    setOnline(true);
    if (!data.orders.length) {
      list.innerHTML = `<div class="empty">
        ${icon('receipt', 'i i-lg')}
        <h3>${S.ordersFilter === 'OPEN' ? 'Nothing waiting on the scale' : 'No orders here yet'}</h3>
        <p class="small">${S.ordersFilter === 'OPEN' ? 'New orders appear here until their weight is entered.' : 'Saved orders show up in this list.'}</p>
      </div>`;
      return;
    }
    list.innerHTML = data.orders.map(orderCard).join('');
    list.querySelectorAll('[data-order]').forEach(el => {
      el.addEventListener('click', () => go('#/order/' + el.dataset.order));
    });
  } catch (err) {
    if (err.status === 401) {
      showWorkerGate();
      return;
    }
    setOnline(false);
    list.innerHTML = `<div class="empty">
      ${icon('alert', 'i i-lg')}
      <h3>Could not load orders</h3>
      <p class="small">${esc(err.message)}</p>
      <div style="margin-top:14px"><button class="btn" id="retryOrders">${icon('refresh')} Retry</button></div>
    </div>`;
    const r = $('#retryOrders');
    if (r) r.addEventListener('click', loadOrders);
  }
}

function orderCard(o) {
  const open = o.status === 'OPEN';
  const amount = open ? o.est_amount : o.actual_amount;
  const wt = open ? o.est_weight : o.actual_weight;
  return `
    <button class="order-card" data-order="${o.id}">
      <div class="oc-top">
        <span class="oc-no">${esc(o.order_no)}</span>
        <span class="pill ${open ? 'pill-open' : 'pill-done'}">${open ? 'To weigh' : 'Sent'}</span>
        <span class="spacer"></span>
        <span class="oc-time">${clockTime(o.created_at)}</span>
      </div>
      <div class="oc-customer">${esc(o.customer_name || 'Walk-in customer')}${o.customer_phone ? ` <span class="small muted">· ${esc(o.customer_phone)}</span>` : ''}</div>
      <div class="oc-metrics">
        <div class="oc-metric"><span class="k">Pieces</span><span class="v">${o.pcs}</span></div>
        <div class="oc-metric"><span class="k">${open ? 'Est. weight' : 'Actual weight'}</span><span class="v tabular">${kg(wt, 1)}</span></div>
        <div class="oc-metric"><span class="k">${open ? 'Estimate' : 'Amount'}</span><span class="v tabular">${money(amount)}</span></div>
      </div>
      <div class="oc-cta">${open ? 'Enter scale weight' : 'View / fix weights'} ${icon('chevron-right', 'i i-sm')}</div>
    </button>`;
}

/* ------------------------------------------------------------------ */
/* 4. order detail / weighing                                          */
/* ------------------------------------------------------------------ */

async function renderOrder(orderId) {
  view.innerHTML = `<div class="skel" style="height:80px;margin-bottom:12px"></div>
    <div class="skel" style="height:120px;margin-bottom:10px"></div>
    <div class="skel" style="height:120px"></div>`;
  foot.innerHTML = '';
  let order;
  try {
    order = await api('/api/orders/' + orderId);
    setOnline(true);
  } catch (err) {
    view.innerHTML = `<div class="empty">${icon('alert', 'i i-lg')}
      <h3>Could not open this order</h3><p class="small">${esc(err.message)}</p>
      <div style="margin-top:14px"><button class="btn" onclick="location.hash='#/orders'">Back to orders</button></div></div>`;
    return;
  }
  S.activeOrder = order;
  S.weights = store.get('draft.' + order.id, {});
  paintOrder(order);
}

function paintOrder(order) {
  const weighed = order.status === 'WEIGHED';
  const lines = order.lines_detail;

  const head = `
    <button class="back" id="back">
      ${icon('chevron-left', 'i i-sm')} Orders
    </button>
    <div class="weigh-head">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div>
          <h1>${weighed ? 'Order sent' : 'Enter scale weight'}</h1>
          <div class="meta">${esc(order.order_no)} · ${esc(order.customer_name || 'Walk-in')} · ${clockTime(order.created_at)}</div>
          ${order.customer_phone ? `<div class="meta tiny">Phone: ${esc(order.customer_phone)}</div>` : ''}
          ${order.worker ? `<div class="meta tiny">Taken by ${esc(order.worker)}</div>` : ''}
          ${order.note ? `<div class="meta tiny">Note: ${esc(order.note)}</div>` : ''}
        </div>
        <button class="btn btn-sm btn-soft" id="editOrderBtn" style="white-space:nowrap">${icon('edit', 'i i-sm')} Edit order</button>
      </div>
    </div>`;

  if (weighed) {
    view.innerHTML = head + `
      <div class="card card-pad" style="margin-bottom:12px;background:#f7fdfa;border-color:#c9e8d9">
        <div class="row" style="gap:10px;align-items:flex-start">
          <span style="color:#0c6b47">${icon('check')}</span>
          <div>
            <div class="strong">Weights submitted</div>
            <div class="small muted">${esc(order.weighed_label)} · sent to the office</div>
          </div>
        </div>
      </div>
      ${lines.map(l => `
        <div class="wline done" data-line="${l.id}">
          <div class="wl-top">
            <div class="wl-name">${esc(l.name)}
              ${l.narration ? `<div style="font-size:12px;color:#0369a1;background:#f0f9ff;border:1px solid #bae6fd;padding:2px 6px;border-radius:4px;margin-top:2px;display:inline-block">Note: ${esc(l.narration)}</div>` : ''}
              <div class="wl-sub">${l.pcs} pcs · ${unitQty(l.qty, l.unit)} · ${money(l.rate)}/kg</div>
            </div>
            <button class="btn btn-sm btn-ghost" data-change-weight="${l.id}" style="color:#1b3554;font-size:12px">${icon('edit', 'i i-sm')} Change weight</button>
          </div>
          <div class="row" style="justify-content:space-between;margin-top:6px">
            <span class="muted small">Actual weight</span>
            <span class="strong tabular">${kg(l.actual_weight, 2)}</span>
          </div>
          <div class="row" style="justify-content:space-between;margin-top:4px">
            <span class="muted small">Amount</span>
            <span class="strong tabular">${money(l.actual_amount)}</span>
          </div>
        </div>`).join('')}
      <div class="total-box" style="margin-top:6px">
        <div class="tb-row tb-main"><span class="tb-k">Final amount</span><span class="tb-v">${money(order.actual_amount)}</span></div>
        <div class="tb-row"><span class="tb-k">Actual weight</span><span class="tb-v">${kg(order.actual_weight, 2)}</span></div>
        <div class="tb-row"><span class="tb-k">Estimate was</span><span class="tb-v">${money(order.est_amount)}</span></div>
      </div>
      <div style="height:12px"></div>
      <div class="note-box" style="margin-bottom:20px">${icon('scale', 'i i-sm')}
        <span>If a weight is wrong, tap <b>Change weight</b> on that item to fix it anytime.</span></div>
    `;
    foot.innerHTML = `
      <div class="footbar">
        <div class="row" style="gap:9px">
          <button class="btn btn-lg" id="shareOrderBtn" style="flex:0 0 auto;background:#fff;border:1px solid #cbd5e1;color:#1b3554">
            ${icon('share', 'i i-sm')} Send bill
          </button>
          <button class="btn btn-lg" id="nextBtn" style="flex:1">Back to orders</button>
        </div>
      </div>`;
    $('#back').addEventListener('click', () => go('#/orders'));
    $('#nextBtn').addEventListener('click', () => go('#/orders'));
    $('#shareOrderBtn').addEventListener('click', () => openShareSheet(estimateFromOrder(order)));
    $('#editOrderBtn').addEventListener('click', () => startEditingOrder(order));
    view.querySelectorAll('[data-change-weight]').forEach(b => {
      b.addEventListener('click', () => openFixWeightSheet(order, b.dataset.changeWeight));
    });
    return;
  }

  // OPEN
  view.innerHTML = head + `
    <div class="note-box" style="margin-bottom:14px">${icon('scale', 'i i-sm')}
      <span>Put the pieces on the scale and type the reading for each line. Tap <b>Use est.</b> if the scale matches the estimate.</span>
    </div>
    <div id="wlines">
      ${lines.map(l => {
        const saved = S.weights[l.id];
        const value = saved === undefined || saved === null ? '' : saved;
        return `
        <div class="wline" data-line="${l.id}">
          <div class="wl-top">
            <div class="wl-name">${esc(l.name)}
              ${l.narration ? `<div style="font-size:12px;color:#0369a1;background:#f0f9ff;border:1px solid #bae6fd;padding:2px 6px;border-radius:4px;margin-top:2px;display:inline-block">Note: ${esc(l.narration)}</div>` : ''}
              <div class="wl-sub">${l.pcs} pcs · ${unitQty(l.qty, l.unit)} · est ${kg(l.est_weight, 1)} · ${money(l.rate)}/kg</div>
            </div>
            <span class="pill pill-muted tabular">est ${money(l.est_amount)}</span>
          </div>
          <div class="wl-input">
            <input inputmode="decimal" data-w="${l.id}" value="${esc(value)}" placeholder="0.0" aria-label="Actual weight for ${esc(l.name)}">
            <span class="wl-unit">kg</span>
          </div>
          <div class="wl-est">
            <button class="btn btn-sm btn-soft" data-fill="${l.id}" data-est="${l.est_weight}">${icon('check', 'i i-sm')} Use est. ${kg(l.est_weight, 1)}</button>
            <span class="spacer"></span>
            <span class="small muted tabular" data-line-amt="${l.id}"></span>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div style="height:8px"></div>
  `;

  const recalc = () => {
    let totalW = 0, totalA = 0;
    lines.forEach(l => {
      const raw = S.weights[l.id];
      const w = raw === undefined || raw === '' ? 0 : Number(raw) || 0;
      totalW += w;
      totalA += w * l.rate;
      const amtEl = view.querySelector(`[data-line-amt="${l.id}"]`);
      if (amtEl) amtEl.textContent = w ? money(w * l.rate) : '';
      const box = view.querySelector(`[data-line="${l.id}"]`);
      if (box) box.classList.toggle('done', w > 0);
    });
    const wEl = $('#fbWeight');
    const aEl = $('#fbAmount');
    if (wEl) wEl.textContent = kg(totalW, 2);
    if (aEl) aEl.textContent = money(totalA);
    const submit = $('#submitW');
    if (submit) {
      const ready = lines.every(l => Number(S.weights[l.id]) > 0);
      submit.disabled = !ready;
      submit.textContent = ready ? 'Submit weight' : 'Enter weight for each line';
    }
  };

  foot.innerHTML = `
    <div class="footbar">
      <div class="fb-row">
        <div><div class="fb-k">Total weight</div><div class="fb-v" id="fbWeight">0 kg</div></div>
        <div style="text-align:right"><div class="fb-k">Amount to bill</div><div class="fb-total" id="fbAmount">₹0</div></div>
      </div>
      <div class="row" style="gap:9px">
        <button class="btn btn-lg" id="shareOrderBtn" style="flex:0 0 auto;background:#fff;border:1px solid #cbd5e1;color:#1b3554">
          ${icon('share', 'i i-sm')} Estimate
        </button>
        <button class="btn btn-success btn-lg" id="submitW" style="flex:1">Submit weight</button>
      </div>
    </div>`;

  $('#back').addEventListener('click', () => go('#/orders'));
  $('#editOrderBtn').addEventListener('click', () => startEditingOrder(order));
  const _so = $('#shareOrderBtn');
  if (_so) _so.addEventListener('click', () => openShareSheet(estimateFromOrder(order)));

  view.querySelectorAll('[data-w]').forEach(inp => {
    inp.addEventListener('input', () => {
      const raw = inp.value.replace(/[^0-9.]/g, '');
      if (raw !== inp.value) inp.value = raw;
      S.weights[inp.dataset.w] = raw === '' ? '' : Number(raw);
      store.set('draft.' + order.id, S.weights);
      recalc();
    });
    inp.addEventListener('focus', () => inp.select());
  });

  view.querySelectorAll('[data-fill]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.fill;
      const est = Number(btn.dataset.est) || 0;
      const inp = view.querySelector(`[data-w="${id}"]`);
      if (inp) {
        inp.value = est ? est.toFixed(1).replace(/\.0$/, '') : '0';
        S.weights[id] = Number(inp.value);
        store.set('draft.' + order.id, S.weights);
        recalc();
      }
    });
  });

  $('#submitW').addEventListener('click', () => submitWeights(order));
  recalc();
}

function startEditingOrder(order) {
  S.editingOrderId = order.id;
  S.editingOrderNo = order.order_no;
  S.customerName = order.customer_name || '';
  S.customerPhone = order.customer_phone || '';
  S.worker = order.worker || S.worker || '';
  S.note = order.note || '';
  S.cart = (order.lines_detail || []).map(l => ({
    item_id: l.item_id,
    pcs: l.pcs,
    qty: l.qty,
    unit: l.unit,
    entry_qty: l.entry_qty !== undefined ? l.entry_qty : (l.qty || l.pcs),
    entry_unit: l.entry_unit || l.unit || 'pcs',
    rate: l.rate,
    narration: l.narration || '',
    actual_weight: l.actual_weight,
  }));
  persistCart();
  go('#/review');
}

function openFixWeightSheet(order, lineId) {
  const line = (order.lines_detail || []).find(l => l.id === lineId);
  if (!line) return;

  let currentWeight = line.actual_weight !== null ? line.actual_weight : (line.est_weight || 0);

  const { sheet, close } = openSheet({
    title: `Change weight: ${line.name}`,
    sub: `${line.pcs} pcs · Current: ${kg(line.actual_weight, 2)} · ${money(line.rate)}/kg`,
    body: `
      <div class="field" style="margin-top:8px;margin-bottom:12px">
        <label for="corrWeightInput">Correct scale weight (kg)</label>
        <input class="input" id="corrWeightInput" inputmode="decimal" value="${currentWeight}" placeholder="0.00" style="font-size:22px;font-weight:700">
      </div>
      <div class="estimate-box" id="corrAmtBox">
        <div><div class="k">New line amount</div><div class="v" id="newAmtVal">${money(currentWeight * line.rate)}</div></div>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-block" data-x>Cancel</button>
        <button class="btn btn-primary btn-block" id="saveWeightBtn">Save weight</button>
      </div>`,
    onMount(node) {
      const inp = $('#corrWeightInput', node);
      node.querySelector('[data-x]').addEventListener('click', close);
      inp.focus();
      inp.select();

      inp.addEventListener('input', () => {
        const val = parseFloat(inp.value) || 0;
        $('#newAmtVal', node).textContent = money(val * line.rate);
      });

      $('#saveWeightBtn', node).addEventListener('click', async () => {
        const val = parseFloat(inp.value);
        if (isNaN(val) || val < 0) {
          toast('Enter a valid weight in kg', 'error');
          inp.focus();
          return;
        }
        try {
          await api(`/api/orders/${order.id}/lines/${line.id}/update`, {
            method: 'POST',
            body: JSON.stringify({ actual_weight: val }),
          });
          close();
          toast('Weight updated', 'success');
          renderOrder(order.id);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  });
}

async function submitWeights(order) {
  const lines = order.lines_detail;
  const missing = lines.filter(l => {
    const v = S.weights[l.id];
    return v === undefined || v === '' || Number(v) <= 0;
  });
  if (missing.length) {
    toast(`Enter weight for ${missing[0].name}`, 'error');
    const box = view.querySelector(`[data-line="${missing[0].id}"]`);
    if (box) {
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const inp = box.querySelector('input');
      if (inp) inp.focus();
    }
    return;
  }

  const ok = await confirmSheet({
    title: 'Submit these weights?',
    message: 'The office will see this order straight away and it cannot be changed from the phone.',
    confirmText: 'Yes, submit',
  });
  if (!ok) return;

  const weights = {};
  lines.forEach(l => { weights[l.id] = Number(S.weights[l.id]); });

  const btn = $('#submitW');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  try {
    const res = await api(`/api/orders/${order.id}/weight`, {
      method: 'POST',
      body: JSON.stringify({ weights }),
    });
    store.del('draft.' + order.id);
    S.doneOrder = res.order;
    go('#/done/' + order.id + '?weighed=1');
    toast('Weight sent to the office', 'success');
    refreshPending();
  } catch (err) {
    if (err.status === 0) {
      queueOutbox({ type: 'weight', orderId: order.id, payload: { weights } });
      toast('No Wi-Fi — weight kept on this phone and will send itself', 'error');
      go('#/orders');
    } else {
      toast(err.message, 'error');
    }
  } finally {
    if (btn) {
      const ready = lines.every(l => Number(S.weights[l.id]) > 0);
      btn.disabled = !ready;
      btn.textContent = ready ? 'Submit weight' : 'Enter weight for each line';
    }
  }
}

/* ------------------------------------------------------------------ */
/* 5. confirmation                                                     */
/* ------------------------------------------------------------------ */

async function renderDone(orderId) {
  let weighed = location.hash.includes('weighed=1');
  let order = S.doneOrder && S.doneOrder.id === orderId ? S.doneOrder : null;
  if (!order) {
    try { order = await api('/api/orders/' + orderId); } catch (err) { go('#/orders'); return; }
  }
  if (weighed && order.status !== 'WEIGHED') weighed = false;

  view.innerHTML = `
    <div class="success">
      <div class="success-mark">${icon('check')}</div>
      <h2>${weighed ? 'Sent to the office' : 'Order saved'}</h2>
      <p>${weighed
        ? 'Your scale weights reached the office computer. Nothing else to do.'
        : 'The estimate is on the office computer. Enter the scale weight when material is ready.'}</p>

      <div class="success-card">
        <div class="sc-row"><span class="sc-k">Order</span><span class="sc-v">${esc(order.order_no)}</span></div>
        <div class="sc-row"><span class="sc-k">Customer</span><span class="sc-v">${esc(order.customer_name || 'Walk-in')}</span></div>
        <div class="sc-row"><span class="sc-k">Pieces</span><span class="sc-v">${order.pcs}</span></div>
        <div class="sc-row"><span class="sc-k">${weighed ? 'Actual weight' : 'Estimated weight'}</span><span class="sc-v">${kg(weighed ? order.actual_weight : order.est_weight, 2)}</span></div>
        <div class="sc-row"><span class="sc-k">${weighed ? 'Final amount' : 'Estimate'}</span><span class="sc-v">${money(weighed ? order.actual_amount : order.est_amount)}</span></div>
      </div>

      ${!weighed ? `<button class="btn btn-primary btn-lg btn-block" id="weighNow">${icon('scale')} Enter weight now</button>
        <div style="height:10px"></div>` : ''}
      <button class="btn btn-lg btn-block" id="shareDoneBtn" style="background:#1b3554;color:#fff">
        ${icon('share', 'i i-sm')} Send estimate to customer
      </button>
      <div style="height:10px"></div>
      <button class="btn btn-lg btn-block" id="newOrder">${icon('plus')} Take another order</button>
      <div style="height:10px"></div>
      <button class="btn btn-ghost btn-block" id="toOrders">See all orders</button>
    </div>`;

  foot.innerHTML = '';
  const wn = $('#weighNow');
  if (wn) wn.addEventListener('click', () => go('#/order/' + order.id));
  $('#shareDoneBtn').addEventListener('click', () => openShareSheet(estimateFromOrder(order)));
  $('#newOrder').addEventListener('click', () => { S.doneOrder = null; go('#/'); });
  $('#toOrders').addEventListener('click', () => go('#/orders'));
}

/* ------------------------------------------------------------------ */
/* offline outbox                                                      */
/* ------------------------------------------------------------------ */

function queueOutbox(item) {
  const queue = store.get(WIFI_KEY, []);
  queue.push(item);
  store.set(WIFI_KEY, queue);
}

let flushing = false;
async function flushOutbox() {
  if (flushing) return;
  const queue = store.get(WIFI_KEY, []);
  if (!queue.length) return;
  flushing = true;
  const remaining = [];
  let sent = 0;
  for (const item of queue) {
    try {
      if (item.type === 'order') {
        await api('/api/orders', { method: 'POST', body: JSON.stringify(item.payload) });
      } else if (item.type === 'weight') {
        await api(`/api/orders/${item.orderId}/weight`, {
          method: 'POST', body: JSON.stringify(item.payload),
        });
      }
      sent += 1;
    } catch (err) {
      if (err.status === 0) { remaining.push(item); }
      else { /* rejected by server: drop so it does not block the queue */ }
    }
  }
  store.set(WIFI_KEY, remaining);
  flushing = false;
  if (sent) {
    toast(`${sent} saved item${sent > 1 ? 's' : ''} sent`, 'success');
    setOnline(true);
    refreshPending();
    if (location.hash.startsWith('#/orders')) loadOrders();
  }
  const n = remaining.length;
  if (n) {
    setOnline(false);
  }
}

/* ------------------------------------------------------------------ */

boot();
