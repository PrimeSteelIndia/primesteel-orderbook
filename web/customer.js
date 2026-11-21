/* Prime Steel - Customer Online Order Portal */
'use strict';

const PAGE_LOAD_TIME = Date.now();

const CS = {
  items: [],
  categories: [],
  activeCat: '',
  searchQ: '',
  cart: [],
  submitting: false,
};

document.addEventListener('DOMContentLoaded', initCustomer);

async function initCustomer() {
  wireTabs();
  initStoredPhone();
  wireFloatingCart();
  await loadItems();
}

function wireFloatingCart() {
  const floatBar = document.getElementById('floatingCartBar');
  if (floatBar) {
    floatBar.addEventListener('click', () => {
      const card = document.getElementById('cartCard');
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }
}

function initStoredPhone() {
  const savedPhone = localStorage.getItem('ps.customer_phone') || '';
  if (savedPhone) {
    const p1 = document.getElementById('cPhone');
    const p2 = document.getElementById('myPhoneLookup');
    if (p1) p1.value = savedPhone;
    if (p2) p2.value = savedPhone;
  }
}

function wireTabs() {
  const tabNew = document.getElementById('tabNewOrder');
  const tabMy = document.getElementById('tabMyOrders');
  const btnNew = document.getElementById('tabBtnNew');
  const btnMy = document.getElementById('tabBtnMy');

  btnNew.addEventListener('click', () => {
    btnNew.setAttribute('aria-selected', 'true');
    btnMy.setAttribute('aria-selected', 'false');
    tabNew.classList.remove('hidden');
    tabMy.classList.add('hidden');
    const floatBar = document.getElementById('floatingCartBar');
    if (floatBar && CS.cart.length > 0) floatBar.classList.remove('hidden');
  });

  btnMy.addEventListener('click', () => {
    btnMy.setAttribute('aria-selected', 'true');
    btnNew.setAttribute('aria-selected', 'false');
    tabMy.classList.remove('hidden');
    tabNew.classList.add('hidden');
    const floatBar = document.getElementById('floatingCartBar');
    if (floatBar) floatBar.classList.add('hidden');
    const ph = document.getElementById('myPhoneLookup').value.trim();
    if (ph && ph.length === 10) {
      loadMyOrders(ph);
    }
  });

  document.getElementById('btnSearchMyOrders').addEventListener('click', () => {
    const ph = document.getElementById('myPhoneLookup').value.trim();
    if (!ph || ph.length < 6) {
      toast('Please enter your 10-digit mobile number', 'error');
      return;
    }
    loadMyOrders(ph);
  });

  document.getElementById('btnGoMyOrders').addEventListener('click', () => {
    btnMy.click();
  });

  document.getElementById('btnPlaceAnother').addEventListener('click', () => {
    document.getElementById('orderSuccessBox').classList.add('hidden');
    document.getElementById('custInfoCard').classList.remove('hidden');
    document.getElementById('catalogCard').classList.remove('hidden');
    document.getElementById('cartCard').classList.remove('hidden');
    CS.cart = [];
    renderCart();
  });

  document.getElementById('itemSearch').addEventListener('input', e => {
    CS.searchQ = e.target.value.toLowerCase().trim();
    renderCatalog();
  });

  document.getElementById('btnSubmitOrder').addEventListener('click', submitCustomerOrder);

  // Auto-validate form fields to enable submit button
  ['cName', 'cPhone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateSubmitButton);
  });
}

async function loadItems() {
  try {
    const data = await api('/api/items');
    CS.items = (data.items || []).filter(i => i.active !== 0);
    const catSet = new Set();
    CS.items.forEach(i => { if (i.category) catSet.add(i.category); });
    CS.categories = Array.from(catSet).sort();
    renderCategories();
    renderCatalog();
  } catch (err) {
    toast('Could not load steel catalog: ' + err.message, 'error');
  }
}

function renderCategories() {
  const container = document.getElementById('catChips');
  let html = `<button class="cat-chip ${!CS.activeCat ? 'active' : ''}" data-cat="">All Items</button>`;
  CS.categories.forEach(cat => {
    html += `<button class="cat-chip ${CS.activeCat === cat ? 'active' : ''}" data-cat="${esc(cat)}">${esc(cat)}</button>`;
  });
  container.innerHTML = html;
  container.querySelectorAll('.cat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      CS.activeCat = btn.dataset.cat;
      container.querySelectorAll('.cat-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCatalog();
    });
  });
}

