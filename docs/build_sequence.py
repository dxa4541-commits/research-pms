"""Draws 3 simple sequence diagrams (chapter-8 style) and appends them to the project PDF."""
import sys
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth
import pypdf

TEAL = (.058824, .278431, .380392)   # same title colour as the existing PDF
F, FB = "Helvetica", "Helvetica-Bold"

class D:
    def __init__(self, c): self.c = c
    def title(self, text, y=712):
        self.c.setFillColorRGB(*TEAL); self.c.setFont(F, 20); self.c.drawString(54, y, text); self.c.setFillColorRGB(0, 0, 0)
    def caption(self, text, y, x=306):
        self.c.setFont("Helvetica-Oblique", 10); self.c.setFillColorRGB(.3, .3, .3)
        self.c.drawCentredString(x, y, text); self.c.setFillColorRGB(0, 0, 0)
    def actor(self, x, y, name):
        c = self.c; c.setLineWidth(1); c.circle(x, y - 7, 7)
        c.line(x, y - 14, x, y - 36); c.line(x - 10, y - 21, x + 10, y - 21)
        c.line(x, y - 36, x - 8, y - 48); c.line(x, y - 36, x + 8, y - 48)
        c.setFont(FB, 9); c.drawCentredString(x, y - 60, name)
    def box(self, cx, ytop, name):
        c = self.c; c.setFont(F, 10); w = stringWidth(name, F, 10) + 20
        c.setFillColorRGB(1, 1, 1); c.setLineWidth(1); c.rect(cx - w / 2, ytop - 24, w, 24, fill=1); c.setFillColorRGB(0, 0, 0)
        c.drawCentredString(cx, ytop - 16, name)
        tw = stringWidth(name, F, 10); c.line(cx - tw / 2, ytop - 18, cx + tw / 2, ytop - 18)
    def life(self, x, y1, y2):
        c = self.c; c.setLineWidth(.8); c.setDash(4, 3); c.line(x, y1, x, y2); c.setDash()
    def act(self, x, y1, y2):
        c = self.c; c.setFillColorRGB(1, 1, 1); c.setLineWidth(1); c.rect(x - 5, y2, 10, y1 - y2, fill=1); c.setFillColorRGB(0, 0, 0)
    def _filled(self, x, y, d):
        p = self.c.beginPath(); p.moveTo(x, y); p.lineTo(x - d * 8, y + 3.5); p.lineTo(x - d * 8, y - 3.5); p.close(); self.c.drawPath(p, fill=1, stroke=0)
    def _open(self, x, y, d):
        self.c.setLineWidth(.9); self.c.line(x, y, x - d * 8, y + 3.5); self.c.line(x, y, x - d * 8, y - 3.5)
    def msg(self, x1, x2, y, label, kind="call", frac=.5):
        c = self.c; d = 1 if x2 > x1 else -1; a, b = x1 + 5 * d, x2 - 5 * d
        c.setLineWidth(1)
        if kind == "call": c.line(a, y, b - d * 7, y); self._filled(b, y, d)
        else: c.setDash(4, 3); c.line(a, y, b - d * 7, y); c.setDash(); self._open(b, y, d)
        c.setFont(F, 9); c.drawCentredString(a + (b - a) * frac, y + 4, label)
    def create(self, xfrom, xbox, y, label="create", boxw=40, frac=.5):
        c = self.c; c.setLineWidth(1); a, b = xfrom + 5, xbox - boxw
        c.setDash(4, 3); c.line(a, y, b - 7, y); c.setDash(); self._open(b, y, 1)
        c.setFont(F, 9); c.drawCentredString(a + (b - a) * frac, y + 4, label)
    def selfmsg(self, x, y, label, h=15):
        c = self.c; c.setLineWidth(1); r = x + 5
        c.line(r, y, r + 26, y); c.line(r + 26, y, r + 26, y - h); c.line(r + 26, y - h, r + 7, y - h); self._filled(r, y - h, -1 + 0 if False else 1) if False else None
        p = c.beginPath(); p.moveTo(r, y - h); p.lineTo(r + 8, y - h + 3.5); p.lineTo(r + 8, y - h - 3.5); p.close(); c.drawPath(p, fill=1, stroke=0)
        c.setFont(F, 9); c.drawString(r + 31, y - 4, label)
    def sep(self, y, text, x1=40, x2=765):
        c = self.c; c.setStrokeColorRGB(.55, .55, .55); c.setLineWidth(.8); c.setDash(2, 2); c.line(x1, y, x2, y); c.setDash(); c.setStrokeColorRGB(0, 0, 0)
        c.setFont("Helvetica-BoldOblique", 9.5); c.setFillColorRGB(*TEAL); c.drawString(x1 + 4, y + 4, text); c.setFillColorRGB(0, 0, 0)
    def opt(self, x1, x2, ytop, ybot, guard, gx=None):
        c = self.c; c.setLineWidth(.9); c.rect(x1, ybot, x2 - x1, ytop - ybot)
        c.setFillColorRGB(1, 1, 1); c.rect(x1, ytop - 13, 30, 13, fill=1); c.setFillColorRGB(0, 0, 0)
        c.setFont(F, 8); c.drawString(x1 + 5, ytop - 10, "opt"); c.setFont(F, 9); c.drawString(gx if gx else x1 + 36, ytop - 11, guard)

