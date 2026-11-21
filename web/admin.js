/* Prime Steel - office dashboard (Windows + Mac browsers) */
'use strict';

const A = {
  tab: 'orders',
  orders: [],
  items: [],
  customers: [],
  stats: null,
  settings: null,
  filter: 'ALL',
  range: 'today',
  q: '',
  itemQuery: '',
  itemCategory: '',
  customerQuery: '',
  openOrder: null,
  timer: null,
  loadedAt: 0,
  busy: false,
};

const main = $('#adminMain');
const app = $('#app');
const gate = $('#loginGate');

/* ------------------------------------------------------------------ */
/* boot / PIN                                                          */
/* ------------------------------------------------------------------ */

async function boot() {
  ADMIN_PIN = sessionStorage.getItem('ps.pin') || '';
  try {
    const settings = await api('/api/settings');
    A.settings = settings;
    showApp();
  } catch (err) {
    if (err.status === 401) showLogin();
    else {
      showApp();
      toast(err.message, 'error');
    }
  }
}

function showLogin() {
  gate.classList.remove('hidden');
  app.classList.add('hidden');
  gate.innerHTML = `
    <div class="login-card">
      <img src="/logo.png" alt="Prime Steel" style="height:48px;width:auto;max-width:180px;margin:0 auto 14px;display:block;object-fit:contain">
      <h1>Office Dashboard</h1>
      <p>Enter the Admin Password or PIN to unlock.</p>
      <div style="position:relative">
        <input class="input pin-input" id="pinInput" type="password" autocomplete="current-password" aria-label="Admin Password" placeholder="Password or PIN" style="letter-spacing:normal">
      </div>
      <div style="height:12px"></div>
      <button class="btn btn-primary btn-lg btn-block" id="pinBtn">Unlock</button>
      <p class="tiny muted" style="margin-top:14px">Locked for security. Anyone can order from the public link, but only the owner can access this panel.</p>
    </div>`;
  const inp = $('#pinInput');
  inp.focus();
  const submit = async () => {
    const pin = inp.value.trim();
    if (!pin) { toast('Please enter password', 'error'); return; }
    try {
      const r = await api('/api/pin/check', { method: 'POST', body: JSON.stringify({ pin }) });
      if (!r.ok) { toast('Incorrect password', 'error'); inp.select(); return; }
      ADMIN_PIN = pin;
      sessionStorage.setItem('ps.pin', pin);
      const settings = await api('/api/settings');
      A.settings = settings;
      gate.classList.add('hidden');
      showApp();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  $('#pinBtn').addEventListener('click', submit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function showApp() {
  app.classList.remove('hidden');
  if (A.settings) {
    const nameEl = $('#businessName');
    if (nameEl && A.settings.business_name) nameEl.textContent = A.settings.business_name;
    document.title = (A.settings.business_name || 'Order Book') + ' - Office';
  }
  wireNav();
  switchTab(location.hash.replace('#', '') || 'orders');
  loadStats();
  clearInterval(A.timer);
  A.timer = setInterval(() => {
    if (document.hidden) return;
    if (A.tab === 'orders') loadOrders(true);
    if (A.tab === 'items') loadStats();
    if (A.tab === 'customers') loadCustomers(true);
  }, 15000);
}

function wireNav() {
  $$('.admin-nav button').forEach(b => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });
  $('#addrBtn').addEventListener('click', showAddresses);
  const lockBtn = $('#lockBtn');
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      ADMIN_PIN = '';
      sessionStorage.removeItem('ps.pin');
      showLogin();
      toast('Admin panel locked', 'info');
    });
  }
  window.addEventListener('hashchange', () => switchTab(location.hash.replace('#', '') || 'orders'));
}

