"""
Excel rates synchronization for Prime Steel Order Book.

Synchronizes item rates and weight per piece from:
"C:\\Users\\Prime Steel\\Desktop\\COMPANY STUDY_backup.xlsm" (Sheet: "Setting", Cols H to J)

Reads file safely via memory buffer to prevent conflict with open Excel sessions.
Provides both manual sync and background file-watcher auto-sync.
"""

from __future__ import annotations

import io
import json
import os
import sqlite3
import threading
import time
import warnings
from pathlib import Path
from typing import Callable

warnings.filterwarnings("ignore", category=UserWarning, module="openpyxl")
import openpyxl

DEFAULT_EXCEL_PATH = Path(r"C:\Users\Prime Steel\Desktop\COMPANY STUDY_backup.xlsm")

_watcher_thread: threading.Thread | None = None
_watcher_stop = threading.Event()
_sync_lock = threading.Lock()
_last_sync_info = {
    "last_sync_time": 0,
    "last_mtime": 0,
    "last_result": None,
    "last_error": "",
    "path": str(DEFAULT_EXCEL_PATH),
}


def get_excel_path(settings: dict | None = None) -> Path:
    if settings and settings.get("excel_rates_path"):
        p = Path(settings["excel_rates_path"].strip())
        if p.exists():
            return p
    return DEFAULT_EXCEL_PATH


def read_rates_from_bytes(data: bytes) -> tuple[list[dict], str | None]:
    """Read rates and w/pcs from the 'Setting' sheet in memory.

    Returns (rows, error_message).
    """
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    except Exception as exc:
        return [], f"Failed to parse Excel workbook: {exc}"

    # Find setting sheet (case-insensitive)
    sheet_name = None
    for name in wb.sheetnames:
        if name.strip().lower() == "setting":
            sheet_name = name
            break

    if not sheet_name:
        return [], f"Sheet 'Setting' not found in workbook. Found: {wb.sheetnames}"

    ws = wb[sheet_name]
    rows: list[dict] = []

    # Read from row 2 downward. Col H=8 (Item), Col I=9 (Rate), Col J=10 (W/PCS)
    max_row = max(ws.max_row or 0, 200)
    for r in range(2, max_row + 1):
        item_val = ws.cell(row=r, column=8).value
        rate_val = ws.cell(row=r, column=9).value
        wpcs_val = ws.cell(row=r, column=10).value

        if item_val is None:
            continue
        item_name = str(item_val).strip()
        if not item_name:
            continue

        row_data: dict = {
            "name": item_name,
            "row": r,
        }

        # Rate (Col I)
        if rate_val is not None and str(rate_val).strip() != "":
            try:
                row_data["rate"] = round(float(rate_val), 2)
            except (ValueError, TypeError):
                pass

        # Weight per pc (Col J)
        if wpcs_val is not None and str(wpcs_val).strip() != "":
            try:
                row_data["weight"] = round(float(wpcs_val), 3)
            except (ValueError, TypeError):
                pass

        if "rate" in row_data or "weight" in row_data:
            rows.append(row_data)

    return rows, None


def read_rates_from_excel(file_path: Path | str) -> tuple[list[dict], str | None]:
    """Read rates and w/pcs from the 'Setting' sheet safely without holding locks.

    Returns (rows, error_message).
    """
    path = Path(file_path)
    if not path.is_file():
        return [], f"Excel file not found at: {path}"

    try:
        # Read into memory buffer first so open Excel won't block reading
        with open(path, "rb") as f:
            data = f.read()
    except Exception as exc:
        return [], f"Could not read Excel file (is it exclusively locked?): {exc}"

    return read_rates_from_bytes(data)


def apply_rates_to_db(
    rows: list[dict],
    conn: sqlite3.Connection,
    norm_name_fn: Callable[[str], str],
    now_ms_fn: Callable[[], int],
) -> dict:
    """Update items table with rates and weight per pc from parsed Excel rows."""
    updated = 0
    created = 0
    unchanged = 0
    actions = []

    with _sync_lock:
        now = now_ms_fn()
        for r in rows:
            name = r["name"]
            norm = norm_name_fn(name)
            rate = r.get("rate")
            wp = r.get("weight")

            existing = conn.execute("SELECT * FROM items WHERE norm=?", (norm,)).fetchone()
            if existing:
                changes = {}
                if rate is not None and abs(float(existing["rate"] or 0) - float(rate)) > 0.001:
                    changes["rate"] = rate
                if wp is not None and abs(float(existing["weight_per_pc"] or 0) - float(wp)) > 0.001:
                    changes["weight_per_pc"] = wp

                if changes:
                    sets = ", ".join(f"{k}=?" for k in changes)
                    conn.execute(
                        f"UPDATE items SET {sets}, updated_at=? WHERE id=?",
                        list(changes.values()) + [now, existing["id"]],
                    )
                    updated += 1
                    actions.append({"name": name, "action": "updated", "changes": changes})
                else:
                    unchanged += 1
            else:
                # Create missing item if not found
                cat = "MISC"
                upper = name.upper()
                if "COIL" in upper:
                    cat = "COIL"
                elif "202" in upper:
                    cat = "202"
                elif "304" in upper:
                    cat = "304"
                elif "CRC" in upper:
                    cat = "CRC"
                elif "HR" in upper:
                    cat = "HR"
                elif "GI" in upper:
                    cat = "GI"
                elif "ANGLE" in upper:
                    cat = "ANGLE"

                conn.execute(
                    """INSERT INTO items (name, norm, category, rate, weight_per_pc,
                           main_unit, alt_unit, alt_factor, active, sort, updated_at)
                       VALUES (?,?,?,?,?,?,?,?,1,0,?)""",
                    (
                        name,
                        norm,
                        cat,
                        rate or 0.0,
                        wp or 0.0,
                        "kg",
                        "pcs",
                        wp or 1.0,
                        now,
                    ),
                )
                created += 1
                actions.append({"name": name, "action": "created", "rate": rate, "weight": wp})

        conn.commit()

    return {
        "ok": True,
        "total_parsed": len(rows),
        "updated": updated,
        "created": created,
        "unchanged": unchanged,
        "actions": actions,
        "time": now,
    }


