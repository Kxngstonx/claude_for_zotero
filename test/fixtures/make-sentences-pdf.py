import sys
lines = [
 "Federated learning trains a model across many clients. Each client keeps",
 "its data local. The server aggregates the updates with FedAvg, as in",
 "Fig. 2 of the paper. We study data valuation for this setting. Our",
 "method assigns a score to every client. Scores guide client selection.",
]
ops = ["BT", "/F1 11 Tf", "14 TL", "72 720 Td"]
for i, l in enumerate(lines):
    s = l.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    ops.append(f"({s}) Tj" if i == 0 else f"T* ({s}) Tj")
ops.append("ET")
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
