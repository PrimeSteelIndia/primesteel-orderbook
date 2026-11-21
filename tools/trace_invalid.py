"""Find which request triggers ERR_INVALID_HTTP_RESPONSE on add-item."""
import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 412, "height": 900})
        ad = await ctx.new_page()

        def on_req_failed(req):
            print(f"  FAILED {req.method} {req.url.replace(BASE,'')} :: {req.failure}")

        ad.on("requestfailed", on_req_failed)

        def on_resp(r):
            if r.status >= 400 or r.status == 0:
                print(f"  RESP {r.status} {r.url.replace(BASE,'')}")

        ad.on("response", on_resp)
        ad.on("console", lambda m: print(f"  CONSOLE[{m.type}] {m.text[:160]}") if m.type == "error" else None)

        await ad.goto(BASE + "/admin.html", wait_until="networkidle")
        await ad.wait_for_timeout(800)
        await ad.click('.admin-nav button[data-tab="items"]')
        await ad.wait_for_timeout(700)
        print("--- adding item ---")
        await ad.click('#addItemBtn')
        await ad.wait_for_timeout(500)
        await ad.fill('#aiName', 'TEST COIL')
        await ad.fill('#aiRate', '64.5')
        await ad.click('#aiSave')
        await ad.wait_for_timeout(1800)
        print("--- done ---")
        await b.close()

asyncio.run(main())