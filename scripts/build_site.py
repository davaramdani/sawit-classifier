"""Build the GitHub Pages document root from the shared design and browser sources."""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs"


def main():
    OUTPUT.mkdir(exist_ok=True)
    html = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    replacements = {
        "{{ url_for('static', filename='css/style.css') }}?v=2": "./assets/style.css",
        "{{ url_for('static', filename='js/app.js') }}?v=2": "./js/app.js",
        "{{ url_for('static', filename='uploads/sawit5.jpg') }}": "./assets/sawit5.jpg",
        'defer="" src="./js/app.js"': 'type="module" src="./js/app.js"',
        'class="brand" href="/"': 'class="brand" href="./"',
    }
    for old, new in replacements.items():
        assert old in html, "Shared template changed; update the static-site conversion: " + old
        html = html.replace(old, new)
    assert "{{" not in html
    html = html.replace('  <title>', '  <link rel="icon" type="image/svg+xml" href="./assets/favicon.svg"/>\n  <title>')
    html = html.replace('      <p class="error-message"', '''      <div class="model-progress" id="modelProgress" role="status" hidden>
       <div class="model-progress-heading"><span id="modelProgressText">Menyiapkan analisis…</span><span id="modelProgressPercent"></span></div>
       <progress id="modelProgressBar" max="100" aria-label="Progres persiapan model"></progress>
       <p id="modelProgressHint">Model dimuat saat pertama digunakan. Foto diproses di perangkat ini.</p>
      </div>
      <p class="error-message"''')
    html = html.replace('     Klasifikasi visual · 3 kelas', '     Analisis di perangkat · 3 kelas')
    (OUTPUT / "index.html").write_text(html, encoding="utf-8")
    (OUTPUT / ".nojekyll").touch()
    (OUTPUT / "assets").mkdir(exist_ok=True)
    shutil.copy2(ROOT / "static" / "css" / "style.css", OUTPUT / "assets" / "style.css")
    shutil.copy2(ROOT / "static" / "uploads" / "sawit5.jpg", OUTPUT / "assets" / "sawit5.jpg")
    shutil.copy2(ROOT / "web" / "favicon.svg", OUTPUT / "assets" / "favicon.svg")
    for source in (ROOT / "web").glob("*.js"):
        (OUTPUT / "js").mkdir(exist_ok=True)
        shutil.copy2(source, OUTPUT / "js" / source.name)
    assert (OUTPUT / "models" / "manifest.json").exists(), "Run export_model.py first."
    assert (OUTPUT / "vendor" / "ort" / "ort.wasm.min.mjs").exists(), "Install browser runtime assets first."
    print("Static site ready:", OUTPUT)


if __name__ == "__main__":
    main()
