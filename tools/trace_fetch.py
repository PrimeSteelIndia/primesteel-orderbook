"""Log every fetch init the page makes, to find what prepends '{}' to the method."""
import asyncio, json, sqlite3
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8077"

async def main():
    con = sqlite3.connect("data/prime.db")
    con.execute("INSERT INTO customers (name,norm,phone,gstin,updated_at,address) VALUES ('ZZ PROBE','ZZ PROBE','','','0','')")
    con.commit()
    pid = con.execute("SELECT id FROM customers WHERE name='ZZ PROBE'").fetchone()[0]

    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1400, "height": 900})
        pg = await ctx.new_page()
        pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

        await pg.add_init_script("""
            window.__f = [];
            const of = window.fetch;
            window.fetch = function (input, init) {
                try {
                    window.__f.push({
                        url: String(input && input.url ? input.url : input),
                        method: init ? init.method : '(undefined)',
                        hasBody: !!(init && init.body),
                        stack: (new Error().stack || '').split('\\n').slice(1, 5).join(' | ')
                    });
                } catch (e) {}
                return of.apply(this, arguments);
            };
        """)

        await pg.goto(BASE + "/admin.html", wait_until="networkidle")
        await pg.click('.admin-nav button[data-tab="customers"]')
        await pg.wait_for_timeout(1500)
        await pg.evaluate("() => { window.__f = []; }")

        row = await pg.query_selector(f'[data-del-cust="{pid}"]')
        if not row:
            print("probe not in first page; using last visible")
            pid = await pg.evaluate("() => A.customers.slice(-1)[0].id")
            row = await pg.query_selector(f'[data-del-cust="{pid}"]')

        await row.click()
        await pg.wait_for_timeout(2000)

        logs = await pg.evaluate("() => window.__f")
        for l in logs:
            print(f"  method={l['method']!r:<12} body={l['hasBody']}  {l['url'].replace(BASE,'')}")
            if 'GET' in str(l['method']) and '{' in str(l['method']):
                print(f"     >>> BAD METHOD. stack: {l['stack'][:400]}")
        await b.close()
    con.close()

asyncio.run(main())