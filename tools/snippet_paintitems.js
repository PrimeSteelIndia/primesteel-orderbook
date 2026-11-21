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