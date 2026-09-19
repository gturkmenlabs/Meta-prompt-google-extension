#!/usr/bin/env python3
"""Build a standalone Windows app using the installed .NET SDK.

Mirrors macos/build.py: copy the shared interface and engine, add the desktop
bridge and layout, then compile the native host. Source extension files are
never rewritten — every edit happens on the copies under the output folder.
"""
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
here = root / "windows"
out = root / "dist" / "MetaPrompt-Windows"

# Must stay in step with macos/build.py; windows/verify_desktop.mjs checks that
# every module these files import is itself on the list.
SHARED = ["popup.html", "options.html", "popup.css", "options.css", "theme.css",
          "popup.js", "options.js", "api.js", "config.js", "prompt.js",
          "background.js", "brain_network.js", "brain_helper.js", "typesafe.js"]

DESKTOP_CSS = """
html, body { min-height: 100vh; }
.popup-page { width: auto; }
.mp-popup { max-width: 760px; margin: 0 auto; }
.mp-pop-body { max-height: none; padding: 28px 36px; overflow: visible; }
.mp-pop-head { padding: 22px 36px; }
.mp-source { min-height: 140px; }
.intro h1 { font-size: 34px; }
.mp-controls { gap: 22px; margin-top: 22px; }
#modeSeg .mp-seg-btn { min-height: 72px; }
#modeSeg small { font-size: 11px; }
.mp-mode-desc { font-size: 12px; }
#writePageBtn { display: none !important; }
.mp-actions { grid-template-columns: 1fr; }
.mp-btn.revise { min-height: 48px; }
textarea#output { max-height: none; min-height: 260px; }
.settings-page { padding: 24px; }
.mp-settings { box-shadow: none; }
@media(max-width:540px) { .mp-pop-body, .mp-pop-head { padding: 20px; } }
"""

HEAD_INJECTION = (
    '<link rel="stylesheet" href="desktop.css">\n'
    '<script src="desktop.js"></script><script src="accounts.js"></script>\n'
    '<script type="module" src="background.js"></script>\n'
    '</head>'
)


def make_icon() -> bool:
    """Convert the extension PNG into an .ico. Pillow is optional."""
    try:
        from PIL import Image
    except ImportError:
        return False
    source = Image.open(root / "icons" / "icon128.png")
    source.save(here / "app.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128)])
    return True


def main() -> None:
    if shutil.which("dotnet") is None:
        sys.exit("The .NET 8 SDK is required: https://dotnet.microsoft.com/download")

    if not make_icon():
        print("Pillow not installed — building without a custom icon "
              "(pip install pillow to add one).")

    if out.exists():
        shutil.rmtree(out)

    subprocess.run(
        ["dotnet", "publish", str(here / "MetaPrompt.csproj"),
         "-c", "Release", "-o", str(out)],
        check=True,
    )

    # The published folder keeps the interface beside the executable; Program.cs
    # maps it to a virtual host so the pages load over https, not file://.
    web = out / "web"
    web.mkdir(parents=True, exist_ok=True)
    for name in SHARED:
        shutil.copy2(root / name, web / name)
    shutil.copy2(here / "desktop.js", web / "desktop.js")
    shutil.copy2(root / "macos" / "accounts.js", web / "accounts.js")

    for name in ["popup.html", "options.html"]:
        page = web / name
        text = page.read_text(encoding="utf-8")
        text = text.replace("</head>", HEAD_INJECTION)
        text = text.replace("Your key stays in this browser", "Your key stays on this PC")
        page.write_text(text, encoding="utf-8")

    (web / "desktop.css").write_text(DESKTOP_CSS, encoding="utf-8")

    print(out / "MetaPrompt.exe")


if __name__ == "__main__":
    main()
