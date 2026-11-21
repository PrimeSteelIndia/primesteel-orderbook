/* ============================================================================
   PRIME STEEL — Customer Online Procurement Portal Logic
   Industrial B2B procurement workflow: real-time catalog filtering,
   synchronized desktop & mobile view switching, dynamic metric tallies,
   and authenticated weighbridge slip inspection.
   ========================================================================== */
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
  wireNavigation();
  wireMobileSteps();
  initStoredPhone();
  wireFloatingCart();
  wireSearchShortcuts();
  await loadItems();
}

/* --------------------------------------------------------------------------
   MOBILE STEP NAVIGATION (Catalog vs Order Panel toggle on small screens)
   -------------------------------------------------------------------------- */
function wireMobileSteps() {
  const btnCat = document.getElementById('btnStepCatalog');
  const btnChk = document.getElementById('btnStepCheckout');
  const btnProceed = document.getElementById('btnProceedDossier');
  const btnBack = document.getElementById('btnBackToCatalog');

  window.setMobileStep = function (step) {
    const isChk = step === 'checkout';
    document.body.classList.toggle('mobile-mode-checkout', isChk);
    document.body.classList.toggle('mobile-mode-catalog', !isChk);
    if (btnCat) btnCat.classList.toggle('active', !isChk);
    if (btnChk) btnChk.classList.toggle('active', isChk);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Default to catalog view on mobile
  document.body.classList.add('mobile-mode-catalog');

  if (btnCat) btnCat.addEventListener('click', () => window.setMobileStep('catalog'));
  if (btnChk) btnChk.addEventListener('click', () => window.setMobileStep('checkout'));
  if (btnProceed) btnProceed.addEventListener('click', () => window.setMobileStep('checkout'));
  if (btnBack) btnBack.addEventListener('click', () => window.setMobileStep('catalog'));

  if (window.location.hash === '#checkout') {
    window.setMobileStep('checkout');
  }
}

/* --------------------------------------------------------------------------
   NAVIGATION & TABS (DESKTOP & MOBILE DUAL SYNC)
   -------------------------------------------------------------------------- */
function wireNavigation() {
  const tabNew = document.getElementById('tabNewOrder');
  const tabMy = document.getElementById('tabMyOrders');

  // Desktop buttons
  const navNew = document.getElementById('navBtnNew');
  const navMy = document.getElementById('navBtnMy');

  // Mobile buttons
  const tabNewBtn = document.getElementById('tabBtnNew');
  const tabMyBtn = document.getElementById('tabBtnMy');

  function setView(view) {
    const isNew = view === 'new';

    // Desktop tabs state
    if (navNew) {
      navNew.classList.toggle('active', isNew);
      navNew.setAttribute('aria-selected', isNew ? 'true' : 'false');
    }
    if (navMy) {
      navMy.classList.toggle('active', !isNew);
      navMy.setAttribute('aria-selected', !isNew ? 'true' : 'false');
    }

    // Mobile tabs state
    if (tabNewBtn) {
      tabNewBtn.classList.toggle('active', isNew);
      tabNewBtn.setAttribute('aria-selected', isNew ? 'true' : 'false');
    }
    if (tabMyBtn) {
      tabMyBtn.classList.toggle('active', !isNew);
      tabMyBtn.setAttribute('aria-selected', !isNew ? 'true' : 'false');
    }

    // Content view
    if (isNew) {
      tabNew.classList.remove('hidden');
      tabMy.classList.add('hidden');
      const floatBar = document.getElementById('floatingCartBar');
      if (floatBar && CS.cart.length > 0) floatBar.classList.remove('hidden');
    } else {
      tabNew.classList.add('hidden');
      tabMy.classList.remove('hidden');
      const floatBar = document.getElementById('floatingCartBar');
      if (floatBar) floatBar.classList.add('hidden');

      const ph = (document.getElementById('myPhoneLookup').value || '').trim();
      if (ph && ph.length === 10) {
        loadMyOrders(ph);
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (navNew) navNew.addEventListener('click', () => setView('new'));
  if (navMy) navMy.addEventListener('click', () => setView('my'));
  if (tabNewBtn) tabNewBtn.addEventListener('click', () => setView('new'));
  if (tabMyBtn) tabMyBtn.addEventListener('click', () => setView('my'));

  // Track search action
  const searchBtn = document.getElementById('btnSearchMyOrders');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const ph = (document.getElementById('myPhoneLookup').value || '').trim();
      if (!ph || ph.length < 10) {
        toast('Please enter a valid 10-digit mobile number', 'error');
        return;
      }
      loadMyOrders(ph);
    });
  }

  // Success screen redirection buttons
  const btnGoMy = document.getElementById('btnGoMyOrders');
  if (btnGoMy) btnGoMy.addEventListener('click', () => setView('my'));

  const btnAnother = document.getElementById('btnPlaceAnother');
  if (btnAnother) {
    btnAnother.addEventListener('click', () => {
      document.getElementById('orderSuccessBox').classList.add('hidden');
      document.getElementById('orderWorkbench').classList.remove('hidden');
      CS.cart = [];
      renderCart();
      renderCatalog();
    });
  }

  // Catalog search input
  const searchInput = document.getElementById('itemSearch');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      CS.searchQ = e.target.value.toLowerCase().trim();
      renderCatalog();
    });
  }

  // Submit order button
  const submitBtn = document.getElementById('btnSubmitOrder');
  if (submitBtn) {
    submitBtn.addEventListener('click', submitCustomerOrder);
  }

  // Form input validation listeners
  ['cName', 'cPhone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', e => {
        if (id === 'cPhone') {
          e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
        }
        updateSubmitButton();
      });
    }
  });

  const myPhone = document.getElementById('myPhoneLookup');
  if (myPhone) {
    myPhone.addEventListener('input', e => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
    });
    myPhone.addEventListener('keydown', e => {
      if (e.key === 'Enter') searchBtn.click();
    });
  }
}