function switchTab(tab) {
  A.tab = ['orders', 'items', 'customers', 'settings'].includes(tab) ? tab : 'orders';
  $$('.admin-nav button').forEach(b => {
    if (b.dataset.tab === A.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (A.tab === 'orders') renderOrdersShell();
  if (A.tab === 'items') renderItemsShell();
  if (A.tab === 'customers') renderCustomersShell();
  if (A.tab === 'settings') renderSettings();
}

async function refreshAll() {
  try {
    await Promise.all([loadStats(), loadOrders()]);
    if (A.tab === 'items') await loadItems();
    if (A.tab === 'customers') await loadCustomers();
  } catch (err) { toast(err.message, 'error'); }
}

/* ------------------------------------------------------------------ */
/* ORDERS                                                             */
/* ------------------------------------------------------------------ */

function renderOrdersShell() {
  main.innerHTML = `
    <div class="admin-head">
      <div>
        <h1>Orders</h1>
        <p id="ordersSub">Loading…</p>
      </div>
      <div class="actions">
        <button class="btn btn-sm" id="refreshBtn">${icon('refresh', 'i i-sm')} Refresh</button>
        <button class="btn btn-sm btn-primary" id="exportAllBtn">${icon('download', 'i i-sm')} Export weighed orders</button>
      </div>
    </div>

    <div class="stat-row" id="statRow">
      ${statSkeleton()}
    </div>

    <div class="toolbar">
      <div class="segmented" id="filterSeg">
        <button data-f="ALL" aria-pressed="true">All</button>
        <button data-f="OPEN" aria-pressed="false">To weigh</button>
        <button data-f="WEIGHED" aria-pressed="false">Ready</button>
      </div>
      <select class="select input-sm" id="rangeSel" style="width:auto;min-height:38px">
        <option value="today">Today</option>
        <option value="7">Last 7 days</option>
        <option value="all">All time</option>
      </select>
      <div class="searchbar" style="height:38px;min-height:38px;flex:1;min-width:200px;max-width:340px;padding:0 10px">
        ${icon('search', 'i i-sm')}
        <input id="orderSearch" placeholder="Order no. or customer" style="font-size:14px" value="${esc(A.q)}">
      </div>
      <span class="small muted" id="ordersUpdated" style="margin-left:auto"></span>
    </div>

    <div class="table-wrap" id="ordersTable">
      <div class="skel" style="height:240px"></div>
    </div>`;

  $('#refreshBtn').addEventListener('click', () => refreshAll());
  $('#exportAllBtn').addEventListener('click', exportAll);
  $('#filterSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    A.filter = b.dataset.f;
    $$('#filterSeg button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.f === A.filter)));
    paintOrders();
  });
  const sel = $('#rangeSel');
  sel.value = A.range;
  sel.addEventListener('change', e => { A.range = e.target.value; loadOrders(); });
  $('#orderSearch').addEventListener('input', debounce(e => {
    A.q = e.target.value.trim();
    paintOrders();
  }, 160));
  loadOrders();
}

function statSkeleton() {
  return Array.from({ length: 4 }).map(() => '<div class="stat"><div class="skel" style="height:12px;width:60%"></div><div class="skel" style="height:24px;width:40%;margin-top:8px"></div></div>').join('');
}

async function loadStats() {
  try {
    A.stats = await api('/api/stats');
    paintStats();
    const sub = $('#ordersSub');
    if (sub) sub.textContent = `${A.stats.today_orders} order${A.stats.today_orders === 1 ? '' : 's'} today · ${A.stats.to_weigh} waiting for weight`;
  } catch (err) { /* keep quiet */ }
}

function paintStats() {
  const row = $('#statRow');
  if (!row || !A.stats) return;
  const s = A.stats;
  row.innerHTML = `
    <div class="stat accent">
      <div class="k">To weigh</div>
      <div class="v">${s.to_weigh}</div>
      <div class="s">${money(s.pending_estimate)} estimated</div>
    </div>
    <div class="stat">
      <div class="k">Weighed today</div>
      <div class="v">${s.weighed_today}</div>
      <div class="s">${money(s.value_today)} billed value</div>
    </div>
    <div class="stat">
      <div class="k">Orders today</div>
      <div class="v">${s.today_orders}</div>
      <div class="s">taken on phones</div>
    </div>
    <div class="stat">
      <div class="k">Items in rate list</div>
      <div class="v">${s.items}</div>
      <div class="s">${s.items_without_weight ? `<span style="color:#9a5b06">${s.items_without_weight} without weight</span>` : 'all have weights'}</div>
    </div>`;
}

async function loadOrders(quiet = false) {
  const wrap = $('#ordersTable');
  try {
    const data = await api('/api/orders?limit=400');
    A.orders = data.orders;
    A.loadedAt = Date.now();
    paintOrders();
    const stamp = $('#ordersUpdated');
    if (stamp) stamp.textContent = 'Updated just now';
    if (!quiet) loadStats();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="empty-table">${icon('alert', 'i i-lg')}<div style="margin-top:8px">${esc(err.message)}</div></div>`;
  }
}

function inRange(order) {
  if (A.range === 'all') return true;
  const d = new Date(order.created_at);
  const now = new Date();
  if (A.range === 'today') return d.toDateString() === now.toDateString();
  const days = Number(A.range);
  return now - d < days * 86400000;
}

function visibleOrders() {
  const q = A.q.toLowerCase();
  return A.orders.filter(o => {
    if (A.filter !== 'ALL' && o.status !== A.filter) return false;
    if (!inRange(o)) return false;
    if (q && !(o.order_no.toLowerCase().includes(q) || (o.customer_name || '').toLowerCase().includes(q) || (o.customer_phone || '').includes(q))) return false;
    return true;
  });
}

function paintOrders() {
  const wrap = $('#ordersTable');
  if (!wrap) return;
  const list = visibleOrders();

  if (!list.length) {
    wrap.innerHTML = `<div class="empty-table">
      ${icon('receipt', 'i i-lg')}
      <h3 style="font-size:16px;color:#0e1a2b;margin:10px 0 4px">No orders here</h3>
      <div class="small">${A.filter === 'OPEN' ? 'Everything has been weighed.' : 'Orders taken on the phones will appear here.'}</div>
    </div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data">
      <thead>
        <tr>
          <th>Order</th>
          <th class="hide-sm">Time</th>
          <th>Customer</th>
          <th class="num hide-sm">Pcs</th>
          <th class="num">Est. kg</th>
          <th class="num">Act. kg</th>
          <th class="num hide-sm">Estimate</th>
          <th class="num">Amount</th>
          <th>Status</th>
          <th class="actions">Excel</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(o => {
          const open = o.status === 'OPEN';
          const diff = o.status === 'WEIGHED' ? o.actual_amount - o.est_amount : 0;
          return `<tr class="clickable" data-order="${o.id}">
            <td class="name">${esc(o.order_no)}<span class="sub">${o.lines} item${o.lines === 1 ? '' : 's'}${o.worker ? ' · ' + esc(o.worker) : ''}</span></td>
            <td class="hide-sm">${clockTime(o.created_at)}<span class="sub">${dayLabel(o.created_at)}</span></td>
            <td>${esc(o.customer_name || 'Walk-in')}${o.customer_phone ? `<span class="sub">${esc(o.customer_phone)}</span>` : ''}</td>
            <td class="num hide-sm">${o.pcs}</td>
            <td class="num">${kg(o.est_weight, 1).replace(' kg', '')}</td>
            <td class="num">${o.status === 'WEIGHED' ? kg(o.actual_weight, 1).replace(' kg', '') : '<span class="muted">—</span>'}</td>
            <td class="num hide-sm">${money(o.est_amount)}</td>
            <td class="num"><b>${money(o.status === 'WEIGHED' ? o.actual_amount : o.est_amount)}</b>
              ${o.status === 'WEIGHED' && Math.abs(diff) >= 1 ? `<span class="sub" style="color:${diff > 0 ? '#9a5b06' : '#0c6b47'}">${diff > 0 ? '+' : ''}${money(diff)}</span>` : ''}</td>
            <td><span class="pill ${open ? 'pill-open' : 'pill-done'}">${open ? 'To weigh' : 'Ready'}</span></td>
            <td class="actions">
              <button class="btn btn-sm btn-soft" data-excel="${o.id}" title="Download for Excel">${icon('download', 'i i-sm')}</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('tr[data-order]').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('[data-excel]')) return;
      openOrderDrawer(tr.dataset.order);
    });
  });
  wrap.querySelectorAll('[data-excel]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await downloadFrom('/api/export/order/' + btn.dataset.excel); }
      catch (err) { toast(err.message, 'error'); }
      finally { btn.disabled = false; }
    });
  });
}

async function exportAll() {
  const n = A.orders.filter(o => o.status === 'WEIGHED').length;
  if (!n) { toast('No weighed orders to export yet'); return; }
  const btn = $('#exportAllBtn');
  btn.disabled = true;
  try {
    await downloadFrom('/api/export/ready');
    toast(`${n} weighed order${n === 1 ? '' : 's'} exported`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally { btn.disabled = false; }
}

/* ---------- order drawer ---------- */

async function openOrderDrawer(orderId) {
  let order;
  try { order = await api('/api/orders/' + orderId); }
  catch (err) { toast(err.message, 'error'); return; }
  A.openOrder = order;
  const weighed = order.status === 'WEIGHED';

  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  const drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.innerHTML = `
    <div class="drawer-head">
      <div style="flex:1;min-width:0">
        <div class="row" style="gap:8px;margin-bottom:4px">
          <h2 style="font-size:18px;font-weight:760;letter-spacing:-0.02em">${esc(order.order_no)}</h2>
          <span class="pill ${weighed ? 'pill-done' : 'pill-open'}">${weighed ? 'Ready' : 'To weigh'}</span>
        </div>
        <div class="small muted">${esc(order.customer_name || 'Walk-in customer')} · ${esc(order.created_label)}</div>
      </div>
      <button class="icon-btn" data-x aria-label="Close">${icon('close')}</button>
    </div>
    <div class="drawer-body">
      <div class="kv"><span class="k">Phone</span><span class="v">${esc(order.customer_phone || '—')}</span></div>
      <div class="kv"><span class="k">Taken by</span><span class="v">${esc(order.worker || '—')}</span></div>
      <div class="kv"><span class="k">Weighed</span><span class="v">${weighed ? esc(order.weighed_label) : 'not yet'}</span></div>
      ${order.note ? `<div class="kv"><span class="k">Note</span><span class="v">${esc(order.note)}</span></div>` : ''}

      <div class="section-title" style="margin:18px 0 8px">Items</div>
      ${order.lines_detail.map(l => {
        const w = weighed && l.actual_weight !== null ? l.actual_weight : l.est_weight;
        const entryInfo = l.entry_unit && l.entry_unit !== 'pcs'
          ? `${l.entry_qty} ${l.entry_unit} (${l.pcs} pcs)`
          : `${l.pcs} pcs`;
        return `<div class="dline">
          <div class="dline-top">
            <span class="dline-name">${esc(l.name)}</span>
            <span class="dline-amt">${money(w * l.rate)}</span>
          </div>
          <div class="dline-sub">${entryInfo} · ${kg(w, 2)} ${weighed ? 'actual' : 'estimated'} · ${money(l.rate)}/kg
            ${weighed && Math.abs(l.actual_weight - l.est_weight) >= 0.05 ? ` · est was ${kg(l.est_weight, 2)}` : ''}</div>
          ${l.narration ? `<div style="font-size:12px;color:#0c6b47;font-style:italic;margin-top:4px;display:flex;align-items:center;gap:4px">
            ${icon('edit', 'i i-sm')} Note: “${esc(l.narration)}”</div>` : ''}
          ${weighed ? `<div style="margin-top:6px;display:flex;justify-content:flex-end">
            <button class="btn btn-xs btn-soft" data-fix-line="${l.id}" style="min-height:28px;padding:0 8px;font-size:12px">
              ${icon('edit', 'i i-sm')} Change weight
            </button>
          </div>` : ''}
        </div>`;
      }).join('')}

      <div class="card card-pad" style="margin-top:14px;background:#f8fafc">
        <div class="kv"><span class="k">Estimated weight</span><span class="v">${kg(order.est_weight, 2)}</span></div>
        <div class="kv"><span class="k">${weighed ? 'Actual weight' : 'Pieces'}</span><span class="v">${weighed ? kg(order.actual_weight, 2) : order.pcs}</span></div>
        <div class="kv"><span class="k">Estimate</span><span class="v">${money(order.est_amount)}</span></div>
        ${weighed ? `<div class="kv"><span class="k"><b>Final amount</b></span><span class="v" style="font-size:16px">${money(order.actual_amount)}</span></div>` : ''}
      </div>

      <div class="note-box" style="margin-top:14px">${icon('sheet', 'i i-sm')}
        <span>“Copy rows” copies Item Name, Pieces, and KG to clipboard for pasting into Excel (excluding rate & amount).</span>
      </div>
    </div>
    <div class="drawer-foot">
      <button class="btn btn-primary" data-act="excel">${icon('download', 'i i-sm')} Excel file</button>
      <button class="btn" data-act="copy">${icon('copy', 'i i-sm')} Copy rows</button>
      <button class="btn" data-act="editorder">${icon('edit', 'i i-sm')} Edit order</button>
      <span class="spacer"></span>
      ${weighed
        ? `<button class="btn btn-sm" data-act="reopen">Reopen</button>`
        : `<button class="btn btn-sm" data-act="addweight">Add weight</button>`}
      <button class="btn btn-sm btn-danger" data-act="delete">${icon('trash', 'i i-sm')}</button>
    </div>`;

  document.body.appendChild(backdrop);
  document.body.appendChild(drawer);
  document.body.style.overflow = 'hidden';
  const close = () => {
    backdrop.remove(); drawer.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', close);
  drawer.querySelector('[data-x]').addEventListener('click', close);

  drawer.querySelectorAll('[data-fix-line]').forEach(btn => {
    btn.addEventListener('click', () => {
      openFixWeightAdmin(order, Number(btn.dataset.fixLine), close);
    });
  });

  drawer.querySelector('[data-act="editorder"]').addEventListener('click', () => {
    close();
    openEditOrderAdmin(order);
  });

  drawer.querySelector('[data-act="excel"]').addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    try { await downloadFrom('/api/export/order/' + order.id); }
    catch (err) { toast(err.message, 'error'); }
    finally { e.currentTarget.disabled = false; }
  });

  drawer.querySelector('[data-act="copy"]').addEventListener('click', async () => {
    const rows = (order.lines_detail || []).map(l => {
      const w = (weighed && l.actual_weight !== null && l.actual_weight !== undefined)
        ? l.actual_weight
        : (l.est_weight != null ? l.est_weight : 0);
      const wtStr = typeof w === 'number' ? (Number.isFinite(w) ? w.toFixed(3) : '') : (w || '');
      return [l.name || '', l.pcs != null ? l.pcs : '', wtStr].join('\t');
    });
    try {
      await copyText(rows.join('\n'));
      toast(`Copied ${rows.length} rows (Name, Pcs, KG) — paste into Excel`, 'success');
    } catch (err) {
      toast('Could not copy on this browser', 'error');
    }
  });

  const reopen = drawer.querySelector('[data-act="reopen"]');
  if (reopen) reopen.addEventListener('click', async () => {
    const ok = confirm('Reopen this order so the weight can be entered again?');
    if (!ok) return;
    try {
      await api(`/api/orders/${order.id}/reopen`, { method: 'POST', body: '{}' });
      toast('Order reopened', 'success');
      close(); refreshAll();
    } catch (err) { toast(err.message, 'error'); }
  });

  const addweight = drawer.querySelector('[data-act="addweight"]');
  if (addweight) addweight.addEventListener('click', () => {
    close();
    window.open('/#/order/' + order.id, '_blank');
  });

  drawer.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    const ok = confirm(`Delete ${order.order_no}? This cannot be undone.`);
    if (!ok) return;
    try {
      await api(`/api/orders/${order.id}/delete`, { method: 'POST', body: '{}' });
      toast('Order deleted', 'success');
      close(); refreshAll();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function openFixWeightAdmin(order, lineId, closeDrawer) {
  const line = (order.lines_detail || []).find(l => l.id === lineId);
  if (!line) return;
  const currentWeight = line.actual_weight !== null ? line.actual_weight : (line.est_weight || 0);

  const { sheet, close } = openSheet({
    title: `Change weight: ${line.name}`,
    sub: `${line.pcs} pcs · Current: ${kg(line.actual_weight, 2)} · ${money(line.rate)}/kg`,
    body: `
      <div class="field" style="margin-top:8px;margin-bottom:12px">
        <label for="corrWeightAdmin">Correct scale weight (kg)</label>
        <input class="input" id="corrWeightAdmin" inputmode="decimal" value="${currentWeight}" placeholder="0.00" style="font-size:20px;font-weight:700">
      </div>
      <div class="kv" style="margin-bottom:14px">
        <span class="k">New line amount</span>
        <span class="v" id="corrAmtAdmin">${money(currentWeight * line.rate)}</span>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-block" data-x>Cancel</button>
        <button class="btn btn-primary btn-block" id="saveWeightAdmin">Save weight</button>
      </div>`,
    onMount(node) {
      const inp = $('#corrWeightAdmin', node);
      const amt = $('#corrAmtAdmin', node);
      inp.addEventListener('input', () => {
        const val = parseNumber(inp.value);
        if (amt) amt.textContent = money(val * line.rate);
      });
      node.querySelector('[data-x]').addEventListener('click', close);
      $('#saveWeightAdmin', node).addEventListener('click', async () => {
        const val = parseNumber(inp.value);
        if (val < 0) { toast('Weight cannot be negative', 'error'); return; }
        try {
          await api(`/api/orders/${order.id}/weights`, {
            method: 'POST',
            body: JSON.stringify({ [line.id]: val })
          });
          toast('Weight updated', 'success');
          close();
          if (closeDrawer) closeDrawer();
          openOrderDrawer(order.id);
          refreshAll();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      setTimeout(() => { inp.focus(); inp.select(); }, 100);
    }
  });
}

function openEditOrderAdmin(order) {
  let lines = (order.lines_detail || []).map(l => ({
    id: l.id,
    item_id: l.item_id,
    name: l.name,
    pcs: l.pcs,
    qty: l.qty !== undefined ? l.qty : l.pcs,
    unit: l.unit || 'pcs',
    entry_qty: l.entry_qty !== undefined ? l.entry_qty : (l.qty || l.pcs),
    entry_unit: l.entry_unit || l.unit || 'pcs',
    narration: l.narration || '',
    rate: l.rate,
    actual_weight: l.actual_weight,
  }));

  const { sheet, close } = openSheet({
    title: `Edit order ${order.order_no}`,
    sub: `${order.lines_detail.length} line(s) · Modify customer, items, units, or narrations`,
    body: `
      <div class="field" style="margin-bottom:10px">
        <label for="eoCustName">Customer name</label>
        <input class="input" id="eoCustName" value="${esc(order.customer_name || '')}" placeholder="Customer name">
      </div>
      <div class="field" style="margin-bottom:10px">
        <label for="eoCustPhone">Phone number</label>
        <input class="input" id="eoCustPhone" type="tel" value="${esc(order.customer_phone || '')}" placeholder="Phone number">
      </div>
      <div class="field" style="margin-bottom:14px">
        <label for="eoNote">Order note</label>
        <input class="input" id="eoNote" value="${esc(order.note || '')}" placeholder="Optional order instructions">
      </div>

      <div class="section-title" style="margin:16px 0 8px;display:flex;justify-content:space-between;align-items:center">
        <span>Order items</span>
        <button class="btn btn-xs btn-soft" id="eoAddLineBtn" type="button">${icon('plus', 'i i-xs')} Add item</button>
      </div>

      <div id="eoLinesWrap" style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;max-height:300px;overflow-y:auto"></div>

      <div class="sheet-actions">
        <button class="btn btn-block" data-x>Cancel</button>
        <button class="btn btn-primary btn-block" id="eoSaveBtn">Save order changes</button>
      </div>`,
    onMount(node) {
      node.querySelector('[data-x]').addEventListener('click', close);

      const renderLines = () => {
        const wrap = $('#eoLinesWrap', node);
        if (!wrap) return;
        if (!lines.length) {
          wrap.innerHTML = `<div class="empty-table" style="padding:20px">No items in this order.</div>`;
          return;
        }
        wrap.innerHTML = lines.map((l, idx) => `
          <div class="card card-pad" style="border:1px solid #e3e8ee;padding:12px" data-idx="${idx}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div style="font-weight:700;font-size:14px">${esc(l.name)}</div>
              <button class="btn btn-xs btn-ghost" data-rm-line="${idx}" style="color:#b42318;padding:2px 6px">${icon('close', 'i i-xs')}</button>
            </div>
            <div class="row" style="gap:8px;margin-bottom:8px">
              <div class="field" style="flex:1">
                <label style="font-size:11px">Quantity</label>
                <input class="input input-sm" data-line-qty="${idx}" inputmode="decimal" value="${l.entry_qty || l.qty || l.pcs}">
              </div>
              <div class="field" style="width:110px">
                <label style="font-size:11px">Unit</label>
                <select class="select input-sm" data-line-unit="${idx}">
                  ${['pcs', 'kg', 'feet', 'inch', 'metre', 'bundle', 'sheet'].map(u => `<option value="${u}"${u === (l.entry_unit || l.unit) ? ' selected' : ''}>${u}</option>`).join('')}
                </select>
              </div>
              <div class="field" style="width:100px">
                <label style="font-size:11px">Rate (₹/kg)</label>
                <input class="input input-sm" data-line-rate="${idx}" inputmode="decimal" value="${l.rate || 0}">
              </div>
            </div>
            <div class="field">
              <label style="font-size:11px">Narration (e.g. half sheet, cut 4ft)</label>
              <input class="input input-sm" data-line-narr="${idx}" value="${esc(l.narration || '')}" placeholder="Add narration / cutting instruction">
            </div>
          </div>
        `).join('');

        wrap.querySelectorAll('[data-rm-line]').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.rmLine);
            lines.splice(idx, 1);
            renderLines();
          });
        });

        wrap.querySelectorAll('[data-line-qty]').forEach(inp => {
          inp.addEventListener('input', () => {
            const idx = Number(inp.dataset.lineQty);
            const val = parseNumber(inp.value);
            lines[idx].entry_qty = val;
            lines[idx].qty = val;
            lines[idx].pcs = Math.max(1, Math.round(val));
          });
        });

        wrap.querySelectorAll('[data-line-unit]').forEach(sel => {
          sel.addEventListener('change', () => {
            const idx = Number(sel.dataset.lineUnit);
            lines[idx].entry_unit = sel.value;
            lines[idx].unit = sel.value;
          });
        });

        wrap.querySelectorAll('[data-line-rate]').forEach(inp => {
          inp.addEventListener('input', () => {
            const idx = Number(inp.dataset.lineRate);
            lines[idx].rate = parseNumber(inp.value);
          });
        });

        wrap.querySelectorAll('[data-line-narr]').forEach(inp => {
          inp.addEventListener('input', () => {
            const idx = Number(inp.dataset.lineNarr);
            lines[idx].narration = inp.value;
          });
        });
      };

      renderLines();

      $('#eoAddLineBtn', node).addEventListener('click', () => {
        openSelectOrderLineItem(item => {
          lines.push({
            item_id: item.id,
            name: item.name,
            pcs: 1,
            qty: 1,
            unit: item.order_unit || item.main_unit || 'pcs',
            entry_qty: 1,
            entry_unit: item.order_unit || item.main_unit || 'pcs',
            narration: '',
            rate: item.rate,
            actual_weight: null,
          });
          renderLines();
        });
      });

      $('#eoSaveBtn', node).addEventListener('click', async () => {
        if (!lines.length) {
          toast('Order must have at least one line', 'error');
          return;
        }
        const saveBtn = $('#eoSaveBtn', node);
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
          await api(`/api/orders/${order.id}/update`, {
            method: 'POST',
            body: JSON.stringify({
              customer_name: $('#eoCustName', node).value.trim(),
              customer_phone: $('#eoCustPhone', node).value.trim(),
              note: $('#eoNote', node).value.trim(),
              lines: lines.map(l => ({
                id: l.id,
                item_id: l.item_id,
                pcs: l.pcs || 1,
                qty: l.qty || l.entry_qty || 1,
                unit: l.unit || l.entry_unit || 'pcs',
                entry_qty: l.entry_qty || l.qty || 1,
                entry_unit: l.entry_unit || l.unit || 'pcs',
                narration: l.narration || '',
                rate: l.rate,
                actual_weight: l.actual_weight,
              }))
            })
          });
          close();
          toast('Order updated successfully', 'success');
          openOrderDrawer(order.id);
          refreshAll();
        } catch (err) {
          toast(err.message, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save order changes';
        }
      });
    }
  });
}

function openSelectOrderLineItem(onSelect) {
  const { sheet, close } = openSheet({
    title: 'Select an item to add',
    sub: 'Choose an item from the rate list',
    body: `
      <div class="searchbar" style="margin-bottom:12px;height:42px">
        ${icon('search', 'i i-sm')}
        <input id="lineItemSearch" placeholder="Search item..." style="font-size:14px">
      </div>
      <div id="lineItemList" style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:6px"></div>`,
    onMount(node) {
      const search = $('#lineItemSearch', node);
      const listWrap = $('#lineItemList', node);

      const render = () => {
        const q = (search.value || '').toUpperCase();
        const matches = A.items.filter(i => i.active && (!q || i.name.toUpperCase().includes(q)));
        listWrap.innerHTML = matches.slice(0, 50).map(i => `
          <button class="btn btn-block btn-soft" data-sel-item="${i.id}" style="justify-content:space-between;text-align:left;height:auto;padding:8px 12px">
            <span style="font-weight:650">${esc(i.name)}</span>
            <span class="small muted">${money(i.rate)}/${i.main_unit || 'kg'} · ${i.order_unit || i.main_unit || 'pcs'}</span>
          </button>
        `).join('') || '<div class="small muted" style="padding:16px;text-align:center">No item matched</div>';

        listWrap.querySelectorAll('[data-sel-item]').forEach(b => {
          b.addEventListener('click', () => {
            const item = A.items.find(i => i.id === Number(b.dataset.selItem));
            if (item) {
              close();
              onSelect(item);
            }
          });
        });
      };

      search.addEventListener('input', debounce(render, 100));
      render();
      setTimeout(() => search.focus(), 100);
    }
  });
}

/* ------------------------------------------------------------------ */
/* ITEMS                                                              */
/* ------------------------------------------------------------------ */

function renderItemsShell() {
  main.innerHTML = `
    <div class="admin-head">
      <div>
        <h1>Rate list</h1>
        <p id="itemsSub">Rate per kg and weight per piece decide every estimate.</p>
      </div>
      <div class="actions">
        <input type="file" id="excelFileInput" accept=".xlsm,.xlsx" style="display:none">
        <button class="btn btn-sm btn-primary" id="uploadExcelBtn" style="background:#e07a2a;border-color:#e07a2a" title="Upload COMPANY STUDY_backup.xlsm to update rates">${icon('upload', 'i i-sm')} Upload Excel Rates</button>
        <button class="btn btn-sm btn-soft" id="syncExcelBtn" title="Sync rates & weight from local file path">${icon('refresh', 'i i-sm')} Sync Local</button>
        <button class="btn btn-sm" id="addItemBtn">${icon('plus', 'i i-sm')} Add item</button>
        <button class="btn btn-sm" id="bulkBtn">${icon('sheet', 'i i-sm')} Bulk update</button>
        <button class="btn btn-sm" id="csvBtn">${icon('download', 'i i-sm')} CSV</button>
      </div>
    </div>
    <div id="itemsAlert"></div>
    <div class="toolbar">
      <div class="searchbar" style="height:38px;min-height:38px;flex:1;min-width:200px;max-width:340px;padding:0 10px">
        ${icon('search', 'i i-sm')}
        <input id="itemSearch" placeholder="Search item" style="font-size:14px" value="${esc(A.itemQuery)}">
      </div>
      <select class="select input-sm" id="catSel" style="width:auto;min-height:38px">
        <option value="">All categories</option>
      </select>
      <span class="small muted" id="itemsCount" style="margin-left:auto"></span>
    </div>
    <div class="table-wrap" id="itemsTable"><div class="skel" style="height:300px"></div></div>`;

  const uploadBtn = $('#uploadExcelBtn');
  const fileInp = $('#excelFileInput');
  if (uploadBtn && fileInp) {
    uploadBtn.addEventListener('click', () => fileInp.click());
    fileInp.addEventListener('change', async () => {
      const file = fileInp.files[0];
      if (!file) return;
      uploadBtn.disabled = true;
      uploadBtn.innerHTML = `${icon('refresh', 'i i-sm')} Uploading...`;
      try {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const b64 = reader.result;
            const res = await api('/api/rates/upload', {
              method: 'POST',
              body: JSON.stringify({ file_b64: b64, filename: file.name })
            });
            toast(`Rates Updated: ${res.updated} updated, ${res.created} created from ${file.name}`, 'success');
            await loadItems();
          } catch (e) {
            toast(e.message, 'error');
          } finally {
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = `${icon('upload', 'i i-sm')} Upload Excel Rates`;
            fileInp.value = '';
          }
        };
        reader.readAsDataURL(file);
      } catch (err) {
        toast(err.message, 'error');
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = `${icon('upload', 'i i-sm')} Upload Excel Rates`;
        fileInp.value = '';
      }
    });
  }

  const syncBtn = $('#syncExcelBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      syncBtn.innerHTML = `${icon('refresh', 'i i-sm')} Syncing...`;
      try {
        const res = await api('/api/items/sync-excel', { method: 'POST', body: '{}' });
        toast(`Synced from Excel: ${res.updated} updated, ${res.created} created (${res.unchanged} unchanged)`, 'success');
        await loadItems();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        syncBtn.disabled = false;
        syncBtn.innerHTML = `${icon('refresh', 'i i-sm')} Sync from Excel`;
      }
    });
  }

  $('#addItemBtn').addEventListener('click', openAddItem);
  $('#bulkBtn').addEventListener('click', openBulk);
  $('#csvBtn').addEventListener('click', downloadItemsCsv);
  $('#itemSearch').addEventListener('input', debounce(e => {
    A.itemQuery = e.target.value.trim();
    paintItems();
  }, 120));
  $('#catSel').addEventListener('change', e => { A.itemCategory = e.target.value; paintItems(); });
  loadItems();
}

