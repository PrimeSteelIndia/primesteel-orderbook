/* ------------------------------------------------------------------ */
/* PDF writer                                                          */
/*                                                                     */
/* No PDF library runs on the shop PC, so this builds the file directly. */
/* A one-page PDF is: a catalogue, a page, the JPEG as an image object, */
/* and a content stream that draws it. The only fiddly part is that the */
/* cross-reference table needs the byte offset of every object, so       */
/* everything is assembled as byte chunks and offsets are counted as it  */
/* goes.                                                               */
/* ------------------------------------------------------------------ */

const A4_W = 595.28;   // points
const A4_H = 841.89;

function strBytes(s) {
  // PDF header/trailer text is ASCII; this keeps binary clean when concatenated
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function concatBytes(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * Build a single-page PDF that shows `jpegBytes` fitted inside an A4 page.
 * Returns a Blob with the correct MIME type.
 */
function buildImagePdf(jpegBytes, imgW, imgH) {
  const margin = 24;

  // Fit the image inside the printable area, keeping its aspect ratio.
  const availW = A4_W - margin * 2;
  const availH = A4_H - margin * 2;
  const scale = Math.min(availW / imgW, availH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  // Centre it on the page.
  const x = (A4_W - drawW) / 2;
  const y = (A4_H - drawH) / 2;

  const content = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
  const contentBytes = strBytes(content);

  const chunks = [];
  const offsets = [];          // byte offset of each object, 1-indexed
  let pos = 0;

  const push = (u8) => { chunks.push(u8); pos += u8.length; };
  const pushStr = (s) => push(strBytes(s));

  pushStr('%PDF-1.4\n');
  // Binary comment marks the file as containing binary data.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const startObj = (n) => { offsets[n] = pos; pushStr(`${n} 0 obj\n`); };
  const endObj = () => pushStr('endobj\n');

  // 1: catalogue
  startObj(1);
  pushStr('<< /Type /Catalog /Pages 2 0 R >>\n');
  endObj();

  // 2: page tree
  startObj(2);
  pushStr('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n');
  endObj();

  // 3: the page
  startObj(3);
  pushStr(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] ` +
    `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\n`
  );
  endObj();

  // 4: the image
  startObj(4);
  pushStr(
    `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
    `/Length ${jpegBytes.length} >>\nstream\n`
  );
  push(jpegBytes);
  pushStr('\nendstream\n');
  endObj();

  // 5: drawing instructions
  startObj(5);
  pushStr(`<< /Length ${contentBytes.length} >>\nstream\n`);
  push(contentBytes);
  pushStr('endstream\n');
  endObj();

  // cross-reference table
  const xrefAt = pos;
  const count = offsets.length;      // includes the free object 0
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pushStr(xref);

  pushStr(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  return new Blob([concatBytes(chunks)], { type: 'application/pdf' });
}

/* ------------------------------------------------------------------ */
/* building the two formats                                            */
/* ------------------------------------------------------------------ */

function safeFileName(s) {
  return String(s || 'estimate').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

async function buildEstimateImage(data) {
  const canvas = drawEstimate(data, { showRates: true });
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.94);
  const name = safeFileName(`PrimeSteel-${data.orderNo || 'Estimate'}-${data.customerName || 'Customer'}`);
  return { blob, name: name + '.jpg', kind: 'image' };
}

async function buildEstimatePdf(data) {
  const canvas = drawEstimate(data, { showRates: true });
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.94);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pdf = buildImagePdf(bytes, canvas.width, canvas.height);
  const name = safeFileName(`PrimeSteel-${data.orderNo || 'Estimate'}-${data.customerName || 'Customer'}`);
  return { blob: pdf, name: name + '.pdf', kind: 'pdf' };
}

/* ------------------------------------------------------------------ */
/* sending                                                             */
/* ------------------------------------------------------------------ */

function waNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) return '91' + d;          // plain Indian mobile
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1);
  return d;
}

function waMessage(data) {
  const lines = [];
  lines.push(`*PRIME STEEL* — ${data.isEstimate ? 'Price Estimate' : 'Order Copy'}`);
  if (data.orderNo) lines.push(`Ref: ${data.orderNo}`);
  if (data.customerName) {
    lines.push('');
    lines.push(`For: ${data.customerName}`);
  }
  lines.push('');
  for (const r of data.rows) {
    lines.push(`• ${r.name}`);
    lines.push(`   ${r.pcs} pcs · ${r.weight.toFixed(2)} kg · ${money(r.rate)}/kg = ${money(r.amount)}`);
  }
  lines.push('');
  lines.push(`Total weight: ${kg(data.totalWeight, 2)}`);
  lines.push(`*${data.isEstimate ? 'Estimated amount' : 'Amount'}: ${money(data.totalAmount)}*`);
  lines.push('');
  lines.push(data.isEstimate
    ? '_Estimate only. Final bill is on actual scale weight. Rates change with the daily steel rate._'
    : '_Billed on actual scale weight._');
  return lines.join('\n');
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Hand a file to the phone's share sheet. This is the only way to put an
 * image or PDF *into* a WhatsApp chat — a wa.me link can only carry text.
 * Returns 'shared' | 'downloaded' | 'cancelled'.
 */
async function shareFile(blob, name, title, text) {
  const file = new File([blob], name, { type: blob.type });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // fall through to download
    }
  }

  downloadBlob(blob, name);
  return 'downloaded';
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to a hidden textarea.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}