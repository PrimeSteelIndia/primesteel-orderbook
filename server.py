#!/usr/bin/env python3
"""
Prime Steel Order Book
======================
A local hub server for a steel trading yard.

  * Workers take orders on their phones over the shop Wi-Fi.
  * Workers enter the actual scale weight later and submit.
  * The owner opens the same address on the Windows PC and on the Mac.
  * Any order can be sent to Excel with one click.

Runs on the Python standard library alone. openpyxl is used for .xlsx files
if it is installed; otherwise Excel downloads fall back to CSV automatically.

    python server.py [--port 8077]
"""

from __future__ import annotations

import mimetypes
import json
import os
import re
import socket
import sqlite3
import sys
import threading
import time
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import excel_sync
import tunnel

try:  # make rupee signs safe on old Windows consoles
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / "data"
WEB_DIR = BASE / "web"
EXPORT_DIR = BASE / "exports"
SETTINGS_FILE = DATA_DIR / "settings.json"
DB_FILE = DATA_DIR / "prime.db"

DEFAULT_SETTINGS = {
    "business_name": "Prime Steel",
    "tagline": "Order book",
    "shared_folder": "",          # optional: mirror finished orders here
    "admin_pin": "",              # empty = no PIN required
    "worker_pin": "1234",         # default worker PIN for warehouse staff
    "enable_tunnel": True,
    "tunnel_token": "",
    "excel_rates_path": r"C:\Users\Prime Steel\Desktop\COMPANY STUDY_backup.xlsm",
    "auto_sync_excel": True,
}

_write_lock = threading.Lock()


class RateLimiter:
    """Thread-safe sliding-window rate limiter to protect server from bot floods."""
    def __init__(self):
        self._lock = threading.Lock()
        self._history: dict[str, list[tuple[float, str]]] = {}

    def is_allowed(self, ip: str, category: str, max_requests: int, window_seconds: float) -> bool:
        now = time.time()
        with self._lock:
            records = self._history.get(ip, [])
            cutoff = now - window_seconds
            valid = [r for r in records if r[0] > cutoff]
            count = sum(1 for r in valid if r[1] == category)
            if count >= max_requests:
                self._history[ip] = valid
                return False
            valid.append((now, category))
            self._history[ip] = valid
            return True


_rate_limiter = RateLimiter()


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------

def now_ms() -> int:
    return int(time.time() * 1000)


def money(value: float) -> float:
    return round(float(value or 0), 2)


def weight(value: float) -> float:
    return round(float(value or 0), 3)


def norm_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "")).strip().upper()


def local_dt(ms: int | None) -> str:
    if not ms:
        return ""
    return datetime.fromtimestamp(ms / 1000).strftime("%d-%m-%Y %I:%M %p")


def load_settings() -> dict:
    data = dict(DEFAULT_SETTINGS)
    try:
        if SETTINGS_FILE.exists():
            saved = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            for k, v in saved.items():
                if k in data:
                    # Apply the saved value even when it is an empty string.
                    # Skipping falsy values meant a deliberately cleared
                    # business_name silently reverted to the DEFAULT_SETTINGS
                    # value, so clearing it never stuck.
                    data[k] = v
            # An empty name is a deliberate choice (the owner clears it to type
            # his own). Filling it back in with "Prime Steel" made the wipe look
            # like it had failed, so blank stays blank.
    except Exception as exc:
        print("[settings] could not read settings:", exc)
    return data


def save_settings(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def lan_addresses() -> list[str]:
    """Best-effort list of addresses other devices can use to reach this PC."""
    found: list[str] = []
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.2)
        sock.connect(("10.255.255.255", 1))
        found.append(sock.getsockname()[0])
        sock.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                found.append(ip)
    except Exception:
        pass
    seen, out = set(), []
    for ip in found:
        if ip not in seen and not ip.startswith("169.254."):
            seen.add(ip)
            out.append(ip)
    return out


# --------------------------------------------------------------------------
# database
# --------------------------------------------------------------------------

SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    norm          TEXT    NOT NULL UNIQUE,
    category      TEXT    NOT NULL DEFAULT '',
    rate          REAL    NOT NULL DEFAULT 0,
    weight_per_pc REAL    NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    sort          INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    norm       TEXT NOT NULL,
    phone      TEXT NOT NULL DEFAULT '',
    gstin      TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_norm ON customers(norm);

