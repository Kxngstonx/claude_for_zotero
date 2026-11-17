# Writes a one-page PDF with a paragraph, a bar chart (vector rectangles),
# a "Figure 1:" caption and a paragraph below it. Used by test/zotero/m4.
import sys


def esc(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def text(x, y, s, size=11):
    return f"BT /F1 {size} Tf {x} {y} Td ({esc(s)}) Tj ET"


ops = [
    text(72, 720, "Federated learning trains a shared model across many clients."),
    text(72, 706, "We compare three aggregation rules on the same benchmark."),
    # chart frame (y 460..660) and bars
    "0 0 0 RG 1 w 90 470 m 90 650 l S 90 470 m 520 470 l S",
    "0.85 0.2 0.2 rg 140 470 80 60 re f",
    "0.2 0.4 0.85 rg 270 470 80 110 re f",
    "0.2 0.65 0.3 rg 400 470 80 170 re f",
    "0 0 0 rg",
    text(160, 455, "Alpha", 10),
    text(295, 455, "Beta", 10),
    text(420, 455, "Gamma", 10),
    text(72, 420, "Figure 1: Final accuracy of Alpha, Beta and Gamma aggregation."),
    text(72, 380, "Gamma reaches the highest accuracy in every run we performed."),
    text(72, 366, "Alpha is the weakest rule and Beta lies in between."),
]
stream = "\n".join(ops).encode()
objs = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]
out = bytearray(b"%PDF-1.4\n")
offs = []
for i, o in enumerate(objs, 1):
    offs.append(len(out))
    out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
x = len(out)
out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
for o in offs:
    out += b"%010d 00000 n \n" % o
out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
open(sys.argv[1], "wb").write(out)
