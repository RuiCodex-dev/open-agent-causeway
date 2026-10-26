"""Render deck/index.html to deck/Causeway-deck.pdf and PNG previews with Playwright's headless Chromium."""
import pathlib, sys
from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).resolve().parent
with sync_playwright() as p:
    browser = p.chromium.launch()
    try:
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        page.goto((here / "index.html").as_uri())
        page.wait_for_load_state("networkidle")
        page.evaluate("document.fonts.ready")
        page.pdf(path=str(here / "Causeway-deck.pdf"), width="1920px", height="1080px", print_background=True, prefer_css_page_size=True)
        if "--png" in sys.argv:
            out = here / "preview"; out.mkdir(exist_ok=True)
            for i, el in enumerate(page.query_selector_all("section.slide"), 1):
                el.screenshot(path=str(out / f"slide-{i:02d}.png"))
    finally:
        browser.close()
print("ok")
