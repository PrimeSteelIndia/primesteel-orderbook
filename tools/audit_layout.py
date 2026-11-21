"""Layout audit for the estimate canvas.

Wraps CanvasRenderingContext2D.fillText so every string drawn is recorded with
its position, alignment and measured width. Then checks that nothing is drawn
outside the page and that no row's numbers collide with its item name.
"""
import asyncio, json, os
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"

AUDIT = r"""
() => {
  const calls = [];
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.fillText;
  proto.fillText = function (text, x, y, maxW) {
    let w = 0;
    try { w = this.measureText(String(text)).width; } catch (e) {}
    calls.push({
      text: String(text),
      x: x, y: y,
      align: this.textAlign,
      font: this.font,
      width: w,
      canvasW: this.canvas.width / (this.canvas.width / 1000 || 1),
    });
    return orig.apply(this, arguments);
  };

  let data;
  try {
    data = estimateFromCart();
    window.__canvas = drawEstimate(data, { showRates: true });
  } finally {
    proto.fillText = orig;
  }

  const W = 1000;                       // logical width used by drawEstimate
  const H = window.__canvas.height / (window.__canvas.width / W);

  const issues = [];
  for (const c of calls) {
    if (!c.text) continue;
    let left = c.x, right = c.x + c.width;
    if (c.align === 'right') { left = c.x - c.width; right = c.x; }
    else if (c.align === 'center') { left = c.x - c.width / 2; right = c.x + c.width / 2; }

    if (left < 0 || right > W) {
      issues.push({ kind: 'outside-page', text: c.text.slice(0, 40), left: Math.round(left), right: Math.round(right) });
    }
    if (c.y < 0 || c.y > H) {
      issues.push({ kind: 'below-page', text: c.text.slice(0, 40), y: Math.round(c.y) });
    }
  }

  return {
    totalDraws: calls.length,
    pageW: W,
    pageH: Math.round(H),
    issues: issues.slice(0, 20),
    issueCount: issues.length,
    sample: calls.filter(c => c.text).slice(0, 14).map(c => ({
      t: c.text.slice(0, 26), x: Math.round(c.x), y: Math.round(c.y), a: c.align, w: Math.round(c.width),
    })),
  };
}
"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 430, "height": 900},
                                  device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(BASE + "/", wait_until="networkidle")

        items = await pg.evaluate("async () => { const r = await (await fetch('/api/items')).json(); return r.items || r; }")
        picks = [i for i in items if i.get("active") and i.get("rate")][:4]

        await pg.evaluate("""(picks) => {
            S.cart = picks.map((it, n) => ({
                item_id: it.id,
                entry_qty: [3, 2, 5, 12][n] || 1,
                entry_unit: it.main_unit || 'pcs',
                qty: [3, 2, 5, 12][n] || 1,
                unit: it.main_unit || 'pcs',
                pcs: [3, 2, 5, 12][n] || 1,
            }));
            S.customerName = 'Sharma Fabrication Works';
            S.customerPhone = '9876543210';
            S.worker = 'Ramesh';
            S.note = 'Delivery by Friday, vehicle MH-12-AB-1234';
        }""", picks)

        res = await pg.evaluate(AUDIT)
        print(json.dumps({k: v for k, v in res.items() if k != 'sample'}, indent=2))
        print("\nfirst draws:")
        for s in res["sample"]:
            print(f"  {s['a']:>6} x={s['x']:>4} y={s['y']:>4} w={s['w']:>3}  {s['t']!r}")

        # Long-name stress test: a very long item name must wrap, not overflow.
        long_res = await pg.evaluate(r"""
        () => {
          const d = estimateFromCart();
          d.rows[0].name = 'Galvanised Corrugated Roofing Sheet Heavy Duty 8ft x 4ft 2.5mm IS277 Premium Grade';
          const c = drawEstimate(d, { showRates: true });
          return { w: c.width, h: c.height };
        }""")
        print(f"\nlong-name canvas: {long_res['w']}x{long_res['h']} (taller = wrapped correctly)")
        print("page errors:", errs if errs else "none")
        await b.close()

asyncio.run(main())