CREATE TABLE IF NOT EXISTS orders (
    id             TEXT PRIMARY KEY,
    order_no       TEXT NOT NULL UNIQUE,
    seq            INTEGER NOT NULL,
    year           INTEGER NOT NULL,
    client_id      TEXT UNIQUE,
    created_at     INTEGER NOT NULL,
    customer_name  TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    worker         TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'OPEN',
    est_weight     REAL NOT NULL DEFAULT 0,
    est_amount     REAL NOT NULL DEFAULT 0,
    actual_weight  REAL NOT NULL DEFAULT 0,
    actual_amount  REAL NOT NULL DEFAULT 0,
    weighed_at     INTEGER,
    exported_at    INTEGER,
    export_error   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS order_lines (
    id            TEXT PRIMARY KEY,
    order_id      TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    line_no       INTEGER NOT NULL,
    item_id       INTEGER,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL DEFAULT '',
    pcs           INTEGER NOT NULL,
    weight_per_pc REAL NOT NULL DEFAULT 0,
    rate          REAL NOT NULL DEFAULT 0,
    actual_weight REAL,
    UNIQUE (order_id, line_no)
);

CREATE TABLE IF NOT EXISTS counters (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS log (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    at     INTEGER NOT NULL,
    kind   TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
);
"""


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_FILE, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _migrate_db(conn: sqlite3.Connection) -> None:
    """Add columns introduced after the initial schema. Safe to call repeatedly."""
    migrations = [
        ("items", "main_unit", "TEXT NOT NULL DEFAULT 'kg'"),
        ("items", "alt_unit", "TEXT NOT NULL DEFAULT 'pcs'"),
        ("items", "alt_factor", "REAL NOT NULL DEFAULT 0"),
        ("items", "alt_unit2", "TEXT NOT NULL DEFAULT ''"),
        ("items", "alt_unit2_factor", "REAL NOT NULL DEFAULT 0"),
        ("items", "length_per_pc", "REAL NOT NULL DEFAULT 0"),
        ("items", "order_unit", "TEXT NOT NULL DEFAULT ''"),
        ("customers", "address", "TEXT NOT NULL DEFAULT ''"),
        ("order_lines", "narration", "TEXT NOT NULL DEFAULT ''"),
        ("order_lines", "entry_unit", "TEXT NOT NULL DEFAULT ''"),
        ("order_lines", "entry_qty", "REAL NOT NULL DEFAULT 0"),
        ("order_lines", "unit", "TEXT NOT NULL DEFAULT 'pcs'"),
        ("order_lines", "qty", "REAL NOT NULL DEFAULT 0"),
    ]
    for table, col, typedef in migrations:
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typedef}")
        except sqlite3.OperationalError:
            pass  # column already exists
    try:
        conn.execute("UPDATE items SET main_unit='kg' WHERE main_unit IS NULL OR main_unit=''")
        conn.execute("UPDATE items SET alt_unit='pcs' WHERE (alt_unit IS NULL OR alt_unit='') AND weight_per_pc > 0")
        conn.execute("UPDATE items SET alt_factor=weight_per_pc WHERE (alt_factor=0 OR alt_factor IS NULL) AND weight_per_pc > 0")
    except Exception:
        pass


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    conn = db()
    try:
        conn.executescript(SCHEMA)
        _migrate_db(conn)
        conn.commit()
    finally:
        conn.close()
    if not SETTINGS_FILE.exists():
        save_settings(DEFAULT_SETTINGS)


def log_event(kind: str, detail: str = "") -> None:
    try:
        conn = db()
        conn.execute("INSERT INTO log (at, kind, detail) VALUES (?,?,?)", (now_ms(), kind, detail))
        conn.commit()
        conn.close()
    except Exception:
        pass


# --------------------------------------------------------------------------
# domain logic
# --------------------------------------------------------------------------

def item_row(row: sqlite3.Row) -> dict:
    keys = row.keys()
    main_u = row["main_unit"] if "main_unit" in keys and row["main_unit"] else "kg"
    alt_u = row["alt_unit"] if "alt_unit" in keys and row["alt_unit"] else "pcs"
    alt_factor = row["alt_factor"] if "alt_factor" in keys and row["alt_factor"] else (row["weight_per_pc"] if alt_u == "pcs" else 0)
    alt_u2 = row["alt_unit2"] if "alt_unit2" in keys and row["alt_unit2"] else ""
    alt_u2_factor = row["alt_unit2_factor"] if "alt_unit2_factor" in keys and row["alt_unit2_factor"] else 0
    order_u = row["order_unit"] if "order_unit" in keys and row["order_unit"] else main_u
    return {
        "id": row["id"],
        "name": row["name"],
        "category": row["category"],
        "rate": row["rate"],
        "weight_per_pc": row["weight_per_pc"],
        "main_unit": main_u,
        "alt_unit": alt_u,
        "alt_factor": alt_factor,
        "alt_unit2": alt_u2,
        "alt_unit2_factor": alt_u2_factor,
        "length_per_pc": row["length_per_pc"] if "length_per_pc" in keys else 0,
        "active": bool(row["active"]),
        "updated_at": row["updated_at"],
        "order_unit": order_u,
    }


def next_order_no(conn: sqlite3.Connection) -> tuple[str, int, int]:
    year = datetime.now().year
    key = f"orders-{year}"
    row = conn.execute("SELECT value FROM counters WHERE name=?", (key,)).fetchone()
    seq = (row["value"] if row else 0) + 1
    if row:
        conn.execute("UPDATE counters SET value=? WHERE name=?", (seq, key))
    else:
        conn.execute("INSERT INTO counters (name, value) VALUES (?,?)", (key, seq))
    return f"PS-{year}-{seq:04d}", seq, year


def order_summary(row: sqlite3.Row, line_count: int = 0, pcs: int = 0) -> dict:
    return {
        "id": row["id"],
        "order_no": row["order_no"],
        "created_at": row["created_at"],
        "created_label": local_dt(row["created_at"]),
        "customer_name": row["customer_name"],
        "customer_phone": row["customer_phone"],
        "worker": row["worker"],
        "note": row["note"],
        "status": row["status"],
        "est_weight": row["est_weight"],
        "est_amount": row["est_amount"],
        "actual_weight": row["actual_weight"],
        "actual_amount": row["actual_amount"],
        "weighed_at": row["weighed_at"],
        "weighed_label": local_dt(row["weighed_at"]),
        "lines": line_count,
        "pcs": pcs,
    }


COMMON_UNITS = ["kg", "pcs", "feet", "inch", "metre", "bundle", "sheet"]


def norm_unit(u: str) -> str:
    s = (u or "").strip().lower()
    if s in ("in", "inch", "inches", '"'):
        return "inch"
    if s in ("ft", "foot", "feet", "'"):
        return "feet"
    if s in ("pc", "pcs", "piece", "pieces", "nos", "no"):
        return "pcs"
    if s in ("kg", "kgs", "kilo", "kilogram", "kilograms"):
        return "kg"
    if s in ("m", "mtr", "meter", "metre", "meters", "metres"):
        return "metre"
    return s or "pcs"


def resolve_quantity(item: sqlite3.Row | dict, entry_qty: float, entry_unit: str) -> dict:
    """Resolve an entered quantity & unit to pieces, weight, and order unit.
    Rate multiplies with main_unit only: est_amount = main_qty * rate.
    Supports primary alt_unit and secondary alt_unit2 (e.g. Coil: main=kg, alt=feet @1.9, alt2=pcs @100)."""
    def _val(k, defval):
        if isinstance(item, dict):
            return item.get(k, defval)
        return item[k] if k in item.keys() else defval

    raw_qty = float(entry_qty or 0)
    u = norm_unit(entry_unit)
    main_u = norm_unit(_val("main_unit", "kg"))
    alt_u = norm_unit(_val("alt_unit", ""))
    alt_factor = float(_val("alt_factor", 0) or 0)
    alt_u2 = norm_unit(_val("alt_unit2", ""))
    alt_unit2_factor = float(_val("alt_unit2_factor", 0) or 0)
    alt_u2_factor = alt_unit2_factor
    length_per_pc = float(_val("length_per_pc", 0) or 0)
    weight_per_pc = float(_val("weight_per_pc", 0) or 0)
    rate = float(_val("rate", 0) or 0)

    # Derive effective weight_per_pc and length_per_pc if not explicitly configured
    if weight_per_pc <= 0:
        if alt_u == "pcs" and alt_factor > 0:
            weight_per_pc = alt_factor
        elif alt_u2 == "pcs" and alt_unit2_factor > 0:
            weight_per_pc = alt_unit2_factor

    if length_per_pc <= 0:
        if alt_u == "feet" and alt_factor > 0 and alt_u2 == "pcs" and alt_unit2_factor > 0:
            length_per_pc = round(alt_unit2_factor / alt_factor, 3)
        elif alt_u2 == "feet" and alt_unit2_factor > 0 and alt_u == "pcs" and alt_factor > 0:
            length_per_pc = round(alt_factor / alt_unit2_factor, 3)

    # 1. Inch and Metre conversions
    effective_qty = raw_qty
    effective_unit = u
    if u == "inch":
        effective_qty = round(raw_qty / 12.0, 3)
        effective_unit = "feet"
    elif u == "metre":
        if main_u != "metre" and alt_u != "metre" and alt_u2 != "metre":
            effective_qty = round(raw_qty * 3.28084, 3)
            effective_unit = "feet"

    # 2. Derive main_qty (quantity in main_unit)
    main_qty = 0.0
    if effective_unit == main_u:
        main_qty = effective_qty
    elif alt_u and effective_unit == alt_u and alt_factor > 0:
        # alt_factor is "how many main units one alt unit is" for every unit
        # except kilograms. A kilogram is a measure of the material, so when the
        # item is counted in pieces alt_factor is the weight of one piece and the
        # conversion goes the other way. Reading it as a multiplier turns 91 kg
        # into 2,757 pieces.
        if alt_u == "kg" and main_u != "kg":
            main_qty = effective_qty / alt_factor
        else:
            main_qty = effective_qty * alt_factor
    elif alt_u2 and effective_unit == alt_u2 and alt_unit2_factor > 0:
        main_qty = effective_qty * alt_unit2_factor
    elif effective_unit == "pcs":
        if alt_u == "pcs" and alt_factor > 0:
            main_qty = effective_qty * alt_factor
        elif alt_u2 == "pcs" and alt_unit2_factor > 0:
            main_qty = effective_qty * alt_unit2_factor
        elif weight_per_pc > 0 and main_u == "kg":
            main_qty = effective_qty * weight_per_pc
        elif length_per_pc > 0 and alt_u == "feet" and alt_factor > 0:
            main_qty = effective_qty * length_per_pc * alt_factor
        else:
            main_qty = effective_qty
    elif effective_unit == "feet":
        if alt_u == "feet" and alt_factor > 0:
            main_qty = effective_qty * alt_factor
        elif alt_u2 == "feet" and alt_unit2_factor > 0:
            main_qty = effective_qty * alt_unit2_factor
        elif length_per_pc > 0:
            pcs_derived = effective_qty / length_per_pc
            if alt_u2 == "pcs" and alt_unit2_factor > 0:
                main_qty = pcs_derived * alt_unit2_factor
            elif alt_u == "pcs" and alt_factor > 0:
                main_qty = pcs_derived * alt_factor
            elif weight_per_pc > 0 and main_u == "kg":
                main_qty = pcs_derived * weight_per_pc
            else:
                main_qty = pcs_derived
        else:
            main_qty = effective_qty
    elif effective_unit == "kg":
        if main_u == "kg":
            main_qty = effective_qty
        elif alt_u == "kg" and alt_factor > 0:
            main_qty = effective_qty / alt_factor
        elif alt_u2 == "kg" and alt_unit2_factor > 0:
            main_qty = effective_qty / alt_unit2_factor
        elif main_u == "pcs" and weight_per_pc > 0:
            main_qty = effective_qty / weight_per_pc
        else:
            main_qty = effective_qty
    else:
        main_qty = effective_qty

    # 3. Derive pcs
    pcs = 0.0
    if effective_unit == "pcs":
        pcs = effective_qty
    elif main_u == "pcs":
        pcs = main_qty
    elif alt_u2 == "pcs" and alt_unit2_factor > 0:
        pcs = main_qty / alt_unit2_factor
    elif alt_u == "pcs" and alt_factor > 0:
        pcs = main_qty / alt_factor
    elif length_per_pc > 0 and effective_unit == "feet":
        pcs = effective_qty / length_per_pc
    elif weight_per_pc > 0 and main_u == "kg":
        pcs = main_qty / weight_per_pc
    elif weight_per_pc > 0 and effective_unit == "kg":
        pcs = effective_qty / weight_per_pc
    else:
        pcs = max(1.0, effective_qty)

    # 4. Derive calc_weight (in kg). This comes before the amount because every
    # item in this business is priced per kilogram, whatever unit it is counted
    # in. A 30 kg sheet at 177 is 177 per kg, not 177 per sheet.
    calc_weight = 0.0
    if main_u == "kg":
        calc_weight = main_qty
    elif alt_u == "kg" and alt_factor > 0:
        calc_weight = main_qty * alt_factor
    elif alt_u2 == "kg" and alt_unit2_factor > 0:
        calc_weight = main_qty * alt_unit2_factor
    elif effective_unit == "kg":
        calc_weight = effective_qty
    elif weight_per_pc > 0:
        calc_weight = main_qty * weight_per_pc

    # 5. Amount follows the weight.
    est_amount = calc_weight * rate if calc_weight > 0 else main_qty * rate


    # 6. Derive length in feet
    feet = 0.0
    if effective_unit == "feet":
        feet = effective_qty
    elif alt_u == "feet" and alt_factor > 0:
        feet = main_qty / alt_factor
    elif alt_u2 == "feet" and alt_unit2_factor > 0:
        feet = main_qty / alt_unit2_factor
    elif length_per_pc > 0 and pcs > 0:
        feet = pcs * length_per_pc

    final_pcs = max(1, int(round(pcs))) if pcs > 0 else 1
    return {
        "pcs": final_pcs,
        "qty": round(effective_qty, 3),
        "unit": effective_unit,
        "entry_qty": round(raw_qty, 3),
        "entry_unit": u,
        "main_qty": round(main_qty, 3),
        "main_unit": main_u,
        "calc_feet": round(feet, 2) if feet else 0,
        "est_weight": weight(calc_weight),
        "weight": weight(calc_weight),
        "est_amount": money(est_amount),
        "amount": money(est_amount),
    }


def _fetch_order_impl(conn: sqlite3.Connection, order_id: str) -> dict | None:
    row = conn.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
    if not row:
        return None
    lines = conn.execute(
        "SELECT * FROM order_lines WHERE order_id=? ORDER BY line_no", (order_id,)
    ).fetchall()
    out = order_summary(row, len(lines), sum(l["pcs"] for l in lines))
    lines_detail = []
    for l in lines:
        keys = l.keys()
        pcs = l["pcs"]
        w_per_pc = float(l["weight_per_pc"] or 0)
        rate = float(l["rate"] or 0)
        est_w = weight(pcs * w_per_pc) if w_per_pc > 0 else 0.0
        unit = l["unit"] if "unit" in keys and l["unit"] else "pcs"
        qty = l["qty"] if "qty" in keys and l["qty"] else float(pcs)

        if est_w > 0:
            est_a = money(est_w * rate)
        elif unit == "pcs":
            est_a = money(pcs * rate)
        else:
            est_a = money(qty * rate)

        act_w = l["actual_weight"]
        if act_w is not None:
            act_a = money(act_w * rate)
        else:
            act_a = 0.0

        lines_detail.append({
            "id": l["id"],
            "line_no": l["line_no"],
            "item_id": l["item_id"],
            "name": l["name"],
            "category": l["category"],
            "pcs": pcs,
            "weight_per_pc": w_per_pc,
            "rate": rate,
            "est_weight": est_w,
            "est_amount": est_a,
            "actual_weight": act_w,
            "actual_amount": act_a,
            "weighed": act_w is not None,
            "narration": l["narration"] if "narration" in keys else "",
            "entry_unit": l["entry_unit"] if "entry_unit" in keys else "",
            "entry_qty": l["entry_qty"] if "entry_qty" in keys else 0,
            "unit": unit,
            "qty": qty,
        })
    out["lines_detail"] = lines_detail
    return out


def fetch_order(conn_or_id: sqlite3.Connection | str, maybe_order_id: str | None = None) -> dict | None:
    if isinstance(conn_or_id, str):
        conn = db()
        try:
            return _fetch_order_impl(conn, conn_or_id)
        finally:
            conn.close()
    return _fetch_order_impl(conn_or_id, maybe_order_id)


def get_order(order_id: str) -> dict | None:
    return fetch_order(order_id)


def recalc_order_totals(conn: sqlite3.Connection, order_id: str) -> None:
    lines = conn.execute("SELECT * FROM order_lines WHERE order_id=? ORDER BY line_no", (order_id,)).fetchall()
    est_w = 0.0
    est_a = 0.0
    act_w = 0.0
    act_a = 0.0
    all_weighed = bool(lines)
    has_any_act = False

    for l in lines:
        keys = l.keys()
        w_per_pc = float(l["weight_per_pc"] or 0)
        rate = float(l["rate"] or 0)
        pcs = float(l["pcs"] or 0)
        qty = float(l["qty"] if "qty" in keys and l["qty"] else pcs)
        u = l["unit"] if "unit" in keys and l["unit"] else "pcs"

        line_est_w = weight(pcs * w_per_pc) if w_per_pc > 0 else 0.0
        if line_est_w > 0:
            line_est_a = money(line_est_w * rate)
        elif u == "pcs":
            line_est_a = money(pcs * rate)
        else:
            line_est_a = money(qty * rate)

        est_w += line_est_w
        est_a += line_est_a

        act = l["actual_weight"]
        if act is not None:
            has_any_act = True
            act_w += float(act)
            act_a += float(act) * rate
        else:
            all_weighed = False

    order = conn.execute("SELECT status FROM orders WHERE id=?", (order_id,)).fetchone()
    if not order:
        return
    old_status = order["status"]
    new_status = "WEIGHED" if (old_status == "WEIGHED" or (lines and all_weighed and has_any_act)) else "OPEN"

    conn.execute(
        """UPDATE orders SET
               est_weight=?, est_amount=?,
               actual_weight=?, actual_amount=?,
               status=?
           WHERE id=?""",
        (weight(est_w), money(est_a), weight(act_w), money(act_a), new_status, order_id),
    )


def create_order(payload: dict) -> dict:
    lines_in = payload.get("lines") or []
    if not lines_in:
        raise ValueError("An order needs at least one item.")

    conn = db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        existing = None
        client_id = (payload.get("client_id") or "").strip() or None
        if client_id:
            existing = conn.execute(
                "SELECT id FROM orders WHERE client_id=?", (client_id,)
            ).fetchone()
        if existing:
            conn.rollback()
            return fetch_order(conn, existing["id"])

        prepared = []
        est_weight = 0.0
        est_amount = 0.0

        for idx, line in enumerate(lines_in, start=1):
            item_id = line.get("item_id")
            item = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
            if not item:
                raise ValueError(f"Item {item_id} is no longer available.")

            if "pcs" in line and not line.get("qty") and not line.get("entry_qty"):
                raw_qty = float(line["pcs"])
                raw_unit = "pcs"
            else:
                raw_qty = float(line.get("qty") or line.get("entry_qty") or line.get("pcs") or 1)
                raw_unit = str(line.get("unit") or line.get("entry_unit") or item["main_unit"] or "pcs").strip()
            res = resolve_quantity(item, raw_qty, raw_unit)
            narration = str(line.get("narration") or "").strip()[:200]

            act_w = line.get("actual_weight")
            if act_w is not None and str(act_w).strip() != "":
                act_w = weight(float(act_w))
            else:
                act_w = None

            est_weight += res["est_weight"]
            est_amount += res["est_amount"]
            prepared.append((idx, item, res, narration, act_w))

        order_no, seq, year = next_order_no(conn)
        order_id = str(uuid.uuid4())
        created = now_ms()

        conn.execute(
            """INSERT INTO orders (id, order_no, seq, year, client_id, created_at,
                   customer_name, customer_phone, worker, note, status,
                   est_weight, est_amount)
               VALUES (?,?,?,?,?,?,?,?,?,?,'OPEN',?,?)""",
            (
                order_id, order_no, seq, year, client_id, created,
                (payload.get("customer_name") or "").strip()[:120],
                (payload.get("customer_phone") or "").strip()[:32],
                (payload.get("worker") or "").strip()[:60],
                (payload.get("note") or "").strip()[:300],
                weight(est_weight), money(est_amount),
            ),
        )

        for line_no, item, res, narration, act_w in prepared:
            conn.execute(
                """INSERT INTO order_lines (id, order_id, line_no, item_id, name, category,
                       pcs, weight_per_pc, rate, actual_weight,
                       narration, entry_unit, entry_qty, unit, qty)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    str(uuid.uuid4()), order_id, line_no, item["id"], item["name"],
                    item["category"], res["pcs"], item["weight_per_pc"], item["rate"], act_w,
                    narration, res["entry_unit"], res["entry_qty"], res["unit"], res["qty"],
                ),
            )

        name = (payload.get("customer_name") or "").strip()
        if name:
            hit = conn.execute("SELECT id FROM customers WHERE norm=?", (norm_name(name),)).fetchone()
            if not hit:
                conn.execute(
                    "INSERT INTO customers (name, norm, phone, gstin, updated_at) VALUES (?,?,?,'',?)",
                    (name, norm_name(name), (payload.get("customer_phone") or "").strip(), created),
                )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    log_event("order.created", order_no)
    order = get_order(order_id)
    auto_export(order)
    return order


