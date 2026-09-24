"""HALCYON, Warden of the Still Water: model, rig, animation, export.

Blender space: creature faces -Y, left = +X, Z up. (glTF: faces +Z.)
Run:  blender -b --factory-startup --python blender/build_halcyon.py -- [preview] [anims] [export]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib, lib
importlib.reload(lib)
from lib import *

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
reset()
rnd = random.Random(11)

# ----------------------------------------------------------------------------
# Palette (linear). Vertex colour = albedo, vertex alpha = glow mask.
# ----------------------------------------------------------------------------
INK = (0.018, 0.020, 0.040)
INK_HI = (0.050, 0.050, 0.088)
BELLY = (0.115, 0.105, 0.150)
SLATE = (0.20, 0.19, 0.25)
BONE = (0.52, 0.49, 0.53)
THROAT = (0.33, 0.30, 0.36)


def mixc(a, b, t, alpha=0.0):
    t = clamp(t)
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, alpha)


# ----------------------------------------------------------------------------
# Skeleton landmarks (rest pose)
# ----------------------------------------------------------------------------
BODY_C = V(0, 0.3, 6.7)
SPINE = [V(0, -2.55, 7.05), V(0, -1.6, 7.35), V(0, 0.2, 7.4), V(0, 1.9, 7.1), V(0, 3.2, 6.6), V(0, 4.05, 6.05)]
BODY_R = 1.62
NECK_PTS = [V(0, -2.2, 7.7), V(0, -2.8, 8.85), V(0, -2.9, 9.95), V(0, -2.5, 10.8), V(0, -2.6, 11.6),
            V(0, -3.3, 12.1), V(0, -3.95, 12.18)]
HEAD_DIR = V(0, -1, -0.08).normalized()
HEAD_LEN = 1.2
BEAK_LEN = 3.0

LEGS = {
    'FL': dict(root=V(0.5, -1.1, 6.75), hip=V(1.35, -1.3, 6.65), knee=V(3.7, -3.3, 10.9), foot=V(5.6, -5.9, 0)),
    'RL': dict(root=V(0.55, 1.1, 6.6), hip=V(1.45, 1.3, 6.5), knee=V(3.8, 3.3, 10.6), foot=V(5.7, 5.6, 0)),
}
for k in list(LEGS.keys()):
    LEGS[k.replace('L', 'R')] = {kk: V(-v.x, v.y, v.z) for kk, v in LEGS[k].items()}
LEG_KEYS = ['FL', 'FR', 'RL', 'RR']

LANTERN_TOP = V(0, 0.55, 5.85)
LANTERN_MID = V(0, 0.55, 4.55)
LANTERN_C = V(0, 0.55, 3.85)
LANTERN_R = 0.72

# ----------------------------------------------------------------------------
# Materials
# ----------------------------------------------------------------------------
M_CARA = material('HC_Carapace', (1, 1, 1), rough=0.3)
M_BEAK = material('HC_Beak', (1, 1, 1), rough=0.25)
M_LANT = material('HC_Lantern', (1.0, 0.42, 0.35), rough=0.4, emit=(1.0, 0.35, 0.28), emit_strength=8.0, use_vcol=False)
M_CRYS = material('HC_Crystal', (0.82, 0.8, 0.9), rough=0.1, use_vcol=False)
MATS = [M_CARA, M_BEAK, M_LANT, M_CRYS]

# ----------------------------------------------------------------------------
# Armature
# ----------------------------------------------------------------------------
ob_arm, arm = new_armature('Halcyon')
add_bone(arm, 'root', V(0, 0, 0), V(0, 1, 0), deform=False)
add_bone(arm, 'body', BODY_C, BODY_C + V(0, 1.0, 0), 'root')
add_bone(arm, 'neck_root', NECK_PTS[0], NECK_PTS[0] + V(0, 0.4, 0), 'body')
for i in range(6):
    add_bone(arm, f'neck_{i}', NECK_PTS[i], NECK_PTS[i + 1], 'neck_root' if i == 0 else f'neck_{i-1}', connect=i > 0)
HEAD_P = NECK_PTS[6]
add_bone(arm, 'head', HEAD_P, HEAD_P + HEAD_DIR * HEAD_LEN, 'neck_5', connect=True)
JAW_HINGE = HEAD_P + HEAD_DIR * 0.72 + V(0, 0, -0.24)
JAW_DIR = (HEAD_DIR + V(0, 0, -0.04)).normalized()
add_bone(arm, 'jaw', JAW_HINGE, JAW_HINGE + JAW_DIR * 1.0, 'head')
add_bone(arm, 'beak_tip', HEAD_P + HEAD_DIR * (1.1 + BEAK_LEN) - V(0, 0, 0.05),
         HEAD_P + HEAD_DIR * (1.1 + BEAK_LEN + 0.3) - V(0, 0, 0.05), 'head', deform=False)
# crest quills: heron plumes fanning back (runtime spring bones)
QUILLS = []
for i, (ln, spread, lift) in enumerate([(3.4, 0.0, 0.30), (2.9, 0.16, 0.18), (2.9, -0.16, 0.18), (2.2, 0.3, 0.05), (2.2, -0.3, 0.05)]):
    base = HEAD_P + HEAD_DIR * 0.22 + V(spread * 0.6, 0, 0.36)
    d = (-HEAD_DIR + V(spread, 0, lift)).normalized()
    QUILLS.append((base, d, ln))
    add_bone(arm, f'quill_{i}', base, base + d * ln * 0.5, 'head')
# lantern
add_bone(arm, 'lantern_stalk', LANTERN_TOP, LANTERN_MID, 'body')
add_bone(arm, 'lantern', LANTERN_MID, LANTERN_C + V(0, 0, -LANTERN_R), 'lantern_stalk', connect=True)
# legs
for k in LEG_KEYS:
    L = LEGS[k]
    sx = 1 if 'L' in k else -1
    add_bone(arm, f'coxa_{k}', L['root'], L['hip'], 'body')
    add_bone(arm, f'femur_{k}', L['hip'], L['knee'], f'coxa_{k}', connect=True, xaxis=None, roll_z=V(sx, 0, 0.3))
    add_bone(arm, f'tibia_{k}', L['knee'], L['foot'], f'femur_{k}', connect=True, xaxis=None, roll_z=V(sx, 0, 0.3))
    add_bone(arm, f'ik_{k}', L['foot'], L['foot'] + V(0, 0.8, 0), 'root', deform=False)
    # pole lies in the rest bend plane so IK reproduces the rest knee exactly
    hip, knee, foot = L['hip'], L['knee'], L['foot']
    hf = (foot - hip).normalized()
    proj = hip + hf * (knee - hip).dot(hf)
    bend = (knee - proj).normalized()
    pole = knee + bend * 4.0
    L['pole'] = pole
    add_bone(arm, f'pole_{k}', pole, pole + V(0, 0.5, 0), 'body', deform=False)
bpy.ops.object.mode_set(mode='POSE')
set_rot_mode(ob_arm)
P = ob_arm.pose.bones


def elev(a, b):
    d = b - a
    return math.degrees(math.atan2(d.z, -d.y))


REST_E = [elev(NECK_PTS[i], NECK_PTS[i + 1]) for i in range(6)] + [elev(HEAD_P, HEAD_P + HEAD_DIR)]
print('REST_E', [round(e, 1) for e in REST_E])

for k in LEG_KEYS:
    c = P[f'tibia_{k}'].constraints.new('IK')
    c.target = ob_arm
    c.subtarget = f'ik_{k}'
    c.pole_target = ob_arm
    c.pole_subtarget = f'pole_{k}'
    c.chain_count = 2
    best = None
    for ang in range(-180, 180, 2):
        c.pole_angle = math.radians(ang)
        bpy.context.view_layer.update()
        knee = ob_arm.matrix_world @ P[f'tibia_{k}'].head
        fx = P[f'femur_{k}'].matrix.to_3x3() @ V(1, 0, 0)
        rx = ob_arm.data.bones[f'femur_{k}'].matrix_local.to_3x3() @ V(1, 0, 0)
        err = (knee - LEGS[k]['knee']).length + (1 - fx.dot(rx))
        if best is None or err < best[0]:
            best = (err, ang)
    c.pole_angle = math.radians(best[1])
    print('pole', k, [round(x, 4) for x in best])

# ----------------------------------------------------------------------------
# Mesh
# ----------------------------------------------------------------------------
mb = MeshBuilder()


def body_radius(u):
    base = math.sin(math.pi * clamp(u, 0, 1)) ** 0.5
    base *= 1.0 + 0.16 * math.exp(-((u - 0.62) / 0.22) ** 2) - 0.1 * math.exp(-((u - 0.3) / 0.07) ** 2)
    if u > 0.36:
        base *= 1 - 0.05 * (0.5 + 0.5 * math.cos((u - 0.36) * 2 * math.pi * 6.0))
    return BODY_R * base


def body_profile(th, u):
    c = math.cos(th)
    mz = 0.8 if c > 0 else 0.6
    w = (th + math.pi) % (2 * math.pi) - math.pi
    mz *= 1 + 0.09 * math.exp(-(w / 0.2) ** 2)
    return (1.0, mz)


def body_color(u, th, co):
    c = math.cos(th)
    belly = clamp((-c - 0.1) / 0.6)
    col = mixc(INK, BELLY, belly * 0.9)
    band = 0.5 + 0.5 * math.cos((u - 0.36) * 2 * math.pi * 6.0)
    if u > 0.36 and c > -0.3:
        col = mixc(col, INK_HI, band * 0.7)
    glow = clamp((c - 0.25) / 0.4) * clamp((u - 0.12) / 0.15) * clamp((0.92 - u) / 0.12)
    return (col[0], col[1], col[2], glow * 0.5)  # <0.5: vein zone (phase 2)


body_path = resample(catmull(SPINE, 10), 48)
mb.tube(body_path, body_radius, sides=30, up=V(0, 0, 1), profile=body_profile, mat=0,
        weight_fn=lambda u, co: {'body': 1.0}, color_fn=body_color)

# ventral armour plates (layered, give the underside structure when seen from below)
for i in range(5):
    u = 0.42 + i * 0.1
    idx = int(u * (len(body_path) - 1))
    c = body_path[idx]
    r = body_radius(u) * 0.62
    mb.ellipsoid(c + V(0, 0, -r * 0.72), (r * 0.95, 0.45, 0.22), seg=16, rings=6, mat=0, weight={'body': 1.0},
                 color_fn=lambda d, co: mixc(BELLY, INK_HI, clamp(d.z + 0.5)))

# neck
neck_path = resample(catmull(NECK_PTS, 10), 64)
seg_len = [(NECK_PTS[i + 1] - NECK_PTS[i]).length for i in range(6)]
cum = [0]
for s in seg_len:
    cum.append(cum[-1] + s)
NL = cum[-1]


def neck_weights(u, co):
    s = u * NL
    ws = {}
    blend = 0.3
    for i in range(6):
        a, b = cum[i], cum[i + 1]
        w = 1.0
        if i > 0:
            w *= smooth((s - a + blend) / (2 * blend))
        if i < 5:
            w *= 1 - smooth((s - b + blend) / (2 * blend))
        if w > 0.001:
            ws[f'neck_{i}'] = w
    if s < 0.35:
        ws['body'] = 1 - smooth(s / 0.35)
    if s > NL - blend:
        ws['head'] = smooth((s - NL + blend) / (2 * blend))
    tot = sum(ws.values())
    return {k: v / tot for k, v in ws.items()}


def neck_color(u, th, co):
    front = math.cos(th)
    stripe = clamp((front - 0.78) / 0.14)
    streak = 0.5 + 0.5 * math.sin(u * 60)
    return mixc(INK, THROAT, stripe * (0.3 + 0.7 * u) * (0.75 + 0.25 * streak))


mb.tube(neck_path, lambda u: lerp(0.74, 0.34, u ** 0.7) * (1 + 0.1 * math.exp(-((u - 0.04) / 0.07) ** 2)), sides=16,
        up=V(0, -1, 0), profile=lambda th, u: (1.0, 0.9), mat=0, weight_fn=neck_weights, color_fn=neck_color,
        cap0=False, cap1=False)

# collar: backward swept blades covering the neck/body seam
for i in range(11):
    a = -1.25 + 2.5 * i / 10
    base = NECK_PTS[0] + V(math.sin(a) * 0.8, 0.25 + abs(math.sin(a)) * 0.25, 0.1 + math.cos(a) * 0.35)
    d = V(math.sin(a) * 0.8, 1.2, 0.45 - abs(a) * 0.3).normalized()
    ln = 1.9 - abs(a) * 0.45
    path = [base + d * ln * t + V(0, 0, -0.45 * t * t) for t in (0, 0.33, 0.66, 1.0)]
    mb.tube(catmull(path, 3), lambda u: 0.2 * (1 - u) ** 0.8, sides=5, profile=lambda th, u: (1.0, 0.4), up=V(0, 0, 1),
            mat=0, weight_fn=lambda u, co: {'body': 1.0}, color_fn=lambda u, th, co: mixc(INK, INK_HI, u))

# head
Rh = HEAD_DIR.to_track_quat('Y', 'Z').to_matrix()
skull_c = HEAD_P + HEAD_DIR * 0.5 + V(0, 0, 0.05)


def skull_shape(d):
    m = 1.0
    if d.y < 0:
        m *= 1 + 0.12 * (-d.y)
    if d.y > 0.3:
        m *= 1 - 0.22 * (d.y - 0.3)
    return m


mb.ellipsoid(skull_c, (0.5, 0.98, 0.55), rot=Rh, seg=20, rings=12, mat=0, weight={'head': 1.0}, shape_fn=skull_shape,
             color_fn=lambda d, co: mixc(INK, INK_HI, clamp(d.z)) if d.z > -0.35 else mixc(INK, THROAT, 0.5))
for sx in (1, -1):
    b0 = HEAD_P + HEAD_DIR * 0.15 + V(sx * 0.28, 0, 0.34)
    b1 = HEAD_P + HEAD_DIR * 1.0 + V(sx * 0.24, 0, 0.14)
    mb.tube(catmull([b0, (b0 + b1) / 2 + V(sx * 0.12, 0, 0.1), b1], 4), lambda u: 0.11 * math.sin(math.pi * u) + 0.02,
            sides=6, profile=lambda th, u: (1.0, 0.6), mat=0, weight_fn=lambda u, co: {'head': 1.0},
            color_fn=lambda u, th, co: (*INK, 0))
    ec = HEAD_P + HEAD_DIR * 0.7 + V(sx * 0.43, 0, 0.14)
    mb.ellipsoid(ec, (0.07, 0.3, 0.1), rot=Rh, seg=10, rings=6, mat=0, weight={'head': 1.0},
                 color_fn=lambda d, co: (1.0, 0.5, 0.45, 1.0))

# beak: heavy dagger, upper mandible with a ridge, lower mandible on the jaw
beak0 = HEAD_P + HEAD_DIR * 1.05 + V(0, 0, 0.08)
beak_tip = HEAD_P + HEAD_DIR * (1.1 + BEAK_LEN) + V(0, 0, -0.05)
upath = catmull([beak0, beak0.lerp(beak_tip, 0.45) + V(0, 0, 0.09), beak_tip], 10)


def beak_prof(th, u):
    c = math.cos(th)
    w = (th + math.pi) % (2 * math.pi) - math.pi
    top = 1.0 + 0.25 * math.exp(-(w / 0.3) ** 2)
    return (0.75, top if c > 0 else 0.42)


mb.tube(upath, lambda u: 0.3 * (1 - u) ** 0.85 + 0.004, sides=12, up=V(0, 0, 1), profile=beak_prof, mat=1,
        weight_fn=lambda u, co: {'head': 1.0}, color_fn=lambda u, th, co: mixc(SLATE, BONE, 0.25 + 0.75 * u ** 0.6),
        cap0=False)
lb0 = JAW_HINGE + JAW_DIR * 0.25
lb_tip = JAW_HINGE + JAW_DIR * (BEAK_LEN + 0.15)
lpath = catmull([lb0, lb0.lerp(lb_tip, 0.5) + V(0, 0, -0.04), lb_tip], 10)
mb.tube(lpath, lambda u: 0.2 * (1 - u) ** 0.85 + 0.004, sides=10, up=V(0, 0, 1),
        profile=lambda th, u: (0.72, 0.5 if math.cos(th) > 0 else 1.0), mat=1,
        weight_fn=lambda u, co: {'jaw': 1.0}, color_fn=lambda u, th, co: mixc(SLATE, BONE, 0.2 + 0.7 * u ** 0.7), cap0=False)
mb.ellipsoid(JAW_HINGE + JAW_DIR * 0.2, (0.28, 0.45, 0.2), rot=Rh, seg=12, rings=6, mat=0, weight={'jaw': 1.0},
             color_fn=lambda d, co: (*INK, 0))

for i, (base, d, ln) in enumerate(QUILLS):
    pts = [base + d * ln * t + V(0, 0, 0.3 * math.sin(math.pi * t) - 0.35 * t * t) for t in (0, 0.25, 0.5, 0.75, 1)]
    mb.tube(catmull(pts, 4), lambda u: 0.11 * (1 - u) ** 0.6 + 0.006, sides=6, up=V(0, 0, 1),
            profile=lambda th, u: (1.0, 0.45), mat=0, weight_fn=(lambda i: (lambda u, co: {f'quill_{i}': 1.0}))(i),
            color_fn=lambda u, th, co: mixc(INK, SLATE, u ** 2, alpha=(0.56 + 0.3 * clamp((u - 0.7) / 0.3)) if u > 0.72 else 0.0))

# lantern stalk + bulb
spath = catmull([LANTERN_TOP + V(0, 0, 0.5), LANTERN_TOP, LANTERN_TOP.lerp(LANTERN_MID, 0.5) + V(0, -0.1, 0), LANTERN_MID], 5)
mb.tube(spath, lambda u: lerp(0.32, 0.13, u), sides=10, up=V(0, -1, 0), mat=0,
        weight_fn=lambda u, co: {'lantern_stalk': 1.0}, color_fn=lambda u, th, co: mixc(INK, BELLY, u))


def bulb_shape(d):
    return 1.0 + 0.2 * clamp(-d.z) ** 2 - 0.1 * clamp(d.z)


mb.ellipsoid(LANTERN_C, (LANTERN_R, LANTERN_R, LANTERN_R * 1.15), seg=22, rings=16, mat=2, weight={'lantern': 1.0},
             shape_fn=bulb_shape, color_fn=lambda d, co: (1, 1, 1, 0.5 + 0.5 * abs(math.sin(math.atan2(d.y, d.x) * 3))))
mb.ellipsoid(LANTERN_C + V(0, 0, LANTERN_R * 0.95), (0.4, 0.4, 0.26), seg=14, rings=6, mat=0, weight={'lantern': 1.0},
             color_fn=lambda d, co: (*INK, 0))
for i in range(6):
    a = i / 6 * 2 * math.pi
    rib = []
    for p in (0.3, 0.8, 1.35, 1.9, 2.4, 2.75):
        d = V(math.cos(a) * math.sin(p), math.sin(a) * math.sin(p), math.cos(p))
        m = bulb_shape(d) * 1.035
        rib.append(LANTERN_C + V(d.x * LANTERN_R, d.y * LANTERN_R, d.z * LANTERN_R * 1.15) * m)
    mb.tube(catmull(rib, 3), lambda u: 0.045 * (1 - 0.6 * u), sides=4, mat=0, weight_fn=lambda u, co: {'lantern': 1.0},
            color_fn=lambda u, th, co: (*INK, 0), up=V(0, 0, 1))

# legs
for k in LEG_KEYS:
    L = LEGS[k]
    sx = 1 if 'L' in k else -1
    front = 'F' in k
    hip, knee, foot = L['hip'], L['knee'], L['foot']
    mb.ellipsoid(hip, (0.46, 0.46, 0.42), seg=14, rings=8, mat=0, weight={f'coxa_{k}': 1.0},
                 color_fn=lambda d, co: mixc(INK, BELLY, clamp(-d.z) * 0.6))
    fmid = hip.lerp(knee, 0.5) + V(sx * 0.45, 0, 0.3)
    fpath = resample(catmull([hip, fmid, knee], 12), 28)

    def fr(u):
        return 0.36 + 0.13 * math.sin(math.pi * clamp(u / 0.8)) - 0.08 * u

    def fprof(th, u):
        w = (th + math.pi) % (2 * math.pi) - math.pi
        return (0.8, 1.0 + 0.25 * math.exp(-(w / 0.35) ** 2))

    mb.tube(fpath, fr, sides=14, up=V(0, 0, 1), profile=fprof, mat=0,
            weight_fn=(lambda k: lambda u, co: {f'femur_{k}': 1.0})(k),
            color_fn=lambda u, th, co: mixc(INK, INK_HI, 0.5 + 0.5 * math.cos(th)))
    kd = (foot - knee).normalized()
    lat = kd.cross(V(0, 0, 1)).normalized()

    def kcol(d, co, lat=lat):
        slit = clamp((abs(d.dot(lat)) - 0.88) / 0.08) * clamp(-d.z + 0.3)
        return (INK[0], INK[1], INK[2], 0.56 + 0.44 * slit if slit > 0.05 else 0.0)

    bend = (L['pole'] - knee).normalized()
    Rk = bend.to_track_quat('Z', 'Y').to_matrix()

    def kshape(d):
        return 1.0 + 0.9 * clamp(d.z) ** 3

    mb.ellipsoid(knee + bend * 0.1, (0.46, 0.46, 0.7), rot=Rk, seg=16, rings=12, mat=0, weight={f'femur_{k}': 1.0},
                 color_fn=kcol, shape_fn=kshape)
    spike_dir = (bend + V(sx * 0.15, 0, 0.4)).normalized()
    mb.tube(catmull([knee + bend * 0.5, knee + spike_dir * 1.3, knee + spike_dir * 2.1 + V(0, 0, 0.25)], 4),
            lambda u: 0.2 * (1 - u) ** 0.9 + 0.004, sides=8, up=V(0, 0, 1), mat=0,
            weight_fn=(lambda k: lambda u, co: {f'femur_{k}': 1.0})(k),
            color_fn=lambda u, th, co: mixc(INK, SLATE, u ** 2))
    for j in range(3):
        ax = (bend + V(rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), 0.2)).normalized()
        mb.prism(knee + ax * 0.35, ax, 0.12 + 0.07 * rnd.random(), 0.4 + 0.45 * rnd.random(), mat=3,
                 weight={f'femur_{k}': 1.0}, col=(1, 1, 1, 0.0), rnd=rnd, roll=rnd.random())
    tmid = knee.lerp(foot, 0.45) + V(sx * 0.55, 0, 0)
    tpath = resample(catmull([knee, tmid, foot.lerp(knee, 0.12), foot], 14), 52)

    def tr(u, front=front):
        r = 0.34 * (1 - u) ** 1.5 + 0.11
        r += 0.06 * math.exp(-((u - 0.86) / 0.022) ** 2)
        for ring in (0.3, 0.52, 0.7):
            r += 0.025 * math.exp(-((u - ring) / 0.01) ** 2)
        if u > 0.88:
            r *= clamp((1 - u) / 0.12) ** 0.75
        return max(r, 0.0)

    def tprof(th, u, front=front):
        # front legs: blade-like keel along the leading edge (they are weapons)
        if not front:
            return (0.85, 1.0)
        w = (th + math.pi) % (2 * math.pi) - math.pi
        return (0.7, 1.0 + 0.55 * math.exp(-(w / 0.25) ** 2) * math.sin(math.pi * clamp(u / 0.9)))

    def tcol(u, th, co):
        c = mixc(INK, INK_HI, 0.5 + 0.5 * math.cos(th))
        for ring in (0.3, 0.52, 0.7):
            c = mixc(c, SLATE, 0.6 * math.exp(-((u - ring) / 0.012) ** 2))
        if u > 0.83:
            c = mixc(c, BONE, (u - 0.83) / 0.17)
        glow = math.exp(-((u - 0.86) / 0.012) ** 2) * 0.9
        return (c[0], c[1], c[2], 0.56 + 0.44 * glow if glow > 0.05 else 0.0)

    mb.tube(tpath, tr, sides=12, up=V(0, 0, 1) if not front else V(0, -1, 0.3), profile=tprof, mat=0,
            weight_fn=(lambda k: lambda u, co: {f'tibia_{k}': 1.0})(k), color_fn=tcol)
    sp0 = foot.lerp(knee, 0.2)
    sdir = (V(sx * 0.2, 0.9 if front else -0.9, 0.1)).normalized()
    mb.tube(catmull([sp0, sp0 + sdir * 0.5 + V(0, 0, 0.12), sp0 + sdir * 0.95 + V(0, 0, 0.45)], 3),
            lambda u: 0.08 * (1 - u) + 0.005, sides=5, mat=0, up=V(0, 0, 1),
            weight_fn=(lambda k: lambda u, co: {f'tibia_{k}': 1.0})(k), color_fn=lambda u, th, co: mixc(INK, SLATE, u))

ob_mesh = mb.build('HalcyonBody', MATS)
skin_to(ob_mesh, ob_arm)

# crystal shell: rigid objects parented to 'body' (detached at the phase change)
shell_objs = []
cands = []
for i in range(400):
    u = rnd.uniform(0.2, 0.9)
    th = rnd.gauss(0, 0.6)
    cands.append((u, th))
picked = []
for u, th in cands:
    if all(abs(u - u2) * 6.5 + abs(th - t2) * 1.3 > 0.62 for u2, t2 in picked):
        picked.append((u, th))
    if len(picked) >= 22:
        break
for i, (u, th) in enumerate(sorted(picked)):
    idx = int(u * (len(body_path) - 1))
    c = body_path[idx]
    r = body_radius(u)
    mx, mz = body_profile(th, u)
    surf = c + V(math.sin(th) * r * mx, 0, math.cos(th) * r * mz)
    normal = V(math.sin(th) * 1.1, 0, math.cos(th)).normalized()
    cw = math.exp(-((u - 0.6) / 0.24) ** 2) * math.exp(-(th / 0.75) ** 2)
    ax = (normal * 1.3 + V(0, 0.15 + 0.55 * u, 0) + V(rnd.uniform(-0.12, 0.12), 0, 0)).normalized()
    length = 1.0 + 4.4 * cw + rnd.uniform(0, 0.6)
    rad = 0.2 + 0.36 * cw + rnd.uniform(0, 0.07)
    smb = MeshBuilder()
    smb.prism(surf - ax * 0.45, ax, rad, length, tip=0.5 + rnd.random() * 0.5, mat=0, rnd=rnd, roll=rnd.random() * 3,
              tip_offset=rnd.uniform(-0.35, 0.35), taper=0.78 + 0.15 * rnd.random())
    if cw > 0.25:
        for j in range(2):
            ax2 = (ax + V(rnd.uniform(-0.5, 0.5), rnd.uniform(-0.3, 0.3), rnd.uniform(-0.2, 0.2))).normalized()
            smb.prism(surf - ax * 0.25, ax2, rad * 0.5, length * rnd.uniform(0.3, 0.5), mat=0, rnd=rnd, roll=rnd.random() * 3)
    so = smb.build(f'Shell_{i:02d}', [M_CRYS])
    parent_to_bone(so, ob_arm, 'body')
    shell_objs.append(so)

bpy.context.view_layer.objects.active = ob_arm
print('verts', len(mb.verts), 'faces', len(mb.faces), 'shell', len(shell_objs))

# ----------------------------------------------------------------------------
# Posing helpers
# ----------------------------------------------------------------------------
NECK_PRESETS = {
    #            e0    e1    e2    e3    e4    e5    head
    'rest':  REST_E,
    'alert': [64, 86, 108, 86, 42, 8, -8],
    'tuck':  [100, 155, 45, 172, 70, 12, -38],
    'coil':  [55, 130, 152, 100, 38, -12, -44],
    'lance': [-36, -36, -36, -36, -36, -36, -38],
    'low':   [20, -10, -24, -28, -22, -14, -8],
    'sky':   [78, 86, 92, 98, 104, 110, 118],
    'roar':  [72, 80, 86, 90, 94, 98, 104],
    'droop': [40, -5, -40, -62, -76, -84, -88],
    'reach': [50, 70, 80, 60, 20, -10, -20],
}


def npre(name):
    return tuple(NECK_PRESETS[name])


def nmix(a, b, t):
    a, b = (npre(a) if isinstance(a, str) else a), (npre(b) if isinstance(b, str) else b)
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def apply_body(loc=(0, 0, 0), rot=(0, 0, 0)):
    """rot = (pitch_down, lean_left, yaw_left) degrees."""
    P['body'].location = Vector(loc)
    P['body'].rotation_euler = Euler((math.radians(rot[0]), math.radians(rot[1]), math.radians(rot[2])), 'XYZ')


def apply_neck(elevs, body_pitch_down=0.0, yaw_left=0.0, head_yaw_left=0.0, head_roll=0.0, jaw=0.0, twist=0.0):
    """elevs: 7 world elevations (6 neck + head) in degrees."""
    P['neck_root'].rotation_euler = Euler((0, math.radians(twist), math.radians(yaw_left)), 'XYZ')
    acc = 0.0
    for i in range(7):
        rot = REST_E[i] - body_pitch_down - acc - elevs[i]
        acc += rot
        if i < 6:
            P[f'neck_{i}'].rotation_euler = Euler((math.radians(rot), 0, 0), 'XYZ')
        else:
            P['head'].rotation_euler = Euler((math.radians(rot), math.radians(head_roll), math.radians(-head_yaw_left)), 'XYZ')
    P['jaw'].rotation_euler = Euler((math.radians(jaw), 0, 0), 'XYZ')


def apply_feet(pos):
    for k, p in pos.items():
        P[f'ik_{k}'].location = Vector(p) - LEGS[k]['foot']


def apply_lantern(swing=0.0, scale=1.0, side=0.0):
    P['lantern_stalk'].rotation_euler = Euler((math.radians(swing), 0, math.radians(side)), 'XYZ')
    P['lantern'].scale = (scale, scale, scale)


def feet_rest():
    return {k: LEGS[k]['foot'].copy() for k in LEG_KEYS}


# ----------------------------------------------------------------------------
# Preview
# ----------------------------------------------------------------------------
def preview_model():
    g = preview_setup()
    bpy.context.view_layer.update()
    shots = []
    for nm, cam, tgt, lens in [('34', (19, -24, 5.5), (0, 0, 6.5), 32), ('side', (32, -1, 6.5), (0, -1, 6.5), 35),
                               ('front', (0, -32, 4), (0, 0, 7), 35), ('low', (5, -15, 1.6), (0, 0, 8), 24),
                               ('back', (-18, 22, 9), (0, 0, 6), 32), ('player', (2.5, -26, 2.2), (0, 0, 7), 40)]:
        p = os.path.join(OUT_PREVIEW, f'_h_{nm}.png')
        render(p, cam, tgt, lens=lens, res=(640, 480))
        shots.append(p)
    contact_sheet(shots, 3, os.path.join(OUT_PREVIEW, 'halcyon_model.png'))
    shots = []
    for name in ['tuck', 'coil', 'lance', 'low', 'sky', 'droop']:
        reset_pose(ob_arm)
        pitch = 0
        if name == 'lance':
            apply_body((0, -1.6, -2.2), (18, 0, 0))
            pitch = 18
        apply_neck(npre(name), body_pitch_down=pitch, jaw=25 if name == 'sky' else 0)
        bpy.context.view_layer.update()
        p = os.path.join(OUT_PREVIEW, f'_n_{name}.png')
        render(p, (32, -4, 6), (0, -4, 6.0), lens=30, res=(480, 360))
        shots.append(p)
    contact_sheet(shots, 3, os.path.join(OUT_PREVIEW, 'halcyon_neck.png'))
    reset_pose(ob_arm)
    bpy.data.objects.remove(g)


if 'preview' in ARGS:
    preview_model()

if 'anims' in ARGS or 'export' in ARGS:
    exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'halcyon_anims.py')).read())
