"""Mechanical audit of PrimeSteel: dead refs, missing routes, missing icons, dupes."""
import re, sqlite3, json, os, sys

ROOT = r"C:\Users\Prime Steel\Desktop\PrimeSteel"
WEB = os.path.join(ROOT, "web")

def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()

server = read(os.path.join(ROOT, "server.py"))
admin = read(os.path.join(WEB, "admin.js"))
worker = read(os.path.join(WEB, "worker.js"))
ui = read(os.path.join(WEB, "ui.js"))
excel = read(os.path.join(ROOT, "excel_export.py"))

print("=" * 70)
print("1. ICONS: used but not defined")
print("=" * 70)
icon_block = re.search(r"const ICONS = \{(.*?)\n\};", ui, re.S)
defined = set(re.findall(r"^\s*'?([A-Za-z0-9_]+)'?\s*:", icon_block.group(1), re.M)) if icon_block else set()
used = set()
for src, label in ((admin, "admin"), (worker, "worker")):
    for m in re.finditer(r"icon\('([A-Za-z0-9_-]+)'", src):
        used.add(m.group(1))
missing = sorted(used - defined)
print(f"defined={len(defined)} used={len(used)}")
print("MISSING (silently render fallback box):", missing or "none")

print()
print("=" * 70)
print("2. ROUTES: JS calls vs server handlers")
print("=" * 70)
get_routes = set(re.findall(r'path == "(/api/[^"]+)"', server))
get_routes |= {"/api/items/" + "{}", }
pattern_routes = set(re.findall(r're\.fullmatch\(r"(/api/[^"]+)"', server))
normalized_patterns = set()
for p in pattern_routes:
    n = re.sub(r"\\d\+", ":id", p)
    n = re.sub(r"\[0-9a-fA-F-\]\+", ":uuid", n)
    normalized_patterns.add(n)

calls = set()
for src in (admin, worker):
    for m in re.finditer(r"api\(\s*[`'\"](/api/[^`'\"$]*)", src):
        calls.add(m.group(1))
    for m in re.finditer(r"api\(\s*`(/api/[^`]*)`", src):
        raw = m.group(1)
        if "${" in raw:
            calls.add(re.sub(r"\$\{[^}]+\}", ":id", raw))
        else:
            calls.add(raw)

all_server = set(get_routes) | normalized_patterns
unknown = []
for c in sorted(calls):
    norm = re.sub(r"\$\{[^}]+\}", ":id", c)
    if norm in all_server or c in all_server:
        continue
    unknown.append(c)
print("JS calls:", len(calls))
print("Server routes:", len(all_server))
print("JS calls with NO matching server route:", unknown or "none")

print()
print("=" * 70)
print("3. DUPLICATE top-level function declarations")
print("=" * 70)
for name, src in (("admin.js", admin), ("worker.js", worker), ("ui.js", ui)):
    fns = re.findall(r"^(?:async )?function ([A-Za-z0-9_]+)", src, re.M)
    seen, dups = set(), set()
    for f in fns:
        if f in seen:
            dups.add(f)
        seen.add(f)
    if dups:
        print(f"  {name}: {sorted(dups)}")
    else:
        print(f"  {name}: none")

print()
print("=" * 70)
print("4. DB schema")
print("=" * 70)
dbp = os.path.join(ROOT, "data", "prime.db")
conn = sqlite3.connect(dbp)
for (tbl,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({tbl})")]
    cnt = conn.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
    print(f"  {tbl} ({cnt} rows): {', '.join(cols)}")
conn.close()

print()
print("=" * 70)
print("5. FEATURE COVERAGE markers (present / absent)")
print("=" * 70)
features = {
    "GST / tax calc":            r"gst|tax|igst|cgst",
    "Invoice / PDF print":       r"print|invoice|pdf",
    "Payment / receipt":         r"payment|receipt|paid|outstanding|balance",
    "Customer ledger":           r"ledger",
    "Stock / inventory":         r"stock|inventory",
    "Barcode / QR":              r"barcode|qr",
    "Undo / audit trail":        r"undo|audit",
    "Order edit after save":     r"edit order|update_order|updateOrder",
    "Duplicate order":           r"duplicate|clone|copy order",
    "Keyboard shortcuts":        r"keydown|hotkey|shortcut",
    "Dashboard charts":          r"chart|sparkline|graph",
    "Search orders":             r'one\("q"\)',
    "Date range filter":         r"range|from=|to=",
    "Scale weigh":               r"scale|weigh|serial|COM",
    "Offline / retry queue":     r"offline|queue|retry|localStorage|indexedDB",
    "Login / PIN":               r"admin_pin|require_admin",
    "Bulk import":               r"bulk",
    "Excel export":              r"xlsx|openpyxl|export",
}
blob = " ".join((server, admin, worker, ui, excel)).lower()
for f, pat in features.items():
    print(f"  {'OK   ' if re.search(pat, blob, re.I) else 'MISS '} {f}")

print()
print("=" * 70)
print("6. Settings keys: file vs used")
print("=" * 70)
sp = os.path.join(ROOT, "data", "settings.json")
try:
    sj = json.load(open(sp, encoding="utf-8"))
    print("  saved keys:", list(sj.keys()))
except Exception as e:
    print("  cannot read:", e)
used_keys = sorted(set(re.findall(r'settings\.get\("([a-z_]+)"', server)) |
                   set(re.findall(r'\["([a-z_]+)"\]', server)))
print("  referenced in server.py:", used_keys[:40])