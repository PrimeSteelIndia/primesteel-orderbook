import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"
errors = []

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        w = await b.new_page(viewport={"width": 420, "height": 900})
        w.on("console", lambda m: errors.append(f"W[{m.type}] {m.text[:250]}") if m.type == "error" else None)
        w.on("pageerror", lambda e: errors.append(f"WPAGEERROR {str(e)[:250]}"))
        await w.goto(BASE + "/", wait_until="networkidle")
        await w.wait_for_timeout(2000)

        # 1. pick item
        await w.evaluate("document.querySelector('#view [data-item]').click()")
        await w.wait_for_timeout(900)
        print("1. item sheet:", await w.evaluate("!!document.querySelector('.sheet')"))

        # 2. set qty
        await w.evaluate("""(() => {
          const q = document.querySelector('#qtyInput');
          q.value = '5'; q.dispatchEvent(new Event('input', {bubbles:true}));
        })()""")
        await w.wait_for_timeout(500)
        print("2. est amount:", await w.evaluate("(document.body.innerText.match(/EST\\. AMOUNT[\\s\\S]{0,40}/)||[''])[0]"))

        # 3. add to order
        await w.evaluate("Array.from(document.querySelectorAll('.sheet button')).filter(b=>b.innerText.includes('Add to order')).forEach(b=>b.click())")
        await w.wait_for_timeout(1600)
        print("3. sheet after add:", await w.evaluate("!!document.querySelector('.sheet')"))
        print("   toasts:", await w.evaluate("Array.from(document.querySelectorAll('.toast')).map(t=>t.innerText.trim())"))
        print("   body:", (await w.inner_text("body"))[:600].replace("\n"," | "))

        print("\nERRORS:", errors or "NONE")
        await b.close()

asyncio.run(main())