"""One-time import of the product and customer lists from the old app.

    python tools/import_old_db.py
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import server  # noqa: E402

OLD = Path(r"C:\Users\Prime Steel\Desktop\PrimeSteel_Server\steel_business.db")


def main() -> None:
    server.init_db()
    if not OLD.exists():
        print("Old database not found at", OLD)
        return

    old = sqlite3.connect(f"file:{OLD}?mode=ro", uri=True)
    old.row_factory = sqlite3.Row
    new = server.db()

    items_before = new.execute("SELECT COUNT(*) c FROM items").fetchone()["c"]
    if items_before:
        print(f"Items already present ({items_before}); will only add missing names.")

    added_items = updated_items = 0
    for row in old.execute("SELECT name, category, rate_per_kg, weight_per_unit FROM products ORDER BY id"):
        name = (row["name"] or "").strip()
        if not name:
            continue
        norm = server.norm_name(name)
        existing = new.execute("SELECT * FROM items WHERE norm=?", (norm,)).fetchone()
        if existing:
            # fill in a missing weight, never overwrite a rate the owner may have fixed
            if existing["weight_per_pc"] <= 0 and (row["weight_per_unit"] or 0) > 0:
                new.execute(
                    "UPDATE items SET weight_per_pc=? WHERE id=?",
                    (server.weight(row["weight_per_unit"]), existing["id"]),
                )
                updated_items += 1
            continue
        new.execute(
            """INSERT INTO items (name, norm, category, rate, weight_per_pc, active, sort, updated_at)
               VALUES (?,?,?,?,?,1,?,?)""",
            (
                name, norm, (row["category"] or "").strip().upper()[:24],
                server.money(row["rate_per_kg"]), server.weight(row["weight_per_unit"]),
                0, server.now_ms(),
            ),
        )
        added_items += 1

    added_customers = 0
    for row in old.execute("SELECT name, phone, gstin FROM customers"):
        name = (row["name"] or "").strip()
        if not name:
            continue
        norm = server.norm_name(name)
        if new.execute("SELECT 1 FROM customers WHERE norm=?", (norm,)).fetchone():
            continue
        new.execute(
            "INSERT INTO customers (name, norm, phone, gstin, updated_at) VALUES (?,?,?,?,?)",
            (name, norm, (row["phone"] or "").strip(), (row["gstin"] or "").strip(), server.now_ms()),
        )
        added_customers += 1

    new.commit()

    total_items = new.execute("SELECT COUNT(*) c FROM items").fetchone()["c"]
    total_customers = new.execute("SELECT COUNT(*) c FROM customers").fetchone()["c"]
    missing_weight = new.execute(
        "SELECT COUNT(*) c FROM items WHERE active=1 AND weight_per_pc<=0"
    ).fetchone()["c"]
    new.close()

    print(f"Items added: {added_items}, weights filled: {updated_items}, now {total_items}")
    print(f"Customers added: {added_customers}, now {total_customers}")
    print(f"Items still without weight: {missing_weight}")

    # surface likely typos instead of silently changing them
    new = server.db()
    rows = new.execute("SELECT name, category, rate FROM items ORDER BY category, name").fetchall()
    by_cat: dict[str, list[float]] = {}
    for r in rows:
        by_cat.setdefault(r["category"], []).append(r["rate"])
    print("\nRates that look out of line with their category:")
    for r in rows:
        rates = sorted(by_cat.get(r["category"], []))
        if len(rates) < 4:
            continue
        median = rates[len(rates) // 2]
        if median and (r["rate"] > median * 2.5 or r["rate"] < median * 0.4):
            print(f"  {r['name']:<32} {r['rate']:>10.2f}   (category median {median:.2f})")
    new.close()


if __name__ == "__main__":
    main()
