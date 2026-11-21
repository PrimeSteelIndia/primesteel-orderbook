// Extract calcItemEntry from worker.js and run it against real items,
// printing amount for a spread of quantities/units.
const fs = require('fs');
const src = fs.readFileSync('web/worker.js', 'utf8');

const start = src.indexOf('function calcItemEntry(');
const endMarker = '\nfunction cartTotals(';
const end = src.indexOf(endMarker, start);
if (start < 0 || end < 0) { console.error('cannot locate calcItemEntry'); process.exit(1); }
const body = src.slice(start, end);

const mod = `
${body}
module.exports = { calcItemEntry };
`;
fs.writeFileSync('tools/_calc.js', mod);
const { calcItemEntry } = require('./_calc.js');

const items = JSON.parse(fs.readFileSync('tools/_items.json', 'utf8'));
console.log(`items: ${items.length}`);

// Group by shape so we see the different maths branches
const shapes = new Map();
for (const it of items) {
  const k = [it.main_unit, it.alt_unit, it.alt_unit2].join('|');
  if (!shapes.has(k)) shapes.set(k, []);
  shapes.get(k).push(it);
}
console.log('\n=== unit shapes in the rate list ===');
for (const [k, list] of shapes) {
  const ex = list[0];
  console.log(`\n${k}  (${list.length} items)  e.g. "${ex.name}"`);
  console.log(`  rate=${ex.rate} weight_per_pc=${ex.weight_per_pc} length_per_pc=${ex.length_per_pc} alt_factor=${ex.alt_factor} alt_unit2_factor=${ex.alt_unit2_factor}`);
  const mainU = ex.main_unit || 'kg';
  for (const q of [1, 5, 10]) {
    const r = calcItemEntry(ex, q, mainU);
    console.log(`  ${q} ${mainU} -> mainQty=${r.mainQty.toFixed(3)} amount=${r.amount.toFixed(2)} pcs=${r.pcs} weight=${r.weight.toFixed(2)} preview="${r.preview}"`);
  }
  // pcs entry where pcs is an alt unit
  if (ex.alt_unit === 'pcs' || ex.alt_unit2 === 'pcs') {
    const r = calcItemEntry(ex, 2, 'pcs');
    console.log(`  2 pcs  -> mainQty=${r.mainQty.toFixed(3)} amount=${r.amount.toFixed(2)} pcs=${r.pcs} weight=${r.weight.toFixed(2)} preview="${r.preview}"`);
  }
}

console.log('\n=== fractional-piece check (kg items with weight_per_pc) ===');
let bad = 0;
for (const it of items) {
  if ((it.main_unit || 'kg') !== 'kg') continue;
  if (!(Number(it.weight_per_pc) > 0)) continue;
  const r = calcItemEntry(it, 5, 'kg');
  const truePcs = 5 / Number(it.weight_per_pc);
  if (Math.abs(r.pcs - truePcs) > 0.01) {
    if (bad < 6) {
      console.log(`  "${it.name}" 5 kg: truePcs=${truePcs.toFixed(3)} but reported pcs=${r.pcs}`);
    }
    bad++;
  }
}
console.log(`  items where reported pcs is wrong for 5 kg: ${bad}`);

console.log('\n=== amount = weight * rate sanity ===');
let mism = 0;
for (const it of items) {
  for (const [q, u] of [[1, 'kg'], [1, 'pcs'], [10, 'pcs'], [100, 'feet'], [5, 'kg']]) {
    const r = calcItemEntry(it, q, u);
    const expect = r.weight * Number(it.rate || 0);
    if (Math.abs(expect - r.amount) > 0.01) {
      console.log(`  MISMATCH "${it.name}" ${q}${u}: mainQty=${r.mainQty} rate=${it.rate} amount=${r.amount} expected=${expect}`);
      mism++;
    }
  }
}
console.log(`  amount mismatches: ${mism}`);