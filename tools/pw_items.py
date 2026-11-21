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

        print("total rows:", await a.evaluate("document.querySelectorAll('#itemsTable tbody tr').length"))
        print("del btns (all):", await a.evaluate("document.querySelectorAll('button[data-del-item]').length"))
        print("edit btns (all):", await a.evaluate("document.querySelectorAll('button[data-edit-item]').length"))
        print("toggle btns (all):", await a.evaluate("document.querySelectorAll('button[data-toggle]').length"))
        print("row html sample:", (await a.evaluate("(document.querySelector('#itemsTable tbody tr')||{}).outerHTML||''"))[:600])

        await a.fill("#itemSearch", "PW Bulk Alpha")
        await a.wait_for_timeout(1000)
        print("\nafter search rows:", await a.evaluate("document.querySelectorAll('#itemsTable tbody tr').length"))
        print("after search del:", await a.evaluate("document.querySelectorAll('button[data-del-item]').length"))
        print("count label:", await a.evaluate("(document.querySelector('#itemsCount')||{}).innerText"))

        # try delete
        await a.evaluate("window.confirm=()=>true")
        n = await a.evaluate("document.querySelectorAll('button[data-del-item]').length")
        if n:
            await a.evaluate("document.querySelector('button[data-del-item]').click()")
            await a.wait_for_timeout(2000)
            print("del toasts:", await a.evaluate("Array.from(document.querySelectorAll('.toast')).map(t=>t.innerText.trim())"))

        # toggle active
        print("\n--- inline field save test ---")
        await a.fill("#itemSearch", "PW Bulk Beta")
        await a.wait_for_timeout(900)
        fields = await a.evaluate("Array.from(document.querySelectorAll('#itemsTable [data-field]')).map(i=>({f:i.dataset.field,v:i.value}))")
        print("fields:", fields)
        if fields:
            await a.evaluate("""(() => {
              const inp = document.querySelector('#itemsTable [data-field="rate"]');
              inp.value = '155'; inp.dispatchEvent(new Event('change', {bubbles:true}));
            })()""")
            await a.wait_for_timeout(1800)
            print("field save toasts:", await a.evaluate("Array.from(document.querySelectorAll('.toast')).map(t=>t.innerText.trim())"))

        print("\n===== ERRORS =====")
        for e in errors: print(" ", e)
        if not errors: print("  NONE")
        await b.close()

asyncio.run(main())