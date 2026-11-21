"""Remove QA/smoke leftovers from the live database."""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(r"C:\Users\Prime Steel\Desktop\PrimeSteel")
db = ROOT / "data" / "prime.db"

conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row

print("orders before:")
for r in conn.execute("SELECT order_no, customer_name, note, status FROM orders ORDER BY created_at"):
    print("  ", r["order_no"], "|", r["customer_name"], "|", r["note"], "|", r["status"])
print("items before:", conn.execute("SELECT COUNT(*) c FROM items").fetchone()["c"])

conn.execute("PRAGMA foreign_keys=ON")
ids = [r["id"] for r in conn.execute(
    "SELECT id FROM orders WHERE note='QA preview' OR customer_name='Smoke Test Customer'"
)]
for oid in ids:
    conn.execute("DELETE FROM order_lines WHERE order_id=?", (oid,))
    conn.execute("DELETE FROM orders WHERE id=?", (oid,))

conn.execute("DELETE FROM items WHERE norm='SMOKE TEST ITEM'")

left = conn.execute("SELECT COUNT(*) c FROM orders").fetchone()["c"]
if left == 0:
    conn.execute("DELETE FROM counters WHERE name LIKE 'orders-%'")

conn.commit()
print("orders left:", conn.execute("SELECT COUNT(*) c FROM orders").fetchone()["c"])
print("items now:", conn.execute("SELECT COUNT(*) c FROM items").fetchone()["c"])
print("active items:", conn.execute("SELECT COUNT(*) c FROM items WHERE active=1").fetchone()["c"])
conn.close()

for f in (ROOT / "exports").glob("*"):
    f.unlink()
    print("removed export", f.name)
