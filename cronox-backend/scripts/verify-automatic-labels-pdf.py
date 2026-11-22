"""Inspect actual automatic PDF pages and rasterize for independent decoding."""
import json
import sys
from pathlib import Path
import pymupdf as fitz

folder = Path(sys.argv[1]).resolve()
report = []
mm = 72 / 25.4
for case_index, case in enumerate(json.loads((folder / 'cases.json').read_text(encoding='utf-8'))):
    pdf = fitz.open(case['file'])
    assert len(pdf) == len(case['lines']), 'Incorrect quantity or blank pages'
    for index, (page, expected) in enumerate(zip(pdf, case['lines'])):
        assert abs(page.rect.width / mm - 62) < .01
        assert abs(page.rect.height / mm - 35) < .01
        assert page.rotation == 0
        text = page.get_text()
        for value in ['CRONOX', 'COLOUR: ' + expected['color'], 'SIZE: ' + expected['size'], expected['code']]:
            assert value in text, (value, text)
        assert not page.get_images(), 'Raster images in vector PDF'
        assert 'http' not in text and 'A4' not in text
        rows = []
        spans = []
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                assert abs(line['dir'][0] - 1) < .00001 and abs(line['dir'][1]) < .00001
                for span in line['spans']:
                    spans.append(span)
                    if span['text'].strip().startswith(('CRONOX:', 'COLOUR:', 'SIZE:')):
                        assert abs(span['origin'][0] - spans[0]['origin'][0]) < .02, span
                    elif span['text'] == expected['code']:
                        assert abs((span['bbox'][0] + span['bbox'][2]) / 2 / mm - 31) < .02, span
                    assert span['bbox'][2] / mm <= 60.45 + .05
                    assert span['bbox'][1] / mm >= 3 - .02
                    assert span['bbox'][3] / mm <= 32 + .02, 'Bottom clearance lost'
                    rows.append(span['origin'][1])
        assert len(rows) == 5 and rows == sorted(rows), rows
        assert abs(rows[0] - rows[1]) < .01, 'Brand and product must share a baseline'
        assert spans[0]['text'].startswith('CRONOX:') and spans[0]['flags'] & 16
        assert all(not (s['flags'] & 16) for s in spans[1:]), 'Only the brand should be bold'
        assert all(abs(s['size'] - 6.5) < .01 for s in spans[1:4])
        assert text == text.upper(), 'All label text must be uppercase'
        ink = [d for d in page.get_drawings() if d['fill'] and max(d['fill']) < .1]
        assert sum(len(d['items']) for d in ink) > 20
        brand_chars = next(s['chars'] for b in page.get_text('rawdict')['blocks'] for l in b.get('lines', []) for s in l['spans'] if ''.join(c['c'] for c in s['chars']).startswith('CRONOX:'))
        # PDF path bounds describe stroke centerlines; include the stroke's
        # half-width to locate the actual black edge, as with the SVG proof.
        first_black_x = min(d['rect'].x0 - (d['width'] / 2 if d['color'] is not None and max(d['color']) < .1 else 0) for d in ink)
        assert brand_chars[1]['c'] == 'R'
        # MuPDF reports an averaged stroke width under the symbol's affine
        # transform. Confirm its edge independently in the 300 dpi rendering.
        assert abs(brand_chars[1]['origin'][0] - first_black_x) / mm < .05, 'R must align with the first actual black bar'
        assert brand_chars[0]['origin'][0] < first_black_x, 'C must precede the first bar'
        raster = page.get_pixmap(dpi=300, alpha=False)
        middle_y = round((min(d['rect'].y0 for d in ink) + max(d['rect'].y1 for d in ink)) / 2 * 300 / 72)
        pixels = raster.samples
        first_black_pixel = next(x for x in range(raster.width) if max(pixels[(middle_y * raster.width + x) * raster.n:(middle_y * raster.width + x) * raster.n + 3]) < 128)
        assert abs(brand_chars[1]['origin'][0] * 300 / 72 - first_black_pixel) < 1.5, 'R does not align with the rendered first bar'
        for drawing in ink:
            r = drawing['rect']
            # Eleven quiet modules at each side, never cropped or scaled.
            assert r.x0 / mm >= 7.6 + 3.3 - .02
            assert r.x1 / mm <= 7.6 + 46.8 - 3.3 + .02
            assert abs(r.height / mm - 10) < .01
            assert r.y0 / mm >= 3 and r.y1 / mm <= 32
        png = folder / f'pdf-{case_index + 1}-{index + 1}-300dpi.png'
        raster.save(png)
        report.append({'png': str(png), 'code': expected['code']})
(folder / 'inspection.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({'ok': True, 'pages': len(report), 'paperMm': [62, 35]}))
