# Executed inside build_halcyon.py's namespace (needs P, apply_*, LEGS, NECK_PRESETS ...).
# Every clip is sampled per frame from eased key poses. Neck bones sample the neck keys with a
# per-bone delay, so the base leads and the head follows (overlapping action / whip).

KEYED = {'body': ('loc', 'rot'), 'neck_root': ('rot',), 'head': ('rot',), 'jaw': ('rot',),
         'lantern_stalk': ('rot',), 'lantern': ('scale',)}
for i in range(6):
    KEYED[f'neck_{i}'] = ('rot',)
for k in LEG_KEYS:
    KEYED[f'ik_{k}'] = ('loc',)

META = {'fps': FPS, 'clips': {}}
WALK_T = 2.0
WALK_EXC = 1.8          # foot excursion either side of rest (body-relative)
WALK_BETA = 0.72        # stance fraction
WALK_SPEED = 2 * WALK_EXC / (WALK_BETA * WALK_T)
META['walk_speed'] = WALK_SPEED
TAU = 2 * math.pi


def K(*keys):
    """keys: (t, value[, ease]) -> normalised list for track()."""
    out = []
    for k in keys:
        out.append((k[0], k[1], k[2] if len(k) > 2 else 'io'))
    return out


def neck_at(keys, t, lag=0.035):
    return tuple(track(keys, t - lag * i)[i] for i in range(7))


def vadd(a, b):
    return tuple(x + y for x, y in zip(a, b))


def rest_foot(k, dx=0.0, dy=0.0, dz=0.0, sx=1.0, sy=1.0):
    f = LEGS[k]['foot']
    return V(f.x * sx + dx, f.y * sy + dy, f.z + dz)


def arc(p0, p1, u, lift, out=0.0):
    """Swing a foot from p0 to p1 with a high lift that stabs down at the end."""
    u = clamp(u)
    h = ease('io', u)
    p = Vector(p0).lerp(Vector(p1), h)
    p.z += lift * math.sin(math.pi * (u ** 0.72))
    if out:
        p.x += out * math.sin(math.pi * u)
    return p


def foot_track(k, keys, t):
    """keys: (t, (x,y,z), ease). Positions are absolute armature-space."""
    return Vector(track(keys, t))


def mirror_keys(keys):
    return [(t, (-v[0], v[1], v[2]), e) for t, v, e in keys]


CLIPS = []


def clip(name, duration, loop=False, events=None):
    def deco(fn):
        CLIPS.append((name, duration, loop, events or {}, fn))
        return fn
    return deco


# ----------------------------------------------------------------------------
# idle: breathing, a slow look around, a jaw clack, an impatient foot tap
# ----------------------------------------------------------------------------
@clip('idle', 4.0, loop=True)
def a_idle(t):
    w = TAU * t / 4.0
    apply_body((0.08 * math.sin(w + 0.5), 0.05 * math.sin(2 * w), 0.13 * math.sin(w)),
               (1.2 * math.sin(w), 1.2 * math.sin(w + 1.0), 2.0 * math.sin(w - 0.4)))
    e = [REST_E[i] + 3.0 * math.sin(w - i * 0.45) for i in range(6)] + [REST_E[6] + 5 * math.sin(2 * w + 1)]
    jaw = 0.0
    for c in (1.55, 1.85):
        if c < t < c + 0.2:
            jaw = 14 * math.sin(math.pi * (t - c) / 0.2)
    apply_neck(e, body_pitch_down=1.2 * math.sin(w), yaw_left=6 * math.sin(w + 0.3),
               head_yaw_left=16 * math.sin(w) + 5 * math.sin(3 * w), head_roll=4 * math.sin(w), jaw=jaw)
    feet = feet_rest()
    if 2.6 < t < 3.3:
        u = (t - 2.6) / 0.7
        feet['FL'] = arc(rest_foot('FL'), rest_foot('FL'), u, 1.1, out=0.25)
    apply_feet(feet)
    apply_lantern(swing=5 * math.sin(w - 1.0), scale=1 + 0.04 * math.sin(2 * w), side=3 * math.sin(w + 0.6))


# ----------------------------------------------------------------------------
# rest (sleeping, standing in the water, neck tucked) / wake
# ----------------------------------------------------------------------------
@clip('rest', 6.0, loop=True)
def a_rest(t):
    w = TAU * t / 6.0
    apply_body((0, 0.2, -0.9 + 0.07 * math.sin(w)), (3 + 0.8 * math.sin(w), 0, 0))
    e = [x + 1.5 * math.sin(w - i * 0.3) for i, x in enumerate(npre('tuck'))]
    apply_neck(e, body_pitch_down=3 + 0.8 * math.sin(w), head_yaw_left=-10, head_roll=-6)
    apply_feet(feet_rest())
    apply_lantern(swing=2 * math.sin(w - 1.0), scale=0.92 + 0.03 * math.sin(w))