S, V, C, X4, X5 = 100, 205, 310, 415, 520
TOP, BOT = 650, 270

def frame(d, names, skip_boxes=()):
    d.actor(S, TOP, names[0]); d.life(S, TOP - 66, BOT)
    for x, n in zip((V, C, X4, X5), names[1:]):
        if n and x not in skip_boxes: d.box(x, TOP, n); d.life(x, TOP - 24, BOT)

def page1(d):
    global BOT; BOT = 270
    d.title("Sequence Diagram – Upload new version")
    frame(d, ["Student", ":View", ":Controller", None, ":Repository"], skip_boxes=())
    d.box(X4, 462, ":Submission"); d.life(X4, 438, BOT)
    d.act(S, 583, 297); d.act(V, 583, 297); d.act(C, 553, 322)
    d.msg(S, V, 575, "uploadVersion(file)")
    d.msg(V, C, 545, "Uploadversion(file)")
    d.selfmsg(C, 515, "checkFile(size, type)")
    d.opt(280, 570, 485, 350, "[file is valid]")
    d.create(C, X4, 450)
    d.act(X4, 438, 385); d.act(X5, 415, 395)
    d.msg(X4, X5, 405, "save(file)")
    d.msg(C, V, 330, "result", "ret"); d.msg(V, S, 305, "show new version", "ret")
    d.caption("Use case: Upload new version  («include» Check file)", 240)

def page2(d):
    global BOT; BOT = 372
    d.title("Sequence Diagram – Approve / reject proposal")
    d.actor(S, TOP, "Supervisor"); d.life(S, TOP - 66, BOT)
    for x, n in ((V, ":View"), (C, ":Controller"), (X4, ":Research"), (X5, ":User")): d.box(x, TOP, n); d.life(x, TOP - 24, BOT)
    d.act(S, 583, 397); d.act(V, 583, 397); d.act(C, 553, 422); d.act(X4, 518, 502); d.act(X5, 478, 462)
    d.msg(S, V, 575, "approve / reject")
    d.msg(V, C, 545, "Approve(decision)")
    d.msg(C, X4, 510, "setStatus(status)")
    d.msg(C, X5, 470, "notify(status)", frac=.3)
    d.msg(C, V, 430, "result", "ret"); d.msg(V, S, 405, "show result", "ret")
    d.caption("Use case: Approve / reject proposal  («extend» Request changes)", 340)

def page3(d):
    global BOT; BOT = 372
    d.title("Sequence Diagram – Review version & add notes")
    d.actor(S, TOP, "Supervisor"); d.life(S, TOP - 66, BOT)
    for x, n in ((V, ":View"), (C, ":Controller"), (X5, ":User")): d.box(x, TOP, n); d.life(x, TOP - 24, BOT)
    d.box(X4, 517, ":Note"); d.life(X4, 493, BOT)
    d.act(S, 583, 392); d.act(V, 583, 392); d.act(C, 553, 417); d.act(X4, 493, 477); d.act(X5, 473, 457)
    d.msg(S, V, 575, "writeNote(text)")
    d.msg(V, C, 545, "Addnote(text)")
    d.create(C, X4, 505)
    d.msg(C, X5, 465, "notify(new note)", frac=.3)
    d.msg(C, V, 425, "result", "ret"); d.msg(V, S, 400, "show note", "ret")
    d.caption("Use case: Review version & add notes  («include» Send notification)", 335)


