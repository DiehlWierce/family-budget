"""Минимальный ридер .xlsx: только то, что нужно для листа «Годовой бюджет»."""
import zipfile, re
from xml.etree.ElementTree import iterparse
import io

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def col_to_idx(ref):
    m = re.match(r'([A-Z]+)(\d+)', ref)
    letters, row = m.group(1), int(m.group(2))
    c = 0
    for ch in letters:
        c = c * 26 + (ord(ch) - 64)
    return c - 1, row - 1


def idx_to_col(i):
    s = ''
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def read_sheet(path, sheet_name):
    z = zipfile.ZipFile(path)
    wb = z.read('xl/workbook.xml').decode('utf8')
    rels = z.read('xl/_rels/workbook.xml.rels').decode('utf8')
    sheets = re.findall(r'<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"', wb)
    rid = dict(sheets)[sheet_name]
    target = re.search(r'Id="%s"[^>]*Target="([^"]+)"' % rid, rels).group(1)
    target = 'xl/' + target.lstrip('/')

    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        buf = []
        for ev, el in iterparse(io.BytesIO(z.read('xl/sharedStrings.xml')), ('start', 'end')):
            if ev == 'end' and el.tag == NS + 'si':
                shared.append(''.join(t.text or '' for t in el.iter(NS + 't')))
                el.clear()

    cells = {}
    merges = []
    for ev, el in iterparse(io.BytesIO(z.read(target)), ('end',)):
        if el.tag == NS + 'c':
            ref = el.get('r')
            t = el.get('t')
            v = el.find(NS + 'v')
            if t == 'inlineStr':
                val = ''.join(x.text or '' for x in el.iter(NS + 't'))
            elif v is None or v.text is None:
                val = None
            elif t == 's':
                val = shared[int(v.text)]
            elif t == 'str':
                val = v.text
            else:
                try:
                    val = float(v.text)
                except ValueError:
                    val = v.text
            if val is not None and val != '':
                cells[col_to_idx(ref)] = val
            el.clear()
        elif el.tag == NS + 'mergeCell':
            merges.append(el.get('ref'))
            el.clear()
    return cells, merges