function renderCatalog() {
  const list = document.getElementById('catalogList');
  let filtered = CS.items;

  if (CS.activeCat) {
    filtered = filtered.filter(i => i.category === CS.activeCat);
  }
  if (CS.searchQ) {
    filtered = filtered.filter(i => (i.name || '').toLowerCase().includes(CS.searchQ) || (i.category || '').toLowerCase().includes(CS.searchQ));
  }

  if (!filtered.length) {
    list.innerHTML = `<p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px 0;">No matching steel items found.</p>`;
    return;
  }

  list.innerHTML = filtered.map(item => `
    <div class="catalog-item">
      <div style="flex:1;min-width:0;">
        <div class="catalog-item-name">${esc(item.name)}</div>
        <div style="font-size:11.5px;color:#64748b;">${esc(item.category || 'General')} · ~${item.weight_per_pc || 0} kg/pc</div>
        <div class="catalog-item-rate">₹${(item.rate || 0).toFixed(2)} / ${esc(item.main_unit || 'kg')}</div>
      </div>
      <button class="btn btn-sm btn-primary" onclick="addToCart(${item.id})" style="background:#e07a2a;border-color:#e07a2a;padding:6px 12px;font-size:12px;">+ Add</button>
    </div>
  `).join('');
}

window.addToCart = function (itemId) {
  const item = CS.items.find(i => i.id === itemId);
  if (!item) return;

  const existing = CS.cart.find(c => c.id === item.id);
  if (existing) {
    existing.pcs += 1;
  } else {
    CS.cart.push({
      id: item.id,
      name: item.name,
      category: item.category,
      rate: item.rate || 0,
      weight_per_pc: item.weight_per_pc || 0,
      main_unit: item.main_unit || 'kg',
      pcs: 1,
    });
  }
  toast(`Added ${item.name}`, 'success');
  renderCart();
};

window.changeCartQty = function (itemId, delta) {
  const line = CS.cart.find(c => c.id === itemId);
  if (!line) return;
  line.pcs += delta;
  if (line.pcs <= 0) {
    CS.cart = CS.cart.filter(c => c.id !== itemId);
  }
  renderCart();
};

window.setCartQty = function (itemId, val) {
  const line = CS.cart.find(c => c.id === itemId);
  if (!line) return;
  const num = parseInt(val, 10);
  if (isNaN(num) || num <= 0) {
    CS.cart = CS.cart.filter(c => c.id !== itemId);
  } else {
    line.pcs = Math.min(5000, num);
  }
  renderCart();
};