@clip('wake', 4.4, events={'stir': 0.2, 'bay': 2.2, 'look': 3.1})
def a_wake(t):
    bl = K((0, (0, 0.2, -0.9)), (0.9, (0, 0.2, -1.1)), (2.0, (0, 0.5, 0.6), 'out'), (3.1, (0, 0.3, 0.3)), (4.4, (0, 0, 0)))
    br = K((0, (3, 0, 0)), (0.9, (5, 0, 0)), (2.0, (-10, 0, 0), 'out'), (3.1, (-4, 0, 0)), (4.4, (0, 0, 0)))
    loc, rot = track(bl, t), track(br, t)
    if 0.3 < t < 0.9:  # stir shiver
        rot = vadd(rot, (0, 2.5 * math.sin(t * 40) * (0.9 - t), 0))
    apply_body(loc, rot)
    nk = K((0, npre('tuck')), (0.9, nmix('tuck', 'alert', 0.25)), (2.0, npre('sky'), 'out'), (3.0, npre('sky')),
           (3.6, npre('alert'), 'back'), (4.4, npre('rest')))
    jaw = track(K((0, 0), (2.1, 0), (2.3, 48, 'out'), (2.9, 40), (3.2, 0)), t)
    hy = track(K((0, -10), (0.9, 12), (1.4, -8), (2.0, 0), (3.2, 0), (3.6, 10), (4.4, 0)), t)
    apply_neck(neck_at(nk, t, 0.05), body_pitch_down=rot[0], head_yaw_left=hy, jaw=jaw,
               head_roll=track(K((0, -6), (1.0, 0)), t))
    apply_feet(feet_rest())
    apply_lantern(swing=track(K((0, 0), (1.0, -8), (2.0, 14), (2.8, -6), (4.4, 0)), t),
                  scale=track(K((0, 0.92), (2.2, 1.25), (3.0, 1.0)), t))


# ----------------------------------------------------------------------------
# walk: lateral-sequence stilt gait with high stabbing steps; bird-like head bob
# ----------------------------------------------------------------------------
PHASE = {'RL': 0.0, 'FL': 0.25, 'RR': 0.5, 'FR': 0.75}


@clip('walk', WALK_T, loop=True)
def a_walk(t):
    w = TAU * t / WALK_T
    feet = {}
    swing_sum = 0.0
    for k in LEG_KEYS:
        p = (t / WALK_T + PHASE[k]) % 1.0
        f = LEGS[k]['foot']
        sx = 1 if 'L' in k else -1
        if p < WALK_BETA:
            s = p / WALK_BETA
            feet[k] = V(f.x, f.y - WALK_EXC + 2 * WALK_EXC * s, 0)
        else:
            s = (p - WALK_BETA) / (1 - WALK_BETA)
            p0 = V(f.x, f.y + WALK_EXC, 0)
            p1 = V(f.x, f.y - WALK_EXC, 0)
            feet[k] = arc(p0, p1, s, 1.9, out=0.35 * sx)
            swing_sum += math.sin(math.pi * s)
    apply_feet(feet)
    lean = 2.4 * math.sin(w - 0.6)
    apply_body((0.18 * math.sin(w - 0.6), 0.08 * math.sin(2 * w), -0.16 + 0.14 * math.cos(2 * w)),
               (1.5 * math.sin(2 * w + 0.4), lean, 2.5 * math.sin(w)))
    # head bob: hold, then thrust forward (twice per cycle)
    q = (t / (WALK_T / 2)) % 1.0
    b = q / 0.7 if q < 0.7 else 1 - ease('out', (q - 0.7) / 0.3)
    fwd = 1 - b
    off = [0, -1, -3, -5, -8, -7, 3]
    e = [REST_E[i] + off[i] * fwd * 1.6 - 3 for i in range(7)]
    apply_neck(e, body_pitch_down=1.5 * math.sin(2 * w + 0.4), yaw_left=-2.5 * math.sin(w),
               head_yaw_left=-3 * math.sin(w), head_roll=-lean * 0.5)
    apply_lantern(swing=7 * math.sin(2 * w - 1.2), side=4 * math.sin(w - 1.4))


# ----------------------------------------------------------------------------
# lance: coil back, beak strike into the salt, stuck (punish window), yank free
# ----------------------------------------------------------------------------
LANCE_BODY = (0, -1.9, -1.35)


@clip('lance', 3.4, events={'glint': 0.7, 'track_end': 0.88, 'strike': 1.02, 'impact': 1.14, 'stuck_end': 2.22,
                            'yank': 2.32})
def a_lance(t):
    bl = K((0, (0, 0, 0)), (0.85, (0, 1.0, 0.55)), (1.0, (0, 1.1, 0.6)), (1.14, LANCE_BODY, 'snap'),
           (1.3, vadd(LANCE_BODY, (0, -0.12, -0.12)), 'out'), (1.6, vadd(LANCE_BODY, (0.1, 0.35, 0.2))),
           (1.85, vadd(LANCE_BODY, (-0.1, -0.05, -0.05))), (2.1, vadd(LANCE_BODY, (0, 0.4, 0.25))),
           (2.22, vadd(LANCE_BODY, (0, 0.2, 0.1))), (2.42, (0, 0.5, 0.1), 'out'), (3.4, (0, 0, 0)))
    br = K((0, (0, 0, 0)), (0.85, (-9, 0, 0)), (1.0, (-10, 0, 0)), (1.14, (19, 0, 0), 'snap'), (1.3, (20, 0, 0), 'out'),
           (1.6, (16, 3, 0)), (1.85, (20, -3, 0)), (2.1, (15, 2, 0)), (2.22, (17, 0, 0)), (2.42, (-7, 0, 0), 'out'),
           (3.4, (0, 0, 0)))
    loc, rot = list(track(bl, t)), track(br, t)
    if 0.85 < t < 1.0:  # anticipation tremble
        loc[0] += 0.03 * math.sin(t * 90)
    apply_body(loc, rot)
    nk = K((0, npre('rest')), (0.85, npre('coil')), (1.0, npre('coil')), (1.12, npre('lance'), 'snap'),
           (2.22, npre('lance')), (2.45, vadd(npre('alert'), (6, 8, 10, 10, 12, 14, 18)), 'out'),
           (3.4, npre('rest'), 'io'))
    jaw = track(K((0, 0), (0.8, 0), (0.95, 14), (1.08, 0, 'snap'), (2.25, 0), (2.4, 26, 'out'), (2.8, 0)), t)
    apply_neck(neck_at(nk, t, 0.022), body_pitch_down=rot[0], jaw=jaw,
               head_roll=track(K((0, 0), (1.6, 0), (1.7, 6), (1.9, -6), (2.1, 4), (2.3, 0)), t))
    feet = feet_rest()
    feet['RL'] = foot_track('RL', K((0, tuple(rest_foot('RL'))), (1.14, tuple(rest_foot('RL'))),
                                    (1.4, tuple(rest_foot('RL', dy=-0.9))), (2.4, tuple(rest_foot('RL', dy=-0.9))),
                                    (3.0, tuple(rest_foot('RL')))), t)
    for k in ('RL',):
        if 1.14 < t < 1.4:
            feet[k].z += 0.8 * math.sin(math.pi * (t - 1.14) / 0.26)
        if 2.4 < t < 3.0:
            feet[k].z += 0.8 * math.sin(math.pi * (t - 2.4) / 0.6)
    apply_feet(feet)
    apply_lantern(swing=track(K((0, 0), (0.85, -12), (1.14, 28, 'snap'), (1.5, -10), (2.0, 5), (2.42, 18), (2.9, -6),
                                (3.4, 0)), t),
                  scale=track(K((0, 1.0), (0.9, 1.1), (1.2, 1.0), (3.4, 1.0)), t))


