"""
Prime Steel Desktop Excel Rate Sync Agent
Watches C:\\Users\\Prime Steel\\Desktop\\COMPANY STUDY_backup.xlsm (Sheet 'Setting', cols H-J)
and automatically pushes rate changes to the cloud server (https://primesteel.cc.cd/api/rates/sync).
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import excel_sync

EXCEL_PATH = Path(r"C:\Users\Prime Steel\Desktop\COMPANY STUDY_backup.xlsm")
CLOUD_URL = os.environ.get("PRIMESTEEL_URL", "https://primesteel.cc.cd")
SYNC_TOKEN = os.environ.get("PRIMESTEEL_SYNC_TOKEN", "Prime2026")


def push_rates(rows: list[dict]) -> bool:
    url = f"{CLOUD_URL.rstrip('/')}/api/rates/sync"
    payload = json.dumps({
        "sync_token": SYNC_TOKEN,
        "rows": rows,
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "PrimeSteelSyncAgent/1.0",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            data = json.loads(res.read().decode())
            if data.get("ok"):
                print(f"[agent] Synced {len(rows)} rates to cloud: {data.get('updated')} updated, {data.get('created')} created.")
                return True
            else:
                print(f"[agent] Cloud sync error: {data.get('error')}")
                return False
    except urllib.error.HTTPError as e:
        print(f"[agent] Cloud sync HTTP error {e.code}: {e.read().decode()[:200]}")
        return False
    except Exception as e:
        print(f"[agent] Cloud sync failed: {e}")
        return False


def run_once():
    if not EXCEL_PATH.exists():
        print(f"[agent] Excel file not found: {EXCEL_PATH}")
        return False
    rows, err = excel_sync.read_rates_from_excel(EXCEL_PATH)
    if err:
        print(f"[agent] Parse error: {err}")
        return False
    return push_rates(rows)


def watch():
    print(f"[agent] Watching {EXCEL_PATH} -> {CLOUD_URL}...")
    last_mtime = 0
    while True:
        try:
            if EXCEL_PATH.exists():
                mtime = EXCEL_PATH.stat().st_mtime
                if mtime != last_mtime:
                    # File changed, wait 1s for Excel write to complete
                    time.sleep(1.0)
                    rows, err = excel_sync.read_rates_from_excel(EXCEL_PATH)
                    if not err and rows:
                        success = push_rates(rows)
                        if success:
                            last_mtime = mtime
                    elif err:
                        print(f"[agent] {err}")
        except Exception as e:
            print(f"[agent] Loop error: {e}")
        time.sleep(4.0)


if __name__ == "__main__":
    if "--once" in sys.argv:
        run_once()
    else:
        watch()
