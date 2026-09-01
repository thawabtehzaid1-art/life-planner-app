"""Generates the PWA app icons from the app's own OKLCH category colors,
so the icon uses exactly the same brand hues as the running app rather
than eyeballed approximations."""
import math
from PIL import Image, ImageDraw

def oklch_to_srgb(L, C, H_deg):
    h = math.radians(H_deg)
    a = C * math.cos(h)
    b = C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_**3, m_**3, s_**3
    r = 4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bl = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    def gamma(c):
        c = max(0.0, min(1.0, c))
        return 12.92*c if c <= 0.0031308 else 1.055*(c**(1/2.4)) - 0.055
    return tuple(max(0, min(255, round(gamma(c) * 255))) for c in (r, g, bl))

ACCENT = oklch_to_srgb(0.734, 0.125, 289)  # violet, matches --color-accent
BG = (22, 24, 38)  # --color-bg #161826

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