# ----------------------------------------------------------------------------
# pierce: raise a foreleg, hover, stab into the salt
# ----------------------------------------------------------------------------
PIERCE_TGT = V(3.1, -9.2, -0.35)


def make_pierce(side):
    s = 1 if side == 'L' else -1
    fk, ok = ('FL', 'FR') if side == 'L' else ('FR', 'FL')

    def fn(t):
        tgt = V(PIERCE_TGT.x * s, PIERCE_TGT.y, PIERCE_TGT.z)
        bl = K((0, (0, 0, 0)), (0.75, (-0.6 * s, 0.55, 0.45)), (0.95, (-0.62 * s, 0.6, 0.55)),
               (1.05, (0.45 * s, -1.0, -1.3), 'snap'), (1.2, (0.5 * s, -1.05, -1.4), 'out'), (1.75, (0.4 * s, -0.9, -1.1)),
               (2.1, (0.1 * s, -0.2, 0.1), 'out'), (2.6, (0, 0, 0)))
        br = K((0, (0, 0, 0)), (0.75, (-6, -5 * s, 7 * s)), (0.95, (-7, -5 * s, 8 * s)), (1.05, (9, 5 * s, 4 * s), 'snap'),
               (1.75, (7, 4 * s, 3 * s)), (2.1, (-2, 0, 0), 'out'), (2.6, (0, 0, 0)))
        loc, rot = list(track(bl, t)), track(br, t)
        if 0.75 < t < 0.95:
            loc[2] += 0.04 * math.sin(t * 80)
        apply_body(loc, rot)
        look = vadd(npre('alert'), (-6, -8, -10, -14, -18, -22, -34))
        nk = K((0, npre('rest')), (0.75, look), (1.05, vadd(look, (-8, -8, -8, -8, -6, -4, -6)), 'snap'),
               (1.75, look), (2.6, npre('rest')))
        hy = track(K((0, 0), (0.75, 22 * s), (1.75, 18 * s), (2.6, 0)), t)
        jaw = track(K((0, 0), (0.9, 18), (1.05, 32, 'snap'), (1.3, 6), (1.8, 0)), t)
        apply_neck(neck_at(nk, t, 0.03), body_pitch_down=rot[0], yaw_left=track(K((0, 0), (0.75, 10 * s), (2.6, 0)), t),
                   head_yaw_left=hy, jaw=jaw)
        feet = feet_rest()
        raise_p = (V(3.5 * s, -4.4, 6.4))
        fkeys = K((0, tuple(rest_foot(fk))), (0.75, tuple(raise_p), 'out'), (0.95, tuple(raise_p + V(0.1 * s, -0.4, 0.4))),
                  (1.05, tuple(tgt), 'in'), (1.75, tuple(tgt)), (2.05, tuple(tgt.lerp(rest_foot(fk), 0.5) + V(0, 0, 2.4)), 'out'),
                  (2.6, tuple(rest_foot(fk)), 'in'))
        f = foot_track(fk, fkeys, t)
        if 1.25 < t < 1.7:  # tugging while embedded
            f.z += 0.12 * max(0.0, math.sin((t - 1.25) * 22))
        feet[fk] = f
        # bracing step with the opposite foreleg
        if 0.15 < t < 0.6:
            feet[ok] = arc(rest_foot(ok), rest_foot(ok, dx=0.7 * -s, dy=0.4), (t - 0.15) / 0.45, 0.9)
        elif t >= 0.6 and t < 2.1:
            feet[ok] = rest_foot(ok, dx=0.7 * -s, dy=0.4)
        elif t >= 2.1:
            feet[ok] = arc(rest_foot(ok, dx=0.7 * -s, dy=0.4), rest_foot(ok), (t - 2.1) / 0.45, 0.8)
        apply_feet(feet)
        apply_lantern(swing=track(K((0, 0), (0.75, -10), (1.05, 24, 'snap'), (1.4, -8), (2.0, 4), (2.6, 0)), t),
                      side=track(K((0, 0), (0.75, 12 * s), (1.05, -16 * s, 'snap'), (1.5, 6 * s), (2.6, 0)), t))
    return fn


for side in ('L', 'R'):
    clip(f'pierce_{side}', 2.6, events={'track_end': 0.8, 'strike': 0.98, 'impact': 1.05, 'stuck_end': 1.78,
                                        'foot': 'FL' if side == 'L' else 'FR'})(make_pierce(side))


