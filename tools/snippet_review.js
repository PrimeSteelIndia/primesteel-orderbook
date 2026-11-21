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
    <button class="back" id="backBtn">
      ${icon('chevron-left', 'i i-sm')} ${isEditing ? 'Cancel editing' : 'Add more items'}
    </button>
    <div class="page-head" style="margin-bottom:16px">
      <h1>${isEditing ? `Edit ${esc(S.editingOrderNo || 'order')}` : 'Check the order'}</h1>
      <p>Tap a number to change it. Tap the bin to remove one item.</p>
    </div>

    ${isEditing ? `
      <div class="note-box warn" style="margin-bottom:14px">
        ${icon('edit', 'i i-sm')}
        <span>Editing order <b>${esc(S.editingOrderNo)}</b>. Changes update the existing order.</span>
      </div>` : ''}

    <div class="section">
      <div class="section-title">Customer</div>
      <button class="pick-field" id="customerBtn">
        ${icon('user')}
        <span class="pf-main">
          <span class="pf-value ${S.customerName ? '' : 'pf-placeholder'}">${esc(S.customerName || 'Choose or type a name')}</span>
        </span>
        ${icon('chevron-right', 'i i-sm')}
      </button>
    </div>

    <div class="section">
      <div class="section-title">Items</div>
      <div class="line-list" id="lines">
        ${S.cart.map((line, idx) => {
          const item = itemById(line.item_id);
          if (!item) return '';
          return `<div class="line-row rev-row" data-line="${idx}">
            <span class="line-main">
              <span class="line-name">${esc(item.name)}</span>
              <span class="line-sub">${money(item.rate)}/${esc(item.main_unit || 'kg')}${item.weight_per_pc > 0 ? ' · ' + kg(item.weight_per_pc, 2) + '/pc' : ''}</span>
            </span>
            <span class="rev-qty">
              <input data-rqty="${idx}" inputmode="decimal" value="${line.entry_qty !== undefined ? line.entry_qty : line.pcs}" aria-label="Quantity for ${esc(item.name)}">
              <span class="rev-unit">${esc(line.entry_unit || line.unit || item.main_unit || 'kg')}</span>
            </span>
            <button type="button" class="rev-del" data-del="${idx}" aria-label="Remove ${esc(item.name)}">${icon('trash', 'i i-sm')}</button>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-title">Taken by</div>
      <div class="field">
        <input class="input" id="worker" placeholder="Your name" value="${esc(S.worker)}" autocomplete="name">
      </div>
      <div style="height:10px"></div>
      <div class="field">
        <label for="note">Order note (optional)</label>
        <input class="input" id="note" placeholder="Vehicle no., delivery detail..." value="${esc(S.note || '')}">
      </div>
    </div>

    <div class="total-box">
      <div class="tb-row tb-main">
        <span class="tb-k">Estimated amount</span>
        <span class="tb-v">${money(t.amount)}</span>
      </div>
      <div class="tb-row">
        <span class="tb-k">${t.pcs} pieces · ${t.lines} item${t.lines === 1 ? '' : 's'}</span>
        <span class="tb-v">${kg(t.weight, 1)}</span>
      </div>
      <div class="tiny" style="color:#9fb6d0;line-height:1.4">This is an estimate from the recorded weight and units. The final amount uses the actual scale weight.</div>
    </div>
    <div style="height:14px"></div>
  `;

  $('#backBtn').addEventListener('click', () => {
    if (isEditing) {
      const orderId = S.editingOrderId;
      S.editingOrderId = null;
      S.editingOrderNo = '';
      S.cart = [];
      persistCart();
      go('#/order/' + orderId);
    } else {
      go('#/');
    }
  });
  $('#note').addEventListener('input', e => { S.note = e.target.value.trim(); });
  $('#worker').addEventListener('input', e => {
    S.worker = e.target.value.trim();
    store.set('worker', S.worker);
  });
  $('#customerBtn').addEventListener('click', openCustomerSheet);

  $('#lines').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const idx = Number(del.dataset.del);
    const line = S.cart[idx];
    if (!line) return;
    const item = itemById(line.item_id);
    S.cart.splice(idx, 1);
    persistCart();
    toast(`${item ? item.name : 'Item'} removed`, 'default');
    renderReview();
  });
  $('#lines').addEventListener('focusin', e => {
    if (e.target.matches('[data-rqty]')) e.target.select();
  });
  $('#lines').addEventListener('change', e => {
    const inp = e.target.closest('[data-rqty]');
    if (!inp) return;
    const idx = Number(inp.dataset.rqty);
    const line = S.cart[idx];
    if (!line) return;
    const item = itemById(line.item_id);
    if (!item) return;
    const val = Math.round((Number(inp.value) || 0) * 1000) / 1000;
    if (val <= 0) {
      S.cart.splice(idx, 1);
      persistCart();
      renderReview();
      return;
    }
    const unit = line.entry_unit || line.unit || item.main_unit || 'kg';
    const calc = calcItemEntry(item, val, unit);
    line.entry_qty = val;
    line.entry_unit = calc.entryUnit;
    line.qty = calc.effectiveQty;
    line.unit = calc.effectiveUnit;
    line.pcs = calc.pcs;
    persistCart();
    renderReview();
  });
  $('#lines').addEventListener('keydown', e => {
    if (e.target.matches('[data-rqty]') && e.key === 'Enter') e.target.blur();
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
      <button class="btn btn-success btn-lg btn-block" id="saveBtn">${isEditing ? 'Save changes to order' : 'Save order'}</button>
    </div>`;

  $('#saveBtn').addEventListener('click', saveOrder);
}