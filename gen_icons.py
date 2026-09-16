import math
from PIL import Image, ImageDraw

CYAN = (0, 255, 212, 255)       # #00FFD4 — plasma cyan, the app's primary accent
PURPLE_HI = (123, 47, 255, 255) # #7B2FFF — ultraviolet plasma purple, secondary accent for the rim highlight
VOID = (3, 1, 10, 255)          # near-black backdrop (matches --bg)

def hexagon(cx, cy, r, rotation=90):
    pts = []
    for i in range(6):
        angle = math.radians(60 * i - rotation)
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    return pts

def draw_glyph(size, bg=True, inset_scale=1.0, corner_radius_frac=0.0):
    """One VeusBid mark: a plasma-cyan hive cell (hexagon) with a bolt
    silhouette cut into it — the jolt of a live bid landing. inset_scale
    shrinks the hex for maskable safe zones."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = cy = size / 2

    if bg:
        if corner_radius_frac > 0:
            d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size * corner_radius_frac, fill=VOID)
        else:
            d.rectangle([0, 0, size, size], fill=VOID)

    r = size * 0.40 * inset_scale
    hexpts = hexagon(cx, cy, r)
    d.polygon(hexpts, fill=CYAN)
    # Thin brighter-purple rim on the upper edges for a touch of dimension at large sizes
    if size >= 96:
        d.line([hexpts[4], hexpts[5], hexpts[0]], fill=PURPLE_HI, width=max(1, int(size * 0.012)), joint="curve")

    # Bolt silhouette, cut out of the hex in the background color — reads
    # instantly as "a live bid just landed" even at 16px.
    bw = r * 0.62
    top = cy - r * 0.68
    bot = cy + r * 0.68
    bolt = [
        (cx + bw * 0.28, top),
        (cx - bw * 0.55, cy + r * 0.06),
        (cx - bw * 0.05, cy + r * 0.06),
        (cx - bw * 0.28, bot),
        (cx + bw * 0.55, cy - r * 0.10),
        (cx + bw * 0.05, cy - r * 0.10),
    ]
    d.polygon(bolt, fill=VOID)

    return img

def save_png(img, path, size):
    img.resize((size, size), Image.LANCZOS).save(path)

sizes_plain = [16, 32, 48, 96, 192, 512]
for s in sizes_plain:
    corner = 0.22 if s >= 96 else 0.0
    im = draw_glyph(max(s, 64), corner_radius_frac=corner)
    save_png(im, f"favicon-{s}.png" if s in (16, 32, 48) else f"icon-{s}.png", s)

# Maskable icons: full-bleed background, glyph inset well within the safe zone
for s in (192, 512):
    im = draw_glyph(max(s, 64), inset_scale=0.72, corner_radius_frac=0.0)
    save_png(im, f"icon-maskable-{s}.png", s)

# Apple touch icon: opaque background, no transparency, slight corner rounding
# left to iOS itself (Apple applies its own mask), so keep square here.
im = draw_glyph(180, corner_radius_frac=0.0)
save_png(im, "apple-touch-icon.png", 180)

# Multi-resolution .ico from the same mark
ico_sizes = [16, 32, 48]
ico_frames = [draw_glyph(s, corner_radius_frac=0.0).resize((s, s), Image.LANCZOS) for s in ico_sizes]
ico_frames[0].save("favicon.ico", format="ICO", sizes=[(s, s) for s in ico_sizes], append_images=ico_frames[1:])

# Replace the stray favicon.jpg (opaque, since JPEG has no alpha) with the same mark
draw_glyph(512, corner_radius_frac=0.0).convert("RGB").save("favicon.jpg", quality=92)

print("done")