# ----------------------------------------------------------------------------
# sweep: head drops to the water on one side and scythes across the front
# ----------------------------------------------------------------------------
def make_sweep(direction):
    d = 1 if direction == 'R2L' else -1   # R2L: starts on creature's right (-X), sweeps to the left (+X)

    def fn(t):
        bl = K((0, (0, 0, 0)), (1.0, (0.4 * d, 0.4, -2.9)), (1.2, (0.45 * d, 0.45, -3.0)), (1.8, (-0.4 * d, -0.3, -2.9)),
               (2.15, (-0.5 * d, -0.2, -2.3), 'out'), (3.2, (0, 0, 0)))
        br = K((0, (0, 0, 0)), (1.0, (10, -7 * d, -38 * d)), (1.2, (11, -8 * d, -40 * d)), (1.8, (10, 7 * d, 36 * d), 'io'),
               (2.15, (4, 9 * d, 44 * d), 'out'), (3.2, (0, 0, 0)))
        loc, rot = track(bl, t), track(br, t)
        apply_body(loc, rot)
        lowp = (12, -20, -36, -40, -32, -20, -8)
        nk = K((0, npre('rest')), (1.0, lowp), (1.2, lowp), (1.8, lowp),
               (2.15, nmix('low', 'alert', 0.4), 'out'), (3.2, npre('rest')))
        yaw = track(K((0, 0), (1.0, -52 * d), (1.2, -55 * d), (1.8, 52 * d), (2.15, 62 * d, 'out'), (3.2, 0)), t - 0.04)
        jaw = track(K((0, 0), (1.0, 10), (1.2, 34), (1.8, 30), (2.2, 0)), t)
        apply_neck(neck_at(nk, t, 0.04), body_pitch_down=rot[0], yaw_left=yaw, jaw=jaw,
                   head_yaw_left=track(K((0, 0), (1.0, -18 * d), (1.8, 20 * d), (2.3, 6 * d), (3.2, 0)), t - 0.1),
                   head_roll=track(K((0, 0), (1.0, 14 * d), (1.8, -14 * d), (3.2, 0)), t), twist=-8 * d * math.sin(math.pi * clamp(t / 2.2)))
        feet = feet_rest()
        # brace: outside foreleg steps wide during the windup
        bk = 'FL' if d == 1 else 'FR'
        sx = 1 if bk == 'FL' else -1
        if 0.2 < t < 0.7:
            feet[bk] = arc(rest_foot(bk), rest_foot(bk, dx=1.0 * sx, dy=-0.5), (t - 0.2) / 0.5, 1.0)
        elif 0.7 <= t < 2.3:
            feet[bk] = rest_foot(bk, dx=1.0 * sx, dy=-0.5)
        elif t >= 2.3:
            feet[bk] = arc(rest_foot(bk, dx=1.0 * sx, dy=-0.5), rest_foot(bk), (t - 2.3) / 0.6, 0.9)
        apply_feet(feet)
        apply_lantern(swing=track(K((0, 0), (1.0, 6), (1.8, -4), (2.2, 10), (3.2, 0)), t),
                      side=track(K((0, 0), (1.0, 18 * d), (1.8, -26 * d), (2.3, 10 * d), (3.2, 0)), t))
    return fn


for dname in ('R2L', 'L2R'):
    clip(f'sweep_{dname}', 3.2, events={'track_end': 0.9, 'strike': 1.2, 'strike_end': 1.82})(make_sweep(dname))


# ----------------------------------------------------------------------------
# toll: crouch, bay at the sky, the lantern swells and releases a ring pulse
# ----------------------------------------------------------------------------
def make_toll(double):
    T = 4.7 if double else 3.6
    pulses = [1.42, 2.66] if double else [1.42]

    def fn(t):
        blk = [(0, (0, 0, 0)), (1.3, (0, 0.2, -2.5)), (1.42, (0, 0.1, -1.7), 'snap'), (1.62, (0, 0.2, -2.7), 'out')]
        brk = [(0, (0, 0, 0)), (1.3, (-7, 0, 0)), (1.42, (-2, 0, 0), 'snap'), (1.62, (-8, 0, 0), 'out')]
        sk = [(0, 1.0), (1.36, 1.6, 'in'), (1.44, 0.78, 'snap'), (1.8, 1.0, 'back')]
        nkk = [(0, npre('rest')), (1.25, npre('sky')), (1.42, vadd(npre('sky'), (-4, -4, -6, -8, -10, -14, -30)), 'snap'),
               (1.7, npre('alert'))]
        if double:
            blk += [(2.52, (0, 0.2, -2.6)), (2.66, (0, 0.1, -1.6), 'snap'), (2.86, (0, 0.2, -2.6), 'out')]
            brk += [(2.52, (-7, 0, 0)), (2.66, (-2, 0, 0), 'snap'), (2.86, (-8, 0, 0), 'out')]
            sk += [(2.6, 1.65, 'in'), (2.68, 0.78, 'snap'), (3.0, 1.0, 'back')]
            nkk += [(2.5, npre('sky')), (2.66, vadd(npre('sky'), (-4, -4, -6, -8, -10, -14, -30)), 'snap'), (2.95, npre('alert'))]
        blk += [(T - 1.0, (0, 0, -0.6)), (T, (0, 0, 0))]
        brk += [(T - 1.0, (-2, 0, 0)), (T, (0, 0, 0))]
        nkk += [(T, npre('rest'))]
        loc, rot = list(track(K(*blk), t)), list(track(K(*brk), t))
        for pt in pulses:
            if pt - 0.45 < t < pt:
                a = (t - pt + 0.45) / 0.45
                loc[2] += 0.05 * a * math.sin(t * 95)
                rot[1] += 1.5 * a * math.sin(t * 70)
        apply_body(loc, rot)
        jaw = 0.0
        for pt in pulses:
            if pt - 0.6 < t < pt + 0.4:
                jaw = max(jaw, 40 * math.sin(math.pi * (t - pt + 0.6) / 1.0))
        apply_neck(neck_at(K(*nkk), t, 0.04), body_pitch_down=rot[0], jaw=jaw)
        feet = {k: rest_foot(k, sx=1.06, sy=1.03) for k in LEG_KEYS}
        blend = smooth(t / 0.8) * (1 - smooth((t - (T - 0.9)) / 0.9))
        feet = {k: LEGS[k]['foot'].lerp(feet[k], blend) for k in LEG_KEYS}
        apply_feet(feet)
        sw = 0.0
        for pt in pulses:
            if pt - 0.4 < t < pt:
                sw = 5 * math.sin(t * 120)
        apply_lantern(swing=sw + track(K((0, 0), (1.42, 0), (1.6, -10), (2.0, 6), (T, 0)), t), scale=track(K(*sk), t))
    return fn, T, pulses


