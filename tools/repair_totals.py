"""Repair stored estimate totals on orders saved before the amount fix.

Dry run by default. --apply writes. Recomputes est_weight / est_amount from each
order's own lines using the server's resolve_quantity, so the stored totals obey
amount = weight x rate (which every real Tally bill already did).

Deletes only probe orders whose customer_name starts with ZZ.
"""
import sqlite3, sys, json
sys.path.insert(0, ".")
import server

APPLY = "--apply" in sys.argv

conn = sqlite3.connect("data/prime.db")
conn.row_factory = sqlite3.Row

orders = conn.execute(
    "SELECT id, order_no, status, customer_name, est_weight, est_amount, created_at FROM orders ORDER BY created_at"
).fetchall()

item_cache = {}
def item_row(iid):
    if iid not in item_cache:
        item_cache[iid] = conn.execute("SELECT * FROM items WHERE id=?", (iid,)).fetchone()
    return item_cache[iid]

repairs, probes = [], []
for o in orders:
    lines = conn.execute("SELECT * FROM order_lines WHERE order_id=? ORDER BY line_no", (o["id"],)).fetchall()

    if (o["customer_name"] or "").startswith("ZZ"):
        probes.append(o)
        continue

    w = a = 0.0
    for l in lines:
        it = item_row(l["item_id"])
        if not it:
            continue
        q = l["entry_qty"] or l["qty"] or l["pcs"] or 1
        u = l["entry_unit"] or l["unit"] or it["main_unit"] or "pcs"
        r = server.resolve_quantity(it, float(q), str(u))
        w += r["est_weight"]
        a += r["est_amount"]

    w, a = round(w, 3), round(a, 2)
    if abs((o["est_amount"] or 0) - a) > 0.01 or abs((o["est_weight"] or 0) - w) > 0.005:
        repairs.append((o, w, a))

print(f"orders scanned: {len(orders)}")
print(f"\nprobe orders to delete ({len(probes)}):")
for p in probes:
    print(f"  {p['order_no']}  {p['customer_name']}  est={p['est_amount']}")

print(f"\norders needing repair ({len(repairs)}):")
for o, w, a in repairs:
    print(f"  {o['order_no']}  {o['status']:<8} {o['customer_name']}")
    print(f"      weight {o['est_weight']} -> {w}")
    print(f"      amount {o['est_amount']} -> {a}   (delta {round(a - (o['est_amount'] or 0), 2):+,})")

if APPLY:
    for p in probes:
        conn.execute("DELETE FROM orders WHERE id=?", (p["id"],))
    for o, w, a in repairs:
        conn.execute("UPDATE orders SET est_weight=?, est_amount=? WHERE id=?", (w, a, o["id"]))
        # keep line-level weight consistent so the printed copy matches
        for l in conn.execute("SELECT * FROM order_lines WHERE order_id=? AND (actual_weight IS NULL OR actual_weight=0)", (o["id"],)).fetchall():
            it = item_row(l["item_id"])
            if not it:
                continue
            q = l["entry_qty"] or l["qty"] or l["pcs"] or 1
            u = l["entry_unit"] or l["unit"] or it["main_unit"] or "pcs"
            r = server.resolve_quantity(it, float(q), str(u))
            conn.execute("UPDATE order_lines SET actual_weight=? WHERE id=?", (r["est_weight"], l["id"]))
    conn.commit()
    print(f"\nAPPLIED: deleted {len(probes)} probes, repaired {len(repairs)} orders")
else:
    print("\nDRY RUN - re-run with --apply to write")

conn.close()