/* --------------------------------------------------------------------------
   KEYBOARD SHORTCUTS & FLOATING CART
   -------------------------------------------------------------------------- */
function wireSearchShortcuts() {
  window.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      const s = document.getElementById('itemSearch');
      if (s) {
        s.focus();
        s.select();
      }
    }
  });
}

function wireFloatingCart() {
  const floatBar = document.getElementById('floatingCartBar');
  if (floatBar) {
    floatBar.addEventListener('click', () => {
      if (window.innerWidth < 960 && window.setMobileStep) {
        window.setMobileStep('checkout');
      } else {
        const card = document.getElementById('cartCard');
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  }
}

function initStoredPhone() {
  const savedPhone = localStorage.getItem('ps.customer_phone') || '';
  if (savedPhone) {
    const p1 = document.getElementById('cPhone');
    const p2 = document.getElementById('myPhoneLookup');
    if (p1 && !p1.value) p1.value = savedPhone;
    if (p2 && !p2.value) p2.value = savedPhone;
  }
}

/* --------------------------------------------------------------------------
   CATALOG LOADING & RENDERING
   -------------------------------------------------------------------------- */
async function loadItems() {
  try {
    const data = await api('/api/items');
    CS.items = (data.items || []).filter(i => i.active !== 0 && (i.rate || 0) > 0);

    const totalBadge = document.getElementById('catTotalCount');
    if (totalBadge) totalBadge.textContent = `${CS.items.length} Items Live`;

    // Group categories with counts
    const catMap = new Map();
    CS.items.forEach(i => {
      const cat = i.category || 'General';
      catMap.set(cat, (catMap.get(cat) || 0) + 1);
    });

    CS.categories = Array.from(catMap.entries()).map(([name, count]) => ({ name, count }));
    CS.categories.sort((a, b) => b.count - a.count);

    renderCategories();
    renderCatalog();
  } catch (err) {
    toast('Could not load steel catalog: ' + err.message, 'error');
  }
}

function categoryLabel(cat) {
  const map = {
    'CRC': 'CRC Sheets',
    'GI': 'GI Galvanized',
    '304': 'SS 304 Grade',
    '202': 'SS 202 Grade',
    'COIL': 'Coils & Slit',
    'ANGLE': 'Angles & Structural',
    'HR': 'Hot Rolled (HR)',
  };
  return map[cat] || cat;
}

function renderCategories() {
  const container = document.getElementById('catChips');
  if (!container) return;

  let html = `
    <button type="button" class="cat-chip-btn ${!CS.activeCat ? 'active' : ''}" data-cat="">
      <span>All Specifications</span>
      <span class="cat-chip-count">${CS.items.length}</span>
    </button>
  `;

  CS.categories.forEach(c => {
    html += `
      <button type="button" class="cat-chip-btn ${CS.activeCat === c.name ? 'active' : ''}" data-cat="${esc(c.name)}">
        <span>${esc(categoryLabel(c.name))}</span>
        <span class="cat-chip-count">${c.count}</span>
      </button>
    `;
  });

  container.innerHTML = html;
  container.querySelectorAll('.cat-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      CS.activeCat = btn.dataset.cat;
      container.querySelectorAll('.cat-chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCatalog();
    });
  });
}

function renderCatalog() {
  const list = document.getElementById('catalogList');
  if (!list) return;

  let filtered = CS.items;

  if (CS.activeCat) {
    filtered = filtered.filter(i => (i.category || 'General') === CS.activeCat);
  }
  if (CS.searchQ) {
    filtered = filtered.filter(i => {
      const name = (i.name || '').toLowerCase();
      const cat = (i.category || '').toLowerCase();
      return name.includes(CS.searchQ) || cat.includes(CS.searchQ);
    });
  }

  if (!filtered.length) {
    list.innerHTML = `
      <div style="grid-column:1/-1;padding:48px 16px;text-align:center;color:var(--zinc);">
        <p class="mono" style="font-size:13px;margin-bottom:6px;">NO MATCHING STEEL ITEMS FOUND</p>
        <span style="font-size:12.5px;">Try searching by standard thickness (e.g. 18G, 20G, 24G) or alloy grade (CRC, GI, 304).</span>
      </div>
    `;
    return;
  }

  list.innerHTML = filtered.map(item => {
    const inCart = CS.cart.find(c => c.id === item.id);
    const catDisplay = item.category || 'STEEL';
    const wtPerPc = item.weight_per_pc || 0;

    return `
      <article class="item-card ${inCart ? 'in-cart' : ''}" data-item-id="${item.id}">
        <div>
          <div class="item-card__top">
            <span class="item-badge">${esc(catDisplay)}</span>
            ${inCart ? `<span class="mono" style="font-size:10.5px;color:var(--oxide-deep);font-weight:600;">IN ORDER (${inCart.pcs})</span>` : ''}
          </div>
          <h3 class="item-card__name">${esc(item.name)}</h3>
          <div class="item-card__specs">
            <span>Nominal: ~${wtPerPc > 0 ? wtPerPc.toFixed(2) + ' kg/pc' : 'Per Coil/Wt'}</span>
          </div>
        </div>

        <div class="item-card__bottom">
          <div class="item-rate-box">
            <span class="item-rate-val">₹${(item.rate || 0).toFixed(2)}</span>
            <span class="item-rate-unit">per ${esc(item.main_unit || 'kg')}</span>
          </div>

          ${inCart ? `
            <div class="item-stepper" aria-label="Adjust quantity">
              <button type="button" class="step-btn" onclick="changeCartQty(${item.id}, -1)" title="Decrease quantity">−</button>
              <input class="step-val" type="number" min="1" max="5000" value="${inCart.pcs}" onchange="setCartQty(${item.id}, this.value)">
              <button type="button" class="step-btn" onclick="changeCartQty(${item.id}, 1)" title="Increase quantity">+</button>
            </div>
          ` : `
            <button type="button" class="btn-add-item" onclick="addToCart(${item.id})">
              <span>+ Add</span>
            </button>
          `}
        </div>
      </article>
    `;
  }).join('');
}

/* --------------------------------------------------------------------------
   CART STATE & STEPPERS
   -------------------------------------------------------------------------- */
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
  renderCatalog();
};

