"""Generates the PWA app icons from the app's own brand colors, so the
icon matches the running app rather than an eyeballed approximation.

ACCENT/BG are literal hex, not derived via OKLCH math, because that's how
index.css itself expresses --color-accent/--color-bg for the dark theme
(:root[data-theme="dark"]) as of the circadian-palette rework -- unlike
the 5-category tint wheel (data.js's TINTS / index.css's [data-c=...]),
which *is* one shared hue rotated through oklch(cat-l cat-c H), the main
brand accent is its own bespoke color per theme, not a point on that
wheel. If index.css's dark-theme values change, update these two to
match and re-run this script -- there's no formula linking them anymore."""
from PIL import Image, ImageDraw

ACCENT = (0xC9, 0x71, 0x58)  # --color-accent, dark theme: #C97158
BG = (0x1D, 0x15, 0x12)  # --color-bg, dark theme: #1D1512

def rounded_square(size, radius, fill):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=fill)
    return img

def blend(color, opacity, onto=BG):
    return tuple(round(onto[i] + (color[i] - onto[i]) * opacity) for i in range(3))

def make_icon(size, maskable=False):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg_radius = size if maskable else round(size * 0.22)
    bg = rounded_square(size, bg_radius, BG + (255,))
    canvas.alpha_composite(bg)

    # Three equal-length bars, flush left — a literal, calm mark for
    # "Align": things brought into line with each other, not a scattered
    # multi-color grid. Single hue at graduated opacity for depth instead
    # of extra colors, to stay in a calm/trustworthy register.
    safe = size * (0.6 if maskable else 0.72)
    origin_x = (size - safe) / 2
    origin_y = (size - safe) / 2
    bar_h = safe * 0.16
    gap = safe * 0.26
    radius = round(bar_h * 0.5)
    d = ImageDraw.Draw(canvas)
    for i, opacity in enumerate((1.0, 0.72, 0.48)):
        y = origin_y + i * gap
        color = blend(ACCENT, opacity) + (255,)
        d.rounded_rectangle(
            [origin_x, y, origin_x + safe, y + bar_h],
            radius=radius, fill=color,
        )
    return canvas

import os
out_dir = os.path.join(os.path.dirname(__file__), "..", "public")
os.makedirs(out_dir, exist_ok=True)

make_icon(192).save(os.path.join(out_dir, "icon-192.png"))
make_icon(512).save(os.path.join(out_dir, "icon-512.png"))
make_icon(512, maskable=True).save(os.path.join(out_dir, "icon-512-maskable.png"))
make_icon(180).save(os.path.join(out_dir, "apple-touch-icon.png"))
print("done", ACCENT)
