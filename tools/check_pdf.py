import re, sys
p = sys.argv[1] if len(sys.argv) > 1 else "PrimeSteel-Estimate-Sharma-Fabrication-Works.pdf"
b = open(p, "rb").read()
print(f"size: {len(b)} bytes")
print(f"header: {b[:9]!r}")
print(f"tail: {b[-32:]!r}")

m = re.search(rb"startxref\s+(\d+)", b)
start = int(m.group(1))
print(f"startxref -> {start}, byte there: {b[start:start+4]!r}")
assert b[start:start + 4] == b"xref", "startxref does not point at xref table"

entries = re.findall(rb"(\d{10}) 00000 n", b[start:])
print(f"xref entries: {len(entries)}")
ok = True
for i, off in enumerate(entries, start=1):
    o = int(off)
    marker = b[o:o + 20]
    if not re.match(rb"%d 0 obj" % i, marker):
        ok = False
        print(f"  BAD obj {i}: offset {o} -> {marker[:20]!r}")
print(f"all xref offsets valid: {ok}")

a = b.find(b"stream\n", b.find(b"/DCTDecode")) + 7
z = b.find(b"\nendstream", a)
jpg = b[a:z]
SOI = b"\xff\xd8"
EOI = b"\xff\xd9"
print(f"embedded jpeg: {len(jpg)} bytes")
print(f"jpeg complete: {jpg[:2] == SOI and jpg[-2:] == EOI}")
print(f"catalogue: {b'/Type /Catalog' in b}")
print(f"image xobj: {b'/Subtype /Image' in b}")
print(f"contents: {b'/Contents 5 0 R' in b}")
print(f"mediabox: {b'/MediaBox' in b}")