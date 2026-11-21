"""
Keep-alive pinger for Render Web Service.

Prevents Render's free tier from spinning down after 15 minutes of inactivity.
Sends an external HTTP GET request to the public URL every 8 minutes.
Works both:
1. Inside Render (pings its own public URL through the edge router to reset the idle countdown).
2. On the local Windows machine (pings the cloud instance 24/7 from the outside).
"""

from __future__ import annotations

import os
import threading
import time
import urllib.request

DEFAULT_RENDER_URL = "https://primesteel-orderbook.onrender.com"
PING_INTERVAL_SECONDS = 8 * 60  # 8 minutes (well under Render's 15-minute inactivity limit)

_thread: threading.Thread | None = None
_stop_event = threading.Event()


def get_target_url() -> str:
    url = os.environ.get("RENDER_EXTERNAL_URL") or os.environ.get("APP_URL") or DEFAULT_RENDER_URL
    url = url.strip().rstrip("/")
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url
    return f"{url}/api/health"


def _pinger_loop(target_url: str):
    # Wait 20 seconds after server boot before first ping
    time.sleep(20)
    while not _stop_event.is_set():
        try:
            req = urllib.request.Request(
                target_url,
                headers={"User-Agent": "PrimeSteel-KeepAlive/1.0"}
            )
            with urllib.request.urlopen(req, timeout=25) as resp:
                code = resp.status
                print(f"[KeepAlive] Heartbeat to {target_url} -> status {code}")
        except Exception as exc:
            print(f"[KeepAlive] Heartbeat to {target_url} notice: {exc}")

        # Sleep for PING_INTERVAL_SECONDS or until stopped
        _stop_event.wait(PING_INTERVAL_SECONDS)


def start_keepalive(target_url: str | None = None) -> None:
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop_event.clear()
    url = target_url or get_target_url()
    _thread = threading.Thread(target=_pinger_loop, args=(url,), daemon=True, name="RenderKeepAlive")
    _thread.start()
    print(f"[KeepAlive] 24x7 keep-alive worker active for {url} (every 8 min)")


def stop_keepalive() -> None:
    _stop_event.set()
