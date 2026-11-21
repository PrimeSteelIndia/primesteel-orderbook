import asyncio, os, sys
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"
USER = os.environ.get("PS_USER", "")
PASS = os.environ.get("PS_PASS", "")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 430, "height": 900}, has_touch=True)
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))

        await pg.goto(BASE + "/", wait_until="networkidle")
        await pg.wait_for_timeout(1500)

        print("=== 1. PICKER: item name + rate + weight/pc only ===")
        cards = await pg.query_selector_all(".item-card")
        print(f"cards: {len(cards)}")
        if cards:
            c = cards[0]
            print(f"card text: {(await c.inner_text()).replace(chr(10),' | ')}")
            child_tags = await c.evaluate("""el => [...el.children].map(ch => ch.className || ch.tagName)""")
            print(f"card children: {child_tags}")

        print()
        print("=== 2. + ADDS WITHOUT OPENING A SHEET ===")
        c0 = cards[0]
        await (await c0.query_selector("[data-inc]")).click()
        await pg.wait_for_timeout(500)
        sheets = await pg.query_selector_all(".sheet")
        print(f"sheets open after tap +: {len(sheets)}")
        qval = await (await c0.query_selector("[data-qty]")).input_value()
        print(f"qty input value after +: '{qval}'")
        incart = await c0.get_attribute("class")
        print(f"card class: {incart}")

        print()
        print("=== 3. TAP THE NUMBER TO TYPE IT ===")
        q = await c0.query_selector("[data-qty]")
        await q.click()
        focused = await pg.evaluate("() => document.activeElement.dataset.qty || ''")
        print(f"focused element is qty input: {focused != ''}")
        await q.fill("12")
        await q.press("Enter")
        await pg.wait_for_timeout(600)
        print(f"qty after typing 12 + Enter: '{await q.input_value()}'")
        # keep it for review
        await (await c0.query_selector("[data-inc]")).click()
        await pg.wait_for_timeout(400)

        print()
        print("=== 4. SHELF LAYOUT: categories down, items across ===")
        shelves = await pg.query_selector_all(".shelf")
        print(f"shelves (categories): {len(shelves)}")
        host = await pg.query_selector("#grid")
        overflow = await host.evaluate("el => getComputedStyle(el).display")
        print(f"#grid display: {overflow}")
        for s in shelves[:3]:
            t = await s.query_selector(".shelf-title")
            rail = await s.query_selector(".shelf-rail")
            title = (await t.inner_text()).strip() if t else "?"
            n = len(await rail.query_selector_all(".item-card")) if rail else 0
            if rail:
                rstyle = await rail.evaluate("el => ({dir: getComputedStyle(el).flexDirection, ovf: getComputedStyle(el).overflowX})")
            else:
                rstyle = {}
            print(f"shelf '{title}': {n} items, rail {rstyle}")

        print()
        print("=== 5. REVIEW: item + customer + per-row delete only ===")
        await pg.click("text=Review")
        await pg.wait_for_timeout(900)
        rows = await pg.query_selector_all(".rev-row")
        dels = await pg.query_selector_all("[data-del]")
        body = await pg.inner_text("body")
        print(f"rev rows: {len(rows)}, per-row delete buttons: {len(dels)}")
        for r in rows:
            print(f"  row: {(await r.inner_text()).replace(chr(10),' | ')}")
        cust = await pg.query_selector("#customerBtn")
        print(f"customer block present: {cust is not None}")
        if cust:
            print(f"  customer text: {(await cust.inner_text()).replace(chr(10),' | ')[:80]}")
        banned = ["Clear all", "Outstanding", "Credit", "Balance due", "Payment mode", "Discount"]
        hits = [x for x in banned if x.lower() in body.lower()]
        print(f"unwanted sections still present: {hits if hits else 'none'}")
        inputs = await pg.query_selector_all("[data-rqty]")
        print(f"inline qty inputs on review: {len(inputs)}")

        print()
        print("=== 6. DELETE ONE ROW ===")
        if dels:
            await dels[0].click()
            await pg.wait_for_timeout(800)
            rows2 = await pg.query_selector_all(".rev-row")
            print(f"rows after deleting one: {len(rows2)} (was {len(rows)})")

        print()
        print("=== 7. DOUBLE-TAP DOES NOT ZOOM ===")
        await pg.goto(BASE + "/", wait_until="networkidle")
        await pg.wait_for_timeout(1500)
        ta = await pg.evaluate("""() => {
            const b = document.querySelector('.item-card [data-inc]');
            return b ? getComputedStyle(b).touchAction : 'no button';
        }""")
        print(f"touch-action on + button: {ta}")
        vp_el = await pg.evaluate("""() => {
            const m = document.querySelector('meta[name=viewport]');
            return m ? m.content : 'none';
        }""")
        print(f"viewport meta: {vp_el}")
        card = (await pg.query_selector_all(".item-card"))[0]
        btn = await card.query_selector("[data-inc]")
        box = await btn.bounding_box()
        cx, cy = box["x"] + box["width"]/2, box["y"] + box["height"]/2
        before = await pg.evaluate("() => window.visualViewport ? window.visualViewport.scale : 1")
        await pg.touchscreen.tap(cx, cy)
        await pg.wait_for_timeout(50)
        await pg.touchscreen.tap(cx, cy)
        await pg.wait_for_timeout(800)
        after = await pg.evaluate("() => window.visualViewport ? window.visualViewport.scale : 1")
        print(f"zoom scale before={before} after double-tap={after}")
        print(f"zoom blocked: {abs(after - before) < 0.01}")
        qv = await (await card.query_selector("[data-qty]")).input_value()
        print(f"both taps registered on qty: '{qv}'")

        print()
        print("=== 8. ADMIN RATE LIST COLUMNS ===")
        await pg.goto(BASE + "/admin", wait_until="networkidle")
        await pg.wait_for_timeout(1200)
        gate = await pg.query_selector("#loginGate")
        gate_visible = await gate.is_visible() if gate else False
        print(f"login gate visible: {gate_visible}")
        if gate_visible:
            if not (USER and PASS):
                print("no PS_USER/PS_PASS env set - skipping admin checks")
            else:
                await pg.fill("#loginUser", USER)
                await pg.fill("#loginPass", PASS)
                await pg.click("#loginBtn")
                await pg.wait_for_timeout(2500)
        if not gate_visible or (USER and PASS):
            hdr = await pg.query_selector_all("#itemsTable thead th")
            cols = []
            for h in hdr:
                cols.append((await h.inner_text()).strip())
            print(f"columns: {cols}")
            arows = await pg.query_selector_all("#itemsTable tbody tr")
            print(f"rows: {len(arows)}")
            if arows:
                cells = await arows[0].query_selector_all("td")
                print(f"cells in first row: {len(cells)}")
                print(f"row text: {(await arows[0].inner_text()).replace(chr(10),' | ')[:120]}")
                d = await arows[0].query_selector("[data-del-item]")
                print(f"per-row delete button: {d is not None}")
                e = await arows[0].query_selector("[data-edit-item]")
                print(f"per-row edit button: {e is not None}")

        print()
        print(f"=== console errors: {errs if errs else 'none'} ===")
        await b.close()

asyncio.run(main())