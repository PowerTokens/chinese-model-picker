"""Take review screenshots of the local page. Usage: python scripts/screenshots.py [url]"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765/"
OUT = Path(__file__).resolve().parent.parent / "screenshots"
OUT.mkdir(exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    errors = []
    for name, vp, scheme, full in [
        ("desktop-1280-light", {"width": 1280, "height": 900}, "light", True),
        ("desktop-1280-dark", {"width": 1280, "height": 900}, "dark", False),
        ("mobile-390-light", {"width": 390, "height": 844}, "light", True),
        ("mobile-390-dark", {"width": 390, "height": 844}, "dark", False),
    ]:
        ctx = b.new_context(viewport=vp, color_scheme=scheme, device_scale_factor=2 if "mobile" in name else 1)
        page = ctx.new_page()
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL, wait_until="networkidle")
        page.wait_for_selector("#modelRows tr")
        page.screenshot(path=str(OUT / f"{name}.png"), full_page=full)
        if name == "desktop-1280-light":
            # interaction shot: filter + calculator
            page.add_style_tag(content=".topbar{position:static !important}")
            page.click('[data-family="Qwen"]')
            page.click('[data-feature="reasoning"]')
            page.click('[data-preset="300,30,128000"]')
            page.locator("#models").screenshot(path=str(OUT / "desktop-1280-filtered-table.png"))
            page.locator("#calculator").screenshot(path=str(OUT / "desktop-1280-calculator.png"))
            page.click('[data-use="qwen3.8-flash"]')
            page.wait_for_timeout(2000)
            page.locator("#access").screenshot(path=str(OUT / "desktop-1280-access-cta.png"))
            page.locator("footer").screenshot(path=str(OUT / "desktop-1280-footer.png"))
        if name == "mobile-390-light":
            page.add_style_tag(content=".topbar{position:static !important}")
            page.evaluate("document.querySelector('#modelRows').scrollIntoView({behavior:'instant', block:'start'})")
            page.screenshot(path=str(OUT / "mobile-390-table.png"))
            page.evaluate("document.querySelector('#calculator').scrollIntoView({behavior:'instant', block:'start'})")
            page.screenshot(path=str(OUT / "mobile-390-calculator.png"))
            page.evaluate("document.querySelector('#access').scrollIntoView({behavior:'instant', block:'start'})")
            page.screenshot(path=str(OUT / "mobile-390-access.png"))
        ctx.close()
    b.close()
    print("console errors:", errors or "none")
