from pathlib import Path
import re

base = Path(__file__).resolve().parent

def read(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"Missing file: {path}")
    return path.read_text(encoding="utf-8")

index_html = read(base / "index.html")
styles_css = read(base / "styles.css")
app_js = read(base / "app.js")

# Inline CSS (match styles.css, ./styles.css, styles.css?x=1, any rel attrs)
css_pat = re.compile(
    r'<link[^>]+href=["\'](?:\./)?styles\.css(?:\?[^"\']*)?["\'][^>]*>',
    re.IGNORECASE
)
if not css_pat.search(index_html):
    raise RuntimeError("Could not find <link ... href='styles.css'> in index.html")
index_html = css_pat.sub(f"<style>\n{styles_css}\n</style>", index_html, count=1)

# Inline JS (match app.js, ./app.js, app.js?x=1, with defer/type/module/etc.)
js_pat = re.compile(
    r'<script[^>]+src=["\'](?:\./)?app\.js(?:\?[^"\']*)?["\'][^>]*>\s*</script>',
    re.IGNORECASE
)
if not js_pat.search(index_html):
    raise RuntimeError("Could not find <script ... src='app.js'></script> in index.html")
index_html = js_pat.sub(f"<script>\n{app_js}\n</script>", index_html, count=1)

out_file = base / "climate_data_explorer.html"
out_file.write_text(index_html, encoding="utf-8")
print("Created:", out_file)
