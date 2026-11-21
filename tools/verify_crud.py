"""Browser proof: add item, add customer, delete customer, no console errors."""
import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"

async def main():
    errs, bad = [], []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 412, "height": 900})
        ad = await ctx.new_page()
        ad.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        ad.on("response", lambda r: bad.append(f"{r.status} {r.url.replace(BASE,'')}") if r.status >= 400 else None)
        ad.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

        await ad.goto(BASE + "/admin.html", wait_until="networkidle")
        await ad.wait_for_timeout(900)

        # --- add customer
        await ad.click('.admin-nav button[data-tab="customers"]')
        await ad.wait_for_timeout(700)
        await ad.click('#addCustBtn')
        await ad.wait_for_timeout(600)
        await ad.fill('#acName', 'KA BROWSER CUST')
        await ad.fill('#acPhone', '9876500001')
        await ad.click('#acSave')
        await ad.wait_for_timeout(1200)
        await ad.click('.admin-nav button[data-tab="customers"]')
        await ad.wait_for_timeout(900)
        cnt_before = await ad.inner_text('#customersCount')
        print("customers after add:", cnt_before)

        # --- delete it through the UI (the thing that never worked)
        row = ad.locator('tr', has_text='KA BROWSER CUST').first
        await row.locator('button[data-del-cust]').click()
        await ad.wait_for_timeout(1800)
        cnt_after = await ad.inner_text('#customersCount')
        print("customers after delete:", cnt_after)
        gone = await ad.locator('tr', has_text='KA BROWSER CUST').count()
        print("row still present:", gone)
        print("DELETE VERIFIED" if gone == 0 else "DELETE STILL BROKEN")

        # --- add item
        await ad.click('.admin-nav button[data-tab="items"]')
        await ad.wait_for_timeout(700)
        await ad.click('#addItemBtn')
        await ad.wait_for_timeout(600)
        await ad.fill('#aiName', 'KA BROWSER ITEM')
        await ad.fill('#aiRate', '55')
        await ad.fill('#aiWeight', '12')
        await ad.click('#aiSave')
        await ad.wait_for_timeout(1400)
        await ad.click('.admin-nav button[data-tab="items"]')
        await ad.wait_for_timeout(900)
        print("items:", await ad.inner_text('#itemsCount'))

        # --- worker header reflects configured name (blank right now)
        wk = await ctx.new_page()
        wk.on("console", lambda m: errs.append("worker: " + m.text) if m.type == "error" else None)
        await wk.goto(BASE + "/", wait_until="networkidle")
        await wk.wait_for_timeout(1100)
        print("header name :", repr(await wk.inner_text('#businessName')))
        print("header badge:", repr(await wk.inner_text('.brand-mark')))
        print("tab title   :", repr(await wk.title()))

        await b.close()
    print("\nconsole errors:", errs if errs else "none")
    print("http >=400   :", bad if bad else "none")

asyncio.run(main())