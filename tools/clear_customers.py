"""Clear every customer record so they can be re-entered by hand.

Orders keep their own customer_name / customer_phone columns, so past and
future orders do not depend on this table. Also drops order_lines left behind
by orders that no longer exist (they can never be displayed).

    python tools/clear_customers.py            # dry run
    python tools/clear_customers.py --apply
"""
import shutil
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "prime.db"

apply = "--apply" in sys.argv
stamp = time.strftime("%Y%m%d-%H%M%S")

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row

total = con.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
with_phone = con.execute(
    "SELECT COUNT(*) FROM customers WHERE phone IS NOT NULL AND TRIM(phone) != ''"
).fetchone()[0]
orders = con.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
orphans = con.execute(
    "SELECT COUNT(*) FROM order_lines WHERE order_id NOT IN (SELECT id FROM orders)"
).fetchone()[0]

print(f"customers to delete : {total}  ({with_phone} of them have a phone number)")
print(f"orders kept         : {orders}")
print(f"orphan order lines  : {orphans} (left by already-deleted orders)")

if not apply:
    print("\nDRY RUN - nothing written. Re-run with --apply.")
    raise SystemExit(0)

backup = DB.with_name(DB.name + f".bak-clearcust-{stamp}")
shutil.copy2(DB, backup)

con.execute("DELETE FROM customers")
con.execute("DELETE FROM sqlite_sequence WHERE name='customers'")
if orphans:
    con.execute("DELETE FROM order_lines WHERE order_id NOT IN (SELECT id FROM orders)")
con.commit()

print(f"\nbackup: {backup.name}")
print(f"customers now : {con.execute('SELECT COUNT(*) FROM customers').fetchone()[0]}")
print(f"orders now    : {con.execute('SELECT COUNT(*) FROM orders').fetchone()[0]}")
print(f"order lines   : {con.execute('SELECT COUNT(*) FROM order_lines').fetchone()[0]}")
con.close()