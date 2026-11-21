"""
Cloudflare Tunnel manager for Prime Steel Order Book.

Runs cloudflared in the background to provide a secure, 24x7 public HTTPS URL
with automatic reconnection and zero router/firewall configuration required.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent
BIN_DIR = BASE / "bin"
CLOUDFLARED_EXE = BIN_DIR / "cloudflared.exe"
TUNNEL_STATE_FILE = BASE / "data" / "tunnel.json"

_tunnel_thread: threading.Thread | None = None
_tunnel_proc: subprocess.Popen | None = None
_stop_event = threading.Event()
_state_lock = threading.Lock()

_state = {
    "active": False,
    "url": "",
    "started_at": 0,
    "reconnects": 0,
    "last_error": "",
    "mode": "quick",  # "quick" or "token"
}


def _save_state():
    try:
        TUNNEL_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        TUNNEL_STATE_FILE.write_text(json.dumps(_state, indent=2), encoding="utf-8")
    except Exception:
        pass


def get_tunnel_status() -> dict:
    with _state_lock:
        return dict(_state)


def stop_tunnel() -> None:
    global _tunnel_proc, _tunnel_thread
    _stop_event.set()
    with _state_lock:
        if _tunnel_proc:
            try:
                _tunnel_proc.terminate()
                _tunnel_proc.wait(timeout=3)
            except Exception:
                try:
                    _tunnel_proc.kill()
                except Exception:
                    pass
            _tunnel_proc = None
        _state["active"] = False
        _state["url"] = ""
        _save_state()
    if _tunnel_thread and _tunnel_thread.is_alive():
        try:
            _tunnel_thread.join(timeout=4)
        except Exception:
            pass
        _tunnel_thread = None
    print("[tunnel] Cloudflare tunnel stopped.")


def start_tunnel(port: int = 8077, token: str | None = None) -> None:
    global _tunnel_thread
    if _tunnel_thread and _tunnel_thread.is_alive():
        return

    if not CLOUDFLARED_EXE.is_file():
        err = f"cloudflared.exe not found at {CLOUDFLARED_EXE}"
        print(f"[tunnel] Error: {err}")
        with _state_lock:
            _state["last_error"] = err
            _save_state()
        return

    _stop_event.clear()

    def _runner():
        global _tunnel_proc
        reconnect_count = 0

        while not _stop_event.is_set():
            cmd = [str(CLOUDFLARED_EXE), "tunnel"]
            mode = "token" if token and token.strip() else "quick"

            if mode == "token":
                cmd.extend(["run", "--token", token.strip()])
            else:
                cmd.extend(["--url", f"http://127.0.0.1:{port}"])

            print(f"[tunnel] Launching Cloudflare Tunnel (mode={mode}, target=http://127.0.0.1:{port})...")
            found_url = ""

            try:
                _tunnel_proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )

                while not _stop_event.is_set():
                    line = _tunnel_proc.stdout.readline() if _tunnel_proc.stdout else ""
                    if not line:
                        break

                    # Mode: token (custom domain)
                    if mode == "token":
                        if "Registered tunnel connection" in line or ("Connection" in line and "registered" in line) or "Connected to" in line:
                            if not found_url:
                                found_url = "https://primesteel.cc.cd"
                                fallback_url = "https://primesteel.tablebook.cc.cd"
                                with _state_lock:
                                    _state["active"] = True
                                    _state["url"] = found_url
                                    _state["urls"] = [found_url, fallback_url]
                                    _state["started_at"] = int(time.time() * 1000)
                                    _state["mode"] = mode
                                    _state["last_error"] = ""
                                    _save_state()
                                print(f"\n" + "=" * 60)
                                print(f"[tunnel] 🌐 ONLINE 24x7 CUSTOM DOMAINS:")
                                print(f"[tunnel]    Primary:  {found_url}")
                                print(f"[tunnel]    Fallback: {fallback_url}")
                                print(f"[tunnel]    Admin:    {found_url}/admin")
                                print(f"[tunnel]    Worker:   {found_url}")
                                print("=" * 60 + "\n")

                    # Mode: quick tunnel
                    elif not found_url:
                        m = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
                        if m:
                            found_url = m.group(0)
                            with _state_lock:
                                _state["active"] = True
                                _state["url"] = found_url
                                _state["started_at"] = int(time.time() * 1000)
                                _state["mode"] = mode
                                _state["last_error"] = ""
                                _save_state()
                            print(f"\n" + "=" * 60)
                            print(f"[tunnel] 🌐 ONLINE 24x7 PUBLIC URL:")
                            print(f"[tunnel]    {found_url}")
                            print(f"[tunnel]    Admin: {found_url}/admin")
                            print(f"[tunnel]    Worker: {found_url}")
                            print("=" * 60 + "\n")

                if _tunnel_proc:
                    _tunnel_proc.wait()

            except Exception as exc:
                print(f"[tunnel] Tunnel exception: {exc}")
                with _state_lock:
                    _state["last_error"] = str(exc)
                    _save_state()

            with _state_lock:
                _state["active"] = False
                _state["url"] = ""
                _save_state()

            if _stop_event.is_set():
                break

            reconnect_count += 1
            with _state_lock:
                _state["reconnects"] = reconnect_count
                _save_state()

            print(f"[tunnel] Tunnel disconnected. Reconnecting in 3 seconds (reconnect #{reconnect_count})...")
            _stop_event.wait(3.0)

    _tunnel_thread = threading.Thread(target=_runner, daemon=True, name="CloudflareTunnelThread")
    _tunnel_thread.start()
