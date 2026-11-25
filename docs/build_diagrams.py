"""Generates the updated UML diagrams (SVG -> PNG/PDF via Playwright). Run: python3 build_diagrams.py"""
import math, html

STYLE = """<style>
text{font-family:Arial,Helvetica,sans-serif;fill:#111}
.t{font-size:13px}.s{font-size:11px}.b{font-weight:bold}.h{font-size:20px;fill:#1f4e79;font-family:Arial}
.lbl{paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}
.ln{stroke:#222;stroke-width:1.3;fill:none}.ds{stroke:#222;stroke-width:1.2;fill:none;stroke-dasharray:6 4}
.uc{fill:#fff;stroke:#111;stroke-width:1.3}.cls{fill:#fff;stroke:#111;stroke-width:1.3}.hd{fill:#e6e6e6;stroke:#111;stroke-width:1.3}
</style>
<defs>
<marker id="open" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M1,1 L9,5 L1,9" fill="none" stroke="#222" stroke-width="1.3"/></marker>
<marker id="gen" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto"><path d="M1,1 L12,7 L1,13 Z" fill="#fff" stroke="#222" stroke-width="1.3"/></marker>
<marker id="arr" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M1,1 L9,5 L1,9 Z" fill="#222"/></marker>
</defs>"""

def T(x, y, s, cls="t", anchor="middle"):
    return f'<text x="{x}" y="{y}" class="{cls}" text-anchor="{anchor}">{html.escape(s)}</text>'

# ---------------------------------------------------------------- USE CASE
def usecase():
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1490" width="1000" height="1490"><rect width="1000" height="1490" fill="#fff"/>{STYLE}']
    o.append(T(40, 30, "Use Case Diagram", "h", "start"))
    cases = {}
    RY = 30
    def uc(key, cx, cy, lines, rx=105):
        cases[key] = (cx, cy, rx)
        s = f'<ellipse class="uc" cx="{cx}" cy="{cy}" rx="{rx}" ry="{RY}"/>'
        y0 = cy + 4 - (len(lines) - 1) * 8
        for i, l in enumerate(lines): s += T(cx, y0 + i * 16, l)
        return s
    def clip(key, p):
        cx, cy, rx = cases[key]; dx, dy = p[0] - cx, p[1] - cy
        t = 1 / math.sqrt((dx / rx) ** 2 + (dy / RY) ** 2); return cx + dx * t, cy + dy * t
    def actor(x, y, name, label_lines=None, lx=None):
        s = (f'<circle cx="{x}" cy="{y}" r="11" fill="#fff" stroke="#111" stroke-width="1.5"/>'
             f'<path d="M{x},{y+11} V{y+45} M{x-22},{y+25} H{x+22} M{x},{y+45} L{x-16},{y+72} M{x},{y+45} L{x+16},{y+72}" class="ln" stroke-width="1.5"/>')
        if lx is not None: return s + T(lx, y + 50, name, "t b", "end")
        for i, l in enumerate(label_lines or [name]): s += T(x, y + 90 + i * 16, l, "t b")
        return s
    def center(key): return cases[key][:2]
    def assoc(p, key):
        a = clip(key, center(key) if False else p); return f'<line class="ln" x1="{p[0]}" y1="{p[1]}" x2="{a[0]:.1f}" y2="{a[1]:.1f}"/>'
    def dashed(k1, k2, label, above=False):
        (x1, y1), (x2, y2) = center(k1), center(k2)
        a, b = clip(k1, (x2, y2)), clip(k2, (x1, y1))
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        t = T(mx, my - 8, label, "s lbl") if above else T(mx + 8, my + 4, label, "s lbl", "start")
        return f'<line class="ds" x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" marker-end="url(#open)"/>' + t

    o.append('<rect x="150" y="150" width="700" height="1310" fill="none" stroke="#111" stroke-width="1.5"/>')
    o.append(T(500, 175, "Research Project Management System", "t b"))
    o += [uc("login", 320, 235, ["Log in"], 85), uc("pwd", 680, 235, ["Change password"], 85),
          uc("notif", 410, 315, ["View notifications"], 85), uc("dl", 590, 315, ["Download file"], 85),
          uc("submit", 300, 410, ["Submit research"]), uc("upload", 300, 600, ["Upload new", "version"]),
          uc("check", 300, 700, ["Check file", "(size and type)"]), uc("status", 300, 500, ["View status", "& feedback"]),
          uc("approve", 700, 410, ["Approve / reject", "proposal"]), uc("changes", 700, 500, ["Request", "changes"]),
          uc("review", 700, 600, ["Review version", "& add notes"]), uc("send", 700, 700, ["Send notification"]),
          uc("grade", 700, 800, ["Grade submission"]), uc("mystu", 700, 890, ["View my students"]),
          uc("teams", 700, 985, ["Form teams"]),
          uc("users", 690, 1090, ["Manage users"], 100), uc("auth", 690, 1170, ["Assign authorization"], 100),
          uc("courses", 690, 1250, ["Manage courses"], 100), uc("deadline", 690, 1330, ["Set deadlines"], 100),
          uc("reports", 690, 1410, ["View progress reports", "(all research projects)"], 100),
          uc("overdue", 390, 1410, ["Identify", "overdue research"])]
    o += [dashed("upload", "check", "«include»"), dashed("changes", "approve", "«extend»"),
          dashed("review", "send", "«include»"), dashed("reports", "overdue", "«include»", above=True)]
    # extra includes found while checking against the code
    # Submit research also includes Check file (checkFile is called in submitResearch)
    o.append('<path class="ds" d="M405,410 H440 V700 H405" marker-end="url(#open)"/>')
    o.append(T(446, 560, "«include»", "s lbl", "start"))
    # Approve / reject also includes Send notification (status change -> notify, requirement 10)
    o.append('<path class="ds" d="M595,410 H560 V700 H595" marker-end="url(#open)"/>')
    o.append(T(554, 560, "«include»", "s lbl", "end"))
    # note: remaining triggers
    o.append('<path d="M425,770 H575 L590,785 V850 H425 Z" fill="#fff" stroke="#111" stroke-width="1.2"/><path d="M575,770 V785 H590" fill="none" stroke="#111" stroke-width="1.2"/>')
    for i, l in enumerate(["Send notification is also", "triggered by: submit research,", "upload version, add note,", "grade, form team, set deadline"]):
        o.append(T(432, 788 + i * 15, l, "s", "start"))
    o.append('<line class="ds" x1="560" y1="770" x2="640" y2="726"/>')
    # actors
    o.append(actor(500, 40, "User", lx=476))
    o.append(actor(70, 475, "Student"))
    o.append(actor(940, 700, "Supervisor", ["Supervisor", "(Doctor)"]))
    o.append(actor(940, 1225, "Admin"))
    for k in ("login", "pwd", "notif", "dl"): o.append(assoc((500, 112), k))
    for k in ("submit", "upload", "status"): o.append(assoc((82, 500), k))
    for k in ("approve", "review", "grade", "mystu", "teams"): o.append(assoc((928, 725), k))
    for k in ("users", "auth", "courses", "deadline", "reports", "teams"): o.append(assoc((928, 1250), k))
    # generalizations: Student / Supervisor / Admin are kinds of User
    o.append('<path class="ln" d="M70,461 V78 H496" marker-end="url(#gen)"/>')
    o.append('<path class="ln" d="M940,686 V78 H504" marker-end="url(#gen)"/>')
    o.append('<path class="ln" d="M940,1211 V1190 H978 V78 H940"/>')
    o.append(T(62, 300, "is-a", "s", "end"))
    o.append('</svg>')
    return "\n".join(o)

