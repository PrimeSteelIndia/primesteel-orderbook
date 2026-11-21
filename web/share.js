/* ==========================================================================
   Prime Steel Order Book — estimate sharing
   Renders an estimate to a canvas, then hands it to WhatsApp either as an
   image (reads straight in the chat) or as a PDF (crisp, and prints properly
   for the office file). Both come from the same drawing, so what the customer
   sees in the chat and what you print are never different documents.
   ========================================================================== */

const EST_W = 1000;          // logical px, scaled up for sharpness
const EST_SCALE = 2;         // 2000 px wide output
const C = {
  navy: '#1b3554',
  navyDeep: '#12263c',
  navySoft: '#eaf0f7',
  ink: '#0e1a2b',
  inkSoft: '#334155',
  muted: '#64748b',
  line: '#e3e8ee',
  headBg: '#f7f9fc',
  green: '#0c6b47',
  white: '#ffffff',
};

function estFont(size, weight = 400) {
  return `${weight} ${size}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
}

/* Build the plain data the renderer needs from either a live cart or a saved
   order, so there is exactly one drawing path for both. */
function estimateFromCart() {
  const rows = [];
  let totalWeight = 0, totalAmount = 0, totalPcs = 0;
  for (const line of S.cart) {
    const item = itemById(line.item_id);
    if (!item) continue;
    const entryQty = line.entry_qty !== undefined ? line.entry_qty : (line.qty || line.pcs);
    const entryUnit = line.entry_unit || line.unit || 'pcs';
    const calc = calcItemEntry(item, entryQty, entryUnit);
    const wPerPc = calc.pcs > 0 ? calc.weight / calc.pcs : 0;
    rows.push({
      name: item.name,
      pcs: calc.pcs,
      weight_per_pc: wPerPc,
      weight: calc.weight,
      rate: Number(item.rate) || 0,
      amount: calc.amount,
    });
    totalWeight += calc.weight;
    totalAmount += calc.amount;
    totalPcs += calc.pcs;
  }
  return {
    title: 'ESTIMATE',
    orderNo: S.editingOrderNo || null,
    customerName: S.customerName || '',
    customerPhone: S.customerPhone || '',
    worker: S.worker || '',
    note: S.note || '',
    when: Date.now(),
    rows,
    totalWeight,
    totalAmount,
    totalPcs,
    isEstimate: true,
  };
}

function estimateFromOrder(order) {
  const singleLine = (order.lines_detail || []).length === 1;
  const orderAct = Number(order.actual_weight) || 0;
  const rows = (order.lines_detail || []).map(l => {
    const hasLineAct = l.actual_weight !== null && l.actual_weight !== undefined && l.actual_weight !== '' && !isNaN(Number(l.actual_weight)) && Number(l.actual_weight) > 0;
    const weighed = hasLineAct || (singleLine && orderAct > 0) || (order.status === 'WEIGHED' && l.actual_weight !== null);
    const weight = hasLineAct ? Number(l.actual_weight) : ((singleLine && orderAct > 0) ? orderAct : (l.actual_weight !== null && l.actual_weight !== undefined ? Number(l.actual_weight) : (l.est_weight != null ? Number(l.est_weight) : 0)));
    const amount = weighed ? (weight * (l.rate || 0)) : (l.est_amount || (weight * (l.rate || 0)));
    return {
      name: l.name,
      pcs: l.pcs,
      weight_per_pc: l.weight_per_pc || 0,
      weight,
      rate: l.rate || 0,
      amount,
      weighed,
    };
  });
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const totalPcs = rows.reduce((s, r) => s + r.pcs, 0);
  return {
    title: order.status === 'WEIGHED' ? 'ORDER' : 'ESTIMATE',
    orderNo: order.order_no || null,
    customerName: order.customer_name || '',
    customerPhone: order.customer_phone || '',
    worker: order.worker || '',
    note: order.note || '',
    when: order.created_at || Date.now(),
    rows,
    totalWeight,
    totalAmount,
    totalPcs,
    isEstimate: order.status !== 'WEIGHED',
  };
}

/* ------------------------------------------------------------------ */
/* drawing                                                             */
/* ------------------------------------------------------------------ */

function estDateStr(ms) {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return { date, time };
}

function estFitText(ctx, text, maxWidth) {
  let s = String(text ?? '');
  if (ctx.measureText(s).width <= maxWidth) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

function drawEstimate(data, opts = {}) {
  const showRates = opts.showRates !== false;
  const pad = 48;
  const innerW = EST_W - pad * 2;

  // Column plan. Values are right-aligned, so widths are measured from the right.
  const cols = showRates
    ? [
        { key: 'name', label: 'Item', align: 'left', w: 0 },
        { key: 'pcs', label: 'Qty', align: 'right', w: 82 },
        { key: 'wpp', label: 'Wt/pc', align: 'right', w: 96 },
        { key: 'weight', label: 'Weight', align: 'right', w: 108 },
        { key: 'rate', label: 'Rate/kg', align: 'right', w: 104 },
        { key: 'amount', label: 'Amount', align: 'right', w: 132 },
      ]
    : [
        { key: 'name', label: 'Item', align: 'left', w: 0 },
        { key: 'pcs', label: 'Qty', align: 'right', w: 90 },
        { key: 'weight', label: 'Weight', align: 'right', w: 120 },
      ];

  const rightCols = cols.filter(c => c.align === 'right');
  const rightW = rightCols.reduce((s, c) => s + c.w, 0);
  cols[0].w = innerW - rightW;

  // ---- measure: work out row heights before sizing the canvas ----
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = estFont(17);
  const nameMax = cols[0].w - 20;
  const rowPadY = 13;
  const lineH = 23;

  const rowHeights = data.rows.map(r => {
    const words = String(r.name || '').split(/\s+/);
    let lines = 1, cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (probe.measureText(t).width > nameMax && cur) { lines++; cur = w; }
      else cur = t;
    }
    return { lines, h: lines * lineH + rowPadY * 2 };
  });

  const headH = 118;
  const metaH = data.customerName || data.customerPhone ? 96 : 54;
  const tableHeadH = 44;
  const rowsH = rowHeights.reduce((s, r) => s + r.h, 0);
  const totalBoxH = 104;
  const noteH = data.note ? 52 : 0;
  const footH = 96;
  const H = headH + metaH + 20 + tableHeadH + rowsH + 20 + totalBoxH + noteH + footH + pad;

  const canvas = document.createElement('canvas');
  canvas.width = EST_W * EST_SCALE;
  canvas.height = Math.ceil(H) * EST_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(EST_SCALE, EST_SCALE);
  ctx.textBaseline = 'alphabetic';

  // ---- background ----
  ctx.fillStyle = C.white;
  ctx.fillRect(0, 0, EST_W, H);

  // ---- header bar ----
  ctx.fillStyle = C.navy;
  ctx.fillRect(0, 0, EST_W, headH);

  ctx.fillStyle = C.white;
  ctx.font = estFont(34, 700);
  ctx.textAlign = 'left';
  const bizName = 'PRIME STEEL';
  ctx.fillText(bizName, pad, 58);

  ctx.font = estFont(13, 500);
  ctx.fillStyle = '#a8c0d8';
  // Neutral by design: an invented product list would be wrong for some shops.
  ctx.fillText(data.isEstimate ? 'Price estimate for supply' : 'Order copy for supply', pad, 84);

  // document label, right side
  ctx.textAlign = 'right';
  ctx.font = estFont(15, 700);
  ctx.fillStyle = '#a8c0d8';
  ctx.fillText(data.isEstimate ? 'PRICE ESTIMATE' : 'ORDER COPY', EST_W - pad, 42);
  if (data.orderNo) {
    ctx.font = estFont(21, 600);
    ctx.fillStyle = C.white;
    ctx.fillText(data.orderNo, EST_W - pad, 68);
  }
  const { date, time } = estDateStr(data.when);
  ctx.font = estFont(13);
  ctx.fillStyle = '#a8c0d8';
  ctx.fillText(`${date}  ·  ${time}`, EST_W - pad, 88);

  // ---- who it is for ----
  let y = headH + 30;
  ctx.textAlign = 'left';
  const hasCustomer = !!(data.customerName || data.customerPhone);
  ctx.font = estFont(11, 700);
  ctx.fillStyle = C.muted;
  ctx.fillText(hasCustomer ? 'PREPARED FOR' : 'WALK-IN ENQUIRY', pad, y);
  y += 26;

  if (hasCustomer) {
    ctx.font = estFont(23, 600);
    ctx.fillStyle = C.ink;
    ctx.fillText(estFitText(ctx, data.customerName || 'Walk-in', innerW * 0.62), pad, y);
    y += 24;
    if (data.customerPhone) {
      ctx.font = estFont(15);
      ctx.fillStyle = C.inkSoft;
      ctx.fillText(data.customerPhone, pad, y);
      y += 22;
    }
  } else {
    ctx.font = estFont(19, 500);
    ctx.fillStyle = C.inkSoft;
    ctx.fillText('No customer name — this is an open estimate.', pad, y);
    y += 26;
  }

  // ---- table ----
  const colX = [];
  let cx = pad;
  for (const c of cols) { colX.push(cx); cx += c.w; }
  const cellRight = (i) => colX[i] + cols[i].w - (cols[i].align === 'right' ? 0 : 0);

  // header row
  ctx.fillStyle = C.headBg;
  ctx.fillRect(pad, y, innerW, tableHeadH);
  ctx.fillStyle = C.line;
  ctx.fillRect(pad, y, innerW, 1);
  ctx.fillRect(pad, y + tableHeadH - 1, innerW, 1);
  ctx.font = estFont(11, 700);
  ctx.fillStyle = C.muted;
  cols.forEach((c, i) => {
    ctx.textAlign = c.align;
    ctx.fillText(c.label.toUpperCase(), c.align === 'left' ? colX[i] : cellRight(i), y + 28);
  });
  y += tableHeadH;

  // body rows
  let idx = 0;
  for (const r of data.rows) {
    const rh = rowHeights[idx].h;
    if (idx % 2 === 1) {
      ctx.fillStyle = '#fcfdfe';
      ctx.fillRect(pad, y, innerW, rh);
    }

    const vals = {
      name: r.name,
      pcs: String(r.pcs),
      wpp: r.weight_per_pc ? r.weight_per_pc.toFixed(2) + ' kg' : '—',
      weight: r.weight ? r.weight.toFixed(2) + ' kg' : '—',
      rate: showRates ? money(r.rate) : '',
      amount: showRates ? money(r.amount) : '',
    };

    // item name can wrap onto several lines
    ctx.font = estFont(17, 500);
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'left';
    const words = String(r.name || '').split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > nameMax && cur) { lines.push(cur); cur = w; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    lines.forEach((ln, i) => {
      ctx.fillText(ln, colX[0], y + rowPadY + 17 + i * lineH);
    });

    cols.forEach((c, i) => {
      if (c.key === 'name') return;
      ctx.textAlign = c.align;
      if (c.key === 'amount') {
        ctx.font = estFont(17, 600);
        ctx.fillStyle = C.ink;
      } else if (c.key === 'pcs') {
        ctx.font = estFont(17, 500);
        ctx.fillStyle = C.inkSoft;
      } else {
        ctx.font = estFont(16);
        ctx.fillStyle = C.inkSoft;
      }
      ctx.fillText(vals[c.key], cellRight(i), y + rowPadY + 17);
    });

    ctx.fillStyle = C.line;
    ctx.fillRect(pad, y + rh - 1, innerW, 1);
    y += rh;
    idx++;
  }

  if (!data.rows.length) {
    ctx.font = estFont(17);
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'left';
    ctx.fillText('No items yet.', pad, y + 34);
    y += 68;
  }

  // ---- totals ----
  y += 22;
  const boxX = showRates ? EST_W - pad - 400 : pad;
  const boxW = showRates ? 400 : innerW;
  ctx.fillStyle = C.navySoft;
  ctx.fillRect(boxX, y, boxW, totalBoxH);

  ctx.textAlign = 'left';
  ctx.font = estFont(13, 600);
  ctx.fillStyle = C.muted;
  ctx.fillText('TOTAL WEIGHT', boxX + 22, y + 32);
  ctx.font = estFont(21, 600);
  ctx.fillStyle = C.ink;
  ctx.fillText(kg(data.totalWeight, 2), boxX + 22, y + 62);

  ctx.font = estFont(13, 600);
  ctx.fillStyle = C.muted;
  ctx.fillText(`${data.totalPcs} pcs · ${data.rows.length} item${data.rows.length === 1 ? '' : 's'}`, boxX + 22, y + 88);

  if (showRates) {
    ctx.textAlign = 'right';
    ctx.font = estFont(13, 600);
    ctx.fillStyle = C.muted;
    ctx.fillText(data.isEstimate ? 'ESTIMATED AMOUNT' : 'TOTAL AMOUNT', boxX + boxW - 22, y + 32);
    ctx.font = estFont(31, 700);
    ctx.fillStyle = C.green;
    ctx.fillText(money(data.totalAmount), boxX + boxW - 22, y + 68);
    ctx.font = estFont(12);
    ctx.fillStyle = C.muted;
    ctx.fillText(`Avg ${money(data.totalWeight > 0 ? data.totalAmount / data.totalWeight : 0)}/kg`, boxX + boxW - 22, y + 88);
  }
  y += totalBoxH;

  // ---- note ----
  if (data.note) {
    y += 18;
    ctx.textAlign = 'left';
    ctx.font = estFont(13, 700);
    ctx.fillStyle = C.muted;
    ctx.fillText('NOTE', pad, y + 14);
    ctx.font = estFont(15);
    ctx.fillStyle = C.inkSoft;
    ctx.fillText(estFitText(ctx, data.note, innerW), pad, y + 36);
    y += noteH;
  }

  // ---- footer ----
  y += 26;
  ctx.fillStyle = C.line;
  ctx.fillRect(pad, y, innerW, 1);
  y += 26;

  ctx.textAlign = 'left';
  ctx.font = estFont(12.5);
  ctx.fillStyle = C.muted;
  const line1 = data.isEstimate
    ? 'Estimate only. The final bill uses the actual scale weight at the time of delivery.'
    : 'Weight shown is the actual scale weight recorded at dispatch.';
  ctx.fillText(line1, pad, y);
  y += 19;
  ctx.font = estFont(12);
  ctx.fillStyle = '#8fa3b8';
  ctx.fillText('Prices change with the daily steel rate. Please confirm before dispatch.', pad, y);

  ctx.textAlign = 'right';
  ctx.font = estFont(12, 600);
  ctx.fillStyle = C.navy;
  ctx.fillText('PRIME STEEL', EST_W - pad, y);

  if (data.worker) {
    ctx.textAlign = 'left';
    ctx.font = estFont(11.5);
    ctx.fillStyle = '#a3b3c4';
    ctx.fillText(`Taken by ${data.worker}`, pad, y + 18);
  }

  return canvas;
}

/* Render into a box the user can look at before sending. */
function estPreviewCanvas(data, maxW = 520) {
  const full = drawEstimate(data, { showRates: true });
  const ratio = maxW / full.width;
  const out = document.createElement('canvas');
  out.width = maxW;
  out.height = Math.round(full.height * ratio);
  const c = out.getContext('2d');
  c.fillStyle = C.white;
  c.fillRect(0, 0, out.width, out.height);
  c.drawImage(full, 0, 0, out.width, out.height);
  return { preview: out, full };
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not build the image'))), type, quality);
  });
}