async function loadItems() {
  try {
    const data = await api('/api/items?all=1');
    A.items = data.items;
    const cats = [...new Set(A.items.map(i => i.category).filter(Boolean))].sort();
    const sel = $('#catSel');
    if (sel) {
      sel.innerHTML = '<option value="">All categories</option>' +
        cats.map(c => `<option value="${esc(c)}"${c === A.itemCategory ? ' selected' : ''}>${esc(c)}</option>`).join('');
    }
    paintItems();
    loadStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function paintItems() {
  const wrap = $('#itemsTable');
  if (!wrap) return;
  const cats = Array.from(new Set(A.items.map(i => i.category).filter(Boolean))).sort();
  const sel = $('#catSel');
  if (sel && sel.options.length <= 1) {
    sel.innerHTML = '<option value="">All categories</option>' +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if (A.itemCategory) sel.value = A.itemCategory;
  }

  const q = A.itemQuery.toUpperCase();
  const list = A.items
    .filter(i => (!A.itemCategory || i.category === A.itemCategory)
      && (!q || i.name.toUpperCase().includes(q)))
    .sort((a, b) => {
      const ac = a.category || '';
      const bc = b.category || '';
      if (ac !== bc) return ac.localeCompare(bc);
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });

  const cnt = $('#itemsCount');
  if (cnt) cnt.textContent = `${list.length} of ${A.items.length} items`;
  const sub = $('#itemsSub');
  if (sub) sub.textContent = 'Tap a rate or weight to change it. It saves when you leave the box.';

  if (!list.length) {
    wrap.innerHTML = `<div class="empty-table">${icon('box', 'i i-lg')}<div style="margin-top:8px">No items match.</div></div>`;
    return;
  }

  const rows = list.map(i => {
    const noWeight = i.weight_per_pc <= 0 && Number(i.alt_factor) <= 0 && Number(i.alt_unit2_factor) <= 0;
    return `<tr data-item="${i.id}"${i.active ? '' : ' class="row-hidden"'}>
      <td class="name" style="min-width:150px">
        <input class="rate-input" data-field="name" value="${esc(i.name)}" style="text-align:left;font-weight:600;width:100%" aria-label="Item name">
        ${noWeight && (i.main_unit || 'kg') === 'kg' ? '<span class="pill pill-warn" style="margin-top:2px;display:inline-block">weight not set</span>' : ''}
      </td>
      <td><input class="rate-input" data-field="category" list="catDatalist" value="${esc(i.category || '')}" style="width:74px;text-align:center;text-transform:uppercase" placeholder="CAT" aria-label="Category"></td>
      <td><input class="rate-input" data-field="order_unit" value="${esc(i.order_unit || '')}" style="width:56px;text-align:center" placeholder="pcs" aria-label="Order unit"></td>
      <td class="num"><input class="rate-input" data-field="rate" inputmode="decimal" value="${i.rate ? i.rate : ''}" style="width:78px" placeholder="0" aria-label="Rate"></td>
      <td class="num"><input class="rate-input" data-field="weight_per_pc" inputmode="decimal" value="${i.weight_per_pc ? i.weight_per_pc : ''}" style="width:74px" placeholder="—" aria-label="Weight per piece in kg"></td>
      <td class="actions">
        <button class="btn btn-sm btn-soft" data-edit-item="${i.id}" title="Units, length and other details">${icon('edit', 'i i-sm')}</button>
        <button class="btn btn-sm btn-ghost" data-toggle="${i.id}" title="${i.active ? 'Hide from the phone app' : 'Show on the phone app'}">${i.active ? 'Hide' : 'Show'}</button>
        <button class="btn btn-sm btn-ghost" data-del-item="${i.id}" title="Delete this item" style="color:#b42318">${icon('trash', 'i i-sm')}</button>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <datalist id="catDatalist">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <table class="data items">
      <thead>
        <tr>
          <th>Item name</th>
          <th>Category</th>
          <th style="text-align:center;width:64px">Order unit</th>
          <th class="num">Rate ₹</th>
          <th class="num">Weight / pc</th>
          <th class="actions">Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  wrap.querySelectorAll('[data-field]').forEach(inp => {
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('change', () => saveItemField(inp));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });

  wrap.querySelectorAll('[data-edit-item]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = A.items.find(i => i.id === Number(btn.dataset.editItem));
      if (item) openEditItem(item);
    });
  });

  wrap.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = A.items.find(i => i.id === Number(btn.dataset.toggle));
      if (!item) return;
      try {
        await api(`/api/items/${item.id}/update`, {
          method: 'POST',
          body: JSON.stringify({ active: !item.active }),
        });
        toast(item.active ? 'Hidden from phones' : 'Showing on phones', 'success');
        await loadItems();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  wrap.querySelectorAll('[data-del-item]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = A.items.find(i => i.id === Number(btn.dataset.delItem));
      if (item) deleteItem(item);
    });
  });
}

async function saveItemField(input) {
  const row = input.closest('[data-item]');
  const id = Number(row.dataset.item);
  const field = input.dataset.field;
  const raw = input.value.trim();
  const item = A.items.find(i => i.id === id);
  if (!item) return;

  let value;
  if (field === 'name') {
    value = raw;
    if (!value) {
      toast('Item name cannot be empty', 'error');
      input.value = item.name;
      return;
    }
    if (item.name === value) return;
  } else if (field === 'category') {
    value = raw.toUpperCase();
    if ((item.category || '') === value) return;
  } else if (field === 'main_unit' || field === 'order_unit' || field === 'alt_unit' || field === 'alt_unit2') {
    value = raw.toLowerCase();
    if ((item[field] || '') === value) return;
  } else {
    value = raw === '' ? 0 : parseNumber(raw);
    if (value < 0) {
      toast('Cannot be negative', 'error');
      input.value = item[field] || '';
      return;
    }
    if (Number(item[field]) === value) return;
  }

  input.classList.add('saving');
  try {
    const res = await api(`/api/items/${id}/update`, {
      method: 'POST',
      body: JSON.stringify({ [field]: value }),
    });
    Object.assign(item, res.item);
    input.classList.remove('saving');
    input.value = item[field] !== undefined ? item[field] : '';
    if (field === 'category') {
      const cats = [...new Set(A.items.map(i => i.category).filter(Boolean))].sort();
      const sel = $('#catSel');
      if (sel) {
        sel.innerHTML = '<option value="">All categories</option>' +
          cats.map(c => `<option value="${esc(c)}"${c === A.itemCategory ? ' selected' : ''}>${esc(c)}</option>`).join('');
      }
      const dl = $('#catDatalist');
      if (dl) {
        dl.innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
      }
    }
    toast('Saved', 'success');
  } catch (err) {
    input.classList.remove('saving');
    input.value = item[field] || '';
    toast(err.message, 'error');
  }
}

function openEditItem(item) {
  const cats = [...new Set(A.items.map(i => i.category).filter(Boolean))].sort();
  const { sheet, close } = openSheet({
    title: `Edit: ${item.name}`,
    sub: `Modify item rate, units, weights, and secondary conversion factors.`,
    body: `
      <div class="field" style="margin-bottom:12px">
        <label for="eiName">Item name *</label>
        <input class="input" id="eiName" value="${esc(item.name || '')}" autocomplete="off">
      </div>
      <div class="field" style="margin-bottom:12px">
        <label for="eiCat">Category</label>
        <input class="input" id="eiCat" list="eiCatList" value="${esc(item.category || '')}" placeholder="SS, GI, MS, COIL, PIPE..." autocomplete="off" style="text-transform:uppercase">
        <datalist id="eiCatList">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      </div>
      <div class="row" style="gap:10px;margin-bottom:12px">
        <div class="field" style="flex:1">
          <label for="eiRate">Rate (₹ per main unit) *</label>
          <input class="input" id="eiRate" inputmode="decimal" value="${item.rate || 0}">
        </div>
        <div class="field" style="flex:1">
          <label for="eiMainUnit">Main Unit (Rate multiplies with this)</label>
          <input class="input" id="eiMainUnit" value="${esc(item.main_unit || 'kg')}" placeholder="kg">
        </div>
        <div class="field" style="flex:1">
          <label for="eiOrderUnit">Order Unit (default = main unit)</label>
          <input class="input" id="eiOrderUnit" value="${esc(item.order_unit || '')}" placeholder="pcs">
        </div>
      </div>
      <div class="row" style="gap:10px;margin-bottom:12px">
        <div class="field" style="flex:1">
          <label for="eiAltUnit">Alt Unit 1 (e.g. feet or pcs)</label>
          <input class="input" id="eiAltUnit" value="${esc(item.alt_unit || '')}" placeholder="feet">
        </div>
        <div class="field" style="flex:1">
          <label for="eiAltFactor">Alt 1 Factor (kg per unit)</label>
          <input class="input" id="eiAltFactor" inputmode="decimal" value="${item.alt_factor || 0}" placeholder="e.g. 1.9 kg/ft">
        </div>
      </div>
      <div class="row" style="gap:10px;margin-bottom:12px">
        <div class="field" style="flex:1">
          <label for="eiAltUnit2">Secondary Alt Unit (e.g. pcs)</label>
          <input class="input" id="eiAltUnit2" value="${esc(item.alt_unit2 || '')}" placeholder="pcs">
        </div>
        <div class="field" style="flex:1">
          <label for="eiAltUnit2Factor">Sec Alt Factor (kg per sec unit)</label>
          <input class="input" id="eiAltUnit2Factor" inputmode="decimal" value="${item.alt_unit2_factor || 0}" placeholder="e.g. 100 kg/pc">
        </div>
      </div>
      <div class="row" style="gap:10px;margin-bottom:14px">
        <div class="field" style="flex:1">
          <label for="eiLength">Length per pc (feet)</label>
          <input class="input" id="eiLength" inputmode="decimal" value="${item.length_per_pc || 0}" placeholder="e.g. 52.63 ft">
        </div>
        <div class="field" style="flex:1">
          <label for="eiWeight">Weight per pc (kg)</label>
          <input class="input" id="eiWeight" inputmode="decimal" value="${item.weight_per_pc || 0}" placeholder="e.g. 100 kg">
        </div>
      </div>
      <div class="note-box" style="margin-bottom:14px">
        ${icon('info', 'i i-sm')}
        <span style="font-size:12px"><b>Multi-unit example (Coil):</b> Main = <code>kg</code>, Alt 1 = <code>feet</code> @ <code>1.9</code> kg/ft, Sec Alt = <code>pcs</code> @ <code>100</code> kg/pc (~52.63 ft/pc). Rate multiplies with main unit (kg) only!</span>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-block" data-x>Cancel</button>
        <button class="btn btn-primary btn-block" id="eiSave">Save item</button>
      </div>`,
    onMount(node) {
      $('#eiName', node).focus();
      node.querySelector('[data-x]').addEventListener('click', close);
      $('#eiSave', node).addEventListener('click', async () => {
        const name = $('#eiName', node).value.trim();
        if (!name) { toast('Please enter item name', 'error'); $('#eiName', node).focus(); return; }
        try {
          await api(`/api/items/${item.id}/update`, {
            method: 'POST',
            body: JSON.stringify({
              name,
              category: $('#eiCat', node).value.trim().toUpperCase(),
              rate: parseNumber($('#eiRate', node).value),
              main_unit: ($('#eiMainUnit', node).value.trim() || 'kg').toLowerCase(),
              order_unit: ($('#eiOrderUnit', node).value.trim() || '').toLowerCase(),
              alt_unit: ($('#eiAltUnit', node).value.trim() || '').toLowerCase(),
              alt_factor: parseNumber($('#eiAltFactor', node).value),
              alt_unit2: ($('#eiAltUnit2', node).value.trim() || '').toLowerCase(),
              alt_unit2_factor: parseNumber($('#eiAltUnit2Factor', node).value),
              length_per_pc: parseNumber($('#eiLength', node).value),
              weight_per_pc: parseNumber($('#eiWeight', node).value),
            }),
          });
          close();
          toast('Item updated', 'success');
          await loadItems();
        } catch (err) { toast(err.message, 'error'); }
      });
    }
  });
}

async function deleteItem(item) {
  const ok = confirm(`Delete "${item.name}" from rate list? If it has existing orders, it will be hidden instead.`);
  if (!ok) return;
  try {
    const res = await api(`/api/items/${item.id}/delete`, {
      method: 'POST',
      body: JSON.stringify({ hard: false }),
    });
    if (res.deactivated) {
      toast('Item has past orders, so it was hidden instead', 'info');
    } else {
      toast('Item deleted', 'success');
    }
    await loadItems();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openAddItem() {
  const cats = [...new Set(A.items.map(i => i.category).filter(Boolean))].sort();
  const { sheet, close } = openSheet({
    title: 'Add an item',
    sub: 'It appears on every worker phone immediately with full multi-unit support.',
    body: `
      <div class="field" style="margin-bottom:12px">
        <label for="aiName">Item name *</label>
        <input class="input" id="aiName" placeholder="e.g. Coil 1.9kg/ft or PVC (304) 18G" autocomplete="off">
      </div>
      <div class="field" style="margin-bottom:12px">
        <label for="aiCat">Category</label>
        <input class="input" id="aiCat" list="aiCatList" placeholder="SS, GI, MS, COIL, PIPE…" autocomplete="off" style="text-transform:uppercase">
        <datalist id="aiCatList">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      </div>
      <div class="row" style="gap:10px;margin-bottom:12px">
        <div class="field" style="flex:1">
          <label for="aiRate">Rate (₹ per main unit) *</label>
          <input class="input" id="aiRate" inputmode="decimal" placeholder="0.00">
        </div>
        <div class="field" style="flex:1">
          <label for="aiMainUnit">Main unit (Pricing unit)</label>
          <input class="input" id="aiMainUnit" placeholder="kg" value="kg">
        </div>
        <div class="field" style="flex:1">
          <label for="aiOrderUnit">Order unit (default = main unit)</label>
          <input class="input" id="aiOrderUnit" placeholder="pcs" value="">
        </div>
      </div>
      <div class="row" style="gap:10px;margin-bottom:12px">
        <div class="field" style="flex:1">
          <label for="aiAltUnit">Alt unit 1 (e.g. feet or pcs)</label>
          <input class="input" id="aiAltUnit" placeholder="feet" value="feet">
        </div>
        <div class="field" style="flex:1">
          <label for="aiAltFactor">Alt 1 factor (kg per unit)</label>
          <input class="input" id="aiAltFactor" inputmode="decimal" placeholder="e.g. 1.9">
        </div>
      </div>
      <div class="row" style="gap:10px;margin-bottom:12px">
        <div class="field" style="flex:1">
          <label for="aiAltUnit2">Secondary Alt unit (e.g. pcs)</label>
          <input class="input" id="aiAltUnit2" placeholder="pcs" value="pcs">
        </div>
        <div class="field" style="flex:1">
          <label for="aiAltUnit2Factor">Sec Alt factor (kg per sec unit)</label>
          <input class="input" id="aiAltUnit2Factor" inputmode="decimal" placeholder="e.g. 100">
        </div>
      </div>
      <div class="row" style="gap:10px;margin-bottom:14px">
        <div class="field" style="flex:1">
          <label for="aiLength">Length per pc (ft)</label>
          <input class="input" id="aiLength" inputmode="decimal" placeholder="e.g. 52.63">
        </div>
        <div class="field" style="flex:1">
          <label for="aiWeight">Weight per pc (kg)</label>
          <input class="input" id="aiWeight" inputmode="decimal" placeholder="e.g. 100">
        </div>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-block" data-x>Cancel</button>
        <button class="btn btn-primary btn-block" id="aiSave">Add item</button>
      </div>`,
    onMount(node) {
      $('#aiName', node).focus();
      node.querySelector('[data-x]').addEventListener('click', close);
      $('#aiSave', node).addEventListener('click', async () => {
        const name = $('#aiName', node).value.trim();
        if (!name) { toast('Type the item name'); $('#aiName', node).focus(); return; }
        try {
          await api('/api/items', {
            method: 'POST',
            body: JSON.stringify({
              name,
              category: $('#aiCat', node).value.trim().toUpperCase(),
              rate: parseNumber($('#aiRate', node).value),
              main_unit: ($('#aiMainUnit', node).value.trim() || 'kg').toLowerCase(),
              order_unit: ($('#aiOrderUnit', node).value.trim() || '').toLowerCase(),
              alt_unit: ($('#aiAltUnit', node).value.trim() || '').toLowerCase(),
              alt_factor: parseNumber($('#aiAltFactor', node).value),
              alt_unit2: ($('#aiAltUnit2', node).value.trim() || '').toLowerCase(),
              alt_unit2_factor: parseNumber($('#aiAltUnit2Factor', node).value),
              length_per_pc: parseNumber($('#aiLength', node).value),
              weight_per_pc: parseNumber($('#aiWeight', node).value),
            }),
          });
          close();
          toast('Item added', 'success');
          await loadItems();
        } catch (err) { toast(err.message, 'error'); }
      });
    },
  });
}

function parseBulk(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  for (const line of lines) {
    let cells;
    if (line.includes('\t')) cells = line.split('\t');
    else if (line.includes(',')) cells = line.split(',');
    else cells = line.split(/\s{2,}|\s*\|\s*/);
    const name = (cells[0] || '').trim();
    if (!name) continue;
    if (/^item\s*name$/i.test(name) || /^name$/i.test(name)) continue;
    const rate = cells[1] !== undefined && String(cells[1]).trim() !== '' ? parseNumber(cells[1]) : '';
    const weight = cells[2] !== undefined && String(cells[2]).trim() !== '' ? parseNumber(cells[2]) : '';
    const category = (cells[3] || '').trim().toUpperCase();
    const main_unit = (cells[4] || '').trim();
    const alt_unit = (cells[5] || '').trim();
    const alt_factor = cells[6] !== undefined && String(cells[6]).trim() !== '' ? parseNumber(cells[6]) : '';
    const alt_unit2 = (cells[7] || '').trim();
    const alt_unit2_factor = cells[8] !== undefined && String(cells[8]).trim() !== '' ? parseNumber(cells[8]) : '';
    const length_per_pc = cells[9] !== undefined && String(cells[9]).trim() !== '' ? parseNumber(cells[9]) : '';
    const order_unit = (cells[10] || '').trim();
    rows.push({ name, rate, weight, category, main_unit, alt_unit, alt_factor, alt_unit2, alt_unit2_factor, length_per_pc, order_unit });
  }
  return rows;
}

function downloadItemsCsv() {
  const rows = [['name', 'rate_per_main_unit', 'weight_per_pc', 'category', 'main_unit', 'alt_unit', 'alt_factor', 'alt_unit2', 'alt_unit2_factor', 'length_per_pc', 'order_unit']];
  A.items.forEach(i => rows.push([
    i.name,
    i.rate,
    i.weight_per_pc,
    i.category || '',
    i.main_unit || 'kg',
    i.alt_unit || '',
    i.alt_factor || 0,
    i.alt_unit2 || '',
    i.alt_unit2_factor || 0,
    i.length_per_pc || 0,
    i.order_unit || '',
  ]));
  const csv = rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'PrimeSteel_rate_list.csv');
  toast('Rate list downloaded', 'success');
}

function openBulk() {
  const { sheet, close } = openSheet({
    title: 'Bulk update the rate list',
    sub: 'Paste rows copied from Excel.',
    body: `
      <div class="note-box" style="margin-bottom:12px">${icon('sheet', 'i i-sm')}
        <span>Columns: <b>name</b>, <b>rate per kg</b>, <b>weight per pc</b>, optional category.
        Existing names are updated; new names are added. Leave a cell blank to keep the old value.</span>
      </div>
      <textarea class="textarea" id="bulkText" style="min-height:190px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px"
        placeholder="PVC (202) 20G	186.44	25.2
PVC (304) 20G	295.00	25.6
8X4 CRC 18G	83.50	28.7"></textarea>
      <div style="height:12px"></div>
      <div id="bulkPreview"></div>
      <div class="sheet-actions">
        <button class="btn btn-block" data-x>Cancel</button>
        <button class="btn btn-primary btn-block" id="bulkApply" disabled>Update items</button>
      </div>`,
    onMount(node) {
      const text = $('#bulkText', node);
      const preview = $('#bulkPreview', node);
      const apply = $('#bulkApply', node);
      node.querySelector('[data-x]').addEventListener('click', close);
      let rows = [];

      const refresh = () => {
        rows = parseBulk(text.value);
        if (!rows.length) { preview.innerHTML = ''; apply.disabled = true; apply.textContent = 'Update items'; return; }
        const map = new Map(A.items.map(i => [i.name.trim().toUpperCase().replace(/\s+/g, ' '), i]));
        let created = 0, updated = 0, same = 0;
        const body = rows.slice(0, 60).map(r => {
          const hit = map.get(r.name.trim().toUpperCase().replace(/\s+/g, ' '));
          let tag = 'new', label = 'New';
          if (hit) {
            const changed = (r.rate !== '' && Math.abs(hit.rate - r.rate) > 0.001) ||
              (r.weight !== '' && Math.abs(hit.weight_per_pc - r.weight) > 0.001);
            if (changed) { tag = 'upd'; label = 'Update'; updated++; }
            else { tag = 'same'; label = 'No change'; same++; }
          } else created++;
          return `<tr>
            <td>${esc(r.name)}</td>
            <td class="num">${r.rate === '' ? '—' : esc(r.rate)}</td>
            <td class="num">${r.weight === '' ? '—' : esc(r.weight)}</td>
            <td><span class="pill badge-${tag}">${label}</span></td>
          </tr>`;
        }).join('');
        preview.innerHTML = `
          <div class="small muted" style="margin-bottom:6px">${rows.length} row${rows.length === 1 ? '' : 's'} —
            <b style="color:#0c6b47">${created} new</b>, <b style="color:#1d4ed8">${updated} updates</b>, ${same} unchanged</div>
          <div class="table-wrap" style="max-height:220px;overflow:auto">
            <table class="preview-table"><thead><tr><th>Item</th><th class="num">Rate</th><th class="num">Weight</th><th>Action</th></tr></thead>
            <tbody>${body}</tbody></table>
          </div>`;
        apply.disabled = false;
        apply.textContent = `Update ${rows.length} item${rows.length === 1 ? '' : 's'}`;
      };

      text.addEventListener('input', debounce(refresh, 180));
      text.addEventListener('paste', () => setTimeout(refresh, 30));
      refresh();

      apply.addEventListener('click', async () => {
        if (!rows.length) return;
        apply.disabled = true;
        apply.textContent = 'Updating…';
        try {
          const res = await api('/api/items/bulk', { method: 'POST', body: JSON.stringify({ rows }) });
          close();
          toast(`${res.created} added, ${res.updated} updated`, 'success');
          await loadItems();
        } catch (err) {
          toast(err.message, 'error');
          apply.disabled = false;
          apply.textContent = 'Try again';
        }
      });
    },
  });
  setTimeout(() => { const t = $('#bulkText'); if (t) t.focus(); }, 120);
  return sheet;
}

/* ------------------------------------------------------------------ */
/* CUSTOMERS                                                          */
/* ------------------------------------------------------------------ */

function renderCustomersShell() {
  main.innerHTML = `
    <div class="admin-head">
      <div>
        <h1>Customers</h1>
        <p id="customersSub">Customer names, phone numbers, and order history.</p>
      </div>
      <div class="actions">
        <button class="btn btn-sm btn-primary" id="addCustBtn">${icon('plus', 'i i-sm')} Add customer</button>
        <button class="btn btn-sm btn-soft" id="bulkCustBtn">${icon('sheet', 'i i-sm')} Bulk add</button>
        <button class="btn btn-sm" id="csvCustBtn">${icon('download', 'i i-sm')} CSV</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="searchbar" style="height:38px;min-height:38px;flex:1;min-width:200px;max-width:340px;padding:0 10px">
        ${icon('search', 'i i-sm')}
        <input id="custSearch" placeholder="Search customer name or phone" style="font-size:14px" value="${esc(A.customerQuery)}">
      </div>
      <span class="small muted" id="customersCount" style="margin-left:auto"></span>
    </div>
    <div class="table-wrap" id="customersTable">
      <div class="skel" style="height:260px"></div>
    </div>`;

  $('#addCustBtn').addEventListener('click', openAddCustomer);
  $('#bulkCustBtn').addEventListener('click', openBulkCustomers);
  $('#csvCustBtn').addEventListener('click', downloadCustomersCsv);
  $('#custSearch').addEventListener('input', debounce(e => {
    A.customerQuery = e.target.value.trim();
    paintCustomers();
  }, 120));
  loadCustomers();
}

function openBulkCustomers() {
  const { sheet, close } = openSheet({
    title: 'Bulk add customers',
    sub: 'Paste copied rows from Excel/Sheets or type multiple customers with live preview (no CSV needed).',
    body: `
      <div class="note-box" style="margin-bottom:12px">
        ${icon('sheet', 'i i-sm')}
        <span><b>Paste from Excel or Sheets:</b> Copy columns (Name, Phone, GSTIN, Address) and paste into the box below, or click <b>Add blank row</b> to enter directly in the grid.</span>
      </div>
      <div class="field" style="margin-bottom:12px">
        <label for="bcPaste" style="font-weight:600">Paste text / table rows:</label>
        <textarea class="textarea" id="bcPaste" style="min-height:90px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px"
          placeholder="Ramesh Steel Traders\t9876543210\t08AAAAA0000A1Z5\tJaipur Industrial Area
Gupta Hardware\t9829012345\t\tSikar Road
Sharma & Sons\t9414011223\t08BBBBB1111B2Z6\tTransport Nagar"></textarea>
      </div>
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="small muted" id="bcSummary">0 customers ready</div>
        <button class="btn btn-sm btn-soft" id="bcAddRowBtn">${icon('plus', 'i i-sm')} Add blank row</button>
      </div>
      <div class="table-wrap" style="max-height:280px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:14px">
        <table class="data" id="bcGridTable" style="margin:0">
          <thead>
            <tr>
              <th style="min-width:140px">Customer Name *</th>
              <th style="min-width:110px">Phone</th>
              <th style="min-width:110px">GSTIN</th>
              <th style="min-width:140px">Address / Notes</th>
              <th style="width:85px;text-align:center">Status</th>
              <th style="width:40px"></th>
            </tr>
          </thead>
          <tbody id="bcGridBody">
            <!-- populated dynamically -->
          </tbody>
        </table>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-block" data-x>Cancel</button>
        <button class="btn btn-primary btn-block" id="bcSaveBtn" disabled>Save customers</button>
      </div>`,
    onMount(node) {
      const pasteArea = $('#bcPaste', node);
      const gridBody = $('#bcGridBody', node);
      const summaryEl = $('#bcSummary', node);
      const saveBtn = $('#bcSaveBtn', node);
      const addRowBtn = $('#bcAddRowBtn', node);
      node.querySelector('[data-x]').addEventListener('click', close);

      let rows = [];

      const map = new Map(A.customers.map(c => [(c.name || '').trim().toUpperCase().replace(/\s+/g, ' '), c]));

      const renderGrid = () => {
        if (!rows.length) {
          gridBody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#64748b">No customers entered yet. Paste above or click “Add blank row”.</td></tr>`;
          summaryEl.textContent = '0 customers ready';
          saveBtn.disabled = true;
          saveBtn.textContent = 'Save customers';
          return;
        }

        let newCount = 0, updateCount = 0;
        gridBody.innerHTML = rows.map((r, idx) => {
          const norm = (r.name || '').trim().toUpperCase().replace(/\s+/g, ' ');
          const hit = norm ? map.get(norm) : null;
          if (hit) updateCount++; else if (r.name.trim()) newCount++;
          const statusBadge = !r.name.trim()
            ? '<span class="pill pill-warn">Name required</span>'
            : (hit ? '<span class="pill pill-muted">Will update</span>' : '<span class="pill pill-done">New</span>');

          return `
            <tr data-bc-idx="${idx}">
              <td><input class="rate-input" data-col="name" value="${esc(r.name)}" placeholder="Customer Name *" style="width:100%;text-align:left;font-weight:600"></td>
              <td><input class="rate-input" data-col="phone" value="${esc(r.phone)}" placeholder="Phone number" style="width:100%;text-align:left"></td>
              <td><input class="rate-input" data-col="gstin" value="${esc(r.gstin)}" placeholder="GSTIN" style="width:100%;text-align:left;text-transform:uppercase"></td>
              <td><input class="rate-input" data-col="address" value="${esc(r.address)}" placeholder="Address" style="width:100%;text-align:left"></td>
              <td style="text-align:center">${statusBadge}</td>
              <td style="text-align:center">
                <button class="icon-btn" data-bc-del="${idx}" title="Remove" style="color:#b42318;padding:2px">${icon('trash', 'i i-sm')}</button>
              </td>
            </tr>`;
        }).join('');

        const validCount = rows.filter(r => r.name.trim()).length;
        summaryEl.innerHTML = `<b>${validCount} customer${validCount === 1 ? '' : 's'}</b> ready: <span style="color:#0c6b47">${newCount} new</span>, <span style="color:#1d4ed8">${updateCount} will update</span>`;
        saveBtn.disabled = validCount === 0;
        saveBtn.textContent = `Save ${validCount} customer${validCount === 1 ? '' : 's'}`;
      };

      const parseAndAppend = (text) => {
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        for (const line of lines) {
          let cells;
          if (line.includes('\t')) cells = line.split('\t');
          else if (line.includes(',')) cells = line.split(',');
          else cells = line.split(/\s{2,}|\s*\|\s*/);
          const name = (cells[0] || '').trim();
          if (!name || /^(customer\s*)?name$/i.test(name)) continue;
          const phone = (cells[1] || '').trim();
          const gstin = (cells[2] || '').trim().toUpperCase();
          const address = (cells[3] || '').trim();
          rows.push({ name, phone, gstin, address });
        }
        renderGrid();
      };

      pasteArea.addEventListener('input', () => {
        const val = pasteArea.value.trim();
        if (val) {
          parseAndAppend(val);
          pasteArea.value = '';
        }
      });

      pasteArea.addEventListener('paste', () => {
        setTimeout(() => {
          const val = pasteArea.value.trim();
          if (val) {
            parseAndAppend(val);
            pasteArea.value = '';
          }
        }, 50);
      });

      addRowBtn.addEventListener('click', () => {
        rows.push({ name: '', phone: '', gstin: '', address: '' });
        renderGrid();
        setTimeout(() => {
          const lastInp = gridBody.querySelector(`tr[data-bc-idx="${rows.length - 1}"] input[data-col="name"]`);
          if (lastInp) lastInp.focus();
        }, 30);
      });

      gridBody.addEventListener('input', e => {
        const inp = e.target.closest('input[data-col]');
        if (!inp) return;
        const tr = inp.closest('tr[data-bc-idx]');
        if (!tr) return;
        const idx = Number(tr.dataset.bcIdx);
        const col = inp.dataset.col;
        rows[idx][col] = inp.value;
        if (col === 'name') {
          const norm = inp.value.trim().toUpperCase().replace(/\s+/g, ' ');
          const hit = norm ? map.get(norm) : null;
          const statusCell = tr.children[4];
          if (statusCell) {
            statusCell.innerHTML = !inp.value.trim()
              ? '<span class="pill pill-warn">Name required</span>'
              : (hit ? '<span class="pill pill-muted">Will update</span>' : '<span class="pill pill-done">New</span>');
          }
          const validCount = rows.filter(r => r.name.trim()).length;
          let nC = 0, uC = 0;
          rows.forEach(r => {
            const nm = (r.name || '').trim().toUpperCase().replace(/\s+/g, ' ');
            if (nm) { if (map.get(nm)) uC++; else nC++; }
          });
          summaryEl.innerHTML = `<b>${validCount} customer${validCount === 1 ? '' : 's'}</b> ready: <span style="color:#0c6b47">${nC} new</span>, <span style="color:#1d4ed8">${uC} will update</span>`;
          saveBtn.disabled = validCount === 0;
          saveBtn.textContent = `Save ${validCount} customer${validCount === 1 ? '' : 's'}`;
        }
      });

      gridBody.addEventListener('click', e => {
        const delBtn = e.target.closest('[data-bc-del]');
        if (!delBtn) return;
        const idx = Number(delBtn.dataset.bcDel);
        rows.splice(idx, 1);
        renderGrid();
      });

      saveBtn.addEventListener('click', async () => {
        const validRows = rows.filter(r => r.name.trim());
        if (!validRows.length) return;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving customers…';
        try {
          const res = await api('/api/customers/bulk', {
            method: 'POST',
            body: JSON.stringify({ rows: validRows }),
          });
          close();
          toast(`${res.created} customer${res.created === 1 ? '' : 's'} added, ${res.updated} updated`, 'success');
          await loadCustomers();
        } catch (err) {
          toast(err.message, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save customers';
        }
      });

      renderGrid();
      pasteArea.focus();
    }
  });
}