def page_combined(d):
    """One diagram: Upload new version -> Review & add notes -> Approve / reject."""
    ST, SU, VW, CT, SB, RS, NT, US = 55, 145, 265, 375, 475, 565, 650, 740
    top, bot = 700, 100
    d.title("Sequence Diagram \u2013 Research submission and review", 740)
    d.actor(ST, top, "Student"); d.life(ST, top - 66, bot)
    d.actor(SU, top, "Supervisor"); d.life(SU, top - 66, bot)
    for x, n in ((VW, ":View"), (CT, ":Controller"), (RS, ":Research"), (US, ":User")):
        d.box(x, top, n); d.life(x, top - 24, bot)
    # created objects: box appears when the Controller creates them
    d.box(SB, 545, ":Submission"); d.life(SB, 521, bot)
    d.box(NT, 383, ":Note"); d.life(NT, 359, bot)

    d.sep(655, "1  Upload new version (Student)", x1=185)
    d.act(ST, 636, 462); d.act(VW, 636, 462); d.act(CT, 614, 484)
    d.msg(ST, VW, 628, "uploadVersion(file)", frac=.72)
    d.msg(VW, CT, 606, "Uploadversion(file)")
    d.selfmsg(CT, 584, "checkFile(size, type)")
    d.opt(330, 530, 563, 508, "[file is valid]", gx=388)
    d.create(CT, SB, 533, boxw=38); d.act(SB, 521, 509)
    d.msg(CT, VW, 492, "result", "ret"); d.msg(VW, ST, 470, "show new version", "ret", frac=.3)

    d.sep(442, "2  Review version & add notes (Supervisor)")
    d.act(SU, 423, 293); d.act(VW, 423, 293); d.act(CT, 401, 315)
    d.msg(SU, VW, 415, "writeNote(text)")
    d.msg(VW, CT, 393, "Addnote(text)")
    d.create(CT, NT, 371, boxw=22, frac=.62); d.act(NT, 359, 347)
    d.msg(CT, US, 345, "notify(new note)", frac=.12); d.act(US, 353, 337)
    d.msg(CT, VW, 323, "result", "ret"); d.msg(VW, SU, 301, "show note", "ret")

    d.sep(273, "3  Approve / reject proposal (Supervisor)")
    d.act(SU, 254, 128); d.act(VW, 254, 128); d.act(CT, 232, 150)
    d.msg(SU, VW, 246, "approve / reject")
    d.msg(VW, CT, 224, "Approve(decision)")
    d.msg(CT, RS, 202, "setStatus(status)", frac=.25); d.act(RS, 210, 194)
    d.msg(CT, US, 180, "notify(status)", frac=.12); d.act(US, 188, 172)
    d.msg(CT, VW, 158, "result", "ret"); d.msg(VW, SU, 136, "show result", "ret")
    d.caption("Use cases: Upload new version (\u00abinclude\u00bb Check file), Review version & add notes (\u00abinclude\u00bb Send notification), Approve / reject proposal", 70, x=396)

if __name__ == "__main__":
    base, out = sys.argv[1], sys.argv[2]
    tmp = out + ".seq.pdf"
    if len(sys.argv) > 3 and sys.argv[3] == "combined":
        c = canvas.Canvas(tmp, pagesize=(792, 780)); d = D(c); page_combined(d); c.showPage(); c.save()
    else:
        c = canvas.Canvas(tmp, pagesize=(612, 792)); d = D(c)
        for p in (page1, page2, page3): p(d); c.showPage()
        c.save()
    w = pypdf.PdfWriter()
    for src in (base, tmp):
        for pg in pypdf.PdfReader(src).pages: w.add_page(pg)
    w.write(out)
    import os; os.remove(tmp); print("written", out, len(w.pages), "pages")
