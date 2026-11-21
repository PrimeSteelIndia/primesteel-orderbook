"""Clear all items and the company name so they can be re-entered by hand.

Order lines store their own name/rate/weight/category, so past orders keep
reading correctly after the items table is emptied.

    python tools/clear_items.py            # dry run, shows what would go
    python tools/clear_items.py --apply
"""
import json
import shutil
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "prime.db"
SETTINGS = ROOT / "data" / "settings.json"

apply = "--apply" in sys.argv
stamp = time.strftime("%Y%m%d-%H%M%S")

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row

items = con.execute("SELECT id, name, category FROM items ORDER BY name").fetchall()
cats = sorted({(r["category"] or "").strip() for r in items if (r["category"] or "").strip()})
used = {
    r[0]
    for r in con.execute(
        "SELECT DISTINCT item_id FROM order_lines WHERE item_id IS NOT NULL"
    )
}

settings = json.loads(SETTINGS.read_text(encoding="utf-8")) if SETTINGS.exists() else {}

print(f"items to clear      : {len(items)}")
print(f"categories affected : {len(cats)} -> {', '.join(cats) if cats else '(none)'}")
print(f"items used in orders: {len(used)} (order lines keep their own copies)")
print(f"business_name now   : {settings.get('business_name')!r}")

if not apply:
    print("\nDRY RUN - nothing written. Re-run with --apply to clear.")
    raise SystemExit(0)

shutil.copy2(DB, DB.with_name(DB.name + f".bak-clearitems-{stamp}"))
if SETTINGS.exists():
    shutil.copy2(SETTINGS, SETTINGS.with_name(SETTINGS.name + f".bak-clearitems-{stamp}"))

con.execute("DELETE FROM items")
con.execute("DELETE FROM sqlite_sequence WHERE name='items'")
con.commit()

settings["business_name"] = ""
if "tagline" in settings:
    settings["tagline"] = ""
SETTINGS.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

left_items = con.execute("SELECT COUNT(*) FROM items").fetchone()[0]
orders = con.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
lines = con.execute("SELECT COUNT(*) FROM order_lines").fetchone()[0]
print(f"\ncleared. items now {left_items}, orders kept {orders}, order lines kept {lines}")
print(f"business_name now: {settings.get('business_name')!r}")
con.close()