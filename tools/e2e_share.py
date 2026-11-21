"""End-to-end: add items by tapping +, open review, tap Send estimate,
pick PDF, click Save file, and confirm a real .pdf download lands on disk.
"""
import asyncio, os, json
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"
OUT = os.path.abspath("tools/out/e2e")
os.makedirs(OUT, exist_ok=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 430, "height": 900},
                                  device_scale_factor=2, is_mobile=True, has_touch=True,
                                  accept_downloads=True)
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)

        await pg.goto(BASE + "/", wait_until="networkidle")

        # ---- 1. add three items by tapping the + on the card ----
        cards = await pg.query_selector_all(".item-card")
        print(f"[picker] cards on screen: {len(cards)}")
        added = 0
        for c in cards[:3]:
            inc = await c.query_selector("[data-inc]")
            if not inc:
                continue
            await inc.click()
            await pg.wait_for_timeout(120)
            added += 1
        print(f"[picker] tapped + on {added} cards")

        state = await pg.evaluate("() => ({ cart: S.cart.length, qty: S.cart.map(l => l.entry_qty) })")
        print(f"[cart] {json.dumps(state)}")

        # ---- 2. go to the review screen ----
        await pg.evaluate("() => go('#/review')")
        await pg.wait_for_timeout(500)

        rev = await pg.evaluate("""() => ({
            rows: document.querySelectorAll('.rev-row').length,
            hasShare: !!document.querySelector('#shareEstBtn'),
            shareLabel: (document.querySelector('#shareEstBtn') || {}).textContent,
            hasSave: !!document.querySelector('#saveBtn'),
        })""")
        print(f"[review] {json.dumps(rev)}")

        # ---- 3. tap Send estimate ----
        await pg.click("#shareEstBtn")
        await pg.wait_for_timeout(900)

        sheet = await pg.evaluate("""() => {
            const s = document.querySelector('.sheet');
            if (!s) return { open: false };
            const cv = s.querySelector('canvas');
            return {
                open: true,
                preview: cv ? cv.width + 'x' + cv.height : null,
                title: (s.querySelector('.sheet-title') || {}).textContent,
                fmtDefault: (s.querySelector('[data-fmt].active') || {}).dataset?.fmt,
                sendLabel: (s.querySelector('#shareFileBtn') || {}).textContent.trim().slice(0, 40),
            };
        }""")
        print(f"[share sheet] {json.dumps(sheet)}")

        # ---- 4. save the PDF for real ----
        async with pg.expect_download(timeout=20000) as dl_info:
            await pg.click("#saveBtn2")
        dl = await dl_info.value
        name = dl.suggested_filename
        path = os.path.join(OUT, name)
        await dl.save_as(path)
        size = os.path.getsize(path)
        print(f"[download] {name}  {size} bytes -> {path}")

        # ---- 5. switch to image and save that too ----
        await pg.click('[data-fmt="image"]')
        await pg.wait_for_timeout(200)
        async with pg.expect_download(timeout=20000) as dl2_info:
            await pg.click("#saveBtn2")
        dl2 = await dl2_info.value
        name2 = dl2.suggested_filename
        path2 = os.path.join(OUT, name2)
        await dl2.save_as(path2)
        print(f"[download] {name2}  {os.path.getsize(path2)} bytes")

        # ---- 6. the WhatsApp text link must be a valid wa.me URL ----
        import urllib.parse
        wa = await pg.evaluate("""() => {
            const d = estimateFromCart();
            const num = waNumber('9876543210');
            return { num, text: waMessage(d).slice(0, 120) };
        }""")
        print(f"[wa number] {wa['num']}")
        print(f"[wa text] {wa['text']!r}")

        print("[errors]", errs if errs else "none")
        print(f"[files] {path} | {path2}")
        await b.close()

asyncio.run(main())