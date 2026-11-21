import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"
errors = []

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)

        # ================= WORKER: create order =================
        w = await b.new_page(viewport={"width": 420, "height": 900})
        w.on("console", lambda m: errors.append(f"W[{m.type}] {m.text[:200]}") if m.type == "error" else None)
        w.on("pageerror", lambda e: errors.append(f"WPAGEERROR {str(e)[:200]}"))
        await w.goto(BASE + "/", wait_until="networkidle")
        await w.wait_for_timeout(1800)

        print("WORKER new-order flow:")
        await w.get_by_text("New order", exact=False).first.click()
        await w.wait_for_timeout(800)
        print("  sheet:", await w.evaluate("!!document.querySelector('.sheet')"))
        # pick first item
        items = await w.evaluate("Array.from(document.querySelectorAll('.sheet [data-item], .sheet .item-row, .sheet .pick')).length")
        print("  item rows:", items)
        # try clicking a customer field
        fields = await w.evaluate("Array.from(document.querySelectorAll('.sheet input')).map(i=>({id:i.id,ph:i.placeholder}))")
        print("  inputs:", fields)
        print("  sheet text:", (await w.inner_text(".sheet"))[:300].replace("\n", " | "))

        await w.evaluate("document.querySelector('.sheet [data-close]')?.click()")
        await w.wait_for_timeout(400)

        # ================= ADMIN: settings save =================
        print("\nADMIN settings:")
        a = await b.new_page()
        a.on("console", lambda m: errors.append(f"A[{m.type}] {m.text[:200]}") if m.type == "error" else None)
        a.on("pageerror", lambda e: errors.append(f"APAGEERROR {str(e)[:200]}"))
        await a.goto(BASE + "/admin", wait_until="networkidle")
        await a.wait_for_timeout(1200)
        await a.get_by_text("Settings", exact=False).first.click()
        await a.wait_for_timeout(1500)
        await a.evaluate("Array.from(document.querySelectorAll('button')).filter(b=>b.innerText.trim()==='Save settings').forEach(b=>b.click())")
        await a.wait_for_timeout(1800)
        print("  toasts:", await a.evaluate("Array.from(document.querySelectorAll('.toast')).map(t=>t.innerText.trim())"))
        print("  sheet:", await a.evaluate("!!document.querySelector('.sheet')"))

        # ================= ADMIN: open order drawer + weigh =================
        print("\nADMIN order drawer:")
        await a.get_by_text("Orders", exact=False).first.click()
        await a.wait_for_timeout(1500)
        rows = await a.evaluate("document.querySelectorAll('table.data tbody tr').length")
        print("  rows:", rows)
        if rows:
            await a.evaluate("document.querySelector('table.data tbody tr').click()")
            await a.wait_for_timeout(1200)
            print("  drawer:", await a.evaluate("!!document.querySelector('.drawer, .sheet')"))
            print("  drawer btns:", await a.evaluate("Array.from(document.querySelectorAll('.drawer button, .sheet button')).map(b=>b.innerText.trim()||b.title).filter(Boolean)"))
            await a.evaluate("document.querySelector('.drawer [data-x], .sheet [data-close]')?.click()")
            await a.wait_for_timeout(400)

        # ================= ADMIN: delete item =================
        print("\nADMIN delete item:")
        await a.get_by_text("Rate list", exact=False).first.click()
        await a.wait_for_timeout(1200)
        await a.fill("#itemSearch", "PW Add Test")
        await a.wait_for_timeout(800)
        c = await a.evaluate("document.querySelectorAll('button[data-del-item]').length")
        print("  del buttons:", c)
        if c:
            a.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
            await a.evaluate("document.querySelector('button[data-del-item]').click()")
            await a.wait_for_timeout(1800)
            print("  toasts:", await a.evaluate("Array.from(document.querySelectorAll('.toast')).map(t=>t.innerText.trim())"))

        print("\n===== ERRORS =====")
        for e in errors: print(" ", e)
        if not errors: print("  NONE")
        await b.close()

asyncio.run(main())