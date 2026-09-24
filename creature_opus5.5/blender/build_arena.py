"""Arena set dressing for the Still Water. Every piece has a job:
  - salt columns: compass landmarks at the arena rim (distinct shapes per direction)
  - the predecessor: a dead Halcyon half-sunk behind the boss, the focal backdrop and a hint of a cycle
  - pilgrim poles: a leading line from the spawn toward the fight, and human-scale references
  - horizon mesas: break the horizon line so the mirror has something to reflect
  - spire: phase-2 attack prop
Blender space: +Y is "north" (three.js -Z). Player spawns south (Y=-26), boss starts at Y=+8.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib, lib
importlib.reload(lib)
from lib import *

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
reset()
rnd = random.Random(21)

SALT_LO = (0.42, 0.40, 0.50)
SALT_HI = (0.93, 0.90, 0.96)
BONE_D = (0.20, 0.19, 0.23)
BONE_L = (0.55, 0.51, 0.54)
WOOD = (0.16, 0.12, 0.09)
MARI = (0.95, 0.55, 0.1)

M_SALT = material('AR_Salt', (1, 1, 1), rough=0.35)
M_BONE = material('AR_Bone', (1, 1, 1), rough=0.5)
M_WOOD = material('AR_Wood', (1, 1, 1), rough=0.9)
M_RIDGE = material('AR_Ridge', (1, 1, 1), rough=1.0)
objs = []


def salt_col(h):
    def f(co):
        t = clamp(co.z / max(h, 1e-3))
        return mixc(SALT_LO, SALT_HI, 0.25 + 0.75 * t ** 0.6)
    return f


def mixc(a, b, t, alpha=0.0):
    t = clamp(t)
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, alpha)


def column(mb, base, axis, r, h, tip=0.4):
    """One salt column; colour graded wet-dark at the waterline to bright at the top."""
    start = len(mb.verts)
    mb.prism(base + V(0, 0, -0.6), axis, r, h, tip=tip, rnd=rnd, roll=rnd.random() * 6, taper=0.85 + 0.1 * rnd.random(),
             tip_offset=rnd.uniform(-0.4, 0.4))
    for i in range(start, len(mb.verts)):
        z = mb.verts[i].z
        mb.colors[i] = mixc(SALT_LO, SALT_HI, 0.2 + 0.8 * clamp(z / (h * 0.9)) ** 0.55)


def cluster(name, center, spec):
    mb = MeshBuilder()
    for (dx, dy, r, h, lean_x, lean_y) in spec:
        ax = V(lean_x, lean_y, 1).normalized()
        column(mb, Vector(center) + V(dx, dy, 0), ax, r, h)
    ob = mb.build(name, [M_SALT])
    objs.append(ob)
    return ob


# NE: the Needle (single tall column + two broken stubs)
cluster('Salt_Needle', (30, 40, 0), [(0, 0, 1.6, 17, 0.06, -0.04), (2.6, 1.2, 0.9, 5, 0.2, 0.1), (-1.8, 2.0, 0.7, 2.6, -0.3, 0.2)])
# W: the Organ (tight cluster of stepped columns)
cluster('Salt_Organ', (-46, 12, 0), [(0, 0, 1.4, 9.5, 0, 0), (2.2, 0.6, 1.2, 7.5, 0.05, 0), (-2.0, 1.0, 1.1, 6.5, -0.05, 0),
                                     (0.6, 2.4, 1.0, 5.5, 0, 0.05), (1.0, -2.1, 1.0, 4.5, 0, -0.05), (3.8, -0.8, 0.8, 3.2, 0.1, 0),
                                     (-3.5, -1.2, 0.8, 2.4, -0.1, 0)])
# E: the Broken Ring (low, walkable scale)
cluster('Salt_Ring', (44, -14, 0), [(3.5 * math.cos(a), 3.5 * math.sin(a), 0.8, 2.0 + 2.5 * rnd.random(),
                                     0.25 * math.cos(a), 0.25 * math.sin(a)) for a in [i * 1.1 for i in range(6)]])
# SW: the Leaning Pair
cluster('Salt_Pair', (-30, -38, 0), [(0, 0, 1.3, 11, 0.35, 0.1), (3.0, -1.0, 1.1, 9, -0.32, -0.05), (1.2, 1.5, 0.6, 2.5, 0, 0)])
# N-far: scattered distant columns framing the predecessor
cluster('Salt_Far', (0, 0, 0), [(x, y, r, h, rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1)) for x, y, r, h in
                                 [(-58, 70, 2.2, 14), (52, 80, 1.8, 10), (70, 30, 2.0, 12), (-75, -10, 2.4, 16),
                                  (-60, 95, 1.6, 7), (85, -50, 2.5, 18), (-40, -85, 1.8, 9)]])

# ------------------------------------------------------------ the predecessor
mb = MeshBuilder()
SK = V(-15, 58, 0)
skull_dir = V(0.35, -1, 0.0).normalized()      # faces the arena
Rs = skull_dir.to_track_quat('Y', 'Z').to_matrix()


def bone_col(d, co):
    t = clamp(co.z / 5.0)
    return mixc(BONE_D, BONE_L, 0.35 + 0.65 * t)


mb.ellipsoid(SK + V(0, 0, 0.6), (2.4, 4.6, 2.2), rot=Rs @ Euler((0.0, 0.25, 0.0)).to_matrix(), seg=22, rings=14,
             color_fn=bone_col, shape_fn=lambda d: 1 + 0.15 * clamp(-d.y) - 0.18 * clamp(d.y - 0.4))
# eye socket rims (dark hollows)
for sx in (1, -1):
    c = SK + Rs @ V(2.05 * sx, 1.6, 1.3)
    mb.ellipsoid(c, (0.5, 1.1, 0.6), rot=Rs, seg=12, rings=6, color_fn=lambda d, co: (0.03, 0.03, 0.05, 0))
# beak jutting up out of the water like a broken mast
b0 = SK + Rs @ V(0, 4.0, 0.8)
b1 = b0 + (skull_dir * 0.55 + V(0, 0, 0.84)).normalized() * 15
mb.tube(catmull([b0, b0.lerp(b1, 0.5) + V(0, 0, 0.3), b1], 10), lambda u: 1.1 * (1 - u) ** 0.9 + 0.02, sides=12,
        profile=lambda th, u: (0.75, 1.0), color_fn=lambda u, th, co: mixc(BONE_D, BONE_L, 0.5 + 0.5 * u), cap0=False)
# lower mandible lying in the water
l1 = b0 + (skull_dir + V(0.3, 0, 0.02)).normalized() * 11
mb.tube(catmull([b0 + V(0, 0, -0.5), b0.lerp(l1, 0.5) + V(0, 0, -0.1), l1 + V(0, 0, -0.3)], 8),
        lambda u: 0.7 * (1 - u) + 0.02, sides=10, profile=lambda th, u: (0.7, 0.6),
        color_fn=lambda u, th, co: mixc(BONE_D, BONE_L, 0.4 + 0.3 * u), cap0=False)
# crest plumes, fossilised
for i in range(3):
    base = SK + Rs @ V((i - 1) * 0.8, -3.6, 1.6)
    tip = base + (Rs @ V((i - 1) * 0.6, -1, 0.35)).normalized() * (8 - abs(i - 1) * 2)
    mb.tube(catmull([base, base.lerp(tip, 0.5) + V(0, 0, 0.7), tip + V(0, 0, -0.8)], 6), lambda u: 0.35 * (1 - u) + 0.02,
            sides=6, color_fn=lambda u, th, co: mixc(BONE_D, BONE_L, 0.6))
# leg needles: long thin bones standing out of the water at angles (echo the boss legs)
for (x, y, lx, ly, L, r) in [(6, 70, 0.3, 0.1, 24, 0.55), (20, 60, -0.45, 0.2, 20, 0.5), (-34, 48, 0.55, 0.15, 21, 0.5),
                             (-24, 74, 0.25, -0.35, 18, 0.45)]:
    base = V(x, y, -1.0)
    d = V(lx, ly, 1).normalized()
    knee = base + d * L * 0.62 + V(0, 0, 0)
    tip = knee + (d + V(lx * 1.8, ly * 1.2, -0.4)).normalized() * L * 0.38
    mb.tube(catmull([base, knee], 6), lambda u, r=r: r * (1.0 - 0.45 * u), sides=10, color_fn=lambda u, th, co: mixc(BONE_D, BONE_L, 0.3 + 0.6 * u))
    mb.ellipsoid(knee, (r * 0.95, r * 0.95, r * 1.2), seg=10, rings=6, color_fn=lambda d, co: (*BONE_L, 0))
    mb.tube(catmull([knee, tip], 6), lambda u, r=r: r * 0.55 * (1 - u) + 0.02, sides=8, color_fn=lambda u, th, co: (*BONE_L, 0))
# ribs: arcs emerging from the water
for i in range(6):
    c = V(-2 + i * 2.2, 72 - i * 0.8, -0.5)
    span = 5.5 - abs(i - 2.5) * 0.6
    pts = [c + V(-span * math.cos(a) * 0.35, 0, span * math.sin(a)) + V(0, 0, 0) for a in [k * math.pi / 8 for k in range(9)]]
    mb.tube(catmull(pts, 3), lambda u: 0.32 * (1 - 0.5 * abs(u - 0.5)), sides=7,
            color_fn=lambda u, th, co: mixc(BONE_D, BONE_L, clamp(co.z / 5)))
pred = mb.build('Predecessor', [M_BONE])
objs.append(pred)

# ------------------------------------------------------------ pilgrim poles + cairn (south, the approach)
mb = MeshBuilder()
for i in range(7):
    y = -31 - i * 4.2
    x = (1.9 if i % 2 == 0 else -1.9) + rnd.uniform(-0.3, 0.3)
    h = 2.6 + rnd.uniform(-0.3, 0.5)
    lean = V(rnd.uniform(-0.08, 0.08), rnd.uniform(-0.05, 0.05), 1).normalized()
    base = V(x, y, -0.3)
    top = base + lean * h
    mb.tube([base, top], lambda u: 0.06 * (1 - 0.3 * u), sides=6, color_fn=lambda u, th, co: (*WOOD, 0), mat=0)
    # crossbar + cloth strips
    cb0, cb1 = top + V(-0.35, 0, -0.25), top + V(0.35, 0, -0.25)
    mb.tube([cb0, cb1], 0.03, sides=5, color_fn=lambda u, th, co: (*WOOD, 0), mat=0)
    for j in range(3):
        s0 = cb0.lerp(cb1, 0.2 + 0.3 * j)
        length = 0.8 + rnd.random() * 0.7
        pts = [s0, s0 + V(0.04, 0.12, -length * 0.5), s0 + V(0.1, 0.3, -length)]
        mb.tube(catmull(pts, 3), 0.06, sides=4, profile=lambda th, u: (1.0, 0.1), color_fn=lambda u, th, co: (*MARI, 0.15), mat=1)
# cairn at the arena threshold
cairn_c = V(4.2, -33.0, 0)
for i, (r, h) in enumerate([(0.42, 0.3), (0.34, 0.26), (0.27, 0.24), (0.2, 0.2), (0.14, 0.16)]):
    z = sum(hh for _, hh in [(0.42, 0.3), (0.34, 0.26), (0.27, 0.24), (0.2, 0.2), (0.14, 0.16)][:i]) - 0.1
    mb.prism(cairn_c + V(rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05), z), V(0, 0, 1), r, h, tip=0.05, rnd=rnd,
             roll=rnd.random() * 6, col=(*SALT_HI, 0), mat=2)
poles = mb.build('Pilgrim_Poles', [M_WOOD, material('AR_Cloth', (1, 1, 1), rough=0.9), M_SALT])
objs.append(poles)

# ------------------------------------------------------------ horizon mesas (very far, low)
mb = MeshBuilder()
for i in range(70):
    a = i / 70 * 2 * math.pi + rnd.uniform(-0.03, 0.03)
    dist = rnd.uniform(620, 900)
    if abs(math.cos(a - 1.3)) > 0.92 and rnd.random() < 0.7:
        continue  # keep a clean gap on the horizon where the sun sets
    w = rnd.uniform(25, 90)
    h = rnd.uniform(6, 30) * (0.5 + 0.5 * abs(math.sin(a * 3.0)))
    c = V(math.sin(a) * dist, math.cos(a) * dist, -1)
    tang = V(math.cos(a), -math.sin(a), 0)
    rad = V(math.sin(a), math.cos(a), 0)
    q = [c - tang * w - rad * 10, c + tang * w - rad * 10, c + tang * w * 0.6 + V(0, 0, h) - rad * 5,
         c - tang * w * 0.7 + V(0, 0, h * rnd.uniform(0.8, 1.0)) - rad * 5]
    idx = [mb.add_vert(p, None, (0.3, 0.3, 0.38, 0)) for p in q]
    mb.add_face(idx, 0, False)
ridge = mb.build('Horizon', [M_RIDGE])
objs.append(ridge)

# ------------------------------------------------------------ phase-2 spire prop
mb = MeshBuilder()
for (dx, dy, r, h, lx, ly) in [(0, 0, 0.55, 2.9, 0.05, 0.0), (0.55, 0.25, 0.35, 1.8, 0.35, 0.1), (-0.45, 0.3, 0.3, 1.4, -0.35, 0.15),
                               (0.1, -0.5, 0.28, 1.2, 0.05, -0.4)]:
    start = len(mb.verts)
    mb.prism(V(dx, dy, -0.4), V(lx, ly, 1).normalized(), r, h, tip=0.6, rnd=rnd, roll=rnd.random() * 6, tip_offset=0.2)
    for i in range(start, len(mb.verts)):
        mb.colors[i] = mixc(SALT_LO, SALT_HI, 0.3 + 0.7 * clamp(mb.verts[i].z / 2.6), alpha=clamp(1 - mb.verts[i].z / 1.2))
spire = mb.build('Spire', [M_SALT])
objs.append(spire)

print('arena objects', [o.name for o in objs])
if 'sheet' in ARGS:
    preview_setup()
    render(os.path.join(OUT_PREVIEW, 'arena_spawn.png'), (0, -34, 3.0), (0, 10, 5), lens=26)
    render(os.path.join(OUT_PREVIEW, 'arena_top.png'), (0, 10, 150), (0, 10, 0), lens=30)
export_glb(os.path.join(OUT_ASSETS, 'arena.glb'), objs, animations=False)
