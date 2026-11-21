import asyncio, json, sys
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"

async def main():
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        pg = await b.new_page()
        pg.on("console", lambda m: errors.append(f"CONSOLE[{m.type}] {m.text}") if m.type in ("error","warning") else None)
        pg.on("pageerror", lambda e: errors.append(f"PAGEERROR {e}"))

        await pg.goto(BASE + "/admin", wait_until="networkidle")
        await pg.wait_for_timeout(1500)
        print("TITLE:", await pg.title())
        print("BODY:", (await pg.inner_text("body"))[:300].replace("\n"," | "))

        # click Rate list tab
        for label in ["Rate list", "Rates", "Items"]:
            loc = pg.get_by_text(label, exact=False).first
            try:
                if await loc.count() > 0:
                    await loc.click(timeout=2500)
                    print("clicked tab:", label)
                    break
            except Exception as e:
                pass
        await pg.wait_for_timeout(1500)
        print("AFTER TAB BODY:", (await pg.inner_text("body"))[:400].replace("\n"," | "))

        # click Add item
        try:
            await pg.get_by_role("button", name="Add item").click(timeout=4000)
            print("clicked Add item")
        except Exception as e:
            print("ADD CLICK FAIL:", e)
        await pg.wait_for_timeout(800)
        print("SHEET?", await pg.evaluate("!!document.querySelector('.sheet')"))
        print("SHEET BODY:", (await pg.inner_text(".sheet"))[:400].replace("\n"," | ") if await pg.query_selector(".sheet") else "none")

        # fill and save
        try:
            await pg.fill("#aiName", "PW Test Item")
            await pg.fill("#aiRate", "77")
            await pg.fill("#aiAltUnit", "feet")
            await pg.fill("#aiAltFactor", "1.9")
            print("filled")
            await pg.click("#aiSave")
            print("clicked save")
        except Exception as e:
            print("FILL/SAVE FAIL:", e)
        await pg.wait_for_timeout(2000)
        print("SHEET AFTER SAVE:", await pg.evaluate("!!document.querySelector('.sheet')"))
        print("TOASTS:", await pg.evaluate("Array.from(document.querySelectorAll('.toast')).map(t=>t.innerText)"))

        print("\n===== ERRORS =====")
        for e in errors: print(e)
        await b.close()

asyncio.run(main())