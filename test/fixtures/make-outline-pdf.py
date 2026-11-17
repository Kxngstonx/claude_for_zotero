# Writes a 4-page PDF with headings and a PDF outline (bookmarks):
#   1 Introduction (p.1), 2 Method (p.2) > 2.1 Model (p.3), 3 Experiments (p.4)
# 2.1 starts mid-page 3 after the end of the method overview text.
# Used by test/zotero/m5.
import sys

PAGES = [
    ["1 Introduction", "Federated learning trains models without sharing data.",
     "We study client valuation. The magic word for this section is APPLE."],
    ["2 Method", "Our method scores each client by its marginal contribution.",
     "The method section keyword is BANANA."],
    ["The overview of the method continues here on page three.",
     "2.1 Model", "The model uses a two layer network. Keyword CHERRY."],
    ["3 Experiments", "We evaluate on CIFAR-10 with 100 clients.",
     "Results are in Table 1. Keyword DURIAN."],
]
OUTLINE = [  # title, page index, y, level
    ("1 Introduction", 0, 720, 1),
    ("2 Method", 1, 720, 1),
    ("2.1 Model", 2, 692, 2),
    ("3 Experiments", 3, 720, 1),
]


def esc(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


objs = {}
n_pages = len(PAGES)
# ids: 1 catalog, 2 pages, 3 font, 4 outlines root, pages 10+2i, contents 11+2i, items 50+
objs[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
kids = []
for i, lines in enumerate(PAGES):
    pid, cid = 10 + 2 * i, 11 + 2 * i
    kids.append(f"{pid} 0 R")
    ops = []
    y = 720
    for line in lines:
        size = 14 if line[:1].isdigit() and len(line) < 20 else 11
        ops.append(f"BT /F1 {size} Tf 72 {y} Td ({esc(line)}) Tj ET")
        y -= 28
    stream = "\n".join(ops).encode()
    objs[cid] = b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"
    objs[pid] = (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {cid} 0 R "
                 f"/Resources << /Font << /F1 3 0 R >> >> >>").encode()
objs[2] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {n_pages} >>".encode()

# outline: top-level 1, 2, 3; 2 has child 2.1
items = {50: 0, 51: 1, 52: 2, 53: 3}  # obj id -> OUTLINE index


def dest(i):
    _, page, y, _ = OUTLINE[i]
    return f"[{10 + 2 * page} 0 R /XYZ 72 {y} 0]"


objs[50] = f"<< /Title ({esc(OUTLINE[0][0])}) /Parent 4 0 R /Next 51 0 R /Dest {dest(0)} >>".encode()
objs[51] = (f"<< /Title ({esc(OUTLINE[1][0])}) /Parent 4 0 R /Prev 50 0 R /Next 53 0 R "
            f"/First 52 0 R /Last 52 0 R /Count 1 /Dest {dest(1)} >>").encode()
objs[52] = f"<< /Title ({esc(OUTLINE[2][0])}) /Parent 51 0 R /Dest {dest(2)} >>".encode()
objs[53] = f"<< /Title ({esc(OUTLINE[3][0])}) /Parent 4 0 R /Prev 51 0 R /Dest {dest(3)} >>".encode()
objs[4] = b"<< /Type /Outlines /First 50 0 R /Last 53 0 R /Count 4 >>"
objs[1] = b"<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R /PageMode /UseOutlines >>"

max_id = max(objs)
out = bytearray(b"%PDF-1.4\n")
offs = {}
for i in range(1, max_id + 1):
    if i not in objs:
        continue
    offs[i] = len(out)
    out += b"%d 0 obj\n" % i + objs[i] + b"\nendobj\n"
x = len(out)
out += b"xref\n0 %d\n0000000000 65535 f \n" % (max_id + 1)
for i in range(1, max_id + 1):
    out += (b"%010d 00000 n \n" % offs[i]) if i in offs else b"0000000000 65535 f \n"
out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (max_id + 1, x)
open(sys.argv[1], "wb").write(out)