def update_order(order_id: str, payload: dict) -> dict:
    conn = db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        order = conn.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        if not order:
            raise KeyError("Order not found")

        fields = []
        vals = []
        c_name = None
        if "customer_name" in payload:
            c_name = str(payload["customer_name"] or "").strip()[:120]
            fields.append("customer_name=?")
            vals.append(c_name)
            if c_name:
                hit = conn.execute("SELECT id FROM customers WHERE norm=?", (norm_name(c_name),)).fetchone()
                if not hit:
                    conn.execute(
                        "INSERT INTO customers (name, norm, phone, gstin, updated_at) VALUES (?,?,?,'',?)",
                        (c_name, norm_name(c_name), str(payload.get("customer_phone") or "").strip(), now_ms()),
                    )
        if "customer_phone" in payload:
            fields.append("customer_phone=?")
            vals.append(str(payload["customer_phone"] or "").strip()[:32])
        if "worker" in payload:
            fields.append("worker=?")
            vals.append(str(payload["worker"] or "").strip()[:60])
        if "note" in payload:
            fields.append("note=?")
            vals.append(str(payload["note"] or "").strip()[:300])

        if fields:
            vals.append(order_id)
            conn.execute(f"UPDATE orders SET {', '.join(fields)} WHERE id=?", vals)

        # If lines array provided, replace lines
        if "lines" in payload:
            lines_in = payload["lines"]
            if not lines_in:
                raise ValueError("An order must have at least one line.")
            conn.execute("DELETE FROM order_lines WHERE order_id=?", (order_id,))
            for idx, line in enumerate(lines_in, start=1):
                item_id = line.get("item_id")
                item = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
                if not item:
                    raise ValueError(f"Item {item_id} not found.")

                if "pcs" in line and not line.get("qty") and not line.get("entry_qty"):
                    raw_qty = float(line["pcs"])
                    raw_unit = "pcs"
                else:
                    raw_qty = float(line.get("qty") or line.get("entry_qty") or line.get("pcs") or 1)
                    raw_unit = str(line.get("unit") or line.get("entry_unit") or item["main_unit"] or "pcs").strip()
                res = resolve_quantity(item, raw_qty, raw_unit)
                narration = str(line.get("narration") or "").strip()[:200]

                act_w = line.get("actual_weight")
                if act_w is not None and str(act_w).strip() != "":
                    act_w = weight(float(act_w))
                else:
                    act_w = None

                conn.execute(
                    """INSERT INTO order_lines (id, order_id, line_no, item_id, name, category,
                           pcs, weight_per_pc, rate, actual_weight,
                           narration, entry_unit, entry_qty, unit, qty)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        str(line.get("id") or uuid.uuid4()), order_id, idx, item["id"], item["name"],
                        item["category"], res["pcs"], item["weight_per_pc"], item["rate"], act_w,
                        narration, res["entry_unit"], res["entry_qty"], res["unit"], res["qty"],
                    ),
                )

        recalc_order_totals(conn, order_id)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    log_event("order.updated", order_id)
    order_out = get_order(order_id)
    if order_out and order_out.get("status") == "WEIGHED":
        auto_export(order_out)
    return order_out


def update_order_line(order_id: str, line_id: str, patch: dict) -> dict:
    conn = db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        line = conn.execute("SELECT * FROM order_lines WHERE id=? AND order_id=?", (line_id, order_id)).fetchone()
        if not line:
            raise KeyError("Line not found")
        item = conn.execute("SELECT * FROM items WHERE id=?", (line["item_id"],)).fetchone() if line["item_id"] else None

        fields = []
        vals = []

        if "narration" in patch:
            fields.append("narration=?")
            vals.append(str(patch["narration"] or "").strip()[:200])

        if "actual_weight" in patch:
            raw_act = patch["actual_weight"]
            if raw_act is None or str(raw_act).strip() == "":
                fields.append("actual_weight=NULL")
            else:
                fields.append("actual_weight=?")
                vals.append(weight(float(raw_act)))

        if "qty" in patch or "unit" in patch or "entry_qty" in patch or "entry_unit" in patch:
            raw_qty = float(patch.get("qty") or patch.get("entry_qty") or line["qty"] or line["pcs"])
            raw_unit = str(patch.get("unit") or patch.get("entry_unit") or line["unit"] or "pcs").strip()
            if item:
                res = resolve_quantity(item, raw_qty, raw_unit)
                fields.extend(["pcs=?", "qty=?", "unit=?", "entry_qty=?", "entry_unit=?"])
                vals.extend([res["pcs"], res["qty"], res["unit"], res["entry_qty"], res["entry_unit"]])
            else:
                fields.extend(["pcs=?", "qty=?", "unit=?"])
                vals.extend([int(round(raw_qty)), raw_qty, raw_unit])

        if fields:
            vals.extend([line_id, order_id])
            conn.execute(f"UPDATE order_lines SET {', '.join(fields)} WHERE id=? AND order_id=?", vals)

        recalc_order_totals(conn, order_id)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    log_event("order_line.updated", f"{order_id}/{line_id}")
    order_out = get_order(order_id)
    if order_out and order_out.get("status") == "WEIGHED":
        auto_export(order_out)
    return order_out


def add_order_line(order_id: str, line_data: dict) -> dict:
    conn = db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        order = conn.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        if not order:
            raise KeyError("Order not found")
        item_id = line_data.get("item_id")
        item = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        if not item:
            raise ValueError("Item not found")

        max_line = conn.execute("SELECT COALESCE(MAX(line_no), 0) m FROM order_lines WHERE order_id=?", (order_id,)).fetchone()["m"]
        line_no = max_line + 1

        raw_qty = float(line_data.get("qty") or line_data.get("entry_qty") or line_data.get("pcs") or 1)
        raw_unit = str(line_data.get("unit") or line_data.get("entry_unit") or item["main_unit"] or "pcs").strip()
        res = resolve_quantity(item, raw_qty, raw_unit)
        narration = str(line_data.get("narration") or "").strip()[:200]

        act_w = line_data.get("actual_weight")
        if act_w is not None and str(act_w).strip() != "":
            act_w = weight(float(act_w))
        else:
            act_w = None

        line_id = str(uuid.uuid4())
        conn.execute(
            """INSERT INTO order_lines (id, order_id, line_no, item_id, name, category,
                   pcs, weight_per_pc, rate, actual_weight,
                   narration, entry_unit, entry_qty, unit, qty)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                line_id, order_id, line_no, item["id"], item["name"],
                item["category"], res["pcs"], item["weight_per_pc"], item["rate"], act_w,
                narration, res["entry_unit"], res["entry_qty"], res["unit"], res["qty"],
            ),
        )

        recalc_order_totals(conn, order_id)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    log_event("order_line.added", f"{order_id}/{line_id}")
    order_out = get_order(order_id)
    if order_out and order_out.get("status") == "WEIGHED":
        auto_export(order_out)
    return order_out


