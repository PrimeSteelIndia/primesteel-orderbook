import asyncio, json
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"
errors = []

async def probe(pg, label, fn):
    try:
        r = await fn(pg)
        print(f"  [{label}] {r}")
    except Exception as e:
        print(f"  [{label}] FAIL: {type(e).__name__}: {str(e)[:150]}")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        pg = await b.new_page()
        pg.on("console", lambda m: errors.append(f"C[{m.type}] {m.text[:200]}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(f"PAGEERROR {str(e)[:200]}"))

        await pg.goto(BASE + "/admin", wait_until="networkidle")
        await pg.wait_for_timeout(1200)

        # ---------- CUSTOMERS ----------
        print("CUSTOMERS:")
        await pg.get_by_text("Customers", exact=False).first.click()
        await pg.wait_for_timeout(1200)
        async def add_cust(pg):
            await pg.get_by_role("button", name="Add customer").click(timeout=5000)
            await pg.wait_for_timeout(600)
            ids = await pg.evaluate("Array.from(document.querySelectorAll('.sheet input')).map(i=>i.id)")
            await pg.fill("#cuName" if "#cuName" in ids or await pg.query_selector("#cuName") else ids and "#"+ids[0], "PW Cust Test")
            await pg.wait_for_timeout(200)
            btn = await pg.evaluate("Array.from(document.querySelectorAll('.sheet .btn-primary')).map(b=>b.id)")
            await pg.click("#" + btn[0] if btn else ".sheet .btn-primary")
            await pg.wait_for_timeout(1800)
            return {"inputs": ids, "btn": btn,
                    "toasts": await pg.evaluate("Array.from(document.querySelectorAll('.toast')).map(t=>t.innerText.trim())"),
                    "sheet": await pg.evaluate("!!document.querySelector('.sheet')")}
        await probe(pg, "add customer", add_cust)

        # ---------- SETTINGS ----------
        print("SETTINGS:")
        await pg.evaluate("document.querySelector('.sheet [data-x]')?.click()")
        await pg.wait_for_timeout(400)
        await pg.get_by_text("Settings", exact=False).first.click()
        await pg.wait_for_timeout(1500)
        async def save_settings(pg):
            btns = await pg.evaluate("Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).slice(0,25)")
            return {"buttons": btns}
        await probe(pg, "settings page", save_settings)

        # ---------- ORDERS ----------
        print("ORDERS:")
        await pg.get_by_text("Orders", exact=False).first.click()
        await pg.wait_for_timeout(1500)
        async def orders(pg):
            return {"rows": await pg.evaluate("document.querySelectorAll('table.data tbody tr').length"),
                    "kpi": (await pg.inner_text("body"))[:120].replace("\n"," | ")}
        await probe(pg, "orders page", orders)

        # ---------- BULK UPDATE ----------
        print("BULK:")
        await pg.get_by_text("Rate list", exact=False).first.click()
        await pg.wait_for_timeout(1200)
        async def bulk(pg):
            await pg.get_by_role("button", name="Bulk update").click(timeout=5000)
            await pg.wait_for_timeout(600)
            ta = await pg.evaluate("!!document.querySelector('#bulkText')")
            await pg.fill("#bulkText", "PW Bulk Alpha\t120\t10\nPW Bulk Beta\t130\t11")
            await pg.wait_for_timeout(500)
            prev = await pg.evaluate("(document.querySelector('#bulkPreview')||{}).innerText||''")
            btns = await pg.evaluate("Array.from(document.querySelectorAll('.sheet .btn-primary')).map(b=>b.innerText.trim())")
            await pg.evaluate("Array.from(document.querySelectorAll('.sheet .btn-primary')).forEach(b=>b.click())")
            await pg.wait_for_timeout(2500)
            return {"ta": ta, "preview": prev[:120], "btns": btns,
                    "toasts": await pg.evaluate("Array.from(document.querySelectorAll('.toast')).map(t=>t.innerText.trim())")}
        await probe(pg, "bulk update", bulk)

        # ---------- CSV ----------
        print("CSV / EXPORT:")
        await pg.evaluate("document.querySelector('.sheet [data-x]')?.click()")
        await pg.wait_for_timeout(400)
        async def csv(pg):
            async with pg.expect_download(timeout=8000) as dl:
                await pg.get_by_role("button", name="CSV").click()
            d = await dl.value
            return {"file": d.suggested_filename}
        await probe(pg, "csv download", csv)

        # ---------- WORKER APP ----------
        print("WORKER:")
        w = await b.new_page()
        w.on("console", lambda m: errors.append(f"W[{m.type}] {m.text[:200]}") if m.type == "error" else None)
        w.on("pageerror", lambda e: errors.append(f"WPAGEERROR {str(e)[:200]}"))
        await w.goto(BASE + "/", wait_until="networkidle")
        await w.wait_for_timeout(2000)
        print("  title:", await w.title())
        print("  body:", (await w.inner_text("body"))[:250].replace("\n"," | "))

        print("\n===== ERRORS =====")
        for e in errors: print(" ", e)
        if not errors: print("  NONE")
        await b.close()

asyncio.run(main())