function renderCart() {
  const list = document.getElementById('cartList');
  const totals = document.getElementById('cartTotalsBar');
  const floatBar = document.getElementById('floatingCartBar');

  if (!CS.cart.length) {
    list.innerHTML = `<p style="color:#94a3b8;font-size:13px;text-align:center;padding:16px 0;">No items selected yet. Tap <strong>+ Add</strong> on items above.</p>`;
    totals.classList.add('hidden');
    if (floatBar) floatBar.classList.add('hidden');
    updateSubmitButton();
    return;
  }

  totals.classList.remove('hidden');
  if (floatBar) floatBar.classList.remove('hidden');

  let totalPcs = 0;
  let totalWeight = 0;
  let totalAmount = 0;

  list.innerHTML = CS.cart.map(line => {
    const lineWeight = line.pcs * line.weight_per_pc;
    const lineAmount = lineWeight * line.rate;
    totalPcs += line.pcs;
    totalWeight += lineWeight;
    totalAmount += lineAmount;

    return `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${esc(line.name)}</div>
          <div class="cart-item-sub">₹${line.rate.toFixed(2)}/kg · Est. ${lineWeight.toFixed(1)} kg · ₹${lineAmount.toFixed(0)}</div>
        </div>
        <div class="cart-qty-ctrl">
          <button class="qty-btn" onclick="changeCartQty(${line.id}, -1)">−</button>
          <input class="qty-val" type="number" min="1" max="5000" value="${line.pcs}" onchange="setCartQty(${line.id}, this.value)">
          <button class="qty-btn" onclick="changeCartQty(${line.id}, 1)">+</button>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('totalPcs').textContent = totalPcs;
  document.getElementById('totalWeight').textContent = totalWeight.toFixed(1) + ' kg';
  const amtFormatted = '₹' + Math.round(totalAmount).toLocaleString('en-IN');
  document.getElementById('totalAmount').textContent = amtFormatted;

  if (floatBar) {
    const floatQty = document.getElementById('floatQty');
    const floatAmt = document.getElementById('floatAmt');
    if (floatQty) floatQty.textContent = `${totalPcs} pcs (${CS.cart.length} item${CS.cart.length > 1 ? 's' : ''})`;
    if (floatAmt) floatAmt.textContent = `${amtFormatted} est.`;
  }

  updateSubmitButton();
}

function updateSubmitButton() {
  const btn = document.getElementById('btnSubmitOrder');
  const name = (document.getElementById('cName').value || '').trim();
  const phone = (document.getElementById('cPhone').value || '').trim();
  const validPhone = /^[0-9]{10}$/.test(phone);

  const canSubmit = name.length >= 2 && validPhone && CS.cart.length > 0 && !CS.submitting;
  btn.disabled = !canSubmit;
}

async function submitCustomerOrder() {
  if (CS.submitting) return;

  const name = (document.getElementById('cName').value || '').trim();
  const phone = (document.getElementById('cPhone').value || '').trim();
  const address = (document.getElementById('cAddress').value || '').trim();
  const note = (document.getElementById('cNote').value || '').trim();
  const hp = (document.getElementById('botHoneypot').value || '').trim();

  if (!name) { toast('Please enter your name', 'error'); return; }
  if (!/^[0-9]{10}$/.test(phone)) { toast('Please enter a valid 10-digit mobile number', 'error'); return; }
  if (!CS.cart.length) { toast('Please select at least one steel item', 'error'); return; }

  const payload = {
    customer_name: name,
    customer_phone: phone,
    address: address,
    note: note ? `[Site: ${address}] ${note}`.trim() : (address ? `[Site: ${address}]` : ''),
    lines: CS.cart.map(l => ({
      item_id: l.id,
      pcs: l.pcs,
      unit: 'pcs',
      qty: l.pcs,
    })),
    t_load: PAGE_LOAD_TIME,
    company_website_url: hp, // Anti-bot honeypot
  };

  CS.submitting = true;
  const btn = document.getElementById('btnSubmitOrder');
  btn.disabled = true;
  btn.textContent = 'Submitting order...';

  try {
    const res = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    localStorage.setItem('ps.customer_phone', phone);

    // Hide order forms and display confirmation receipt
    document.getElementById('custInfoCard').classList.add('hidden');
    document.getElementById('catalogCard').classList.add('hidden');
    document.getElementById('cartCard').classList.add('hidden');

    const successBox = document.getElementById('orderSuccessBox');
    document.getElementById('successOrderNo').textContent = res.order.order_no;
    successBox.classList.remove('hidden');

    const floatBar = document.getElementById('floatingCartBar');
    if (floatBar) floatBar.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    toast('Order ' + res.order.order_no + ' placed successfully!', 'success');
  } catch (err) {
    toast(err.message || 'Could not place order', 'error');
  } finally {
    CS.submitting = false;
    btn.textContent = 'Submit Order Online →';
    updateSubmitButton();
  }
}

async function loadMyOrders(phone) {
  const container = document.getElementById('myOrdersList');
  container.innerHTML = `<p style="color:#64748b;font-size:13px;text-align:center;padding:24px 0;">Loading your orders...</p>`;

  try {
    const data = await api(`/api/customer/orders?phone=${encodeURIComponent(phone)}`);
    const orders = data.orders || [];

    if (!orders.length) {
      container.innerHTML = `
        <div class="cust-card" style="text-align:center;padding:32px 16px;">
          <div style="font-size:32px;margin-bottom:8px;">📦</div>
          <h3 style="margin-bottom:6px;">No orders found</h3>
          <p class="small" style="color:#64748b;">No steel orders found under phone <strong>${esc(phone)}</strong>. Check the number or place a new order.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = orders.map(o => {
      const isWeighed = o.status === 'WEIGHED';
      const wt = isWeighed ? o.actual_weight : o.est_weight;
      const amt = isWeighed ? o.actual_amount : o.est_amount;
      const dateStr = new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

      return `
        <div class="cust-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
            <div>
              <div style="font-weight:700;font-size:15px;color:#0f172a;">${esc(o.order_no)}</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px;">${dateStr}</div>
            </div>
            <span class="status-badge ${isWeighed ? 'status-weighed' : 'status-open'}">
              ${isWeighed ? '✓ Weighed & Ready' : '⏳ Waiting for Weighing'}
            </span>
          </div>

          <div style="background:#f8fafc;border-radius:8px;padding:10px 12px;margin:10px 0;display:grid;grid-template-columns:repeat(3, 1fr);text-align:center;border:1px solid #e2e8f0;">
            <div><span class="totals-lbl">Total Pcs</span><div style="font-weight:700;font-size:14px;">${o.pcs}</div></div>
            <div><span class="totals-lbl">${isWeighed ? 'Scale Weight' : 'Est. Weight'}</span><div style="font-weight:700;font-size:14px;">${(wt || 0).toFixed(1)} kg</div></div>
            <div><span class="totals-lbl">${isWeighed ? 'Final Amount' : 'Est. Amount'}</span><div style="font-weight:700;font-size:14px;color:#e07a2a;">₹${Math.round(amt || 0).toLocaleString('en-IN')}</div></div>
          </div>

          <div style="margin-top:8px;">
            <div style="font-size:11.5px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:6px;">Items Ordered:</div>
            ${(o.lines_detail || []).map(l => `
              <div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px dashed #f1f5f9;">
                <span>${esc(l.name)} × ${l.pcs || l.qty} pcs</span>
                <span style="font-weight:600;color:#334155;">₹${l.rate}/kg</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    container.innerHTML = `<p style="color:#b91c1c;font-size:13px;text-align:center;padding:24px 0;">Error loading orders: ${esc(err.message)}</p>`;
  }
}
