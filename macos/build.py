#!/usr/bin/env python3
"""Build a standalone macOS app using the installed Apple Swift toolchain."""
from pathlib import Path
import plistlib
import shutil
import subprocess

root = Path(__file__).resolve().parent.parent
app = root / "dist" / "MetaPrompt.app"
contents = app / "Contents"
web = contents / "Resources" / "web"
web.mkdir(parents=True, exist_ok=True)
(contents / "MacOS").mkdir(exist_ok=True)
for name in ["popup.html", "options.html", "popup.css", "options.css", "theme.css",
             "popup.js", "options.js", "api.js", "config.js", "prompt.js",
             "background.js", "brain_network.js", "brain_helper.js", "typesafe.js"]:
    shutil.copy2(root / name, web / name)
shutil.copy2(root / "macos" / "desktop.js", web / "desktop.js")
shutil.copy2(root / "macos" / "accounts.js", web / "accounts.js")
for name in ["popup.html", "options.html"]:
    page = web / name
    text = page.read_text()
    text = text.replace("</head>", '<link rel="stylesheet" href="desktop.css">\n<script src="desktop.js"></script><script src="accounts.js"></script>\n<script type="module" src="background.js"></script>\n</head>')
    text = text.replace("Your key stays in this browser", "Your key stays on this Mac")
    page.write_text(text)
(web / "desktop.css").write_text("""
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
""")
with (contents / "Info.plist").open("wb") as f:
    plistlib.dump({
        "CFBundleName": "MetaPrompt",
        "CFBundleDisplayName": "MetaPrompt",
        "CFBundleIdentifier": "local.metaprompt.desktop",
        "CFBundleExecutable": "MetaPrompt",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "2.5.0",
        "CFBundleVersion": "1",
        "LSMinimumSystemVersion": "13.0",
        "NSHighResolutionCapable": True,
        "NSPrincipalClass": "NSApplication",
        "CFBundleIconFile": "AppIcon",
    }, f)
iconset = root / "macos" / ".build" / "AppIcon.iconset"
iconset.mkdir(parents=True, exist_ok=True)
for size in [16, 32, 128, 256, 512]:
    for scale in [1, 2]:
        name = f"icon_{size}x{size}" + ("@2x" if scale == 2 else "") + ".png"
        subprocess.run(["sips", "-z", str(size*scale), str(size*scale),
                        str(root / "icons" / "icon128.png"), "--out", str(iconset / name)], check=True, stdout=subprocess.DEVNULL)
subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(contents / "Resources" / "AppIcon.icns")], check=True)
subprocess.run(["swiftc", "-O", "-target", "arm64-apple-macosx13.0",
                str(root / "macos" / "Main.swift"), str(root / "macos" / "Accounts.swift"), "-o", str(contents / "MacOS" / "MetaPrompt"),
                "-framework", "Cocoa", "-framework", "WebKit"], check=True)
subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(app)], check=True)
print(app)