for dbl in (False, True):
    fn, T, pulses = make_toll(dbl)
    ev = {'charge': 0.25}
    for i, p in enumerate(pulses):
        ev[f'pulse{i}'] = p
    clip('toll_double' if dbl else 'toll', T, events=ev)(fn)


# ----------------------------------------------------------------------------
# hit / stagger
# ----------------------------------------------------------------------------
@clip('hit', 0.7)
def a_hit(t):
    apply_body(track(K((0, (0, 0, 0)), (0.07, (0.1, 0.35, 0.2), 'snap'), (0.7, (0, 0, 0))), t),
               track(K((0, (0, 0, 0)), (0.07, (-4, 3, 3), 'snap'), (0.25, (1, -1.5, -1)), (0.7, (0, 0, 0))), t))
    nk = K((0, npre('rest')), (0.1, vadd(npre('rest'), (2, 4, 6, 8, 10, 12, 16)), 'snap'), (0.7, npre('rest')))
    apply_neck(neck_at(nk, t, 0.03), jaw=track(K((0, 0), (0.1, 26, 'snap'), (0.5, 0)), t),
               head_yaw_left=track(K((0, 0), (0.1, 12, 'snap'), (0.3, -8), (0.7, 0)), t))
    apply_feet(feet_rest())
    apply_lantern(swing=track(K((0, 0), (0.1, 16, 'snap'), (0.35, -8), (0.7, 0)), t))


@clip('stagger', 3.4, events={'down': 0.35, 'vuln_end': 2.45})
def a_stagger(t):
    bl = K((0, (0, 0, 0)), (0.35, (0.3, -0.4, -3.6), 'in2'), (0.55, (0.3, -0.4, -3.2), 'out'), (0.8, (0.3, -0.4, -3.5)),
           (1.4, (-0.2, -0.3, -3.3)), (2.0, (0.25, -0.4, -3.5)), (2.45, (0, -0.3, -3.2)), (3.4, (0, 0, 0), 'io'))
    br = K((0, (0, 0, 0)), (0.35, (12, 8, 0), 'in2'), (0.55, (10, 6, 0), 'out'), (1.2, (13, -5, 3)), (1.8, (11, 6, -3)),
           (2.45, (10, 0, 0)), (3.4, (0, 0, 0)))
    loc, rot = track(bl, t), track(br, t)
    apply_body(loc, rot)
    slump = (38, -8, -40, -55, -40, -20, -12)
    nk = K((0, npre('rest')), (0.4, slump, 'in2'), (2.45, slump), (3.4, npre('rest'), 'io'))
    hy = 0.0
    if 0.6 < t < 2.4:
        hy = 16 * math.sin((t - 0.6) * 9) * math.sin(math.pi * (t - 0.6) / 1.8)
    apply_neck(neck_at(nk, t, 0.05), body_pitch_down=rot[0], head_yaw_left=hy,
               jaw=track(K((0, 0), (0.35, 34, 'snap'), (0.9, 12), (2.3, 8), (2.7, 0)), t),
               head_roll=track(K((0, 0), (0.5, 20), (1.5, -12), (2.4, 8), (3.4, 0)), t))
    spread = smooth(t / 0.35) * (1 - smooth((t - 2.5) / 0.8))
    apply_feet({k: LEGS[k]['foot'].lerp(rest_foot(k, sx=1.14, sy=1.08), spread) for k in LEG_KEYS})
    apply_lantern(swing=track(K((0, 0), (0.35, 34, 'snap'), (0.8, -22), (1.3, 12), (1.9, -6), (2.45, 3), (3.4, 0)), t),
                  side=track(K((0, 0), (0.5, -14), (1.2, 10), (3.4, 0)), t))


