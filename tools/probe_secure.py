"""Prove whether the phone can attach a file to WhatsApp.

navigator.share/canShare only exist in a secure context. On http://<lan-ip>
they are undefined, which is why the share button silently downloads instead
of opening WhatsApp with the file attached.
"""
import asyncio, json, sqlite3
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"

PROBE = """() => ({
  isSecureContext: window.isSecureContext,
  hasShare: typeof navigator.share,
  hasCanShare: typeof navigator.canShare,
  protocol: location.protocol,
  host: location.host,
})"""

async def main():
    ip = None
    con = sqlite3.connect("data/prime.db")
    con.close()

    # find LAN ip from the server's own bootstrap
    import urllib.request
    boot = json.load(urllib.request.urlopen(BASE + "/api/bootstrap"))
    ip = (boot.get("lan") or [None])[0]
    print("LAN address the phone would use:", ip)

    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await (await b.new_context()).new_page()

        for label, url in [
            ("localhost", BASE),
            ("LAN ip", f"http://{ip}:8077" if ip else None),
        ]:
            if not url:
                continue
            try:
                await pg.goto(url, wait_until="domcontentloaded", timeout=8000)
                r = await pg.evaluate(PROBE)
                print(f"  {label:<10} {r['protocol']:<6} secure={r['isSecureContext']!s:<5} "
                      f"navigator.share={r['hasShare']:<10} canShare={r['hasCanShare']}")
            except Exception as e:
                print(f"  {label:<10} ERROR {e}")

        await b.close()

asyncio.run(main())