def delete_order_line(order_id: str, line_id: str) -> dict:
    conn = db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        count = conn.execute("SELECT COUNT(*) c FROM order_lines WHERE order_id=?", (order_id,)).fetchone()["c"]
        if count <= 1:
            raise ValueError("Cannot delete the only item in an order.")
        conn.execute("DELETE FROM order_lines WHERE id=? AND order_id=?", (line_id, order_id))
        recalc_order_totals(conn, order_id)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    log_event("order_line.deleted", f"{order_id}/{line_id}")
    order_out = get_order(order_id)
    if order_out and order_out.get("status") == "WEIGHED":
        auto_export(order_out)
    return order_out


def delete_order(order_id: str) -> bool:
    conn = db()
    try:
        conn.execute("DELETE FROM orders WHERE id=?", (order_id,))
        conn.commit()
    finally:
        conn.close()
    log_event("order.deleted", order_id)
    return True


def delete_item(item_id: int, hard: bool = False) -> dict:
    conn = db()
    try:
        if hard:
            conn.execute("DELETE FROM items WHERE id=?", (item_id,))
            conn.commit()
            return {"ok": True, "action": "deleted"}
        used = conn.execute("SELECT COUNT(*) c FROM order_lines WHERE item_id=?", (item_id,)).fetchone()["c"]
        if used > 0:
            conn.execute("UPDATE items SET active=0, updated_at=? WHERE id=?", (now_ms(), item_id))
            action = "deactivated"
        else:
            conn.execute("DELETE FROM items WHERE id=?", (item_id,))
            action = "deleted"
        conn.commit()
        return {"ok": True, "action": action}
    finally:
        conn.close()


def submit_weights(order_id: str, weights: dict[str, float], require_all: bool = False) -> dict:
    conn = db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        order = conn.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        if not order:
            raise KeyError("Order not found")
        lines = conn.execute("SELECT * FROM order_lines WHERE order_id=?", (order_id,)).fetchall()
        if not lines:
            raise ValueError("Order has no items.")

        line_ids = {l["id"] for l in lines}
        if require_all:
            missing = [lid for lid in line_ids if lid not in weights or weights[lid] is None or str(weights[lid]).strip() == ""]
            if missing:
                raise ValueError("Enter a weight for every line.")

        for line in lines:
            raw = weights.get(line["id"])
            if raw is not None and str(raw).strip() != "":
                try:
                    w = float(raw)
                except (TypeError, ValueError):
                    raise ValueError(f"'{raw}' is not a valid weight for {line['name']}.")
                if w < 0 or w > 100000:
                    raise ValueError(f"Weight for {line['name']} looks wrong.")
                conn.execute("UPDATE order_lines SET actual_weight=? WHERE id=?", (weight(w), line["id"]))

        conn.execute("UPDATE orders SET weighed_at=? WHERE id=?", (now_ms(), order_id))
        recalc_order_totals(conn, order_id)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    log_event("order.weighed", order_id)
    order = get_order(order_id)
    auto_export(order)
    return order


def auto_export(order: dict) -> None:
    """Write a finished order to exports/ and (optionally) the shared folder."""
    if not order or order["status"] != "WEIGHED":
        return
    settings = load_settings()
    safe = re.sub(r"[^A-Za-z0-9]+", "_", order["customer_name"] or "Walk_in").strip("_")[:40]
    stamp = datetime.now().strftime("%d-%m-%Y")
    base = f"{order['order_no']}_{safe or 'Walk_in'}_{stamp}"
    targets = [EXPORT_DIR]
    shared = (settings.get("shared_folder") or "").strip()
    if shared:
        try:
            p = Path(shared)
            p.mkdir(parents=True, exist_ok=True)
            targets.append(p)
        except Exception as exc:
            log_event("export.shared_failed", str(exc))
    for folder in targets:
        try:
            written = write_order_file(order, folder, base)
            if written:
                log_event("export.written", str(written))
        except Exception as exc:
            log_event("export.failed", str(exc))
            try:
                conn = db()
                conn.execute("UPDATE orders SET export_error=? WHERE id=?", (str(exc)[:300], order["id"]))
                conn.commit()
                conn.close()
            except Exception:
                pass


def write_order_file(order: dict, folder: Path, base: str):
    import excel_export

    if excel_export.HAS_OPENPYXL:
        path = folder / f"{base}.xlsx"
        path.write_bytes(excel_export.order_workbook(order, load_settings()))
        return path
    path = folder / f"{base}.csv"
    path.write_text(excel_export.order_csv(order, load_settings()), encoding="utf-8-sig")
    return path


# --------------------------------------------------------------------------
# items
# --------------------------------------------------------------------------

def list_items(include_inactive: bool = False) -> list[dict]:
    conn = db()
    try:
        sql = "SELECT * FROM items"
        if not include_inactive:
            sql += " WHERE active=1"
        sql += " ORDER BY sort, name COLLATE NOCASE"
        return [item_row(r) for r in conn.execute(sql).fetchall()]
    finally:
        conn.close()


def update_item(item_id: int, patch: dict) -> dict:
    fields, values = [], []
    conn = db()
    try:
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise KeyError("Item not found")
        if "name" in patch:
            name = str(patch["name"]).strip()
            if not name:
                raise ValueError("Item name cannot be empty.")
            dupe = conn.execute(
                "SELECT id FROM items WHERE norm=? AND id<>?", (norm_name(name), item_id)
            ).fetchone()
            if dupe:
                raise ValueError(f"'{name}' already exists.")
            fields += ["name=?", "norm=?"]
            values += [name, norm_name(name)]
        if "category" in patch:
            fields.append("category=?")
            values.append(str(patch["category"]).strip().upper()[:24])
        if "rate" in patch:
            fields.append("rate=?")
            values.append(money(patch["rate"]))
        if "weight_per_pc" in patch:
            fields.append("weight_per_pc=?")
            values.append(weight(patch["weight_per_pc"]))
        if "active" in patch:
            fields.append("active=?")
            values.append(1 if patch["active"] else 0)
        if "main_unit" in patch:
            fields.append("main_unit=?")
            values.append(str(patch["main_unit"]).strip() or "kg")
        if "alt_unit" in patch:
            fields.append("alt_unit=?")
            values.append(str(patch["alt_unit"]).strip())
        if "alt_factor" in patch:
            fields.append("alt_factor=?")
            values.append(float(patch["alt_factor"] or 0))
        if "alt_unit2" in patch:
            fields.append("alt_unit2=?")
            values.append(str(patch["alt_unit2"]).strip())
        if "alt_unit2_factor" in patch:
            fields.append("alt_unit2_factor=?")
            values.append(float(patch["alt_unit2_factor"] or 0))
        if "length_per_pc" in patch:
            fields.append("length_per_pc=?")
            values.append(float(patch["length_per_pc"] or 0))
        if "order_unit" in patch:
            fields.append("order_unit=?")
            values.append(str(patch["order_unit"]).strip())
        if not fields:
            return item_row(row)
        fields.append("updated_at=?")
        values.append(now_ms())
        values.append(item_id)
        conn.execute(f"UPDATE items SET {', '.join(fields)} WHERE id=?", values)
        conn.commit()
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        return item_row(row)
    finally:
        conn.close()