# ----------------------------------------------------------------------------
# roar: phase transition. rear up, scream, shell bursts, forelegs slam down
# ----------------------------------------------------------------------------
@clip('roar', 5.2, events={'rear': 0.2, 'scream': 1.0, 'shatter': 2.2, 'slam': 3.0})
def a_roar(t):
    bl = K((0, (0, 0, 0)), (1.1, (0, 1.3, 1.3)), (2.3, (0, 1.3, 1.4)), (2.6, (0, 1.6, 1.8), 'out'), (3.0, (0, -1.3, -2.4), 'in'),
           (3.3, (0, -1.1, -2.0), 'out'), (5.2, (0, 0, 0)))
    br = K((0, (0, 0, 0)), (1.1, (-24, 0, 0)), (2.3, (-24, 0, 0)), (2.6, (-28, 0, 0), 'out'), (3.0, (15, 0, 0), 'in'),
           (3.3, (12, 0, 0), 'out'), (5.2, (0, 0, 0)))
    loc, rot = list(track(bl, t)), list(track(br, t))
    if 1.1 < t < 2.35:
        a = math.sin(math.pi * (t - 1.1) / 1.25)
        rot[1] += 5 * a * math.sin(t * 52)
        loc[2] += 0.08 * a * math.sin(t * 77)
    apply_body(loc, rot)
    nk = K((0, npre('rest')), (1.0, npre('roar')), (2.3, npre('roar')), (2.6, npre('sky')), (3.0, npre('low'), 'in'),
           (3.4, nmix('low', 'alert', 0.3)), (5.2, npre('rest')))
    jaw = track(K((0, 0), (0.8, 10), (1.05, 55, 'out'), (2.3, 50), (2.6, 20), (3.0, 40, 'snap'), (3.5, 10), (4.2, 0)), t)
    hr = 0.0
    if 1.1 < t < 2.35:
        hr = 8 * math.sin(t * 40) * math.sin(math.pi * (t - 1.1) / 1.25)
    apply_neck(neck_at(nk, t, 0.045), body_pitch_down=rot[0], jaw=jaw, head_roll=hr)
    feet = feet_rest()
    for fk in ('FL', 'FR'):
        s = 1 if fk == 'FL' else -1
        up1 = V(4.3 * s, -5.0, 4.6)
        up2 = V(4.5 * s, -4.8, 5.8)
        land = V(5.4 * s, -7.2, 0)
        fkeys = K((0, tuple(rest_foot(fk))), (0.3, tuple(rest_foot(fk))), (1.1, tuple(up1), 'out'), (2.3, tuple(up1 + V(0, 0.2, 0.3))),
                  (2.6, tuple(up2), 'out'), (3.0, tuple(land), 'in'), (4.0, tuple(land)), (4.8, tuple(rest_foot(fk))))
        f = foot_track(fk, fkeys, t)
        if 4.0 < t < 4.8:
            f.z += 1.2 * math.sin(math.pi * (t - 4.0) / 0.8)
        feet[fk] = f
    apply_feet(feet)
    apply_lantern(swing=track(K((0, 0), (1.1, 30), (2.3, 26), (3.0, -30, 'in'), (3.4, 16), (4.0, -6), (5.2, 0)), t),
                  scale=track(K((0, 1.0), (2.1, 1.45, 'in'), (2.3, 0.9, 'snap'), (2.8, 1.1), (5.2, 1.0)), t))


# ----------------------------------------------------------------------------
# vault (phase 2): crouch, leap, fold legs, crash down at the target
# ----------------------------------------------------------------------------
@clip('vault', 2.8, events={'track_end': 0.7, 'liftoff': 0.82, 'land': 1.65})
def a_vault(t):
    bz = track(K((0, 0), (0.65, -3.0), (0.82, -3.2), (1.22, 4.8, 'out'), (1.65, -2.4, 'in'), (1.9, -1.8, 'out'),
                 (2.8, 0)), t)
    pitch = track(K((0, 0), (0.65, 8), (0.82, 10), (1.22, -6, 'out'), (1.65, 10, 'in'), (2.8, 0)), t)
    apply_body((0, track(K((0, 0), (0.65, 0.5), (0.82, 0.5), (1.65, -0.3), (2.8, 0)), t), bz), (pitch, 0, 0))
    nk = K((0, npre('rest')), (0.65, npre('low')), (0.82, npre('low')), (1.22, npre('reach'), 'out'),
           (1.65, vadd(npre('low'), (-5, -10, -12, -14, -14, -12, -10)), 'in'), (2.8, npre('rest')))
    apply_neck(neck_at(nk, t, 0.04), body_pitch_down=pitch,
               jaw=track(K((0, 0), (0.7, 12), (0.9, 40, 'out'), (1.6, 20), (1.75, 44, 'snap'), (2.3, 0)), t))
    feet = {}
    for k in LEG_KEYS:
        r = rest_foot(k)
        crouch = rest_foot(k, sx=1.08, sy=1.04)
        tuck = V(r.x * 0.55, r.y * 0.6, bz + 3.2)
        reach = V(r.x * 1.02, r.y * 1.02, 1.2)
        fkeys = K((0, tuple(r)), (0.65, tuple(crouch)), (0.82, tuple(crouch)), (1.15, tuple(tuck), 'out'),
                  (1.5, tuple(reach)), (1.65, tuple(r), 'in'), (2.8, tuple(r)))
        feet[k] = foot_track(k, fkeys, t)
        if 1.0 < t < 1.3:  # keep tucked relative to the rising body
            feet[k].z = max(feet[k].z, bz + 3.0)
    apply_feet(feet)
    apply_lantern(swing=track(K((0, 0), (0.82, -10), (1.2, 30, 'out'), (1.65, -26, 'in'), (2.0, 12), (2.8, 0)), t),
                  scale=track(K((0, 1.0), (0.8, 1.15), (1.65, 1.0)), t))


