"""The Pilgrim: player character. Conical salt-farmer hat, long coat, marigold scarf, hooked glaive.

Blender space: faces -Y, left = +X. The glaive is animated in character space; both arms follow it by IK.
Run: blender -b --factory-startup --python blender/build_player.py -- [sheet] [export]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib, lib
importlib.reload(lib)
from lib import *

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
reset()
rnd = random.Random(3)

COAT = (0.035, 0.045, 0.062)
COAT_HI = (0.07, 0.08, 0.1)
LINING = (0.85, 0.47, 0.08)
MARIGOLD = (0.95, 0.55, 0.1)
HAT = (0.11, 0.1, 0.095)
MASK = (0.72, 0.67, 0.6)
DARK = (0.018, 0.018, 0.022)
BOOT = (0.05, 0.035, 0.03)
ASH = (0.5, 0.42, 0.32)
STEEL = (0.75, 0.77, 0.82)


def c4(c, a=0.0):
    return (c[0], c[1], c[2], a)


M_MAIN = material('PL_Main', (1, 1, 1), rough=0.8)
M_BLADE = material('PL_Blade', (1, 1, 1), rough=0.2, metal=0.8)

# ---------------------------------------------------------------- skeleton
J = {
    'hips': (V(0, 0, 0.98), V(0, 0, 1.12)), 'spine': (V(0, 0, 1.12), V(0, 0.01, 1.3)),
    'chest': (V(0, 0.01, 1.3), V(0, 0, 1.5)), 'neck': (V(0, 0, 1.5), V(0, -0.01, 1.6)),
    'head': (V(0, -0.01, 1.6), V(0, -0.01, 1.82)),
}
SIDE = {
    'shoulder': (V(0.05, 0, 1.46), V(0.18, 0.0, 1.45)), 'upperarm': (V(0.18, 0, 1.45), V(0.25, 0.0, 1.18)),
    'forearm': (V(0.25, 0, 1.18), V(0.29, -0.06, 0.95)), 'hand': (V(0.29, -0.06, 0.95), V(0.3, -0.08, 0.86)),
    'thigh': (V(0.1, 0, 0.98), V(0.11, 0, 0.54)), 'shin': (V(0.11, 0, 0.54), V(0.11, 0.03, 0.1)),
    'foot': (V(0.11, 0.03, 0.1), V(0.11, -0.13, 0.03)),
}
PARENT = {'hips': 'root', 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck',
          'shoulder': 'chest', 'upperarm': 'shoulder', 'forearm': 'upperarm', 'hand': 'forearm',
          'thigh': 'hips', 'shin': 'thigh', 'foot': 'shin'}
GRIP_R = V(-0.3, -0.09, 0.9)
GRIP_GAP = 0.5

ob_arm, arm = new_armature('Pilgrim')
add_bone(arm, 'root', V(0, 0, 0), V(0, 0.3, 0), deform=False)
for n, (h, t) in J.items():
    add_bone(arm, n, h, t, PARENT[n], connect=n not in ('hips',))
for s, sx in (('L', 1), ('R', -1)):
    for n, (h, t) in SIDE.items():
        par = PARENT[n] if PARENT[n] in J or PARENT[n] == 'root' else f'{PARENT[n]}_{s}'
        add_bone(arm, f'{n}_{s}', V(h.x * sx, h.y, h.z), V(t.x * sx, t.y, t.z), par,
                 connect=n in ('upperarm', 'forearm', 'hand', 'shin', 'foot'))
add_bone(arm, 'weapon', GRIP_R, GRIP_R + V(0, 0.3, 0), 'root')
add_bone(arm, 'grip_R', GRIP_R, GRIP_R + V(0, 0.1, 0), 'weapon', deform=False)
add_bone(arm, 'grip_L', GRIP_R + V(0, -GRIP_GAP, 0), GRIP_R + V(0, -GRIP_GAP + 0.1, 0), 'weapon', deform=False)
for s, sx in (('L', 1), ('R', -1)):
    add_bone(arm, f'pole_{s}', V(0.55 * sx, 0.55, 1.15), V(0.55 * sx, 0.7, 1.15), 'chest', deform=False)
SCARF = [V(0, 0.09, 1.53), V(0.03, 0.32, 1.47), V(0.05, 0.56, 1.37), V(0.04, 0.8, 1.24), V(0.02, 1.02, 1.1)]
for i in range(4):
    add_bone(arm, f'scarf_{i}', SCARF[i], SCARF[i + 1], 'chest' if i == 0 else f'scarf_{i-1}', connect=i > 0)
bpy.ops.object.mode_set(mode='POSE')
set_rot_mode(ob_arm)
P = ob_arm.pose.bones
P['weapon'].rotation_mode = 'YXZ'

for s in ('L', 'R'):
    c = P[f'forearm_{s}'].constraints.new('IK')
    c.target, c.subtarget = ob_arm, f'grip_{s}'
    c.pole_target, c.pole_subtarget = ob_arm, f'pole_{s}'
    c.chain_count = 2
    c.pole_angle = math.radians(-90)
    cr = P[f'hand_{s}'].constraints.new('COPY_ROTATION')
    cr.target, cr.subtarget = ob_arm, f'grip_{s}'
    cr.influence = 0.0

# ---------------------------------------------------------------- mesh
mb = MeshBuilder()


def wz(z, pairs):
    """blend weights by height: pairs = [(z, bone), ...] ascending."""
    for i in range(len(pairs) - 1):
        z0, b0 = pairs[i]
        z1, b1 = pairs[i + 1]
        if z <= z1:
            t = smooth((z - z0) / (z1 - z0))
            return {b0: 1 - t, b1: t} if b0 != b1 else {b0: 1.0}
    return {pairs[-1][1]: 1.0}


TORSO_W = [(0.98, 'hips'), (1.15, 'spine'), (1.34, 'chest'), (1.5, 'chest'), (1.58, 'neck')]

# torso (coat upper)
tpath = [V(0, 0.0, z) for z in (0.95, 1.05, 1.18, 1.3, 1.42, 1.52, 1.58)]
mb.tube(catmull(tpath, 3), lambda u: [0.16, 0.17, 0.175, 0.2, 0.2, 0.13, 0.07][min(6, int(u * 6.99))] if False else
        (0.16 + 0.05 * math.sin(math.pi * clamp(u / 0.9)) - 0.1 * clamp((u - 0.85) / 0.15)), sides=14, up=V(0, -1, 0),
        profile=lambda th, u: (1.0, 0.72), weight_fn=lambda u, co: wz(co.z, TORSO_W),
        color_fn=lambda u, th, co: c4(COAT if math.cos(th) < 0.9 else COAT_HI))
# collar / scarf wrap
mb.tube([V(0.13 * math.cos(a), 0.1 * math.sin(a) + 0.01, 1.52) for a in [i / 16 * 2 * math.pi for i in range(17)]],
        0.055, sides=8, weight_fn=lambda u, co: {'chest': 0.6, 'neck': 0.4}, color_fn=lambda u, th, co: c4(MARIGOLD),
        cap0=False, cap1=False)
# coat skirt, open at the front
skirt_rings = []
for i in range(9):
    z = 1.05 - i * 0.09
    r = 0.19 + 0.2 * (i / 8) ** 1.2
    ring = []
    for j in range(19):
        a = math.radians(-160 + 320 * j / 18)  # 0 = back (+Y); gap at the front
        x, y = math.sin(a) * r, math.cos(a) * r * 0.85
        side = 'thigh_L' if x > 0 else 'thigh_R'
        lw = smooth((1.0 - z) / 0.55) * 0.65 * clamp(abs(x) / (r * 0.6) + (0.4 if y < 0 else 0))
        w = {'hips': 1 - lw, side: lw} if lw > 0.01 else {'hips': 1.0}
        edge = j in (0, 18)
        col = c4(LINING) if edge else c4(COAT if i < 8 else COAT_HI)
        ring.append(mb.add_vert(V(x, y, z), w, col))
    skirt_rings.append(ring)
for i in range(8):
    for j in range(18):
        a, b = skirt_rings[i], skirt_rings[i + 1]
        mb.add_face((a[j], a[j + 1], b[j + 1], b[j]))
# belt + charm
mb.tube([V(0.175 * math.cos(a), 0.13 * math.sin(a), 1.02) for a in [i / 16 * 2 * math.pi for i in range(17)]], 0.025,
        sides=6, weight_fn=lambda u, co: {'hips': 1.0}, color_fn=lambda u, th, co: c4(DARK), cap0=False, cap1=False)
mb.ellipsoid(V(0.12, -0.12, 0.95), (0.035, 0.035, 0.05), seg=8, rings=6, weight={'hips': 1.0},
             color_fn=lambda d, co: c4(MARIGOLD, 0.8))
# head, mask, hat
mb.ellipsoid(V(0, -0.01, 1.69), (0.085, 0.09, 0.11), seg=12, rings=8, weight={'head': 1.0},
             color_fn=lambda d, co: c4(MASK) if d.y < -0.3 else c4(DARK))
mb.ellipsoid(V(0, -0.075, 1.69), (0.07, 0.03, 0.09), seg=10, rings=6, weight={'head': 1.0},
             color_fn=lambda d, co: c4(DARK) if abs(d.z) < 0.18 and d.y < 0 else c4(MASK))


def hat_r(u):
    return 0.47 * (1 - u) ** 1.05 + 0.002


hpath = [V(0, -0.01, 1.745 + 0.25 * t) for t in (0, 0.33, 0.66, 1.0)]
mb.tube(catmull(hpath, 3), hat_r, sides=24, up=V(0, -1, 0), weight_fn=lambda u, co: {'head': 1.0},
        color_fn=lambda u, th, co: c4(MARIGOLD) if 0.2 < u < 0.26 else c4(HAT if u > 0.05 else (0.06, 0.055, 0.05)))
mb.tube([V(0, -0.01, 1.745), V(0, -0.01, 1.73)], lambda u: 0.47 - 0.01 * u, sides=24, up=V(0, -1, 0),
        weight_fn=lambda u, co: {'head': 1.0}, color_fn=lambda u, th, co: c4((0.06, 0.055, 0.05)), cap0=False)
# arms & legs
for s, sx in (('L', 1), ('R', -1)):
    for n, r0, r1, col in (('upperarm', 0.06, 0.05, COAT), ('forearm', 0.05, 0.042, COAT)):
        h, t = SIDE[n]
        mb.tube([V(h.x * sx, h.y, h.z), V(t.x * sx, t.y, t.z)], lambda u, r0=r0, r1=r1: lerp(r0, r1, u), sides=8,
                weight_fn=(lambda b: lambda u, co: {b: 1.0})(f'{n}_{s}'), color_fn=lambda u, th, co, col=col: c4(col))
    # sleeve cuff
    h, t = SIDE['forearm']
    mb.tube([V(t.x * sx, t.y, t.z) + V(0, 0.01, 0.05), V(t.x * sx, t.y, t.z) - V(0, 0, 0.01)], 0.06, sides=8,
            weight_fn=(lambda b: lambda u, co: {b: 1.0})(f'forearm_{s}'), color_fn=lambda u, th, co: c4(LINING))
    h, t = SIDE['hand']
    mb.ellipsoid(V(h.x * sx, h.y, h.z).lerp(V(t.x * sx, t.y, t.z), 0.5), (0.04, 0.045, 0.06), seg=8, rings=6,
                 weight={f'hand_{s}': 1.0}, color_fn=lambda d, co: c4(DARK))
    mb.ellipsoid(V(0.2 * sx, 0.0, 1.43), (0.09, 0.1, 0.07), seg=10, rings=6, weight={'chest': 0.5, f'upperarm_{s}': 0.5},
                 color_fn=lambda d, co: c4(COAT_HI))
    for n, r0, r1, col in (('thigh', 0.075, 0.06, DARK), ('shin', 0.058, 0.048, BOOT)):
        h, t = SIDE[n]
        mb.tube([V(h.x * sx, h.y, h.z), V(t.x * sx, t.y, t.z)], lambda u, r0=r0, r1=r1: lerp(r0, r1, u), sides=8,
                weight_fn=(lambda b: lambda u, co: {b: 1.0})(f'{n}_{s}'), color_fn=lambda u, th, co, col=col: c4(col))
    h, t = SIDE['foot']
    mb.ellipsoid(V(0.11 * sx, -0.04, 0.05), (0.05, 0.12, 0.05), seg=10, rings=6, weight={f'foot_{s}': 1.0},
                 color_fn=lambda d, co: c4(BOOT))

# scarf ribbon (flat, trailing)
spath = resample(catmull(SCARF, 6), 20)
sl = [(SCARF[i + 1] - SCARF[i]).length for i in range(4)]
sc = [0]
for x in sl:
    sc.append(sc[-1] + x)


def scarf_w(u, co):
    s = u * sc[-1]
    ws = {}
    for i in range(4):
        w = 1.0
        if i > 0:
            w *= smooth((s - sc[i] + 0.08) / 0.16)
        if i < 3:
            w *= 1 - smooth((s - sc[i + 1] + 0.08) / 0.16)
        if w > 0.001:
            ws[f'scarf_{i}'] = w
    t = sum(ws.values())
    return {k: v / t for k, v in ws.items()}


mb.tube(spath, lambda u: 0.075 * (1 - 0.3 * u), sides=6, up=V(0, 0, 1), profile=lambda th, u: (1.0, 0.12),
        weight_fn=scarf_w, color_fn=lambda u, th, co: c4(MARIGOLD, 0.25 if u > 0.92 else 0.0))

ob_mesh = mb.build('PilgrimBody', [M_MAIN, M_BLADE])
skin_to(ob_mesh, ob_arm)

# glaive (rigid to 'weapon'; shaft runs along -Y from the right-hand grip)
gb = MeshBuilder()
G = GRIP_R
gb.tube([G + V(0, 0.55, 0), G + V(0, -1.3, 0)], lambda u: 0.022 + 0.004 * math.sin(math.pi * u), sides=8, up=V(0, 0, 1),
        weight_fn=lambda u, co: {'weapon': 1.0}, color_fn=lambda u, th, co: c4(ASH if 0.05 < u < 0.97 else DARK))
for y in (0.0, -GRIP_GAP):
    gb.tube([G + V(0, y + 0.07, 0), G + V(0, y - 0.07, 0)], 0.028, sides=8, up=V(0, 0, 1),
            weight_fn=lambda u, co: {'weapon': 1.0}, color_fn=lambda u, th, co: c4(DARK))
gb.tube([G + V(0, -1.26, 0), G + V(0, -1.34, 0)], 0.035, sides=8, up=V(0, 0, 1), weight_fn=lambda u, co: {'weapon': 1.0},
        color_fn=lambda u, th, co: c4(MARIGOLD))
# crescent blade: flat, curving up and back into a hook
bpts = [G + V(0, -1.3, 0.0), G + V(0, -1.55, 0.04), G + V(0, -1.78, 0.12), G + V(0, -1.9, 0.26), G + V(0, -1.86, 0.4)]
bpath = resample(catmull(bpts, 6), 22)
gb.tube(bpath, lambda u: 0.075 * math.sin(math.pi * clamp(u * 0.9 + 0.08)) ** 0.7 + 0.003, sides=8, up=V(0, 0, 1),
        profile=lambda th, u: (0.13, 1.0), mat=1, weight_fn=lambda u, co: {'weapon': 1.0},
        color_fn=lambda u, th, co: c4(STEEL, 1.0 if math.cos(th) < -0.6 else 0.0))
# back spike
gb.tube([G + V(0, -1.3, 0), G + V(0, -1.42, -0.12), G + V(0, -1.46, -0.22)], lambda u: 0.03 * (1 - u) + 0.003, sides=6,
        mat=1, weight_fn=lambda u, co: {'weapon': 1.0}, color_fn=lambda u, th, co: c4(STEEL))
ob_glaive = gb.build('Glaive', [M_MAIN, M_BLADE])
skin_to(ob_glaive, ob_arm)
print('player verts', len(mb.verts) + len(gb.verts))

# ---------------------------------------------------------------- posing
LIMBS = ['hips', 'spine', 'chest', 'neck', 'head'] + [f'{n}_{s}' for s in 'LR' for n in SIDE]


def R(bn, x=0, y=0, z=0):
    P[bn].rotation_euler = Euler((math.radians(x), math.radians(y), math.radians(z)), 'XYZ')


def weapon(loc, pitch_down=0, roll=0, yaw_left=0):
    """loc: absolute grip_R position (character space). Blade points -Y at zero yaw."""
    P['weapon'].location = Vector(loc) - GRIP_R
    P['weapon'].rotation_euler = Euler((math.radians(pitch_down), math.radians(roll), math.radians(yaw_left)), 'YXZ')


def ik(left=1.0, right=1.0):
    P['forearm_L'].constraints['IK'].influence = left
    P['forearm_R'].constraints['IK'].influence = right


KEYED = {b: ('rot',) for b in LIMBS}
KEYED['hips'] = ('loc', 'rot')
KEYED['weapon'] = ('loc', 'rot')

CLIPS = []
META = {'fps': FPS, 'clips': {}}


def clip(name, duration, loop=False, events=None):
    def deco(fn):
        CLIPS.append((name, duration, loop, events or {}, fn))
        return fn
    return deco


def Kp(*keys):
    return [(k[0], k[1], k[2] if len(k) > 2 else 'io') for k in keys]


def pose_legs(stance=0.0, crouch=0.0):
    """Neutral standing legs. stance spreads, crouch bends knees (hips handled by caller)."""
    for s, sx in (('L', 1), ('R', -1)):
        R(f'thigh_{s}', -crouch * 38 + (6 if s == 'R' else -8) * stance, 0, -sx * 4 * stance)
        R(f'shin_{s}', crouch * 70)
        R(f'foot_{s}', -crouch * 32)


GUARD_W = ((-0.28, -0.2, 1.0), -38, 80, 22)


def guard(breath=0.0):
    weapon((GUARD_W[0][0], GUARD_W[0][1], GUARD_W[0][2] + breath * 0.01), GUARD_W[1] + breath * 1.5, GUARD_W[2], GUARD_W[3])


@clip('idle', 2.4, loop=True)
def p_idle(t):
    w = TAU * t / 2.4 if 'TAU' in globals() else 2 * math.pi * t / 2.4
    b = math.sin(w)
    P['hips'].location = (0, 0, -0.05 + 0.008 * b)
    R('hips', 0, 12, 0)
    R('spine', 4 + b, -6, 0)
    R('chest', 3 + 1.5 * b, -8, 0)
    R('neck', -2, 2, 0)
    R('head', -4 - b, 2 + 2 * math.sin(w * 0.5), 0)
    pose_legs(stance=1.0, crouch=0.12)
    R('thigh_L', -14, 0, -6)
    R('thigh_R', 4, 0, 8)
    guard(b)
    ik(1, 1)


@clip('run', 0.72, loop=True)
def p_run(t):
    w = 2 * math.pi * t / 0.72
    P['hips'].location = (0, 0, -0.07 + 0.045 * math.cos(2 * w))
    R('hips', 8, 0, 0)
    R('spine', 10, 6 * math.sin(w), 0)
    R('chest', 6 + 2 * math.cos(2 * w), 8 * math.sin(w), 0)
    R('neck', -8, -4 * math.sin(w), 0)
    R('head', -8, -6 * math.sin(w), 0)
    for s, ph in (('L', 0.0), ('R', math.pi)):
        a = w + ph
        R(f'thigh_{s}', -42 * math.sin(a) - 12, 0, 0)
        knee = 18 + 70 * clamp(0.5 + 0.9 * math.cos(a - 0.9)) * (1 if math.sin(a) < 0.4 else 0.55)
        R(f'shin_{s}', knee)
        R(f'foot_{s}', -15 + 25 * math.sin(a))
    # left arm swings (free), right hand trails the glaive low behind
    ik(0.0, 1.0)
    R('shoulder_L', 0, 0, 0)
    R('upperarm_L', 40 * math.sin(w), 0, -12)
    R('forearm_L', -55 + 10 * math.sin(w))
    weapon((-0.34, 0.12 + 0.04 * math.sin(w), 0.9 + 0.03 * math.cos(2 * w)), -10 + 4 * math.sin(2 * w), 90, 172)


def attack_body(twist, lean, step, crouch):
    P['hips'].location = (0, -step, -0.06 - crouch * 0.12)
    R('hips', 4 + lean * 0.3, twist * 0.4, 0)
    R('spine', 6 + lean * 0.4, twist * 0.35, 0)
    R('chest', 4 + lean * 0.3, twist * 0.35, 0)
    R('head', -8 - lean * 0.4, -twist * 0.6, 0)
    pose_legs(stance=1.2, crouch=0.15 + crouch)
    R('thigh_L', -30 - crouch * 30, 0, -5)
    R('thigh_R', 18, 0, 8)
    R('shin_R', 25)


@clip('attack1', 0.62, events={'active': [0.13, 0.25], 'cancel': 0.34, 'chain': 0.3})
def p_attack1(t):
    # horizontal slash, right to left
    tw = track(Kp((0, 0), (0.11, -30, 'out'), (0.24, 34, 'snap'), (0.62, 12)), t)
    stp = track(Kp((0, 0), (0.11, 0.02), (0.22, 0.28, 'snap'), (0.62, 0.12)), t)
    attack_body(tw, 6, stp, track(Kp((0, 0.05), (0.2, 0.2), (0.62, 0.1)), t))
    yaw = track(Kp((0, GUARD_W[3]), (0.11, -120, 'out'), (0.25, 95, 'snap'), (0.4, 110, 'out'), (0.62, 70)), t)
    pitch = track(Kp((0, GUARD_W[1]), (0.11, -8), (0.25, 4), (0.62, -20)), t)
    roll = track(Kp((0, 80), (0.11, 180), (0.25, 180), (0.62, 120)), t)
    loc = track(Kp((0, GUARD_W[0]), (0.11, (-0.34, 0.02, 1.12)), (0.25, (0.05, -0.34, 1.08), 'snap'),
                   (0.62, (0.02, -0.2, 1.02))), t)
    weapon(loc, pitch, roll, yaw)
    ik(1, 1)


@clip('attack2', 0.62, events={'active': [0.12, 0.24], 'cancel': 0.32, 'chain': 0.28})
def p_attack2(t):
    # rising backhand, left to right
    tw = track(Kp((0, 12), (0.1, 36, 'out'), (0.23, -34, 'snap'), (0.62, -8)), t)
    stp = track(Kp((0, 0.12), (0.1, 0.1), (0.21, 0.36, 'snap'), (0.62, 0.14)), t)
    attack_body(tw, 4, stp, track(Kp((0, 0.1), (0.1, 0.22), (0.24, 0.05), (0.62, 0.05)), t))
    yaw = track(Kp((0, 70), (0.1, 118, 'out'), (0.24, -110, 'snap'), (0.4, -122, 'out'), (0.62, -60)), t)
    pitch = track(Kp((0, -20), (0.1, 6), (0.24, -40, 'snap'), (0.62, -42)), t)
    roll = track(Kp((0, 120), (0.1, 30), (0.24, 0), (0.62, 40)), t)
    loc = track(Kp((0, (0.02, -0.2, 1.02)), (0.1, (0.1, -0.05, 0.92)), (0.24, (-0.3, -0.25, 1.2), 'snap'),
                   (0.62, (-0.3, -0.15, 1.15))), t)
    weapon(loc, pitch, roll, yaw)
    ik(1, 1)


@clip('attack3', 1.0, events={'active': [0.4, 0.5], 'impact': 0.49, 'cancel': 0.7})
def p_attack3(t):
    # overhead leap-slam
    hz = track(Kp((0, -0.06), (0.3, 0.1, 'out'), (0.47, -0.3, 'in'), (0.6, -0.26), (1.0, -0.06)), t)
    stp = track(Kp((0, 0.0), (0.3, 0.25), (0.47, 0.6, 'in'), (1.0, 0.25)), t)
    P['hips'].location = (0, -stp, hz)
    lean = track(Kp((0, 0), (0.3, -18, 'out'), (0.47, 38, 'in'), (0.65, 32), (1.0, 6)), t)
    R('hips', lean * 0.35, 0, 0)
    R('spine', lean * 0.35, 0, 0)
    R('chest', lean * 0.3, 0, 0)
    R('head', -lean * 0.5 - 6, 0, 0)
    cr = track(Kp((0, 0.1), (0.2, 0.3), (0.3, 0.0, 'out'), (0.47, 0.55, 'in'), (0.7, 0.5), (1.0, 0.15)), t)
    pose_legs(1.0, cr)
    R('thigh_L', -40 - cr * 40, 0, -6)
    R('thigh_R', 20 + cr * 10, 0, 8)
    R('shin_R', 40 + cr * 50)
    pitch = track(Kp((0, GUARD_W[1]), (0.3, -150, 'out'), (0.36, -158), (0.49, 32, 'in'), (0.7, 30), (1.0, -20)), t)
    loc = track(Kp((0, GUARD_W[0]), (0.3, (-0.05, 0.12, 1.75), 'out'), (0.49, (-0.05, -0.45, 0.95), 'in'),
                   (0.7, (-0.05, -0.42, 0.92)), (1.0, GUARD_W[0])), t)
    yaw = track(Kp((0, GUARD_W[3]), (0.3, 0), (0.7, 0), (1.0, GUARD_W[3])), t)
    weapon(loc, pitch, track(Kp((0, 80), (0.3, 90), (1.0, 80)), t), yaw)
    ik(1, 1)


@clip('dodge', 0.5, events={'iframes': [0.02, 0.34], 'cancel': 0.38})
def p_dodge(t):
    # low skating dash across the water
    low = track(Kp((0, 0), (0.07, 1.0, 'out'), (0.34, 1.0), (0.5, 0.0)), t)
    P['hips'].location = (0, 0, -0.06 - 0.36 * low)
    R('hips', 30 * low, 0, 0)
    R('spine', 18 * low, 0, 0)
    R('chest', 10 * low, 0, 0)
    R('head', -30 * low, 0, 0)
    R('thigh_L', -85 * low, 0, -6)
    R('shin_L', 95 * low)
    R('foot_L', -10 * low)
    R('thigh_R', 45 * low, 0, 10)
    R('shin_R', 40 * low)
    R('foot_R', 30 * low)
    ik(1.0 - low, 1.0)
    R('upperarm_L', 50 * low, 0, -30 * low)
    R('forearm_L', -20 * low)
    gw = GUARD_W
    run_w = ((-0.34, 0.25, 0.62), 10, 90, 170)
    loc = tuple(a + (b - a) * low for a, b in zip(gw[0], run_w[0]))
    weapon(loc, lerp(gw[1], run_w[1], low), lerp(gw[2], run_w[2], low), lerp(gw[3], run_w[3], low))


@clip('hit', 0.45)
def p_hit(t):
    k = track(Kp((0, 0), (0.06, 1.0, 'snap'), (0.45, 0.0)), t)
    P['hips'].location = (0, 0.12 * k, -0.06 - 0.08 * k)
    R('hips', -8 * k, 0, 0)
    R('spine', -14 * k, 6 * k, 0)
    R('chest', -12 * k, 6 * k, 0)
    R('head', -20 * k, -10 * k, 6 * k)
    pose_legs(1.0, 0.15 + 0.2 * k)
    R('thigh_R', 20 * k, 0, 8)
    weapon((GUARD_W[0][0] - 0.1 * k, GUARD_W[0][1] + 0.1 * k, GUARD_W[0][2] + 0.15 * k), GUARD_W[1] - 30 * k,
           GUARD_W[2], GUARD_W[3] + 20 * k)
    ik(1 - k, 1)
    R('upperarm_L', -30 * k, 0, -40 * k)


@clip('heal', 1.3, events={'heal': 0.62})
def p_heal(t):
    k = track(Kp((0, 0), (0.3, 1.0, 'out'), (0.95, 1.0), (1.3, 0.0)), t)
    P['hips'].location = (0, 0.05 * k, -0.06 - 0.42 * k)
    R('hips', 8 * k, 0, 0)
    R('spine', 22 * k, 0, 0)
    R('chest', 12 * k, 0, 0)
    R('head', 15 * k, 0, 0)
    R('thigh_L', -70 * k, 0, -5)
    R('shin_L', 75 * k)
    R('thigh_R', 20 * k, 0, 6)
    R('shin_R', 110 * k)
    R('foot_R', 40 * k)
    ik(1 - k, 1)
    R('upperarm_L', -45 * k, 0, -8 * k)
    R('forearm_L', -25 * k)
    R('hand_L', 30 * k)
    # glaive planted upright
    weapon(((-0.3 + 0.0 * k), -0.15, 1.0 - 0.1 * k), lerp(GUARD_W[1], -88, k), lerp(GUARD_W[2], 90, k), lerp(GUARD_W[3], 0, k))


@clip('death', 2.0, events={'fall': 1.2})
def p_death(t):
    knees = track(Kp((0, 0), (0.25, 0.1), (0.75, 1.0, 'in2'), (2.0, 1.0)), t)
    fall = track(Kp((0, 0), (0.9, 0.0), (1.35, 1.0, 'in'), (1.5, 0.95, 'out'), (2.0, 1.0)), t)
    P['hips'].location = (0.0, -0.1 * fall, -0.06 - 0.5 * knees - 0.2 * fall)
    R('hips', -10 * (1 - knees) + 10 * knees + 60 * fall, 0, -10 * fall)
    R('spine', 10 * knees + 15 * fall, 0, 0)
    R('chest', 10 * knees + 10 * fall, 0, 0)
    R('head', 20 * knees - 20 * fall, 0, 15 * fall)
    for s in 'LR':
        R(f'thigh_{s}', -60 * knees + 20 * fall, 0, 0)
        R(f'shin_{s}', 110 * knees - 50 * fall)
        R(f'foot_{s}', 30 * knees)
    drop = track(Kp((0, 0), (0.6, 0), (1.0, 1.0, 'in')), t)
    weapon((-0.4 - 0.3 * drop, -0.2 - 0.2 * drop, 1.0 - 0.9 * drop), lerp(GUARD_W[1], 0, drop), 90, lerp(GUARD_W[3], 40, drop))
    ik(1 - knees, 1 - drop)
    R('upperarm_L', -20 * fall, 0, -20 * fall)
    R('upperarm_R', -30 * fall, 0, 20 * fall)


# ---------------------------------------------------------------- bake / export
TAU = 2 * math.pi


def bake_player(name, dur, loop, fn):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ob_arm.animation_data_create()
    ob_arm.animation_data.action = act
    n = int(round(dur * FPS))
    for f in range(n + 1):
        t = 0.0 if (loop and f == n) else f / FPS
        reset_pose(ob_arm)
        for s in 'LR':
            P[f'forearm_{s}'].constraints['IK'].influence = 1.0
        fn(t)
        for bn, chans in KEYED.items():
            pb = P[bn]
            if 'loc' in chans:
                pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_euler', frame=f)
        for s in 'LR':
            P[f'forearm_{s}'].constraints['IK'].keyframe_insert('influence', frame=f)
    tr = ob_arm.animation_data.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, 0, act)
    tr.mute = True
    ob_arm.animation_data.action = None
    return act


SOCK = {'blade_base': ('weapon', (0, -1.32, 0.02)), 'blade_tip': ('weapon', (0, -1.9, 0.3)),
        'hand': ('hand_L', (0, 0.05, 0))}
acts = {}
for name, dur, loop, events, fn in CLIPS:
    acts[name] = bake_player(name, dur, loop, fn)
    samp = sample_sockets(ob_arm, acts[name], SOCK, dur)
    META['clips'][name] = {'duration': dur, 'loop': loop, 'events': events, 'sockets': samp}
    print('PCLIP', name, dur)

reset_pose(ob_arm)
bpy.context.scene.frame_set(0)
if 'sheet' in ARGS:
    g = preview_setup()
    for name, times in [('idle', (0, 1.2)), ('run', (0, 0.18, 0.36, 0.54)), ('attack1', (0.0, 0.11, 0.18, 0.25, 0.4)),
                        ('attack2', (0.1, 0.18, 0.24)), ('attack3', (0.3, 0.42, 0.49, 0.8)), ('dodge', (0.1, 0.3)),
                        ('hit', (0.06,)), ('heal', (0.6,)), ('death', (0.8, 1.4, 2.0))]:
        ob_arm.animation_data.action = acts[name]
        shots = []
        for i, tt in enumerate(times):
            bpy.context.scene.frame_set(int(round(tt * FPS)))
            for j, cam in enumerate([(3.2, -3.2, 1.6), (0.0, 4.2, 2.0)]):
                p = os.path.join(OUT_PREVIEW, f'_p_{name}_{i}_{j}.png')
                render(p, cam, (0, -0.4, 1.0), lens=35, res=(300, 300))
                shots.append(p)
        contact_sheet(shots, len(shots), os.path.join(OUT_PREVIEW, f'player_{name}.png'))
    ob_arm.animation_data.action = None
    bpy.context.scene.frame_set(0)
    bpy.data.objects.remove(g)

if 'export' in ARGS:
    bpy.ops.object.mode_set(mode='OBJECT')
    reset_pose(ob_arm)
    bpy.context.view_layer.update()
    export_glb(os.path.join(OUT_ASSETS, 'pilgrim.glb'), [ob_arm, ob_mesh, ob_glaive])
    with open(os.path.join(OUT_ASSETS, 'pilgrim_meta.json'), 'w') as fp:
        json.dump(META, fp, separators=(',', ':'))
