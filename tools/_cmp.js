
const fs = require('fs');
const src = fs.readFileSync('web/worker.js','utf8');
const s = src.indexOf('function calcItemEntry(');
const e = src.indexOf('\nfunction cartTotals(', s);
fs.writeFileSync('tools/_calc.js', src.slice(s,e) + '\nmodule.exports={calcItemEntry};\n');
const { calcItemEntry } = require('./_calc.js');
const items = JSON.parse(fs.readFileSync('tools/_items.json','utf8'));
const jobs = JSON.parse(fs.readFileSync('tools/_jobs.json','utf8'));
const byId = new Map(items.map(i=>[i.id,i]));
const out = jobs.map(j => {
  const it = byId.get(j.item_id);
  if (!it) return {bad:'missing'};
  const r = calcItemEntry(it, j.entry_qty, j.entry_unit);
  return {amount: r.amount, weight: r.weight, pcs: r.pcs, mainQty: r.mainQty};
});
console.log(JSON.stringify(out));