async function loadCustomers(quiet = false) {
  try {
    // No cap: the list used to stop at 200 while the shop had 383 customers,
    // so the rest were invisible and could never be deleted or edited.
    const data = await api('/api/customers?all=1&limit=100000');
    A.customers = data.customers || [];
    paintCustomers();
    const sub = $('#customersSub');
    if (sub) sub.textContent = `${A.customers.length} registered customer${A.customers.length === 1 ? '' : 's'}`;
  } catch (err) {
    if (!quiet) toast(err.message, 'error');
  }
}

function paintCustomers() {
  const wrap = $('#customersTable');
  if (!wrap) return;
  const q = A.customerQuery.toLowerCase();
  const list = A.customers.filter(c => {
    if (!q) return true;
    return (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.gstin || '').toLowerCase().includes(q);
  });

  const count = $('#customersCount');
  if (count) count.textContent = `${list.length} of ${A.customers.length} customers`;

  if (!list.length) {
    wrap.innerHTML = `<div class="empty-table">
      ${icon('user', 'i i-lg')}
      <h3 style="font-size:16px;color:#0e1a2b;margin:10px 0 4px">No customer found</h3>
      <div class="small">${q ? `No customer matches “${esc(A.customerQuery)}”` : 'Customers added here or from orders appear in this list.'}</div>
    </div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data">
      <thead>
        <tr>
          <th>Customer Name</th>
          <th>Phone Number</th>
          <th class="hide-sm">GSTIN</th>
          <th class="hide-sm">Address / Notes</th>
          <th class="num">Orders</th>
          <th class="actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(c => `
          <tr data-customer="${c.id}">
            <td class="name">
              ${esc(c.name)}
              ${c.order_count > 5 ? ' <span class="pill pill-done">Frequent</span>' : ''}
            </td>
            <td>
              ${c.phone ? `<a href="tel:${esc(c.phone)}" style="font-weight:600;text-decoration:none">${esc(c.phone)}</a>` : '<span class="muted">—</span>'}
            </td>
            <td class="hide-sm">
              ${c.gstin ? `<code>${esc(c.gstin)}</code>` : '<span class="muted">—</span>'}
            </td>
            <td class="hide-sm muted">
              ${esc(c.address || '—')}
            </td>
            <td class="num"><b>${c.order_count || 0}</b></td>
            <td class="actions">
              <button class="btn btn-sm btn-soft" data-edit-cust="${c.id}" title="Edit customer details">${icon('edit', 'i i-sm')} Edit</button>
              <button class="btn btn-sm btn-ghost" data-del-cust="${c.id}" title="Delete customer" style="color:#b42318">${icon('trash', 'i i-sm')}</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('[data-edit-cust]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = A.customers.find(x => x.id === Number(btn.dataset.editCust));
      if (c) openEditCustomer(c);
    });
  });

  wrap.querySelectorAll('[data-del-cust]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = A.customers.find(x => x.id === Number(btn.dataset.delCust));
      if (c) deleteCustomer(c);
    });
  });
}

