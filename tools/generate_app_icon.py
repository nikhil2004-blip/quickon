from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app.ico"


BASE_SIZE = 256


def _draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (15, 15, 15, 0))
    draw = ImageDraw.Draw(img)

    # Strong dark background so the icon stays readable at tiny Windows sizes.
    bg = (14, 18, 24, 255)
    draw.rounded_rectangle(
        (size * 0.06, size * 0.06, size * 0.94, size * 0.94),
        radius=int(size * 0.20),
        fill=bg,
    )

    pocket = (224, 206, 166, 255)
    deck = (24, 24, 24, 255)
    edge = (255, 255, 255, 28)
    shadow = (0, 0, 0, 85)

    def scale(x: float) -> int:
        return round(x * size / 256)

    # Pocket shadow.
    pocket_points = [
        (scale(48), scale(90)),
        (scale(48), scale(155)),
        (scale(72), scale(202)),
        (scale(128), scale(235)),
        (scale(184), scale(202)),
        (scale(208), scale(155)),
        (scale(208), scale(90)),
        (scale(170), scale(125)),
        (scale(157), scale(138)),
        (scale(144), scale(148)),
        (scale(128), scale(160)),
        (scale(112), scale(148)),
        (scale(99), scale(138)),
        (scale(86), scale(125)),
    ]
    shadow_points = [(x + scale(4), y + scale(5)) for x, y in pocket_points]
    draw.polygon(shadow_points, fill=shadow)

    draw.polygon(pocket_points, fill=pocket)

    cards = [
        (95, 44, 24, 24),
        (137, 44, 24, 24),
        (95, 84, 24, 24),
        (137, 84, 24, 24),
    ]
    for x, y, w, h in cards:
        rect = [scale(x), scale(y), scale(x + w), scale(y + h)]
        draw.rounded_rectangle(rect, radius=max(2, scale(6)), fill=deck)

    # Thin highlight to keep the pocket shape crisp after downscaling.
    draw.rounded_rectangle(
        (scale(48), scale(90), scale(208), scale(235)),
        radius=scale(28),
        outline=edge,
        width=max(1, scale(2)),
    )

    return img


def main() -> None:
    master = _draw_icon(BASE_SIZE)
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(OUT, format="ICO", sizes=sizes)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
