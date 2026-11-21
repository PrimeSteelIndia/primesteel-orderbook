import asyncio, json
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"
errors = []
toasts = []

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        pg = await b.new_page()
        pg.on("console", lambda m: errors.append(f"CONSOLE[{m.type}] {m.text}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(f"PAGEERROR {e}"))

        await pg.goto(BASE + "/admin", wait_until="networkidle")
        await pg.wait_for_timeout(1200)
        await pg.get_by_text("Rate list", exact=False).first.click()
        await pg.wait_for_timeout(1200)

        # ---------- ADD ----------
        await pg.get_by_role("button", name="Add item").click()
        await pg.wait_for_timeout(600)
        await pg.fill("#aiName", "PW Add Test")
        await pg.fill("#aiCat", "SS")
        await pg.fill("#aiRate", "77")
        await pg.fill("#aiAltUnit", "feet")
        await pg.fill("#aiAltFactor", "1.9")
        await pg.fill("#aiAltUnit2", "pcs")
        await pg.fill("#aiAltUnit2Factor", "100")
        await pg.fill("#aiLength", "52.63")
        await pg.fill("#aiWeight", "100")
        await pg.click("#aiSave")
        await pg.wait_for_timeout(1800)
        t = await pg.evaluate("Array.from(document.querySelectorAll('.toast')).map(t=>t.innerText.trim())")
        sheet_open = await pg.evaluate("!!document.querySelector('.sheet')")
        print(f"ADD -> sheet_open={sheet_open} toasts={t}")

        # verify it's in the table
        body = await pg.inner_text("#itemsTable")
        print("ADD visible in table:", "PW Add Test" in body)

        # ---------- EDIT ----------
        row_btn = pg.locator('button[data-edit-item]').first
        await row_btn.click()
        await pg.wait_for_timeout(700)
        print("EDIT sheet open:", await pg.evaluate("!!document.querySelector('.sheet')"))
        # find the item we added and edit it instead
        await pg.evaluate("document.querySelector('.sheet [data-x]')?.click()")
        await pg.wait_for_timeout(400)

        # edit our specific item via API-checked name -> use search box
        await pg.fill("#itemSearch", "PW Add Test")
        await pg.wait_for_timeout(700)
        await pg.locator('button[data-edit-item]').first.click()
        await pg.wait_for_timeout(700)
        print("EDIT2 sheet:", await pg.evaluate("!!document.querySelector('.sheet')"))
        await pg.fill("#eiRate", "99")
        await pg.fill("#eiWeight", "55")
        await pg.click("#eiSave")
        await pg.wait_for_timeout(1800)
        t2 = await pg.evaluate("Array.from(document.querySelectorAll('.toast')).map(t=>t.innerText.trim())")
        sheet2 = await pg.evaluate("!!document.querySelector('.sheet')")
        print(f"EDIT -> sheet_open={sheet2} toasts={t2}")

        # ---------- CSRF / pin gate ----------
        print("\nERRORS:", errors if errors else "NONE")
        await b.close()

asyncio.run(main())