from pathlib import Path
import re

base = Path(__file__).parent

index_html = (base / "index.html").read_text(encoding="utf-8")
styles_css = (base / "styles.css").read_text(encoding="utf-8")
app_js = (base / "app.js").read_text(encoding="utf-8")

# Inline CSS
index_html = re.sub(
    r'<link[^>]+href=["\']styles\.css["\'][^>]*>',
    f"<style>\n{styles_css}\n</style>",
    index_html
)

# Inline JS
index_html = re.sub(
    r'<script[^>]+src=["\']app\.js["\'][^>]*></script>',
    f"<script>\n{app_js}\n</script>",
    index_html
)

out_file = base / "climate_data_explorer.html"
out_file.write_text(index_html, encoding="utf-8")

print("Created:", out_file)