function openAddCustomer() {
  const { sheet, close } = openSheet({
    title: 'Add a customer',
    sub: 'Worker phones will suggest this name and phone automatically.',
    body: `
      <div class="field" style="margin-bottom:12px">
        <label for="acName">Customer name *</label>
        <input class="input" id="acName" placeholder="e.g. Ramesh Steel Traders" autocomplete="off">
      </div>
      <div class="field" style="margin-bottom:12px">
        <label for="acPhone">Phone number</label>
        <input class="input" id="acPhone" type="tel" inputmode="tel" placeholder="10-digit mobile number" autocomplete="off">
      </div>
      <div class="field" style="margin-bottom:12px">
        <label for="acGstin">GSTIN (optional)</label>
        <input class="input" id="acGstin" placeholder="e.g. 08AAAAA0000A1Z5" autocomplete="off" style="text-transform:uppercase">
      </div>
      <div class="field" style="margin-bottom:14px">
        <label for="acAddress">Address / Notes</label>
        <textarea class="textarea" id="acAddress" placeholder="Site location, delivery address, or notes" style="min-height:80px"></textarea>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-block" data-x>Cancel</button>
        <button class="btn btn-primary btn-block" id="acSave">Save customer</button>
      </div>`,
    onMount(node) {
      $('#acName', node).focus();
      node.querySelector('[data-x]').addEventListener('click', close);
      $('#acSave', node).addEventListener('click', async () => {
        const name = $('#acName', node).value.trim();
        const phone = $('#acPhone', node).value.trim();
        const gstin = $('#acGstin', node).value.trim().toUpperCase();
        const address = $('#acAddress', node).value.trim();
        if (!name) { toast('Please enter customer name', 'error'); $('#acName', node).focus(); return; }
        try {
          await api('/api/customers', {
            method: 'POST',
            body: JSON.stringify({ name, phone, gstin, address })
          });
          close();
          toast('Customer saved', 'success');
          await loadCustomers();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
  });
}

function openEditCustomer(cust) {
  const { sheet, close } = openSheet({
    title: `Edit: ${cust.name}`,
    sub: `${cust.order_count || 0} order${cust.order_count === 1 ? '' : 's'} placed`,
    body: `
      <div class="field" style="margin-bottom:12px">
        <label for="ecName">Customer name *</label>
        <input class="input" id="ecName" value="${esc(cust.name || '')}" autocomplete="off">
      </div>
      <div class="field" style="margin-bottom:12px">
        <label for="ecPhone">Phone number</label>
        <input class="input" id="ecPhone" type="tel" inputmode="tel" value="${esc(cust.phone || '')}" autocomplete="off">
      </div>
      <div class="field" style="margin-bottom:12px">
        <label for="ecGstin">GSTIN</label>
        <input class="input" id="ecGstin" value="${esc(cust.gstin || '')}" autocomplete="off" style="text-transform:uppercase">
      </div>
      <div class="field" style="margin-bottom:14px">
        <label for="ecAddress">Address / Notes</label>
        <textarea class="textarea" id="ecAddress" style="min-height:80px">${esc(cust.address || '')}</textarea>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-block" data-x>Cancel</button>
        <button class="btn btn-primary btn-block" id="ecSave">Update customer</button>
      </div>`,
    onMount(node) {
      $('#ecName', node).focus();
      node.querySelector('[data-x]').addEventListener('click', close);
      $('#ecSave', node).addEventListener('click', async () => {
        const name = $('#ecName', node).value.trim();
        const phone = $('#ecPhone', node).value.trim();
        const gstin = $('#ecGstin', node).value.trim().toUpperCase();
        const address = $('#ecAddress', node).value.trim();
        if (!name) { toast('Please enter customer name', 'error'); $('#ecName', node).focus(); return; }
        try {
          await api(`/api/customers/${cust.id}/update`, {
            method: 'POST',
            body: JSON.stringify({ name, phone, gstin, address })
          });
          close();
          toast('Customer updated', 'success');
          await loadCustomers();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
  });
}

async function deleteCustomer(cust) {
  const ok = confirm(`Delete customer "${cust.name}"?`);
  if (!ok) return;
  try {
    await api(`/api/customers/${cust.id}/delete`, {
      method: 'POST',
      body: '{}'
    });
    toast('Customer deleted', 'success');
    await loadCustomers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function downloadCustomersCsv() {
  const rows = [['name', 'phone', 'gstin', 'address', 'orders_count']];
  A.customers.forEach(c => rows.push([
    c.name || '',
    c.phone || '',
    c.gstin || '',
    c.address || '',
    c.order_count || 0
  ]));
  const csv = rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'PrimeSteel_customers.csv');
  toast('Customers list downloaded', 'success');
}

/* ------------------------------------------------------------------ */
/* SETTINGS                                                           */
/* ------------------------------------------------------------------ */

async function renderSettings() {
  main.innerHTML = `<div class="admin-head"><div><h1>Settings</h1><p>Loading…</p></div></div>`;
  let s;
  try { s = await api('/api/settings'); }
  catch (err) { main.innerHTML = `<div class="empty-table">${esc(err.message)}</div>`; return; }
  A.settings = s;
  const port = s.port;
  const urls = (s.lan || []).map((ip, idx) => ({
    ip,
    label: idx === 0 ? 'Main' : 'Also',
    worker: `http://${ip}:${port}`,
    admin: `http://${ip}:${port}/admin`,
  }));

  const tunnelActive = s.tunnel && s.tunnel.active && s.tunnel.url;
  const tunnelUrl = s.tunnel?.url || '';
  const lastSyncStr = s.excel_sync?.last_sync_time
    ? `Last synced: ${new Date(s.excel_sync.last_sync_time).toLocaleTimeString()} (${s.excel_sync.last_result?.total || 74} items)`
    : 'Watching file for changes';

  main.innerHTML = `
    <div class="admin-head">
      <div><h1>Settings</h1><p>Business name, 24x7 online access, Excel rates sync, and security.</p></div>
    </div>

    <div class="settings-grid">
      <div class="card card-pad">
        <h2 style="font-size:16px;font-weight:740;margin-bottom:14px">Business & Security</h2>
        <div class="field" style="margin-bottom:12px">
          <label for="sName">Business name</label>
          <input class="input" id="sName" value="${esc(s.business_name)}">
        </div>
        <div class="field" style="margin-bottom:12px">
          <label for="sTag">Subtitle on the phone app</label>
          <input class="input" id="sTag" value="${esc(s.tagline)}">
        </div>
        <div class="field" style="margin-bottom:6px">
          <label for="sFolder">Shared folder for finished orders</label>
          <input class="input" id="sFolder" value="${esc(s.shared_folder)}" placeholder="e.g. C:\\Users\\Prime Steel\\Desktop\\PrimeSteel Orders">
          <span class="tiny muted">Leave empty to only keep files in <code>${esc(s.exports_folder)}</code>.</span>
        </div>
        <div style="height:14px"></div>
        <div class="field" style="margin-bottom:6px">
          <label for="sPin">Office Password / PIN (optional)</label>
          <input class="input" id="sPin" type="text" autocomplete="off" placeholder="${s.has_pin ? 'Password/PIN is set — type a new one to change' : 'Min 4 characters (e.g. 1234 or strong password)'}">
          <span class="tiny muted">Blocks the office dashboard and rate edits.${s.has_pin ? ' Leave blank to keep the current PIN.' : ''}</span>
        </div>
        ${s.has_pin ? '<div style="margin-top:6px"><button class="btn btn-sm btn-ghost" id="removePin" style="color:#b42318">Remove PIN</button></div>' : ''}
        <div style="height:14px"></div>
        <div class="field" style="margin-bottom:6px">
          <label for="sWorkerPin">Worker Scale Station PIN</label>
          <input class="input" id="sWorkerPin" type="text" autocomplete="off" value="${esc(s.worker_pin || '1234')}" placeholder="e.g. 1234">
          <span class="tiny muted">Workers must enter this PIN at <code>/worker</code> to access scale weighing and all orders.</span>
        </div>
        <div style="height:16px"></div>
        <button class="btn btn-primary" id="saveSettings">Save settings</button>
      </div>

      <div class="stack" style="gap:16px">
        <div class="card card-pad" style="border-color:${tunnelActive ? '#bfdbfe' : '#e2e8f0'};background:${tunnelActive ? '#f8faff' : '#fff'}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <h2 style="font-size:16px;font-weight:740;margin:0">24x7 Online Access (Cloudflare Tunnel)</h2>
            <span class="pill ${tunnelActive ? 'pill-done' : 'pill-muted'}" style="margin-left:auto">${tunnelActive ? 'Active' : 'Connecting...'}</span>
          </div>
          <p class="small muted" style="margin-bottom:12px">Access Prime Steel securely from any phone, laptop, or home network 24x7 over encrypted HTTPS.</p>
          
          ${tunnelActive ? `
            <div class="url-list">
              <div class="url-item">
                <span class="pill pill-done">phone</span>
                <code>${esc(tunnelUrl)}</code>
                <button class="btn btn-sm" data-copy="${esc(tunnelUrl)}">Copy</button>
              </div>
              <div class="url-item">
                <span class="pill pill-muted">office</span>
                <code>${esc(tunnelUrl + '/admin')}</code>
                <button class="btn btn-sm" data-copy="${esc(tunnelUrl + '/admin')}">Copy</button>
              </div>
            </div>
          ` : `
            <div class="small muted" style="padding:10px;background:#f1f5f9;border-radius:6px;margin-bottom:10px">
              Tunnel is establishing connection. Refresh or check connection.
            </div>
          `}
          
          <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
            <button class="btn btn-sm btn-soft" id="restartTunnelBtn">${icon('refresh', 'i i-sm')} Restart tunnel</button>
          </div>
        </div>

        <div class="card card-pad">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <h2 style="font-size:16px;font-weight:740;margin:0">Excel Rates Sync (Company Study)</h2>
            <span class="pill pill-done" style="margin-left:auto">Auto-sync</span>
          </div>
          <p class="small muted" style="margin-bottom:10px">Automatically pulls Item Rates and Weight/Piece from Setting sheet (H to J) in your Excel file.</p>
          
          <div class="field" style="margin-bottom:10px">
            <label for="sExcelPath">Excel file path</label>
            <input class="input" id="sExcelPath" value="${esc(s.excel_rates_path || '')}">
          </div>
          <div class="tiny muted" style="margin-bottom:12px;padding:6px 10px;background:#f8fafc;border-radius:4px">
            ${icon('check', 'i i-sm')} ${esc(lastSyncStr)}
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm btn-soft" id="syncExcelSettingsBtn">${icon('refresh', 'i i-sm')} Sync rates now</button>
          </div>
        </div>

        <div class="card card-pad">
          <h2 style="font-size:16px;font-weight:740;margin-bottom:6px">Local Network (Wi-Fi)</h2>
          <p class="small muted" style="margin-bottom:12px">Local IP addresses on your shop router.</p>
          <div class="url-list">
            ${urls.length ? urls.map((u, idx) => `
              <div class="url-item">
                <span class="pill ${idx === 0 ? 'pill-done' : 'pill-muted'}">${esc(u.label)}</span>
                <code>${esc(u.worker)}</code>
                <button class="btn btn-sm" data-copy="${esc(u.worker)}">Copy</button>
              </div>
              <div class="url-item">
                <span class="pill pill-muted">office</span>
                <code>${esc(u.admin)}</code>
                <button class="btn btn-sm" data-copy="${esc(u.admin)}">Copy</button>
              </div>`).join('') : '<div class="small muted">No network address found. Is Wi-Fi connected?</div>'}
          </div>
        </div>

        <div class="card card-pad">
          <h2 style="font-size:16px;font-weight:740;margin-bottom:6px">Data</h2>
          <p class="small muted" style="margin-bottom:12px">Everything lives in one file on this computer.</p>
          <div class="kv"><span class="k">Database</span><span class="v" style="font-size:12px">data/prime.db</span></div>
          <div class="kv"><span class="k">Finished order files</span><span class="v" style="font-size:12px">${esc(s.exports_folder)}</span></div>
          <div class="kv"><span class="k">Excel writer</span><span class="v">${s.openpyxl ? '.xlsx' : 'CSV fallback'}</span></div>
          <div style="height:12px"></div>
          <button class="btn" id="backupBtn">${icon('download', 'i i-sm')} Download database backup</button>
          ${s.openpyxl ? '' : `<div class="note-box warn" style="margin-top:12px">${icon('alert', 'i i-sm')}<span>openpyxl is not installed on this computer, so downloads are CSV that Excel opens fine. For .xlsx run <code>pip install openpyxl</code>.</span></div>`}
        </div>
      </div>
    </div>`;

  $('#saveSettings').addEventListener('click', async () => {
    const body = {
      business_name: $('#sName').value.trim(),
      tagline: $('#sTag').value.trim(),
      shared_folder: $('#sFolder').value.trim(),
      excel_rates_path: $('#sExcelPath').value.trim(),
    };
    const pin = $('#sPin').value.trim();
    if (pin) body.admin_pin = pin;
    const wpin = $('#sWorkerPin') ? $('#sWorkerPin').value.trim() : '';
    if (wpin) body.worker_pin = wpin;
    if (!$('#sName').value.trim()) { toast('Business name cannot be empty', 'error'); return; }
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify(body) });
      if (pin) { ADMIN_PIN = pin; sessionStorage.setItem('ps.pin', pin); }
      const nameEl = $('#businessName');
      if (nameEl) nameEl.textContent = body.business_name;
      document.title = body.business_name + ' - Office';
      toast('Saved', 'success');
      renderSettings();
    } catch (err) { toast(err.message, 'error'); }
  });

  const syncSettingsBtn = $('#syncExcelSettingsBtn');
  if (syncSettingsBtn) {
    syncSettingsBtn.addEventListener('click', async () => {
      syncSettingsBtn.disabled = true;
      syncSettingsBtn.innerHTML = `${icon('refresh', 'i i-sm')} Syncing...`;
      try {
        const res = await api('/api/items/sync-excel', { method: 'POST', body: '{}' });
        toast(`Synced from Excel: ${res.updated} updated, ${res.created} created`, 'success');
        renderSettings();
      } catch (err) { toast(err.message, 'error'); }
      finally {
        syncSettingsBtn.disabled = false;
        syncSettingsBtn.innerHTML = `${icon('refresh', 'i i-sm')} Sync rates now`;
      }
    });
  }

  const restartTunnelBtn = $('#restartTunnelBtn');
  if (restartTunnelBtn) {
    restartTunnelBtn.addEventListener('click', async () => {
      restartTunnelBtn.disabled = true;
      try {
        await api('/api/tunnel/restart', { method: 'POST', body: '{}' });
        toast('Tunnel restarting...', 'info');
        setTimeout(renderSettings, 3000);
      } catch (err) { toast(err.message, 'error'); }
      finally { restartTunnelBtn.disabled = false; }
    });
  }

  const removePinBtn = $('#removePin');
  if (removePinBtn) {
    removePinBtn.addEventListener('click', async () => {
      if (!confirm('Remove the PIN? Anyone on the Wi-Fi can then open this dashboard.')) return;
      try {
        await api('/api/settings', { method: 'POST', body: JSON.stringify({ admin_pin: '' }) });
        ADMIN_PIN = '';
        sessionStorage.removeItem('ps.pin');
        toast('PIN removed', 'success');
        renderSettings();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  main.querySelectorAll('[data-copy]').forEach(b => {
    b.addEventListener('click', async () => {
      try { await copyText(b.dataset.copy); toast('Address copied', 'success'); }
      catch { toast('Could not copy', 'error'); }
    });
  });

  $('#backupBtn').addEventListener('click', async () => {
    try { await downloadFrom('/api/backup'); toast('Backup downloaded', 'success'); }
    catch (err) { toast(err.message, 'error'); }
  });
}

function showAddresses() {
  const s = A.settings;
  if (!s) return;
  const urls = (s.lan || []).map(ip => `http://${ip}:${s.port}`);
  const tunnelUrl = s.tunnel && s.tunnel.active && s.tunnel.url ? s.tunnel.url : '';

  openSheet({
    title: 'Access Prime Steel Anywhere',
    sub: 'Open on worker phones or from outside the shop 24x7.',
    body: `
      ${tunnelUrl ? `
        <div style="margin-bottom:14px;padding:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            ${icon('globe', 'i i-sm')}
            <strong style="color:#15803d;font-size:14px">24x7 Online Access (Anywhere / Mobile Data)</strong>
            <span class="pill pill-done" style="margin-left:auto">Online</span>
          </div>
          <div class="url-item" style="margin-top:6px">
            <span class="pill pill-done">phone</span>
            <code>${esc(tunnelUrl)}</code>
            <button class="btn btn-sm" data-copy="${esc(tunnelUrl)}">Copy</button>
          </div>
          <div class="url-item" style="margin-top:6px">
            <span class="pill pill-muted">office</span>
            <code>${esc(tunnelUrl + '/admin')}</code>
            <button class="btn btn-sm" data-copy="${esc(tunnelUrl + '/admin')}">Copy</button>
          </div>
        </div>
      ` : ''}

      <div class="small muted" style="margin-bottom:8px">Local Shop Wi-Fi:</div>
      <div class="url-list">
        ${urls.map(u => `<div class="url-item"><code>${esc(u)}</code>
          <button class="btn btn-sm" data-copy="${esc(u)}">Copy</button></div>`).join('') ||
          '<div class="small muted">No network address found.</div>'}
      </div>
      <div class="note-box" style="margin-top:14px">${icon('phone', 'i i-sm')}
        <span>The first address is the worker app. Add <code>/admin</code> for this dashboard.</span></div>`,
    onMount(node) {
      node.querySelectorAll('[data-copy]').forEach(b => {
        b.addEventListener('click', async () => {
          try { await copyText(b.dataset.copy); toast('Copied', 'success'); }
          catch { toast('Could not copy', 'error'); }
        });
      });
    },
  });
}

/* ------------------------------------------------------------------ */

boot();
