import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"
errors = []

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        a = await b.new_page()
        a.on("console", lambda m: errors.append(f"A[{m.type}] {m.text[:250]}") if m.type == "error" else None)
        a.on("pageerror", lambda e: errors.append(f"APAGEERROR {str(e)[:250]}"))
        await a.goto(BASE + "/admin", wait_until="networkidle")
        await a.wait_for_timeout(1500)
        await a.get_by_text("Rate list", exact=False).first.click()
        await a.wait_for_timeout(1500)

        for term in ["PVC", "PW", "pw bulk alpha", "PW Bulk Alpha", "8X3"]:
            await a.fill("#itemSearch", term)
            await a.wait_for_timeout(700)
            res = await a.evaluate("""(t) => ({
                q: window.A ? A.itemQuery : 'noA',
                rows: document.querySelectorAll('#itemsTable tbody tr').length,
                count: (document.querySelector('#itemsCount')||{}).innerText,
                empty: (document.querySelector('.empty-table')||{}).innerText || null,
                manual: (window.A ? A.items.filter(i=>i.name.toUpperCase().includes(A.itemQuery.toUpperCase())).length : -1)
            })""", term)
            print(f"{term!r:20} -> {res}")

        print("\nERRORS:", errors or "NONE")
        await b.close()

asyncio.run(main())