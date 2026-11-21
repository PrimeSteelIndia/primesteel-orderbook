import asyncio, os, json, base64
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"
OUT = os.path.abspath("tools/out")
os.makedirs(OUT, exist_ok=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 430, "height": 900}, device_scale_factor=2,
                                  is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        errs = []
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))

        await pg.goto(BASE + "/", wait_until="networkidle")

        # ---- build a cart via the API, then load it into the app ----
        items = await pg.evaluate("async () => (await (await fetch('/api/items')).json())")
        items = items.get("items", items) if isinstance(items, dict) else items
        picks = [i for i in items if i.get("active") and i.get("rate")][:3]
        print(f"[items] using {len(picks)}: " + ", ".join(i["name"] for i in picks))

        # ---- does the share module exist and load? ----
        loaded = await pg.evaluate("""() => ({
            estimateFromCart: typeof estimateFromCart,
            drawEstimate: typeof drawEstimate,
            buildImagePdf: typeof buildImagePdf,
            buildEstimatePdf: typeof buildEstimatePdf,
            openShareSheet: typeof openShareSheet
        })""")
        print("[modules]", json.dumps(loaded))

        # ---- build an estimate from a synthetic cart and render it ----
        result = await pg.evaluate("""(picks) => {
            S.cart = picks.map((it, n) => ({
                item_id: it.id,
                entry_qty: n === 0 ? 3 : (n === 1 ? 2 : 5),
                entry_unit: it.main_unit || 'pcs',
                qty: n === 0 ? 3 : (n === 1 ? 2 : 5),
                unit: it.main_unit || 'pcs',
                pcs: n === 0 ? 3 : (n === 1 ? 2 : 5),
            }));
            S.customerName = 'Sharma Fabrication Works';
            S.customerPhone = '9876543210';
            S.worker = 'Ramesh';
            S.note = 'Delivery by Friday, vehicle MH-12-AB-1234';
            const d = estimateFromCart();
            return {
                rows: d.rows.length,
                totalWeight: d.totalWeight,
                totalAmount: d.totalAmount,
                totalPcs: d.totalPcs,
            };
        }""", picks)
        print("[estimate]", json.dumps(result))

        # ---- render the canvas and save a PNG so the design can be inspected ----
        png = await pg.evaluate("""() => {
            const d = estimateFromCart();
            const c = drawEstimate(d, {showRates:true});
            return { w: c.width, h: c.height, data: c.toDataURL('image/png') };
        }""")
        png_path = os.path.join(OUT, "estimate.png")
        with open(png_path, "wb") as f:
            f.write(base64.b64decode(png["data"].split(",", 1)[1]))
        print(f"[canvas] {png['w']}x{png['h']} -> {png_path}")

        # ---- build the PDF and save it ----
        pdf = await pg.evaluate("""async () => {
            const d = estimateFromCart();
            const built = await buildEstimatePdf(d);
            const buf = new Uint8Array(await built.blob.arrayBuffer());
            let s = '';
            for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
            return { name: built.name, type: built.blob.type, size: buf.length, b64: btoa(s) };
        }""")
        pdf_path = os.path.join(OUT, pdf["name"])
        with open(pdf_path, "wb") as f:
            f.write(base64.b64decode(pdf["b64"]))
        print(f"[pdf] {pdf['name']}  {pdf['type']}  {pdf['size']} bytes -> {pdf_path}")

        # ---- build the image version ----
        img = await pg.evaluate("""async () => {
            const d = estimateFromCart();
            const built = await buildEstimateImage(d);
            const buf = new Uint8Array(await built.blob.arrayBuffer());
            let s = '';
            for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
            return { name: built.name, type: built.blob.type, size: buf.length, b64: btoa(s) };
        }""")
        img_path = os.path.join(OUT, img["name"])
        with open(img_path, "wb") as f:
            f.write(base64.b64decode(img["b64"]))
        print(f"[img] {img['name']}  {img['type']}  {img['size']} bytes -> {img_path}")

        # ---- open the share sheet UI for real and screenshot it ----
        await pg.evaluate("() => openShareSheet(estimateFromCart())")
        await pg.wait_for_timeout(700)
        sheet_ok = await pg.evaluate("""() => {
            const s = document.querySelector('.sheet');
            if (!s) return { open: false };
            const cv = s.querySelector('canvas');
            return {
                open: true,
                canvas: cv ? { w: cv.width, h: cv.height } : null,
                fmtBtns: s.querySelectorAll('[data-fmt]').length,
                hasSend: !!s.querySelector('#shareFileBtn'),
                hasWa: !!s.querySelector('#waTextBtn'),
                hasCopy: !!s.querySelector('#copyBtn'),
                title: (s.querySelector('.sheet-title') || {}).textContent,
            };
        }""")
        print("[sheet]", json.dumps(sheet_ok))
        await pg.screenshot(path=os.path.join(OUT, "share-sheet.png"), full_page=True)

        # click the Image format toggle and confirm it updates
        await pg.click('[data-fmt="image"]')
        await pg.wait_for_timeout(200)
        after = await pg.evaluate("""() => {
            const s = document.querySelector('.sheet');
            return {
                word: (s.querySelector('#fmtWord') || {}).textContent,
                active: s.querySelector('[data-fmt="image"]').classList.contains('active'),
                hint: (s.querySelector('#fmtHint') || {}).textContent.slice(0, 40),
            };
        }""")
        print("[fmt toggle]", json.dumps(after))
        await pg.screenshot(path=os.path.join(OUT, "share-sheet-image.png"), full_page=True)

        print("[console errors]", errs if errs else "none")
        print("[paths]", png_path, pdf_path, img_path)
        await b.close()

asyncio.run(main())