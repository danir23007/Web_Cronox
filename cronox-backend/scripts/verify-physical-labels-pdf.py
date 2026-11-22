"""Inspect actual PDF pages and render them at 300 dpi for independent decoding."""
import json
import sys
from pathlib import Path
import pymupdf as fitz

folder = Path(sys.argv[1]).resolve()
report = []
for filename, height, codes, side, end, visible_id in [
    ('brother-50x35.pdf', 35, ['CRX0000000001'] * 3 + ['CRX2147483647'], 1.55, 3, True),
    ('template-edited-50x40.pdf', 40, ['CRX0000000001'], 1.55, 4, False),
]:
    pdf = fitz.open(folder / filename)
    assert len(pdf) == len(codes), (filename, 'Wrong page count')
    for index, (page, code) in enumerate(zip(pdf, codes)):
        assert abs(page.rect.width * 25.4 / 72 - 50) < .01
        assert abs(page.rect.height * 25.4 / 72 - height) < .01
        if visible_id:
            assert code in page.get_text(), (filename, index, page.get_text())
        else:
            assert code not in page.get_text()
            assert 'SERIE LOCAL' in page.get_text()
        assert not page.get_images(), 'PDF contains rasterized content'
        ink = [d for d in page.get_drawings() if d['fill'] and max(d['fill']) < .1]
        assert sum(len(d['items']) for d in ink) > 20, 'Empty page or no vector bars'
        for rect in [d['rect'] for d in ink]:
            assert rect.x0 >= side * 72 / 25.4 - .1
            assert rect.x1 <= (50 - side) * 72 / 25.4 + .1
            assert rect.y0 >= end * 72 / 25.4 - .1
            assert rect.y1 <= (height - end) * 72 / 25.4 + .1
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                assert abs(line['dir'][0] - 1) < .0001 and abs(line['dir'][1]) < .0001, 'Printed text must stay horizontal'
                for span in line['spans']:
                    x0, y0, x1, y1 = span['bbox']
                    assert x0 >= side * 72 / 25.4 - .2
                    assert x1 <= (50 - side) * 72 / 25.4 + .2
                    assert y0 >= end * 72 / 25.4 - .2
                    assert y1 <= (height - end) * 72 / 25.4 + .2
        png = folder / f'{filename}-{index + 1}-300dpi.png'
        page.get_pixmap(dpi=300, alpha=False).save(png)
        report.append({'file': filename, 'page': index + 1, 'widthMm': 50, 'heightMm': height, 'identifier': code, 'png': png.name, 'vector': True})
(folder / 'pdf-inspection.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({'ok': True, 'pages': len(report), 'dimensions': '50x35 / 50x40 mm', 'rasterImages': 0}))