def perform_sync(
    file_path: Path | str,
    conn_fn: Callable[[], sqlite3.Connection],
    norm_name_fn: Callable[[str], str],
    now_ms_fn: Callable[[], int],
    log_event_fn: Callable[[str, str], None] | None = None,
) -> dict:
    """High-level sync runner."""
    path = Path(file_path)
    rows, err = read_rates_from_excel(path)
    if err:
        _last_sync_info["last_error"] = err
        return {"ok": False, "error": err, "path": str(path)}

    conn = conn_fn()
    try:
        result = apply_rates_to_db(rows, conn, norm_name_fn, now_ms_fn)
    finally:
        conn.close()

    try:
        mtime = path.stat().st_mtime
    except Exception:
        mtime = 0

    _last_sync_info["last_sync_time"] = result["time"]
    _last_sync_info["last_mtime"] = mtime
    _last_sync_info["last_result"] = {
        "updated": result["updated"],
        "created": result["created"],
        "unchanged": result["unchanged"],
        "total": result["total_parsed"],
    }
    _last_sync_info["last_error"] = ""
    _last_sync_info["path"] = str(path)

    if log_event_fn:
        try:
            log_event_fn(
                "rates.excel_sync",
                json.dumps({
                    "updated": result["updated"],
                    "created": result["created"],
                    "unchanged": result["unchanged"],
                    "path": str(path),
                }),
            )
        except Exception:
            pass

    return result


def sync_from_bytes(
    data: bytes,
    conn_fn: Callable[[], sqlite3.Connection],
    norm_name_fn: Callable[[str], str],
    now_ms_fn: Callable[[], int],
    log_event_fn: Callable[[str, str], None] | None = None,
) -> dict:
    """Sync rates from uploaded Excel workbook bytes."""
    rows, err = read_rates_from_bytes(data)
    if err:
        return {"ok": False, "error": err}
    return sync_from_rows(rows, conn_fn, norm_name_fn, now_ms_fn, log_event_fn, source="uploaded_file")


def sync_from_rows(
    rows: list[dict],
    conn_fn: Callable[[], sqlite3.Connection],
    norm_name_fn: Callable[[str], str],
    now_ms_fn: Callable[[], int],
    log_event_fn: Callable[[str, str], None] | None = None,
    source: str = "api_sync",
) -> dict:
    """Apply an explicit list of parsed rate rows to the database."""
    if not rows:
        return {"ok": False, "error": "No rate rows provided."}

    conn = conn_fn()
    try:
        result = apply_rates_to_db(rows, conn, norm_name_fn, now_ms_fn)
    finally:
        conn.close()

    _last_sync_info["last_sync_time"] = result["time"]
    _last_sync_info["last_result"] = {
        "updated": result["updated"],
        "created": result["created"],
        "unchanged": result["unchanged"],
        "total": result["total_parsed"],
    }
    _last_sync_info["last_error"] = ""

    if log_event_fn:
        try:
            log_event_fn(
                f"rates.{source}",
                json.dumps({
                    "updated": result["updated"],
                    "created": result["created"],
                    "unchanged": result["unchanged"],
                    "total": result["total_parsed"],
                }),
            )
        except Exception:
            pass

    return result


def start_excel_watcher(
    get_path_fn: Callable[[], Path],
    conn_fn: Callable[[], sqlite3.Connection],
    norm_name_fn: Callable[[str], str],
    now_ms_fn: Callable[[], int],
    log_event_fn: Callable[[str, str], None] | None = None,
    poll_interval: float = 5.0,
) -> None:
    """Start background watcher thread for Excel changes."""
    global _watcher_thread
    if _watcher_thread and _watcher_thread.is_alive():
        return

    _watcher_stop.clear()

    def _watch_loop():
        last_mtime = 0.0
        while not _watcher_stop.is_set():
            try:
                path = get_path_fn()
                if path and path.is_file():
                    mtime = path.stat().st_mtime
                    if last_mtime == 0.0:
                        # First run: initialize mtime and do initial sync if needed
                        last_mtime = mtime
                    elif mtime > last_mtime:
                        # File was modified! Wait 1.5s to ensure Excel is done writing
                        time.sleep(1.5)
                        try:
                            # Re-check mtime after delay
                            last_mtime = path.stat().st_mtime
                            res = perform_sync(path, conn_fn, norm_name_fn, now_ms_fn, log_event_fn)
                            if res.get("ok"):
                                print(f"[excel_sync] Auto-updated rates: {res.get('updated')} updated, {res.get('created')} created from {path.name}")
                            else:
                                print(f"[excel_sync] Auto-sync notice: {res.get('error')}")
                        except Exception as e:
                            print(f"[excel_sync] Auto-sync failed: {e}")
            except Exception as exc:
                # Don't let watcher crash on transient OS file lock errors
                pass

            _watcher_stop.wait(poll_interval)

    _watcher_thread = threading.Thread(target=_watch_loop, daemon=True, name="ExcelRatesWatcher")
    _watcher_thread.start()
    print("[excel_sync] Background Excel rates watcher started.")


def get_sync_status() -> dict:
    """Return status of last sync for admin UI."""
    return dict(_last_sync_info)
