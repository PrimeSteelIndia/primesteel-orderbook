import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"
errors = []

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)

        w = await b.new_page(viewport={"width": 420, "height": 900})
        w.on("console", lambda m: errors.append(f"W[{m.type}] {m.text[:200]}") if m.type == "error" else None)
        w.on("pageerror", lambda e: errors.append(f"WPAGEERROR {str(e)[:200]}"))
        await w.goto(BASE + "/", wait_until="networkidle")
        await w.wait_for_timeout(2000)

        print("WORKER item list:")
        print("  body:", (await w.inner_text("body"))[:500].replace("\n", " | "))

        # click an item card
        cards = await w.evaluate("""
          Array.from(document.querySelectorAll('#view [data-item], #view .item, #view button'))
            .map(e=>({t:(e.innerText||'').slice(0,40), d:Object.keys(e.dataset||{})})).slice(0,10)
        """)
        for c in cards: print("   card:", c)

        await w.evaluate("document.querySelector('#view [data-item]')?.click()")
        await w.wait_for_timeout(900)
        print("  after item click sheet:", await w.evaluate("!!document.querySelector('.sheet')"))
        if await w.query_selector(".sheet"):
            print("  sheet:", (await w.inner_text(".sheet"))[:400].replace("\n"," | "))
            print("  inputs:", await w.evaluate("Array.from(document.querySelectorAll('.sheet input')).map(i=>({id:i.id,ph:i.placeholder,v:i.value}))"))
            print("  buttons:", await w.evaluate("Array.from(document.querySelectorAll('.sheet button')).map(b=>b.innerText.trim()||b.title).filter(Boolean)"))

        # ADMIN: full sub-flows
        print("\nADMIN:")
        a = await b.new_page()
        a.on("console", lambda m: errors.append(f"A[{m.type}] {m.text[:200]}") if m.type == "error" else None)
        a.on("pageerror", lambda e: errors.append(f"APAGEERROR {str(e)[:200]}"))
        await a.goto(BASE + "/admin", wait_until="networkidle")
        await a.wait_for_timeout(1500)

        # settings save
        await a.get_by_text("Settings", exact=False).first.click()
        await a.wait_for_timeout(1600)
        await a.evaluate("Array.from(document.querySelectorAll('button')).filter(b=>b.innerText.trim()==='Save settings').forEach(b=>b.click())")
        await a.wait_for_timeout(2000)
        print("  settings toasts:", await a.evaluate("Array.from(document.querySelectorAll('.toast')).map(t=>t.innerText.trim())"))

        # order drawer
        await a.get_by_text("Orders", exact=False).first.click()
        await a.wait_for_timeout(1600)
        n = await a.evaluate("document.querySelectorAll('table.data tbody tr').length")
        print("  order rows:", n)
        if n:
            await a.evaluate("document.querySelector('table.data tbody tr').click()")
            await a.wait_for_timeout(1400)
            has = await a.evaluate("!!document.querySelector('.drawer, .sheet')")
            print("  drawer open:", has)
            if has:
                print("  drawer btns:", await a.evaluate("Array.from(document.querySelectorAll('.drawer button, .sheet button')).map(b=>b.innerText.trim()||b.title).filter(Boolean)"))
                s = await a.evaluate("(document.querySelector('.drawer,.sheet')||{}).innerText||''")
                print("  drawer text:", s[:300].replace("\n"," | "))
                await a.evaluate("document.querySelector('.drawer [data-x], .sheet [data-close]')?.click()")
                await a.wait_for_timeout(500)

        # delete item
        await a.get_by_text("Rate list", exact=False).first.click()
        await a.wait_for_timeout(1300)
        await a.fill("#itemSearch", "PW Bulk Alpha")
        await a.wait_for_timeout(900)
        cnt = await a.evaluate("document.querySelectorAll('button[data-del-item]').length")
        print("  del btns:", cnt)
        if cnt:
            await a.evaluate("window.confirm = () => true")
            await a.evaluate("document.querySelector('button[data-del-item]').click()")
            await a.wait_for_timeout(2000)
            print("  delete toasts:", await a.evaluate("Array.from(document.querySelectorAll('.toast')).map(t=>t.innerText.trim())"))

        print("\n===== ERRORS =====")
        for e in errors: print(" ", e)
        if not errors: print("  NONE")
        await b.close()

asyncio.run(main())