"""Check the app works with a completely empty database."""
import asyncio, json
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"

async def main():
    errs, bad = [], []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 412, "height": 900})

        # --- worker app
        pg = await ctx.new_page()
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("response", lambda r: bad.append(f"{r.status} {r.url.replace(BASE,'')}") if r.status >= 400 else None)
        await pg.goto(BASE + "/", wait_until="networkidle")
        await pg.wait_for_timeout(1200)
        txt = (await pg.inner_text("body"))[:300].replace("\n", " | ")
        print("worker body:", txt)
        print("worker header:", repr(await pg.evaluate("() => { const h = document.querySelector('.app-head .brand, header'); return h ? h.innerText.trim().slice(0,60) : null; }")))

        # --- admin
        pg2 = await ctx.new_page()
        pg2.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg2.on("response", lambda r: bad.append(f"{r.status} {r.url.replace(BASE,'')}") if r.status >= 400 else None)
        await pg2.goto(BASE + "/admin.html", wait_until="networkidle")
        await pg2.wait_for_timeout(1200)
        for tab in ("items", "customers", "settings"):
            try:
                await pg2.click(f'.admin-nav button[data-tab="{tab}"]')
                await pg2.wait_for_timeout(900)
                body = (await pg2.inner_text("main"))[:140].replace("\n", " | ")
                print(f"admin {tab}: {body}")
            except Exception as e:
                print(f"admin {tab}: CLICK FAILED {e}")

        await b.close()
    print("\nconsole errors:", errs if errs else "none")
    print("http >=400   :", bad if bad else "none")

asyncio.run(main())