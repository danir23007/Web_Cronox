"""Regenerate the product placeholder's accessible Cormorant Garamond caption.

Install fonttools[woff] to run this optional asset-generation script. The SVG is
used as an <img>, where browsers cannot load an external webfont. Only this own
caption is outlined; brand artwork and font binaries are never modified.
The official source font and SIL OFL license are in assets/fonts/cormorant-garamond.
"""

from pathlib import Path
import argparse
import os

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/fonts/cormorant-garamond/cormorant-garamond-normal-latin-v21.woff2"
CAPTION = "Imagen no disponible"


def generate(spacing_font):
    font = instantiateVariableFont(TTFont(SOURCE), {"wght": 500})
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = 26 / font["head"].unitsPerEm
    # The original caption used Arial. Keep its space advance while outlining
    # only the Cormorant letters; the system font is read locally, never copied.
    spacing = TTFont(spacing_font)
    space_glyph = spacing.getBestCmap()[ord(" ")]
    space_width = spacing["hmtx"][space_glyph][0] * 26 / spacing["head"].unitsPerEm
    advances = [space_width if char.isspace() else glyphs[cmap[ord(char)]].width * scale for char in CAPTION]
    width = sum(advances)
    x = 300 - width / 2
    pen = SVGPathPen(glyphs, ntos=lambda value: f"{value:.2f}".rstrip("0").rstrip("."))
    for char, advance in zip(CAPTION, advances):
        glyph = glyphs[cmap[ord(char)]]
        glyph.draw(TransformPen(pen, (scale, 0, 0, -scale, x, 564)))
        x += advance
    output = f'''<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750" viewBox="0 0 600 750" role="img" aria-label="{CAPTION}">
  <!-- Cormorant Garamond 500 letters and original Arial spacing; regenerate with scripts/generate-product-placeholder.py. -->
  <title>{CAPTION}</title>
  <rect width="600" height="750" fill="#181818"/>
  <rect x="102" y="212" width="396" height="302" fill="none" stroke="#777" stroke-width="3"/>
  <path d="M150 450l90-96 66 65 64-76 80 107" fill="none" stroke="#777" stroke-width="3"/>
  <circle cx="399" cy="293" r="25" fill="none" stroke="#777" stroke-width="3"/>
  <path fill="#bbb" d="{pen.getCommands()}"/>
</svg>
'''
    (ROOT / "assets/customer-product-image-unavailable.svg").write_text(output, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spacing-font", type=Path, default=Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts/arial.ttf", help="Locally installed original Arial font; never distributed")
    generate(parser.parse_args().spacing_font)