def create_item(payload: dict) -> dict:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("Item name is required.")
    conn = db()
    try:
        dupe = conn.execute("SELECT * FROM items WHERE norm=?", (norm_name(name),)).fetchone()
        if dupe:
            raise ValueError(f"'{name}' already exists.")
        conn.execute(
            """INSERT INTO items (name, norm, category, rate, weight_per_pc,
                   main_unit, alt_unit, alt_factor, alt_unit2, alt_unit2_factor, length_per_pc,
                   order_unit,
                   active, sort, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,0,?)""",
            (
                name, norm_name(name), str(payload.get("category") or "").strip().upper()[:24],
                money(payload.get("rate")), weight(payload.get("weight_per_pc")),
                str(payload.get("main_unit") or "kg").strip() or "kg",
                str(payload.get("alt_unit") or "").strip(),
                float(payload.get("alt_factor") or 0),
                str(payload.get("alt_unit2") or "").strip(),
                float(payload.get("alt_unit2_factor") or 0),
                float(payload.get("length_per_pc") or 0),
                str(payload.get("order_unit") or "").strip().lower(),
                now_ms(),
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM items WHERE norm=?", (norm_name(name),)).fetchone()
        return item_row(row)
    finally:
        conn.close()


def bulk_update_items(rows: list[dict]) -> dict:
    """Upsert by name. Blank cells are left untouched; 0 is a real value."""
    created = updated = unchanged = 0
    errors: list[dict] = []
    actions: list[dict] = []
    conn = db()
    try:
        for idx, raw in enumerate(rows, start=1):
            name = str(raw.get("name") or "").strip()
            if not name:
                continue
            try:
                rate = raw.get("rate")
                wp = raw.get("weight")
                rate = None if rate in (None, "") else money(rate)
                wp = None if wp in (None, "") else weight(wp)
                main_unit = raw.get("main_unit")
                alt_unit = raw.get("alt_unit")
                alt_factor = raw.get("alt_factor")
                alt_unit2 = raw.get("alt_unit2")
                alt_unit2_factor = raw.get("alt_unit2_factor")
                length_per_pc = raw.get("length_per_pc")
                main_unit = None if main_unit in (None, "") else str(main_unit).strip()
                alt_unit = None if alt_unit is None else str(alt_unit).strip()
                alt_factor = None if alt_factor in (None, "") else float(alt_factor)
                alt_unit2 = None if alt_unit2 is None else str(alt_unit2).strip()
                alt_unit2_factor = None if alt_unit2_factor in (None, "") else float(alt_unit2_factor)
                length_per_pc = None if length_per_pc in (None, "") else float(length_per_pc)
                order_unit = raw.get("order_unit")
                order_unit = None if order_unit in (None, "") else str(order_unit).strip()
                existing = conn.execute("SELECT * FROM items WHERE norm=?", (norm_name(name),)).fetchone()
                if existing:
                    changes = {}
                    if rate is not None and abs(existing["rate"] - rate) > 0.0001:
                        changes["rate"] = rate
                    if wp is not None and abs(existing["weight_per_pc"] - wp) > 0.0001:
                        changes["weight_per_pc"] = wp
                    if main_unit is not None and existing["main_unit"] != main_unit:
                        changes["main_unit"] = main_unit
                    if alt_unit is not None and existing["alt_unit"] != alt_unit:
                        changes["alt_unit"] = alt_unit
                    if alt_factor is not None and abs(existing["alt_factor"] - alt_factor) > 0.0001:
                        changes["alt_factor"] = alt_factor
                    if alt_unit2 is not None and ("alt_unit2" in existing.keys() and existing["alt_unit2"] != alt_unit2):
                        changes["alt_unit2"] = alt_unit2
                    if alt_unit2_factor is not None and ("alt_unit2_factor" in existing.keys() and abs(existing["alt_unit2_factor"] - alt_unit2_factor) > 0.0001):
                        changes["alt_unit2_factor"] = alt_unit2_factor
                    if length_per_pc is not None and abs(existing["length_per_pc"] - length_per_pc) > 0.0001:
                        changes["length_per_pc"] = length_per_pc
                    if order_unit is not None and existing["order_unit"] != order_unit:
                        changes["order_unit"] = order_unit
                    if changes:
                        sets = ", ".join(f"{k}=?" for k in changes)
                        conn.execute(
                            f"UPDATE items SET {sets}, updated_at=? WHERE id=?",
                            list(changes.values()) + [now_ms(), existing["id"]],
                        )
                        updated += 1
                        actions.append({"row": idx, "name": name, "action": "updated"})
                    else:
                        unchanged += 1
                        actions.append({"row": idx, "name": name, "action": "same"})
                else:
                    conn.execute(
                        """INSERT INTO items (name, norm, category, rate, weight_per_pc,
                               main_unit, alt_unit, alt_factor, alt_unit2, alt_unit2_factor, length_per_pc,
                               order_unit,
                               active, sort, updated_at)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,0,?)""",
                        (
                            name, norm_name(name), str(raw.get("category") or "").strip().upper()[:24],
                            rate or 0, wp or 0,
                            main_unit or "kg", alt_unit or "", alt_factor or 0,
                            alt_unit2 or "", alt_unit2_factor or 0, length_per_pc or 0,
                            order_unit or "",
                            now_ms(),
                        ),
                    )
                    created += 1
                    actions.append({"row": idx, "name": name, "action": "new"})
            except Exception as exc:
                errors.append({"row": idx, "name": name, "error": str(exc)})
        conn.commit()
    finally:
        conn.close()
    log_event("items.bulk", f"new={created} updated={updated} same={unchanged} errors={len(errors)}")
    return {
        "created": created, "updated": updated, "unchanged": unchanged,
        "errors": errors, "actions": actions,
    }


def customers_search(q: str, limit: int = 12) -> list[dict]:
    conn = db()
    try:
        q = (q or "").strip()
        if q:
            like = f"%{q}%"
            rows = conn.execute(
                """SELECT id, name, phone, gstin, updated_at FROM customers
                   WHERE name LIKE ? OR phone LIKE ? OR gstin LIKE ?
                   ORDER BY CASE WHEN name LIKE ? THEN 0 ELSE 1 END, name
                   LIMIT ?""",
                (like, like, like, f"{q}%", limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, name, phone, gstin, updated_at FROM customers ORDER BY updated_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def list_customers(q: str = "", limit: int = 100, query: str = "") -> list[dict]:
    conn = db()
    try:
        q = (query or q or "").strip()
        if q:
            like = f"%{q}%"
            rows = conn.execute(
                """SELECT c.*,
                     (SELECT COUNT(*) FROM orders o WHERE o.customer_name=c.name) AS order_count
                   FROM customers c
                   WHERE c.name LIKE ? OR c.phone LIKE ? OR c.gstin LIKE ?
                   ORDER BY CASE WHEN c.name LIKE ? THEN 0 ELSE 1 END, c.name
                   LIMIT ?""",
                (like, like, like, f"{q}%", limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT c.*,
                     (SELECT COUNT(*) FROM orders o WHERE o.customer_name=c.name) AS order_count
                   FROM customers c
                   ORDER BY c.updated_at DESC, c.name
                   LIMIT ?""",
                (limit,),
            ).fetchall()
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "phone": r["phone"],
                "gstin": r["gstin"],
                "address": r["address"] if "address" in r.keys() else "",
                "order_count": r["order_count"],
                "updated_at": r["updated_at"],
                "updated_label": local_dt(r["updated_at"]),
            }
            for r in rows
        ]
    finally:
        conn.close()


def get_customer_by_id(customer_id: int) -> dict | None:
    conn = db()
    try:
        row = conn.execute(
            """SELECT c.*,
                 (SELECT COUNT(*) FROM orders o WHERE o.customer_name=c.name) AS order_count
               FROM customers c
               WHERE c.id=?""",
            (customer_id,),
        ).fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "name": row["name"],
            "phone": row["phone"],
            "gstin": row["gstin"],
            "address": row["address"] if "address" in row.keys() else "",
            "order_count": row["order_count"],
            "updated_at": row["updated_at"],
            "updated_label": local_dt(row["updated_at"]),
        }
    finally:
        conn.close()


def create_customer(payload: dict) -> dict:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("Customer name is required.")
    phone = str(payload.get("phone") or "").strip()
    gstin = str(payload.get("gstin") or "").strip().upper()
    address = str(payload.get("address") or "").strip()
    conn = db()
    try:
        dupe = conn.execute("SELECT * FROM customers WHERE norm=?", (norm_name(name),)).fetchone()
        if dupe:
            raise ValueError(f"Customer '{name}' already exists.")
        conn.execute(
            "INSERT INTO customers (name, norm, phone, gstin, address, updated_at) VALUES (?,?,?,?,?,?)",
            (name, norm_name(name), phone, gstin, address, now_ms()),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM customers WHERE norm=?", (norm_name(name),)).fetchone()
        return {"id": row["id"], "name": row["name"], "phone": row["phone"], "gstin": row["gstin"], "address": address}
    finally:
        conn.close()


def remember_phone(payload: dict) -> dict:
    """Store a hand-typed WhatsApp number against the customer name.

    Most customer records were imported without a phone, so the share sheet had
    nothing to pre-fill. When someone types the number once, keep it: the next
    estimate for that name fills itself. Never overwrites an existing number.
    """
    name = str(payload.get("name") or "").strip()
    phone = str(payload.get("phone") or "").strip()
    if not name or not phone:
        raise ValueError("Both customer name and phone are required.")
    conn = db()
    try:
        row = conn.execute(
            "SELECT id, phone FROM customers WHERE norm=?", (norm_name(name),)
        ).fetchone()
        if row:
            if not (row["phone"] or "").strip():
                conn.execute(
                    "UPDATE customers SET phone=?, updated_at=? WHERE id=?",
                    (phone, now_ms(), row["id"]),
                )
                conn.commit()
            return {"id": row["id"], "updated": True}
        conn.execute(
            "INSERT INTO customers (name, norm, phone, gstin, address, updated_at) VALUES (?,?,?,'','',?)",
            (name, norm_name(name), phone, now_ms()),
        )
        conn.commit()
        return {"id": conn.execute("SELECT id FROM customers WHERE norm=?", (norm_name(name),)).fetchone()["id"], "created": True}
    finally:
        conn.close()


def update_customer(cust_id: int, payload: dict) -> dict:
    conn = db()
    try:
        row = conn.execute("SELECT * FROM customers WHERE id=?", (cust_id,)).fetchone()
        if not row:
            raise KeyError("Customer not found")
        old_name = row["name"]
        fields = []
        vals = []
        new_name = None
        if "name" in payload:
            new_name = str(payload["name"] or "").strip()
            if not new_name:
                raise ValueError("Name cannot be empty.")
            dupe = conn.execute("SELECT id FROM customers WHERE norm=? AND id<>?", (norm_name(new_name), cust_id)).fetchone()
            if dupe:
                raise ValueError(f"Customer '{new_name}' already exists.")
            fields.extend(["name=?", "norm=?"])
            vals.extend([new_name, norm_name(new_name)])
        if "phone" in payload:
            fields.append("phone=?")
            vals.append(str(payload["phone"] or "").strip())
        if "gstin" in payload:
            fields.append("gstin=?")
            vals.append(str(payload["gstin"] or "").strip().upper())
        if "address" in payload:
            fields.append("address=?")
            vals.append(str(payload["address"] or "").strip())
        if fields:
            fields.append("updated_at=?")
            vals.append(now_ms())
            vals.append(cust_id)
            conn.execute(f"UPDATE customers SET {', '.join(fields)} WHERE id=?", vals)
            if new_name and new_name != old_name:
                conn.execute("UPDATE orders SET customer_name=? WHERE customer_name=?", (new_name, old_name))
            if "phone" in payload and (new_name or old_name):
                conn.execute("UPDATE orders SET customer_phone=? WHERE customer_name=?", (str(payload["phone"] or "").strip(), new_name or old_name))
            conn.commit()
        row = conn.execute("SELECT * FROM customers WHERE id=?", (cust_id,)).fetchone()
        return {
            "id": row["id"], "name": row["name"], "phone": row["phone"],
            "gstin": row["gstin"], "address": row["address"] if "address" in row.keys() else ""
        }
    finally:
        conn.close()


def bulk_update_customers(rows: list[dict]) -> dict:
    """Upsert customers by name. Provides a rich interface response."""
    created = updated = unchanged = 0
    errors: list[dict] = []
    actions: list[dict] = []
    conn = db()
    try:
        for idx, raw in enumerate(rows, start=1):
            name = str(raw.get("name") or "").strip()
            if not name:
                continue
            phone = str(raw.get("phone") or "").strip()[:32]
            gstin = str(raw.get("gstin") or "").strip().upper()[:24]
            address = str(raw.get("address") or "").strip()[:300]
            try:
                existing = conn.execute("SELECT * FROM customers WHERE norm=?", (norm_name(name),)).fetchone()
                if existing:
                    changes = {}
                    if phone and existing["phone"] != phone:
                        changes["phone"] = phone
                    if gstin and existing["gstin"] != gstin:
                        changes["gstin"] = gstin
                    if address and ("address" in existing.keys() and existing["address"] != address):
                        changes["address"] = address
                    if changes:
                        sets = ", ".join(f"{k}=?" for k in changes)
                        conn.execute(
                            f"UPDATE customers SET {sets}, updated_at=? WHERE id=?",
                            list(changes.values()) + [now_ms(), existing["id"]],
                        )
                        updated += 1
                        actions.append({"row": idx, "name": name, "action": "updated"})
                    else:
                        unchanged += 1
                        actions.append({"row": idx, "name": name, "action": "same"})
                else:
                    conn.execute(
                        "INSERT INTO customers (name, norm, phone, gstin, address, updated_at) VALUES (?,?,?,?,?,?)",
                        (name, norm_name(name), phone, gstin, address, now_ms()),
                    )
                    created += 1
                    actions.append({"row": idx, "name": name, "action": "new"})
            except Exception as exc:
                errors.append({"row": idx, "name": name, "error": str(exc)})
        conn.commit()
    finally:
        conn.close()
    log_event("customers.bulk", f"new={created} updated={updated} same={unchanged} errors={len(errors)}")
    return {
        "created": created, "updated": updated, "unchanged": unchanged,
        "errors": errors, "actions": actions,
    }


def delete_customer(cust_id: int) -> dict:
    conn = db()
    try:
        conn.execute("DELETE FROM customers WHERE id=?", (cust_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


def list_orders(status: str = "", q: str = "", since_ms: int = 0, limit: int = 200) -> list[dict]:
    conn = db()
    try:
        sql = """SELECT o.*,
                   (SELECT COUNT(*) FROM order_lines l WHERE l.order_id=o.id) AS line_count,
                   (SELECT COALESCE(SUM(pcs),0) FROM order_lines l WHERE l.order_id=o.id) AS pcs
                 FROM orders o WHERE 1=1"""
        args: list = []
        if status in ("OPEN", "WEIGHED"):
            sql += " AND o.status=?"
            args.append(status)
        if since_ms:
            sql += " AND o.created_at>=?"
            args.append(since_ms)
        if q:
            sql += " AND (o.order_no LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)"
            like = f"%{q}%"
            args += [like, like, like]
        sql += " ORDER BY o.created_at DESC LIMIT ?"
        args.append(limit)
        return [order_summary(r, r["line_count"], r["pcs"]) for r in conn.execute(sql, args).fetchall()]
    finally:
        conn.close()


def stats() -> dict:
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    start_ms = int(start.timestamp() * 1000)
    conn = db()
    try:
        to_weigh = conn.execute("SELECT COUNT(*) c FROM orders WHERE status='OPEN'").fetchone()["c"]
        today = conn.execute("SELECT COUNT(*) c FROM orders WHERE created_at>=?", (start_ms,)).fetchone()["c"]
        weighed_today = conn.execute(
            "SELECT COUNT(*) c, COALESCE(SUM(actual_amount),0) v FROM orders WHERE status='WEIGHED' AND weighed_at>=?",
            (start_ms,),
        ).fetchone()
        no_weight = conn.execute(
            "SELECT COUNT(*) c FROM items WHERE active=1 AND weight_per_pc<=0"
        ).fetchone()["c"]
        items = conn.execute("SELECT COUNT(*) c FROM items WHERE active=1").fetchone()["c"]
        pending_amount = conn.execute(
            "SELECT COALESCE(SUM(est_amount),0) v FROM orders WHERE status='OPEN'"
        ).fetchone()["v"]
        return {
            "to_weigh": to_weigh,
            "today_orders": today,
            "weighed_today": weighed_today["c"],
            "value_today": money(weighed_today["v"]),
            "items": items,
            "items_without_weight": no_weight,
            "pending_estimate": money(pending_amount),
        }
    finally:
        conn.close()


# --------------------------------------------------------------------------
# HTTP layer
# --------------------------------------------------------------------------

class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status
        self.message = message


class Handler(BaseHTTPRequestHandler):
    server_version = "PrimeSteel/1.0"
    protocol_version = "HTTP/1.1"

    # ---- plumbing -------------------------------------------------------
    def log_message(self, fmt, *args):  # quieter console
        if "/api/" in (self.path or ""):
            sys.stdout.write("  %s %s\n" % (self.command, self.path))

    def _headers(self, status: int, ctype: str, length: int, extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def _json(self, obj, status: int = 200, extra: dict | None = None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(body), extra)
        if self.command != "HEAD":
            self.wfile.write(body)

    def _bytes(self, data: bytes, ctype: str, filename: str | None = None, status: int = 200):
        extra = {}
        if filename:
            from urllib.parse import quote
            extra["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(filename)}"
        self._headers(status, ctype, len(data), extra)
        if self.command != "HEAD":
            self.wfile.write(data)

    def _content_length(self) -> int:
        try:
            return max(0, int(self.headers.get("Content-Length") or 0))
        except (TypeError, ValueError):
            return 0

    def _client_ip(self) -> str:
        xff = self.headers.get("X-Forwarded-For")
        if xff:
            return xff.split(",")[0].strip()
        cf_ip = self.headers.get("CF-Connecting-IP")
        if cf_ip:
            return cf_ip.strip()
        return self.client_address[0] if self.client_address else "127.0.0.1"

    def _body(self) -> dict:
        length = self._content_length()
        if not length:
            return {}
        if length > 262144:  # max 256KB request body to prevent DoS
            raise ApiError("Payload too large.", 413)
        raw = self.rfile.read(length)
        self._body_consumed = len(raw)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            raise ApiError("Malformed request.", 400)

    def _drain_body(self):
        """Consume whatever is left of the request body, and nothing more."""
        length = self._content_length()
        consumed = getattr(self, "_body_consumed", 0)
        remaining = length - consumed
        if remaining <= 0:
            return
        try:
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 65536))
                if not chunk:
                    break
                remaining -= len(chunk)
            self._body_consumed = length
        except Exception:
            self._body_consumed = length
            self.close_connection = True

    def _is_admin(self) -> bool:
        pin = (load_settings().get("admin_pin") or "").strip()
        if not pin:
            return True
        return (self.headers.get("X-Admin-Pin") or "").strip() == pin

    def _require_admin(self):
        if not self._is_admin():
            raise ApiError("Wrong PIN.", 401)

    def _is_worker(self) -> bool:
        if self._is_admin():
            return True
        wpin = (load_settings().get("worker_pin") or "").strip()
        if not wpin:
            return True
        pin = (self.headers.get("X-Worker-Pin") or "").strip()
        return pin == wpin

    def _require_worker(self):
        if not self._is_worker():
            raise ApiError("Worker or Admin authorization required.", 401)

    # ---- routing --------------------------------------------------------
    def handle_one_request(self):
        self._body_consumed = 0
        try:
            return super().handle_one_request()
        finally:
            if not self.close_connection:
                self._drain_body()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if self.headers.get("X-Forwarded-Proto") == "http":
            host = self.headers.get("Host") or "primesteel.cc.cd"
            self.send_response(301)
            self.send_header("Location", f"https://{host}{self.path}")
            self.send_header("Content-Length", "0")
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
            self.end_headers()
            return

        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        try:
            if path.startswith("/api/"):
                ip = self._client_ip()
                if not _rate_limiter.is_allowed(ip, "api", max_requests=120, window_seconds=60):
                    raise ApiError("Rate limit exceeded. Please wait a moment.", 429)
                return self._api_get(path, query)
            return self._static(path)
        except ApiError as exc:
            return self._json({"error": exc.message}, exc.status)
        except Exception as exc:  # pragma: no cover - defensive
            import traceback
            traceback.print_exc()
            return self._json({"error": f"Server error: {exc}"}, 500)

    def do_POST(self):
        if self.headers.get("X-Forwarded-Proto") == "http":
            host = self.headers.get("Host") or "primesteel.cc.cd"
            self.send_response(301)
            self.send_header("Location", f"https://{host}{self.path}")
            self.send_header("Content-Length", "0")
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
            self.end_headers()
            return

        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path.startswith("/api/"):
                ip = self._client_ip()
                if not _rate_limiter.is_allowed(ip, "api", max_requests=120, window_seconds=60):
                    raise ApiError("Rate limit exceeded. Please wait a moment.", 429)
                return self._api_post(path)
            raise ApiError("Not found", 404)
        except ApiError as exc:
            return self._json({"error": exc.message}, exc.status)
        except ValueError as exc:
            return self._json({"error": str(exc)}, 400)
        except KeyError as exc:
            return self._json({"error": str(exc).strip("'")}, 404)
        except Exception as exc:  # pragma: no cover
            import traceback
            traceback.print_exc()
            return self._json({"error": f"Server error: {exc}"}, 500)

    # ---- static ---------------------------------------------------------
    def _static(self, path: str):
        if path in ("/", "/landing", "/landing.html", "/index.html"):
            rel = "landing.html"
        elif path in ("/order", "/order.html", "/customer", "/customer.html"):
            rel = "customer.html"
        elif path in ("/worker", "/worker.html", "/app"):
            rel = "worker.html"
        elif path in ("/admin", "/admin.html"):
            rel = "admin.html"
        else:
            rel = path.lstrip("/")
        target = (WEB_DIR / rel).resolve()
        if not str(target).startswith(str(WEB_DIR.resolve())) or not target.is_file():
            return self._json({"error": "Not found"}, 404)
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if target.suffix == ".webmanifest":
            ctype = "application/manifest+json"
        elif target.suffix == ".webp":
            ctype = "image/webp"
        elif target.suffix == ".woff2":
            ctype = "font/woff2"
        elif target.suffix == ".xml":
            ctype = "application/xml"
        elif target.suffix == ".txt":
            ctype = "text/plain"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json", "application/xml", "image/svg+xml"):
            ctype += "; charset=utf-8"
        data = target.read_bytes()
        self._bytes(data, ctype)

    # ---- API: GET -------------------------------------------------------
    def _api_get(self, path: str, q: dict):
        def one(key, default=""):
            return (q.get(key) or [default])[0]

        if path == "/api/health":
            return self._json({"ok": True, "time": now_ms()})

        if path == "/api/bootstrap":
            settings = load_settings()
            items = list_items()
            cats = sorted({i["category"] for i in items if i["category"]})
            return self._json({
                # No literal fallback: the owner clears this to enter his own
                # company name, and reviving "Prime Steel" would look like the wipe failed.
                "business": settings.get("business_name") or "",
                "tagline": settings.get("tagline") or "",
                "items": items,
                "categories": cats,
                "stats": stats(),
                "lan": lan_addresses(),
                "port": PORT,
                "tunnel": tunnel.get_tunnel_status(),
                "excel_sync": excel_sync.get_sync_status(),
            })

        if path == "/api/items":
            return self._json({"items": list_items(include_inactive=one("all") == "1")})

        if path == "/api/units":
            return self._json({"units": COMMON_UNITS})

        if path == "/api/customers":
            self._require_worker()
            if one("all") == "1" or one("full") == "1":
                return self._json({"customers": list_customers(one("q"), int(one("limit", "200") or 200))})
            return self._json({"customers": customers_search(one("q"), int(one("limit", "12") or 12))})

        if path == "/api/customer/orders":
            phone = re.sub(r"\D", "", one("phone"))
            if len(phone) < 6:
                return self._json({"orders": []})
            ip = self._client_ip()
            if not _rate_limiter.is_allowed(ip, "customer_orders", max_requests=40, window_seconds=60):
                raise ApiError("Too many requests. Please wait a moment.", 429)
            all_orders = list_orders(status=None, limit=500)
            matching = []
            for o in all_orders:
                c_phone = re.sub(r"\D", "", o.get("customer_phone") or "")
                if phone and (phone in c_phone or c_phone in phone):
                    matching.append({
                        "id": o["id"],
                        "order_no": o["order_no"],
                        "customer_name": o["customer_name"],
                        "customer_phone": o["customer_phone"],
                        "status": o["status"],
                        "pcs": o["pcs"],
                        "est_weight": o["est_weight"],
                        "est_amount": o["est_amount"],
                        "actual_weight": o.get("actual_weight"),
                        "actual_amount": o.get("actual_amount"),
                        "created_at": o["created_at"],
                        "weighed_at": o.get("weighed_at"),
                        "lines_detail": [
                            {
                                "name": l["name"],
                                "category": l.get("category", ""),
                                "pcs": l.get("pcs", 0),
                                "unit": l.get("unit") or l.get("entry_unit") or "pcs",
                                "qty": l.get("qty") or l.get("entry_qty") or l.get("pcs", 0),
                                "est_weight": l.get("est_weight", 0),
                                "actual_weight": l.get("actual_weight", 0),
                                "rate": l.get("rate", 0),
                                "narration": l.get("narration", ""),
                            }
                            for l in o.get("lines_detail", [])
                        ]
                    })
            return self._json({"orders": matching})

        if path == "/api/orders":
            self._require_worker()
            since = 0
            if one("since") == "today":
                since = int(datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
            try:
                limit = max(1, min(2000, int(one("limit", "200") or 200)))
            except ValueError:
                limit = 200
            return self._json({"orders": list_orders(one("status"), one("q"), since, limit)})

        m = re.fullmatch(r"/api/orders/([0-9a-fA-F-]+)", path)
        if m:
            self._require_worker()
            order = get_order(m.group(1))
            if not order:
                raise ApiError("Order not found", 404)
            return self._json(order)

        if path == "/api/stats":
            self._require_admin()
            return self._json(stats())

        if path == "/api/settings":
            self._require_admin()
            s = load_settings()
            return self._json({
                "business_name": s.get("business_name", ""),
                "tagline": s.get("tagline", ""),
                "shared_folder": s.get("shared_folder", ""),
                "has_pin": bool((s.get("admin_pin") or "").strip()),
                "has_worker_pin": bool((s.get("worker_pin") or "").strip()),
                "worker_pin": s.get("worker_pin", "1234"),
                "enable_tunnel": bool(s.get("enable_tunnel", True)),
                "tunnel_token": s.get("tunnel_token", ""),
                "excel_rates_path": s.get("excel_rates_path", str(excel_sync.DEFAULT_EXCEL_PATH)),
                "auto_sync_excel": bool(s.get("auto_sync_excel", True)),
                "tunnel": tunnel.get_tunnel_status(),
                "excel_sync": excel_sync.get_sync_status(),
                "lan": lan_addresses(),
                "port": PORT,
                "exports_folder": str(EXPORT_DIR),
                "data_folder": str(DATA_DIR),
                "openpyxl": _has_openpyxl(),
            })

        if path == "/api/tunnel":
            return self._json(tunnel.get_tunnel_status())

        if path == "/api/items/sync-excel/status":
            return self._json(excel_sync.get_sync_status())

        m = re.fullmatch(r"/api/export/order/([0-9a-fA-F-]+)", path)
        if m:
            self._require_admin()
            order = get_order(m.group(1))
            if not order:
                raise ApiError("Order not found", 404)
            import excel_export
            safe = re.sub(r"[^A-Za-z0-9]+", "_", order["customer_name"] or "Walk_in").strip("_")[:40]
            name = f"{order['order_no']}_{safe or 'Walk_in'}"
            if excel_export.HAS_OPENPYXL:
                data = excel_export.order_workbook(order, load_settings())
                return self._bytes(
                    data,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    f"{name}.xlsx",
                )
            data = excel_export.order_csv(order, load_settings()).encode("utf-8-sig")
            return self._bytes(data, "text/csv; charset=utf-8", f"{name}.csv")

        if path == "/api/export/ready":
            self._require_admin()
            orders = list_orders(one("status") or "WEIGHED")
            full = [get_order(o["id"]) for o in orders]
            full = [o for o in full if o]
            import excel_export
            stamp = datetime.now().strftime("%d-%m-%Y_%H%M")
            if excel_export.HAS_OPENPYXL:
                data = excel_export.master_workbook(full, load_settings())
                return self._bytes(
                    data,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    f"PrimeSteel_Orders_{stamp}.xlsx",
                )
            data = excel_export.master_csv(full).encode("utf-8-sig")
            return self._bytes(data, "text/csv; charset=utf-8", f"PrimeSteel_Orders_{stamp}.csv")

        if path == "/api/backup":
            self._require_admin()
            conn = db()
            try:
                conn.execute("VACUUM INTO ?", (str(DATA_DIR / "_backup_tmp.db"),))
            finally:
                conn.close()
            data = (DATA_DIR / "_backup_tmp.db").read_bytes()
            (DATA_DIR / "_backup_tmp.db").unlink(missing_ok=True)
            stamp = datetime.now().strftime("%Y-%m-%d")
            return self._bytes(data, "application/octet-stream", f"PrimeSteel_backup_{stamp}.db")

        raise ApiError("Not found", 404)

    # ---- API: POST ------------------------------------------------------
    def _api_post(self, path: str):
        if path == "/api/pin/check":
            body = self._body()
            pin = (load_settings().get("admin_pin") or "").strip()
            ok = (not pin) or (str(body.get("pin") or "").strip() == pin)
            return self._json({"ok": ok})

        if path == "/api/pin/worker/check":
            body = self._body()
            s = load_settings()
            wpin = (s.get("worker_pin") or "").strip()
            apin = (s.get("admin_pin") or "").strip()
            pin = str(body.get("pin") or "").strip()
            ok = (not wpin) or (pin == wpin) or (apin and pin == apin)
            return self._json({"ok": ok})

        if path == "/api/orders":
            ip = self._client_ip()
            payload = self._body()

            # Anti-bot check: Honeypot field (hidden from humans, filled by bots)
            hp = str(payload.get("company_website_url") or payload.get("hp") or payload.get("bot_trap") or "").strip()
            if hp:
                raise ApiError("Invalid submission.", 400)

            # Anti-bot check: Sub-second automated submission
            t_load = payload.get("t_load")
            if t_load and isinstance(t_load, (int, float)):
                if (now_ms() - t_load) < 1000:
                    raise ApiError("Automated submission detected.", 400)

            # Anti-flood rate limiting for public customer orders: max 6 orders / 5 min per IP
            is_staff = self._is_worker() or self._is_admin()
            if not is_staff:
                if not _rate_limiter.is_allowed(ip, "order_create", max_requests=6, window_seconds=300):
                    raise ApiError("You are placing orders too quickly. Please wait a few minutes.", 429)

            # Strict validation
            name = str(payload.get("customer_name") or "").strip()
            if len(name) > 80:
                raise ApiError("Customer name too long (max 80 characters).", 400)
            phone = str(payload.get("customer_phone") or "").strip()
            if phone:
                clean_phone = re.sub(r"\D", "", phone)
                if len(clean_phone) not in (10, 11, 12):
                    raise ApiError("Please enter a valid phone number.", 400)
            lines = payload.get("lines") or []
            if not lines:
                raise ApiError("At least one item is required.", 400)
            if len(lines) > 50:
                raise ApiError("Maximum 50 items per order.", 400)

            order = create_order(payload)
            return self._json({"order": order})

        m = re.fullmatch(r"/api/orders/([0-9a-fA-F-]+)/update", path)
        if m:
            self._require_worker()
            body = self._body()
            order = update_order(m.group(1), body)
            return self._json({"order": order})

        m = re.fullmatch(r"/api/orders/([0-9a-fA-F-]+)/lines/add", path)
        if m:
            self._require_worker()
            body = self._body()
            order = add_order_line(m.group(1), body)
            return self._json({"order": order})

        m = re.fullmatch(r"/api/orders/([0-9a-fA-F-]+)/lines/([0-9a-fA-F-]+)/update", path)
        if m:
            self._require_worker()
            body = self._body()
            order = update_order_line(m.group(1), m.group(2), body)
            return self._json({"order": order})

        m = re.fullmatch(r"/api/orders/([0-9a-fA-F-]+)/lines/([0-9a-fA-F-]+)/delete", path)
        if m:
            self._require_worker()
            order = delete_order_line(m.group(1), m.group(2))
            return self._json({"order": order})

        m = re.fullmatch(r"/api/orders/([0-9a-fA-F-]+)/weight", path)
        if m:
            self._require_worker()
            body = self._body()
            weights = body.get("weights") or {}
            order = submit_weights(m.group(1), weights, require_all=True)
            return self._json({"order": order})

        m = re.fullmatch(r"/api/orders/([0-9a-fA-F-]+)/weights", path)
        if m:
            self._require_worker()
            body = self._body()
            weights = body.get("weights") if "weights" in body else body
            order = submit_weights(m.group(1), weights, require_all=False)
            return self._json({"order": order})

        m = re.fullmatch(r"/api/orders/([0-9a-fA-F-]+)/reopen", path)
        if m:
            self._require_admin()
            conn = db()
            try:
                conn.execute(
                    "UPDATE orders SET status='OPEN', weighed_at=NULL, actual_weight=0, actual_amount=0 WHERE id=?",
                    (m.group(1),),
                )
                conn.execute("UPDATE order_lines SET actual_weight=NULL WHERE order_id=?", (m.group(1),))
                conn.commit()
            finally:
                conn.close()
            log_event("order.reopened", m.group(1))
            return self._json({"order": get_order(m.group(1))})

        m = re.fullmatch(r"/api/orders/([0-9a-fA-F-]+)/delete", path)
        if m:
            self._require_admin()
            delete_order(m.group(1))
            return self._json({"ok": True})

        if path == "/api/items":
            self._require_admin()
            return self._json({"item": create_item(self._body())})

        if path == "/api/items/bulk":
            self._require_admin()
            body = self._body()
            rows = body.get("rows") or []
            if not rows:
                raise ApiError("Nothing to update.")
            return self._json(bulk_update_items(rows))

        m = re.fullmatch(r"/api/items/(\d+)/update", path)
        if m:
            self._require_admin()
            return self._json({"item": update_item(int(m.group(1)), self._body())})

        m = re.fullmatch(r"/api/items/(\d+)/delete", path)
        if m:
            self._require_admin()
            body = self._body() if self.headers.get("Content-Length") else {}
            return self._json(delete_item(int(m.group(1)), hard=bool(body.get("hard"))))

        if path == "/api/customers":
            self._require_worker()
            return self._json({"customer": create_customer(self._body())})

        if path == "/api/customers/quickphone":
            self._require_worker()
            return self._json(remember_phone(self._body()))

        if path == "/api/customers/bulk":
            self._require_admin()
            body = self._body()
            rows = body.get("rows") or []
            if not rows:
                raise ApiError("No customers provided to add.")
            return self._json(bulk_update_customers(rows))

        m = re.fullmatch(r"/api/customers/(\d+)/update", path)
        if m:
            self._require_worker()
            return self._json({"customer": update_customer(int(m.group(1)), self._body())})

        m = re.fullmatch(r"/api/customers/(\d+)/delete", path)
        if m:
            self._require_worker()
            return self._json(delete_customer(int(m.group(1))))

        if path == "/api/items/sync-excel":
            self._require_admin()
            s = load_settings()
            p = excel_sync.get_excel_path(s)
            res = excel_sync.perform_sync(p, db, norm_name, now_ms, log_event)
            if not res.get("ok"):
                raise ApiError(res.get("error") or "Excel sync failed", 400)
            return self._json(res)

        if path == "/api/rates/upload":
            self._require_admin()
            body = self._body()
            b64_data = body.get("file_b64") or ""
            if not b64_data:
                raise ApiError("No file data received.", 400)
            import base64
            try:
                if "," in b64_data:
                    b64_data = b64_data.split(",", 1)[1]
                data = base64.b64decode(b64_data)
            except Exception as exc:
                raise ApiError(f"Invalid file encoding: {exc}", 400)
            res = excel_sync.sync_from_bytes(data, db, norm_name, now_ms, log_event)
            if not res.get("ok"):
                raise ApiError(res.get("error") or "Upload sync failed", 400)
            return self._json(res)

        if path == "/api/rates/sync":
            # API endpoint for desktop sync agent or external sync
            body = self._body()
            token = (body.get("sync_token") or body.get("token") or "").strip()
            s = load_settings()
            admin_pin = (s.get("admin_pin") or "Prime2026").strip()
            if not (token and (token == admin_pin or token == s.get("sync_token"))) and not self._is_admin():
                raise ApiError("Unauthorized sync token.", 401)
            rows = body.get("rows") or []
            if not rows:
                raise ApiError("No rate rows provided.", 400)
            res = excel_sync.sync_from_rows(rows, db, norm_name, now_ms, log_event, source="desktop_agent")
            if not res.get("ok"):
                raise ApiError(res.get("error") or "Sync failed", 400)
            return self._json(res)

        if path == "/api/tunnel/restart":
            self._require_admin()
            s = load_settings()
            tunnel.stop_tunnel()
            tunnel.start_tunnel(PORT, token=s.get("tunnel_token"))
            return self._json({"ok": True, "tunnel": tunnel.get_tunnel_status()})

        if path == "/api/settings":
            self._require_admin()
            body = self._body()
            current = load_settings()
            for key in ("business_name", "tagline", "shared_folder", "excel_rates_path", "tunnel_token", "worker_pin"):
                if key in body:
                    current[key] = str(body[key] or "").strip()
            for key in ("enable_tunnel", "auto_sync_excel"):
                if key in body:
                    current[key] = bool(body[key])
            if "admin_pin" in body:
                pin = str(body["admin_pin"] or "").strip()
                if pin and (len(pin) < 4 or len(pin) > 32):
                    raise ApiError("PIN/Password must be between 4 and 32 characters.")
                current["admin_pin"] = pin
            if "worker_pin" in body:
                wpin = str(body["worker_pin"] or "").strip()
                current["worker_pin"] = wpin
            if current.get("shared_folder"):
                try:
                    Path(current["shared_folder"]).mkdir(parents=True, exist_ok=True)
                except Exception as exc:
                    raise ApiError(f"Cannot use that folder: {exc}")
            save_settings(current)
            return self._json({"ok": True})
        raise ApiError("Not found", 404)


def _has_openpyxl() -> bool:
    try:
        import excel_export
        return bool(excel_export.HAS_OPENPYXL)
    except Exception:
        return False


class ThreadedServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc_type, exc_val, _ = sys.exc_info()
        if exc_type in (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            return  # Normal client disconnection on mobile/Wi-Fi
        super().handle_error(request, client_address)


PORT = 8077


def main() -> None:
    global PORT
    port = int(os.environ.get("PORT", PORT))
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == "--port" and i + 1 < len(args):
            port = int(args[i + 1])
        elif a.startswith("--port="):
            port = int(a.split("=", 1)[1])
    PORT = port

    init_db()
    settings = load_settings()
    ips = lan_addresses()

    print()
    print("  " + "=" * 58)
    print(f"   {settings.get('business_name') or 'Order Book'}")
    print("  " + "=" * 58)
    print(f"   On this computer :  http://localhost:{port}/admin")
    for ip in ips:
        print(f"   On phones        :  http://{ip}:{port}")
    for ip in ips:
        print(f"   On your Mac      :  http://{ip}:{port}/admin")
    print("  " + "=" * 58)
    print("   Keep this window open. Press Ctrl+C to stop.")
    print()

    # In cloud environments like Render, file watcher and local tunnel are not needed
    is_cloud = bool(os.environ.get("RENDER") or os.environ.get("DYNO") or os.environ.get("K_SERVICE"))

    # Start 24x7 keep-alive heartbeat to prevent Render free instance from sleeping
    import keepalive
    keepalive.start_keepalive()

    if not is_cloud and settings.get("auto_sync_excel", True):
        excel_sync.start_excel_watcher(
            get_path_fn=lambda: excel_sync.get_excel_path(load_settings()),
            conn_fn=db,
            norm_name_fn=norm_name,
            now_ms_fn=now_ms,
            log_event_fn=log_event,
            poll_interval=5.0,
        )

    if not is_cloud and settings.get("enable_tunnel", True):
        tunnel.start_tunnel(port, token=settings.get("tunnel_token"))

    httpd = ThreadedServer(("0.0.0.0", port), Handler)
    httpd.daemon_threads = True
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")
    finally:
        keepalive.stop_keepalive()
        tunnel.stop_tunnel()
        httpd.server_close()


if __name__ == "__main__":
    main()
