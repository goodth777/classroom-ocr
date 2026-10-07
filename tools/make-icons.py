# Draws the app icon (paper sheet with text lines on accent green) as PNGs.
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parent.parent / "web" / "icons"
out.mkdir(parents=True, exist_ok=True)
for size in (192, 512):
    s = size / 512
    img = Image.new("RGB", (size, size), "#1f6f5c")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([136 * s, 104 * s, 376 * s, 408 * s], radius=28 * s, fill="#ffffff")
    for i, w in enumerate((176, 176, 120)):
        y = (176 + i * 56) * s
        d.rounded_rectangle([176 * s, y, (176 + w) * s, y + 18 * s], radius=9 * s, fill="#1f6f5c")
    img.save(out / f"icon-{size}.png")
print("ok")