# ----------------------------------------------------------------------------
# spires (phase 2): both forelegs drive into the salt; each pump raises a spire wave
# ----------------------------------------------------------------------------
@clip('spires', 2.8, events={'track_end': 0.85, 'stab': 1.05, 'pump0': 1.08, 'pump1': 1.62, 'stuck_end': 2.0})
def a_spires(t):
    bl = K((0, (0, 0, 0)), (0.8, (0, 0.8, 0.8)), (1.05, (0, -1.3, -1.9), 'snap'), (1.35, (0, -1.2, -2.3)), (1.5, (0, -1.2, -1.8)),
           (1.62, (0, -1.3, -2.4), 'snap'), (1.85, (0, -1.2, -1.9)), (2.2, (0, -0.4, -0.4), 'out'), (2.8, (0, 0, 0)))
    br = K((0, (0, 0, 0)), (0.8, (-12, 0, 0)), (1.05, (15, 0, 0), 'snap'), (1.35, (17, 0, 0)), (1.5, (13, 0, 0)),
           (1.62, (18, 0, 0), 'snap'), (1.85, (14, 0, 0)), (2.2, (2, 0, 0), 'out'), (2.8, (0, 0, 0)))
    loc, rot = track(bl, t), track(br, t)
    apply_body(loc, rot)
    down = vadd(npre('alert'), (-10, -14, -18, -22, -26, -30, -40))
    nk = K((0, npre('rest')), (0.8, npre('sky')), (1.05, down, 'snap'), (2.0, down), (2.8, npre('rest')))
    apply_neck(neck_at(nk, t, 0.035), body_pitch_down=rot[0],
               jaw=track(K((0, 0), (0.6, 30), (0.9, 45), (1.05, 10, 'snap'), (1.62, 30, 'snap'), (1.9, 0)), t))
    feet = feet_rest()
    for fk in ('FL', 'FR'):
        s = 1 if fk == 'FL' else -1
        up = V(3.6 * s, -4.3, 6.2)
        stab = V(2.3 * s, -8.0, -0.35)
        fkeys = K((0, tuple(rest_foot(fk))), (0.8, tuple(up), 'out'), (0.95, tuple(up + V(0, -0.3, 0.4))), (1.05, tuple(stab), 'in'),
                  (2.0, tuple(stab)), (2.3, tuple(stab.lerp(rest_foot(fk), 0.5) + V(0, 0, 2.2)), 'out'),
                  (2.8, tuple(rest_foot(fk)), 'in'))
        feet[fk] = foot_track(fk, fkeys, t)
    apply_feet(feet)
    apply_lantern(swing=track(K((0, 0), (0.8, -14), (1.05, 26, 'snap'), (1.35, -6), (1.62, 20, 'snap'), (2.0, -8), (2.8, 0)), t),
                  scale=track(K((0, 1.0), (1.0, 1.25), (1.1, 0.95), (1.55, 1.2), (1.65, 0.95), (2.4, 1.0)), t))


# ----------------------------------------------------------------------------
# death: a leg slips, a struggle, the collapse, one last reach at the sky, stillness
# ----------------------------------------------------------------------------
@clip('death', 7.0, events={'slip': 1.2, 'collapse': 3.1, 'last': 4.3, 'still': 6.3})
def a_death(t):
    bl = K((0, (0, 0, 0)), (0.3, (0, 0.4, 0.3), 'snap'), (1.2, (-0.7, 0, -1.5), 'in'), (1.5, (-0.8, 0, -1.2), 'out'),
           (2.4, (-0.6, 0.1, -0.8)), (3.1, (-0.7, 0.2, -5.0), 'in'), (3.35, (-0.7, 0.2, -4.7), 'out'),
           (3.6, (-0.7, 0.2, -4.95)), (7.0, (-0.75, 0.2, -5.1)))
    br = K((0, (0, 0, 0)), (0.3, (-6, 0, 0), 'snap'), (1.2, (2, -11, 0), 'in'), (1.5, (0, -9, 0)), (2.4, (-6, -6, 0)),
           (3.1, (6, -15, 3), 'in'), (3.35, (5, -13, 3)), (3.6, (6, -15, 3)), (7.0, (7, -16, 3)))
    loc, rot = track(bl, t), track(br, t)
    apply_body(loc, rot)
    dead = (22, -2, -14, -12, -8, -5, -8)
    nk = K((0, npre('rest')), (0.3, vadd(npre('rest'), (4, 8, 10, 12, 14, 16, 20)), 'snap'), (1.2, npre('alert')),
           (2.4, npre('sky')), (3.1, npre('alert'), 'in'), (3.6, npre('reach')), (4.3, nmix('reach', 'roar', 0.7), 'out'),
           (5.9, dead, 'in2'), (7.0, dead))
    jaw = track(K((0, 0), (0.3, 30, 'snap'), (0.9, 5), (2.2, 10), (2.5, 42, 'out'), (3.0, 10), (4.2, 12),
                  (4.5, 30, 'out'), (5.6, 12), (7.0, 16)), t)
    apply_neck(neck_at(nk, t, 0.06), body_pitch_down=rot[0], jaw=jaw,
               head_roll=track(K((0, 0), (1.2, -10), (2.4, 6), (3.6, -8), (5.9, -30), (7.0, -34)), t),
               head_yaw_left=track(K((0, 0), (4.3, 10), (5.9, -14), (7.0, -16)), t))
    feet = feet_rest()
    feet['FR'] = foot_track('FR', K((0, tuple(rest_foot('FR'))), (0.8, tuple(rest_foot('FR'))),
                                    (1.2, tuple(rest_foot('FR', sx=1.38, sy=1.2)), 'in')), t)
    feet['RL'] = foot_track('RL', K((0, tuple(rest_foot('RL'))), (2.7, tuple(rest_foot('RL'))),
                                    (3.1, tuple(rest_foot('RL', sx=1.3, sy=1.25)), 'in')), t)
    for k in ('FL', 'RR'):
        feet[k] = foot_track(k, K((0, tuple(rest_foot(k))), (2.8, tuple(rest_foot(k))),
                                  (3.1, tuple(rest_foot(k, sx=1.12, sy=1.1)), 'in')), t)
    apply_feet(feet)
    apply_lantern(swing=track(K((0, 0), (0.3, 20), (1.2, -12), (2.4, 8), (3.1, 60, 'in'), (3.4, 50), (7.0, 62)), t),
                  scale=track(K((0, 1.0), (2.4, 1.2), (3.1, 1.0), (6.3, 0.72)), t),
                  side=track(K((0, 0), (1.2, -20), (3.1, -10), (7.0, -14)), t))


