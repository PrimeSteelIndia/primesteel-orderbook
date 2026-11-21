import sqlite3, json, sys, subprocess, os
sys.path.insert(0, ".")
from server import resolve_quantity

con = sqlite3.connect("data/prime.db")
con.row_factory = sqlite3.Row

orders = list(con.execute("SELECT * FROM orders ORDER BY seq"))
items = {r["id"]: dict(r) for r in con.execute("SELECT * FROM items")}

print(f"{len(orders)} orders\n")

problems = []
for o in orders:
    lines = list(con.execute("SELECT * FROM order_lines WHERE order_id=? ORDER BY line_no", (o["id"],)))
    srv_amt = 0.0
    srv_wt = 0.0
    detail = []
    for ln in lines:
        it = items.get(ln["item_id"])
        if not it:
            detail.append(f"  line {ln['line_no']}: MISSING ITEM id={ln['item_id']}")
            continue
        r = resolve_quantity(it, ln["entry_qty"], ln["entry_unit"])
        srv_amt += r["est_amount"]
        srv_wt += r["weight"]
        detail.append(
            f"  line {ln['line_no']} {ln['name'][:24]:24s} "
            f"entry={ln['entry_qty']}{ln['entry_unit']:4s} "
            f"main={r['main_qty']:.3f}{r['main_unit']:4s} "
            f"rate={it['rate']:.2f} amt={r['est_amount']:.2f} "
            f"wt={r['weight']:.2f} pcs={r['pcs']}"
        )
    diff = abs(srv_amt - o["est_amount"])
    flag = "  <<< MISMATCH" if diff > 0.02 else ""
    if diff > 0.02:
        problems.append((o["order_no"], o["est_amount"], srv_amt, diff))
    print(f"{o['order_no']} stored est_amount={o['est_amount']:.2f} recomputed={srv_amt:.2f} diff={diff:.2f}{flag}")
    for d in detail:
        print(d)
    print()

print("=" * 60)
if problems:
    print("ORDERS WHERE STORED TOTAL != SUM OF ITS OWN LINES:")
    for p in problems:
        print(f"  {p[0]}: stored {p[1]:.2f} vs computed {p[2]:.2f} (off by {p[3]:.2f})")
else:
    print("All stored order totals match a recomputation from their lines.")

# Now compare against the browser function
print()
print("=" * 60)
print("Comparing same lines against the phone's JS calcItemEntry")
js = r"""
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
"""
jobs = []
meta = []
for o in orders:
    for ln in con.execute("SELECT * FROM order_lines WHERE order_id=? ORDER BY line_no", (o["id"],)):
        jobs.append({"item_id": ln["item_id"], "entry_qty": ln["entry_qty"], "entry_unit": ln["entry_unit"]})
        meta.append((o["order_no"], ln["line_no"], ln["name"], ln["entry_qty"], ln["entry_unit"], ln["item_id"]))

json.dump(jobs, open("tools/_jobs.json", "w"))
open("tools/_cmp.js", "w").write(js)
res = subprocess.run(["node", "tools/_cmp.js"], capture_output=True, text=True)
if res.returncode != 0:
    print("node failed:", res.stderr[:600])
else:
    out = json.loads(res.stdout)
    bad = 0
    for (ono, lno, name, q, u, iid), jr, m in zip(
        meta,
        out,
        [(o, l) for o in orders for l in con.execute("SELECT * FROM order_lines WHERE order_id=? ORDER BY line_no", (o["id"],))]
    ):
        it = items.get(iid)
        if not it:
            continue
        sr = resolve_quantity(it, q, u)
        da = abs(sr["est_amount"] - jr.get("amount", 0))
        dw = abs(sr["weight"] - jr.get("weight", 0))
        if da > 0.02 or dw > 0.05:
            print(f"  {ono} line {lno} {name[:22]:22s} {q}{u}")
            print(f"    server: amt={sr['est_amount']:.2f} wt={sr['weight']:.3f} pcs={sr['pcs']}")
            print(f"    phone : amt={jr.get('amount',0):.2f} wt={jr.get('weight',0):.3f} pcs={jr.get('pcs')}")
            bad += 1
    print(f"  line-level disagreements phone vs server: {bad} of {len(jobs)}")