# ---------------------------------------------------------------- CLASS
def classdiagram():
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1480" width="1000" height="1480"><rect width="1000" height="1480" fill="#fff"/>{STYLE}']
    o.append(T(40, 28, "Class Diagram", "h", "start"))
    boxes = {}
    def box(key, x, y, w, title, rows, hdh=30, rh=21):
        h = hdh + max(1, len(rows)) * rh + 8; boxes[key] = (x, y, w, h)
        s = f'<rect class="cls" x="{x}" y="{y}" width="{w}" height="{h}"/><rect class="hd" x="{x}" y="{y}" width="{w}" height="{hdh}"/>'
        s += T(x + w / 2, y + 20, title, "t b")
        for i, r in enumerate(rows): s += T(x + 10, y + hdh + 17 + i * rh, r, "s", "start")
        return s
    def cont(x, y, w, h, title):
        return f'<rect fill="none" stroke="#111" stroke-width="1.3" x="{x}" y="{y}" width="{w}" height="{h}"/><rect class="hd" x="{x}" y="{y}" width="{w}" height="30"/>' + T(x + w / 2, y + 20, title, "t b")
    def edge(k, side, f=.5):
        x, y, w, h = boxes[k]
        return {"t": (x + w * f, y), "b": (x + w * f, y + h), "l": (x, y + h * f), "r": (x + w, y + h * f)}[side]
    def line(p, q, m1="", m2="", name="", arrow=False, **_):
        s = f'<line class="ln" x1="{p[0]:.0f}" y1="{p[1]:.0f}" x2="{q[0]:.0f}" y2="{q[1]:.0f}"{" marker-end=\"url(#arr)\"" if arrow else ""}/>'
        L = math.hypot(q[0] - p[0], q[1] - p[1]) or 1
        ux, uy = (q[0] - p[0]) / L, (q[1] - p[1]) / L
        nx, ny = uy, -ux  # side normal: above for left->right lines, right for downward lines
        def at(pt, sgn, txt): return T(pt[0] + sgn * ux * 22 + nx * 12, pt[1] + sgn * uy * 22 + ny * 12 + 4, txt, "s lbl")
        if m1: s += at(p, 1, m1)
        if m2: s += at(q, -1, m2)
        if name: s += T((p[0] + q[0]) / 2 - nx * 13, (p[1] + q[1]) / 2 - ny * 13 + 4, name, "s lbl")
        return s
    # --- MVC layers (as in the original diagram)
    o.append(box("client", 80, 55, 170, "client", ["browser (HTML/JS)"]))
    o.append(box("server", 420, 55, 170, "server", ["routing + role check"]))
    o.append(box("view", 80, 175, 250, "view", ["pages (student/supervisor/admin)", "login", "notifications bell", "Arabic RTL / English switch"]))
    ctl = ["login()", "changePassword()", "submitResearch()", "uploadVersion()", "checkFile()", "decide()  // approve/reject/changes",
           "addNote()", "grade()", "formTeam()", "setDeadline()", "manageUsers()  // + assign role", "reports()", "notify()"]
    o.append(box("ctl", 420, 175, 300, "controller", ctl, rh=19))
    o.append(line(edge("client", "r"), edge("server", "l"), arrow=True))
    o.append(f'<line class="ln" x1="165" y1="{boxes["client"][1]+boxes["client"][3]}" x2="165" y2="175"/>')
    o.append(line(edge("server", "b", .35), (505, 175), arrow=True))
    o.append(line(edge("ctl", "l", .2), edge("view", "r", .45), arrow=True))
    # --- model
    MY = 520
    o.append(cont(20, MY, 960, 670, "model"))
    o.append(box("course", 40, 580, 170, "Course", ["id", "name"]))
    o.append(box("team", 300, 580, 170, "Team", ["id", "name"]))
    o.append(box("user", 590, 580, 170, "User", ["id", "name", "email", "role  // student|supervisor|admin"], rh=21))
    boxes["user"] = (590, 580, 200, boxes["user"][3]); o[-1] = o[-1].replace('width="170"', 'width="200"')
    o.append(box("notif", 855, 580, 115, "Notification", ["message", "isRead", "createdAt"]))
    o.append(box("session", 855, 740, 115, "Session", ["token", "createdAt"]))
    o.append(box("research", 300, 820, 170, "Research", ["id", "title", "status", "deadline", "createdAt"]))
    o.append(box("sub", 300, 1040, 170, "Submission", ["versionNo", "filename", "size", "createdAt"]))
    o.append(box("grade", 40, 1040, 170, "Grade", ["score  // 0..100"]))
    o.append(box("note", 590, 1040, 170, "Note", ["text", "createdAt"]))
    # associations with multiplicities
    o.append(line(edge("course", "r", .4), edge("team", "l", .4), "1", "*"))
    o.append(line(edge("team", "r", .4), edge("user", "l", .3), "0..1", "*", "members"))
    o.append(line(edge("course", "b", .5), edge("research", "l", .3), "1", "*"))
    o.append(line(edge("team", "b", .5), edge("research", "t", .5), "0..1", "0..1"))
    o.append(line(edge("user", "b", .08), edge("research", "r", .25), "1", "*", "student"))
    o.append(line(edge("user", "b", .30), edge("research", "r", .70), "1", "*", "supervisor"))
    o.append(line(edge("research", "b"), edge("sub", "t"), "1", "*"))
    o.append(line(edge("sub", "l", .5), edge("grade", "r", .5), "1", "0..1"))
    o.append(line(edge("sub", "r", .5), edge("note", "l", .5), "1", "*"))
    o.append(line(edge("user", "b", .85), edge("note", "t", .85), "1", "*", "author"))
    o.append(line(edge("user", "r", .3), edge("notif", "l", .3), "1", "*"))
    o.append(line(edge("user", "r", .75), edge("session", "l", .5), "1", "*"))
    o.append(T(980 - 20, 1175, "Student / Supervisor / Admin are the values of User.role", "s", "end"))
    # model -> controller, model -> repository
    o.append(line((570, 175 + boxes["ctl"][3]), (570, MY), arrow=True))
    RY = 1230
    o.append(cont(20, RY, 960, 150, "Repository"))
    o.append(box("db", 120, 1285, 280, "database", ["SQL (SQLite): users, courses, teams,", "research, submissions, grades, notes,", "notifications, sessions"], hdh=26, rh=17))
    o.append(box("fs", 560, 1285, 280, "Filestore", ["uploaded files (random names:", "versions are never overwritten)"], hdh=26, rh=17))
    o.append(line((500, MY + 670), (500, RY), arrow=True))
    o.append('</svg>')
    return "\n".join(o)

open("use-case-diagram.svg", "w").write(usecase())
open("class-diagram.svg", "w").write(classdiagram())
print("svg written")