# ----------------------------------------------------------------------------
# bake, sample sockets, export
# ----------------------------------------------------------------------------
SOCKETS = {
    'beak': ('beak_tip', (0, 0, 0)),
    'head': ('head', (0, 0.5, 0)),
    'lantern': ('lantern', (0, (LANTERN_MID - LANTERN_C).length, 0)),
    'body': ('body', (0, 0, 0)),
}
for k in LEG_KEYS:
    SOCKETS['foot_' + k] = (f'tibia_{k}', (0, P[f'tibia_{k}'].bone.length, 0))

ob_mesh.hide_render = False
acts = {}
only = [a for a in ARGS if a.startswith('only=')]
only = only[0][5:].split(',') if only else None
for name, dur, loop, events, fn in CLIPS:
    if only and name not in only:
        continue
    act = bake_action(ob_arm, name, dur, fn, KEYED, loop=loop)
    acts[name] = act
    samp = sample_sockets(ob_arm, act, SOCKETS, dur)
    # foot plants: downward crossings
    plants = []
    for k in LEG_KEYS:
        zs = [p[1] for p in samp['foot_' + k]]
        for f in range(1, len(zs)):
            if zs[f - 1] > 0.12 and zs[f] <= 0.12:
                plants.append([round(f / FPS, 3), k])
    META['clips'][name] = {'duration': dur, 'loop': loop, 'events': events, 'plants': sorted(plants),
                           'sockets': samp}
    bz = [p[1] for p in samp['beak']]
    print(f'CLIP {name:12s} {dur:.2f}s  beak minY {min(bz):.2f}  plants {len(plants)}')

# report a few gameplay-critical positions (glTF coords: x, y-up, z-forward)
def at(name, sock, tt):
    c = META['clips'].get(name)
    if not c:
        return None
    return c['sockets'][sock][min(len(c['sockets'][sock]) - 1, int(round(tt * FPS)))]


print('LANCE beak @impact', at('lance', 'beak', 1.14), '@1.6', at('lance', 'beak', 1.6))
print('PIERCE_L foot @impact', at('pierce_L', 'foot_FL', 1.05))
for tt in (1.2, 1.4, 1.6, 1.8):
    print('SWEEP beak', tt, at('sweep_R2L', 'beak', tt))
print('STAGGER head', at('stagger', 'head', 1.0), 'lantern', at('stagger', 'lantern', 1.0))
print('TOLL lantern', at('toll', 'lantern', 1.42))

reset_pose(ob_arm)
ob_arm.animation_data.action = None
bpy.context.scene.frame_set(0)

if 'preview' in ARGS or 'sheet' in ARGS:
    g = preview_setup()
    for name, times, cam, tgt in [
        ('lance', (0.0, 0.85, 1.0, 1.14, 1.8, 2.45), (30, -5, 5), (0, -5, 5)),
        ('pierce_L', (0.0, 0.75, 0.95, 1.05, 1.5, 2.1), (-4, -30, 5), (0, -3, 5)),
        ('sweep_R2L', (0.0, 1.0, 1.35, 1.55, 1.8, 2.15), (0, -32, 12), (0, -3, 3)),
        ('toll', (0.0, 1.3, 1.42, 1.62, 2.4, 3.3), (26, -14, 5), (0, 0, 5)),
        ('roar', (0.0, 1.1, 2.2, 2.6, 3.0, 4.0), (28, -10, 6), (0, -1, 6)),
        ('vault', (0.0, 0.65, 0.9, 1.22, 1.65, 2.2), (30, -6, 7), (0, 0, 6)),
        ('stagger', (0.0, 0.35, 1.0, 2.0, 2.8, 3.4), (26, -14, 5), (0, -2, 4)),
        ('death', (0.0, 1.2, 2.4, 3.1, 4.3, 7.0), (26, -16, 5), (0, -2, 4)),
        ('walk', (0.0, 0.33, 0.67, 1.0, 1.33, 1.67), (30, -4, 5), (0, 0, 5)),
        ('spires', (0.0, 0.8, 1.05, 1.62, 2.1, 2.5), (26, -14, 5), (0, -3, 5)),
        ('wake', (0.0, 0.9, 2.0, 2.4, 3.1, 4.4), (26, -14, 5), (0, -1, 6)),
        ('idle', (0.0, 1.0, 1.7, 2.8, 3.0, 3.5), (22, -18, 5), (0, -1, 6)),
    ]:
        if name not in acts or (only and name not in only):
            continue
        ob_arm.animation_data.action = acts[name]
        shots = []
        for i, tt in enumerate(times):
            bpy.context.scene.frame_set(int(round(tt * FPS)))
            p = os.path.join(OUT_PREVIEW, f'_a_{name}_{i}.png')
            render(p, cam, tgt, lens=28, res=(400, 300))
            shots.append(p)
        contact_sheet(shots, 6, os.path.join(OUT_PREVIEW, f'anim_{name}.png'))
    ob_arm.animation_data.action = None
    bpy.context.scene.frame_set(0)
    bpy.data.objects.remove(g)

if 'export' in ARGS:
    bpy.ops.object.mode_set(mode='OBJECT')
    reset_pose(ob_arm)
    bpy.context.view_layer.update()
    export_glb(os.path.join(OUT_ASSETS, 'halcyon.glb'), [ob_arm, ob_mesh] + shell_objs)
    with open(os.path.join(OUT_ASSETS, 'halcyon_meta.json'), 'w') as fp:
        json.dump(META, fp, separators=(',', ':'))
    print('META written')