window.changeCartQty = function (itemId, delta) {
  const line = CS.cart.find(c => c.id === itemId);
  if (!line) return;
  line.pcs += delta;
  if (line.pcs <= 0) {
    CS.cart = CS.cart.filter(c => c.id !== itemId);
  }
  renderCart();
  renderCatalog();
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
  renderCatalog();
};

window.removeCartItem = function (itemId) {
  CS.cart = CS.cart.filter(c => c.id !== itemId);
  renderCart();
  renderCatalog();
};

function formatWeightDisplay(kgVal) {
  if (kgVal >= 1000) {
    return (kgVal / 1000).toFixed(2) + ' MT (' + Math.round(kgVal).toLocaleString('en-IN') + ' kg)';
  }
  return kgVal.toFixed(1) + ' kg';
}

function renderCart() {
  const list = document.getElementById('cartList');
  const countBadge = document.getElementById('cartBadgeCount');
  const stepBadge = document.getElementById('stepCartBadge');
  const floatBar = document.getElementById('floatingCartBar');

  if (stepBadge) stepBadge.textContent = String(CS.cart.length);

  if (!CS.cart.length) {
    if (list) {
      list.innerHTML = `
        <p style="color:var(--zinc);font-size:12.5px;text-align:center;padding:20px 0;margin:0;">
          No items selected yet. Tap <strong>+ Add</strong> on the material catalog on the left.
        </p>
      `;
    }
    if (countBadge) countBadge.textContent = '0 ITEMS';
    document.getElementById('totalPcs').textContent = '0';
    document.getElementById('totalWeight').textContent = '0 kg';
    document.getElementById('totalAmount').textContent = '₹0';
    if (floatBar) floatBar.classList.add('hidden');
    updateSubmitButton();
    return;
  }

  if (countBadge) countBadge.textContent = `${CS.cart.length} ITEM${CS.cart.length > 1 ? 'S' : ''}`;
  if (floatBar) floatBar.classList.remove('hidden');

  let totalPcs = 0;
  let totalWeight = 0;
  let totalAmount = 0;

  if (list) {
    list.innerHTML = CS.cart.map(line => {
      const lineWeight = line.pcs * line.weight_per_pc;
      const lineAmount = lineWeight * line.rate;
      totalPcs += line.pcs;
      totalWeight += lineWeight;
      totalAmount += lineAmount;

      return `
        <div class="cart-line">
          <div class="cart-line-info">
            <div class="cart-line-name" title="${esc(line.name)}">${esc(line.name)}</div>
            <div class="cart-line-sub">
              <span>₹${line.rate.toFixed(2)}/kg</span>
              <span>·</span>
              <span>~${lineWeight.toFixed(1)} kg</span>
              <span>·</span>
              <strong style="color:var(--ink);">₹${Math.round(lineAmount).toLocaleString('en-IN')}</strong>
            </div>
          </div>

          <div class="cart-line-ctrl">
            <div class="item-stepper" style="background:#ffffff;">
              <button type="button" class="step-btn" onclick="changeCartQty(${line.id}, -1)">−</button>
              <input class="step-val" type="number" min="1" max="5000" value="${line.pcs}" onchange="setCartQty(${line.id}, this.value)">
              <button type="button" class="step-btn" onclick="changeCartQty(${line.id}, 1)">+</button>
            </div>
            <button type="button" class="cart-del-btn" onclick="removeCartItem(${line.id})" title="Remove item">×</button>
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('totalPcs').textContent = totalPcs;
  document.getElementById('totalWeight').textContent = formatWeightDisplay(totalWeight);
  const amtFormatted = '₹' + Math.round(totalAmount).toLocaleString('en-IN');
  document.getElementById('totalAmount').textContent = amtFormatted;

  if (floatBar) {
    const floatQty = document.getElementById('floatQty');
    const floatAmt = document.getElementById('floatAmt');
    if (floatQty) floatQty.textContent = `${totalPcs} pcs (${CS.cart.length} items)`;
    if (floatAmt) floatAmt.textContent = `${amtFormatted} est.`;
  }

  updateSubmitButton();
}

function updateSubmitButton() {
  const btn = document.getElementById('btnSubmitOrder');
  if (!btn) return;

  const name = (document.getElementById('cName').value || '').trim();
  const phone = (document.getElementById('cPhone').value || '').trim();
  const validPhone = /^[0-9]{10}$/.test(phone);

  const canSubmit = name.length >= 2 && validPhone && CS.cart.length > 0 && !CS.submitting;
  btn.disabled = !canSubmit;
}

/* --------------------------------------------------------------------------
   ORDER SUBMISSION
   -------------------------------------------------------------------------- */
async function submitCustomerOrder() {
  if (CS.submitting) return;

  const name = (document.getElementById('cName').value || '').trim();
  const phone = (document.getElementById('cPhone').value || '').trim();
  const address = (document.getElementById('cAddress').value || '').trim();
  const note = (document.getElementById('cNote').value || '').trim();
  const hp = (document.getElementById('botHoneypot').value || '').trim();

  if (!name) { toast('Please enter your firm or client name', 'error'); return; }
  if (!/^[0-9]{10}$/.test(phone)) { toast('Please enter a valid 10-digit mobile number', 'error'); return; }
  if (!CS.cart.length) { toast('Please select at least one steel material', 'error'); return; }

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
    company_website_url: hp, // Honeypot anti-bot
  };

  CS.submitting = true;
  const btn = document.getElementById('btnSubmitOrder');
  btn.disabled = true;
  btn.innerHTML = `<span>Registering Order...</span>`;

  try {
    const res = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    localStorage.setItem('ps.customer_phone', phone);

    // Switch view to success docket
    document.getElementById('orderWorkbench').classList.add('hidden');
    const successBox = document.getElementById('orderSuccessBox');
    document.getElementById('successOrderNo').textContent = res.order.order_no;
    successBox.classList.remove('hidden');

    const floatBar = document.getElementById('floatingCartBar');
    if (floatBar) floatBar.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    toast(`Order ${res.order.order_no} placed successfully!`, 'success');
  } catch (err) {
    toast(err.message || 'Could not place order', 'error');
  } finally {
    CS.submitting = false;
    btn.innerHTML = `<span>Submit Procurement Order</span><span aria-hidden="true">→</span>`;
    updateSubmitButton();
  }
}

/* --------------------------------------------------------------------------
   TRACK MY ORDERS / DIGITAL SCALE SLIP LOOKUP
   -------------------------------------------------------------------------- */
async function loadMyOrders(phone) {
  const container = document.getElementById('myOrdersList');
  if (!container) return;

  container.innerHTML = `
    <div style="padding:36px 0;text-align:center;color:var(--zinc);">
      <span class="mono">Querying dispatch records for +91 ${esc(phone)}...</span>
    </div>
  `;

  try {
    const data = await api(`/api/customer/orders?phone=${encodeURIComponent(phone)}`);
    const orders = data.orders || [];

    if (!orders.length) {
      container.innerHTML = `
        <div class="panel-card" style="text-align:center;padding:40px 20px;">
          <div style="font-size:32px;margin-bottom:10px;">📦</div>
          <h3 style="margin-bottom:8px;font-size:16px;">No Records Found</h3>
          <p style="color:var(--steel);font-size:13px;max-width:440px;margin:0 auto 16px;">
            No material orders were found registered under mobile number <strong>+91 ${esc(phone)}</strong>.
          </p>
          <button type="button" class="portal-home-link" onclick="document.getElementById('navBtnNew').click();">
            Place New Order →
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = orders.map(o => {
      const isWeighed = o.status === 'WEIGHED';
      const wt = isWeighed ? o.actual_weight : o.est_weight;
      const amt = isWeighed ? o.actual_amount : o.est_amount;
      const dateStr = new Date(o.created_at).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });

      return `
        <article class="weigh-slip-card">
          <div class="weigh-slip-card__head">
            <div>
              <div class="slip-order-no">${esc(o.order_no)}</div>
              <div class="slip-date">${dateStr} · Boral Yard</div>
            </div>
            <span class="slip-status-badge ${isWeighed ? 'weighed' : 'pending'}">
              ${isWeighed ? '✓ Weighed on Scale' : '⏳ In Scale Queue'}
            </span>
          </div>

          <div class="metric-tally-grid" style="background:var(--paper-3);margin-bottom:12px;">
            <div class="metric-meter">
              <span class="meter-lbl">Total Pieces</span>
              <span class="meter-val">${o.pcs} pcs</span>
            </div>
            <div class="metric-meter">
              <span class="meter-lbl">${isWeighed ? 'Certified Scale Wt' : 'Est. Metric Wt'}</span>
              <span class="meter-val">${(wt || 0).toFixed(1)} kg</span>
            </div>
            <div class="metric-meter">
              <span class="meter-lbl">${isWeighed ? 'Final Scale Amount' : 'Est. Amount'}</span>
              <span class="meter-val highlight">₹${Math.round(amt || 0).toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div>
            <div class="mono" style="font-size:10.5px;color:var(--steel);text-transform:uppercase;margin-bottom:6px;letter-spacing:0.06em;">
              Manifest Lines:
            </div>
            ${(o.lines_detail || []).map(l => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px dashed var(--line-light);font-size:13px;">
                <span style="font-weight:600;color:var(--ink);">${esc(l.name)} <span style="font-weight:400;color:var(--steel);">× ${l.pcs || l.qty} pcs</span></span>
                <span class="mono" style="font-weight:600;color:var(--graphite);">₹${l.rate}/kg</span>
              </div>
            `).join('')}
          </div>
        </article>
      `;
    }).join('');

  } catch (err) {
    container.innerHTML = `
      <div class="panel-card" style="text-align:center;padding:32px 16px;color:#b91c1c;">
        <p class="mono">Error fetching dispatch records: ${esc(err.message)}</p>
      </div>
    `;
  }
}
