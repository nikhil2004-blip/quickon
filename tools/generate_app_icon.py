from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app.ico"


def _draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (15, 15, 15, 0))
    draw = ImageDraw.Draw(img)

    # Background tile with a soft dark fill so the icon reads on light menus.
    bg = (18, 22, 28, 255)
    draw.rounded_rectangle(
        (size * 0.08, size * 0.08, size * 0.92, size * 0.92),
        radius=int(size * 0.18),
        fill=bg,
    )

    pocket = (216, 199, 161, 255)
    deck = (31, 31, 31, 255)
    shadow = (0, 0, 0, 70)

    def scale(x: float) -> int:
        return round(x * size / 512)

    # Pocket shadow.
    pocket_points = [
        (scale(96), scale(180)),
        (scale(96), scale(310)),
        (scale(145), scale(405)),
        (scale(256), scale(470)),
        (scale(367), scale(405)),
        (scale(416), scale(310)),
        (scale(416), scale(180)),
        (scale(340), scale(250)),
        (scale(315), scale(275)),
        (scale(289), scale(295)),
        (scale(256), scale(320)),
        (scale(223), scale(295)),
        (scale(197), scale(275)),
        (scale(172), scale(250)),
    ]
    shadow_points = [(x + scale(8), y + scale(10)) for x, y in pocket_points]
    draw.polygon(shadow_points, fill=shadow)

    draw.polygon(pocket_points, fill=pocket)

    cards = [
        (190, 90, 48, 48),
        (274, 90, 48, 48),
        (190, 170, 48, 48),
        (274, 170, 48, 48),
    ]
    for x, y, w, h in cards:
        rect = [scale(x), scale(y), scale(x + w), scale(y + h)]
        draw.rounded_rectangle(rect, radius=max(2, scale(12)), fill=deck)

    return img


def main() -> None:
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [_draw_icon(size) for size in sizes]
    images[0].save(OUT, format="ICO", sizes=[(size, size) for size in sizes], append_images=images[1:])
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
