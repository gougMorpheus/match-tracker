"""Erzeugt die PWA-Icons (kein eigenes Logo im Repo vorhanden; Design aus App-Farben).
Aufruf: python3 scripts/generate-icons.py  (benoetigt Pillow und DejaVu Sans Bold)."""
from PIL import Image, ImageDraw, ImageFont
BG = (15, 23, 42); ACCENT = (56, 189, 248); TEXT = (226, 232, 240)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def draw(size, maskable=False, rounded=True):
    s = 1024
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if maskable or not rounded:
        d.rectangle([0, 0, s, s], fill=BG)
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=220, fill=BG)
    scale = 0.72 if maskable else 1.0  # maskable: Inhalt in der sicheren Zone (80 %)
    c = s / 2; r = 360 * scale
    d.ellipse([c - r, c - r, c + r, c + r], outline=ACCENT, width=int(34 * scale))
    font = ImageFont.truetype(FONT, int(250 * scale))
    d.text((c, c - 20 * scale), "40K", font=font, fill=TEXT, anchor="mm")
    small = ImageFont.truetype(FONT, int(92 * scale))
    d.text((c, c + 190 * scale), "TRACKER", font=small, fill=ACCENT, anchor="mm")
    return im.resize((size, size), Image.LANCZOS)

draw(192).save("public/icons/icon-192.png")
draw(512).save("public/icons/icon-512.png")
draw(512, maskable=True).save("public/icons/icon-maskable-512.png")
draw(192, maskable=True).save("public/icons/icon-maskable-192.png")
draw(180, rounded=False).convert("RGB").save("public/icons/apple-touch-icon.png")
draw(32).save("public/favicon-32.png")
draw(48).save("public/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
