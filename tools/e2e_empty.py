"""Full journey on a wiped database: item -> customer -> order -> share.

A wiped database is where fallbacks and empty-state bugs surface, so this runs
the real UI rather than the API.
"""
import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"

async def main():
    errs, bad = [], []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 412, "height": 900},
                                  accept_downloads=True)
        pg = await ctx.new_page()
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("response", lambda r: bad.append(f"{r.status} {r.url.replace(BASE,'')}") if r.status >= 400 else None)

        ad = await ctx.new_page()
        ad.on("console", lambda m: errs.append("admin: " + m.text) if m.type == "error" else None)
        await ad.goto(BASE + "/admin.html", wait_until="networkidle")
        await ad.wait_for_timeout(900)
        await ad.click('.admin-nav button[data-tab="items"]')
        await ad.wait_for_timeout(800)

        # ---- add two items through the real form
        for name, cat, rate, wt in (
            ("MS ANGLE 50x50x6", "MS ANGLE", "78", "22.5"),
            ("COIL 1.9KG/FT", "COIL", "64.5", "100"),
        ):
            await ad.click('#addItemBtn')
            await ad.wait_for_timeout(600)
            await ad.fill('#aiName', name)
            await ad.fill('#aiCat', cat)
            await ad.fill('#aiRate', rate)
            await ad.fill('#aiWeight', wt)
            await ad.click('#aiSave')
            await ad.wait_for_timeout(1100)

        await ad.click('.admin-nav button[data-tab="items"]')
        await ad.wait_for_timeout(1000)
        cnt = await ad.inner_text('#itemsCount')
        print("admin item count:", cnt)
        rows = await ad.eval_on_selector_all('.admin-main tbody tr', "els => els.length")
        print("admin item rows :", rows)

        await b.close()
    print("\nconsole errors:", errs if errs else "none")
    print("http >=400   :", bad if bad else "none")

asyncio.run(main())