import urllib.request
import os
from pathlib import Path
from urllib.parse import urljoin

BASE_URL = "https://primesteelindia.github.io/com/"
WEB_DIR = Path(r"C:\Users\Prime Steel\Desktop\PrimeSteel\web")

files_to_download = [
    "index.html",
    "styles.css",
    "app.js",
    "scene.js",
    "assets/prime-steel-logo.png",
    "assets/favicon.svg",
    "assets/gi-coils.webp",
    "assets/ms-pipes.webp",
    "assets/ss-coils.webp",
]

for rel_path in files_to_download:
    url = urljoin(BASE_URL, rel_path)
    target = WEB_DIR / ("landing.html" if rel_path == "index.html" else rel_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    
    print(f"Downloading {url} -> {target.name}...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as resp:
        data = resp.read()
        target.write_bytes(data)
        print(f"  Saved {len(data)} bytes.")

print("\nAll assets downloaded successfully.")
