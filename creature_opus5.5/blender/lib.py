"""Shared helpers for the HALCYON Blender asset pipeline.

Everything is procedural so assets can be rebuilt headlessly:
    blender -b --factory-startup --python blender/build_halcyon.py
"""
import bpy, bmesh, math, json, os, random
from mathutils import Vector, Matrix, Euler, Quaternion

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ASSETS = os.path.join(ROOT, 'public', 'assets')
OUT_PREVIEW = os.path.join(ROOT, 'docs', 'preview')
os.makedirs(OUT_ASSETS, exist_ok=True)
os.makedirs(OUT_PREVIEW, exist_ok=True)

FPS = 30


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.frame_start = 0
    return sc


def V(x, y, z):
    return Vector((x, y, z))


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def smooth(t):
    t = clamp(t)
    return t * t * (3 - 2 * t)


# ----------------------------------------------------------------------------
# Curves
# ----------------------------------------------------------------------------

def catmull(points, samples_per_seg=8):
    """Centripetal-ish Catmull-Rom through points, returns dense list of Vectors."""
    pts = [Vector(p) for p in points]
    if len(pts) < 2:
        return pts
    ext = [pts[0] + (pts[0] - pts[1])] + pts + [pts[-1] + (pts[-1] - pts[-2])]
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for s in range(samples_per_seg):
            t = s / samples_per_seg
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1].copy())
    return out


def resample(path, n):
    """Resample polyline to n points evenly by arc length."""
    d = [0.0]
    for i in range(1, len(path)):
        d.append(d[-1] + (path[i] - path[i - 1]).length)
    L = d[-1]
    out = []
    j = 0
    for k in range(n):
        s = L * k / (n - 1)
        while j < len(d) - 2 and d[j + 1] < s:
            j += 1
        seg = d[j + 1] - d[j]
        t = 0 if seg < 1e-9 else (s - d[j]) / seg
        out.append(path[j].lerp(path[j + 1], t))
    return out


# ----------------------------------------------------------------------------
# Mesh builder: accumulates geometry with weights / colors / materials
# ----------------------------------------------------------------------------

class MeshBuilder:
    def __init__(self):
        self.verts = []      # Vector
        self.weights = []    # dict bone->w
        self.colors = []     # (r,g,b,a)
        self.faces = []      # (idx tuple, mat_index, smooth)

    def add_vert(self, co, w=None, col=(1, 1, 1, 0)):
        self.verts.append(Vector(co))
        self.weights.append(w or {})
        self.colors.append(tuple(col))
        return len(self.verts) - 1

    def add_face(self, idx, mat=0, smooth=True):
        self.faces.append((tuple(idx), mat, smooth))

    def tube(self, path, radius, sides=10, up=V(0, 0, 1), profile=None, mat=0, smooth=True,
             weight_fn=None, color_fn=None, cap0=True, cap1=True, twist=0.0):
        """Loft a tube along path (list of Vector).

        radius(u) -> float, profile(theta, u) -> radial multiplier (or (mx, mz) tuple for ellipse)
        weight_fn(u, co) -> dict, color_fn(u, theta, co) -> rgba
        Frame: parallel transport starting from `up`.
        """
        n = len(path)
        tangents = []
        for i in range(n):
            if i == 0:
                t = path[1] - path[0]
            elif i == n - 1:
                t = path[-1] - path[-2]
            else:
                t = path[i + 1] - path[i - 1]
            tangents.append(t.normalized())
        # initial normal
        t0 = tangents[0]
        nrm = (up - t0 * up.dot(t0))
        if nrm.length < 1e-4:
            nrm = V(1, 0, 0) - t0 * t0.x
        nrm.normalize()
        frames = []
        for i in range(n):
            if i > 0:
                rot = tangents[i - 1].rotation_difference(tangents[i])
                nrm = rot @ nrm
                nrm = (nrm - tangents[i] * nrm.dot(tangents[i])).normalized()
            b = tangents[i].cross(nrm).normalized()
            frames.append((nrm.copy(), b))
        rings = []
        for i in range(n):
            u = i / (n - 1)
            r = radius(u) if callable(radius) else radius
            c = path[i]
            if r < 1e-4 and (i == 0 or i == n - 1):
                w = weight_fn(u, c) if weight_fn else None
                col = color_fn(u, 0.0, c) if color_fn else (1, 1, 1, 0)
                rings.append([self.add_vert(c, w, col)])
                continue
            nr, bn = frames[i]
            ring = []
            for s in range(sides):
                th = 2 * math.pi * s / sides + twist * u
                mx = mz = 1.0
                if profile:
                    p = profile(th, u)
                    if isinstance(p, tuple):
                        mx, mz = p
                    else:
                        mx = mz = p
                off = nr * (math.cos(th) * r * mz) + bn * (math.sin(th) * r * mx)
                co = c + off
                w = weight_fn(u, co) if weight_fn else None
                col = color_fn(u, th, co) if color_fn else (1, 1, 1, 0)
                ring.append(self.add_vert(co, w, col))
            rings.append(ring)
        for i in range(n - 1):
            a, b = rings[i], rings[i + 1]
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                for s in range(len(b)):
                    self.add_face((a[0], b[s], b[(s + 1) % len(b)]), mat, smooth)
            elif len(b) == 1:
                for s in range(len(a)):
                    self.add_face((a[s], b[0], a[(s + 1) % len(a)]), mat, smooth)
            else:
                for s in range(sides):
                    s2 = (s + 1) % sides
                    self.add_face((a[s], b[s], b[s2], a[s2]), mat, smooth)
        if cap0 and len(rings[0]) > 1:
            self.add_face(tuple(reversed(rings[0])), mat, smooth)
        if cap1 and len(rings[-1]) > 1:
            self.add_face(tuple(rings[-1]), mat, smooth)
        return rings

    def ellipsoid(self, center, radii, rot=None, seg=16, rings=10, mat=0, smooth=True, weight=None,
                  color_fn=None, shape_fn=None):
        """UV ellipsoid. shape_fn(dir)->scale multiplier for organic bumps."""
        rot = rot or Matrix.Identity(3)
        idx = []
        top = None
        for r in range(rings + 1):
            phi = math.pi * r / rings
            row = []
            for s in range(seg if 0 < r < rings else 1):
                th = 2 * math.pi * s / seg
                d = V(math.sin(phi) * math.cos(th), math.sin(phi) * math.sin(th), math.cos(phi))
                m = shape_fn(d) if shape_fn else 1.0
                p = V(d.x * radii[0], d.y * radii[1], d.z * radii[2]) * m
                co = Vector(center) + rot @ p
                col = color_fn(d, co) if color_fn else (1, 1, 1, 0)
                row.append(self.add_vert(co, weight, col))
            idx.append(row)
        for r in range(rings):
            a, b = idx[r], idx[r + 1]
            if len(a) == 1:
                for s in range(seg):
                    self.add_face((a[0], b[s], b[(s + 1) % seg]), mat, smooth)
            elif len(b) == 1:
                for s in range(seg):
                    self.add_face((a[s], b[0], a[(s + 1) % seg]), mat, smooth)
            else:
                for s in range(seg):
                    s2 = (s + 1) % seg
                    self.add_face((a[s], b[s], b[s2], a[s2]), mat, smooth)

    def prism(self, base, axis, radius, length, tip=0.35, sides=6, mat=0, weight=None, col=(1, 1, 1, 0),
              taper=0.9, rnd=None, roll=0.0, tip_offset=0.0, col_tip=None):
        """Faceted crystal prism with pointed tip (flat shaded)."""
        rnd = rnd or random.Random(0)
        axis = Vector(axis).normalized()
        ref = V(0, 0, 1) if abs(axis.z) < 0.9 else V(1, 0, 0)
        u = axis.cross(ref).normalized()
        v = axis.cross(u).normalized()
        base = Vector(base)
        top_c = base + axis * length
        ring0, ring1 = [], []
        for s in range(sides):
            th = 2 * math.pi * s / sides + roll
            rr = radius * (0.85 + 0.3 * rnd.random())
            d = u * math.cos(th) + v * math.sin(th)
            ring0.append(self.add_vert(base + d * rr, weight, col))
            ring1.append(self.add_vert(top_c + d * rr * taper, weight, col))
        tip_pt = top_c + axis * (radius * tip * 3.0) + (u * tip_offset * radius)
        ti = self.add_vert(tip_pt, weight, col_tip or col)
        for s in range(sides):
            s2 = (s + 1) % sides
            self.add_face((ring0[s], ring0[s2], ring1[s2], ring1[s]), mat, False)
            self.add_face((ring1[s], ring1[s2], ti), mat, False)
        self.add_face(tuple(reversed(ring0)), mat, False)

    def build(self, name, materials, collection=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.verts], [], [f[0] for f in self.faces])
        me.update()
        for i, p in enumerate(me.polygons):
            p.material_index = self.faces[i][1]
            p.use_smooth = self.faces[i][2]
        for m in materials:
            me.materials.append(m)
        # color attribute (point domain, RGBA float)
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(self.colors):
            ca.data[i].color = c
        me.color_attributes.active_color = ca
        # glTF drops colour alpha, so the glow mask also travels in UV.x
        uvl = me.uv_layers.new(name='UVMap')
        for loop in me.loops:
            uvl.data[loop.index].uv = (self.colors[loop.vertex_index][3], 0.0)
        ob = bpy.data.objects.new(name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        # vertex groups
        groups = {}
        for i, w in enumerate(self.weights):
            for bn, val in w.items():
                if val <= 0:
                    continue
                if bn not in groups:
                    groups[bn] = ob.vertex_groups.new(name=bn)
                groups[bn].add([i], val, 'REPLACE')
        # recompute normals outward
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        return ob


# ----------------------------------------------------------------------------
# Materials (preview look + names consumed by the game)
# ----------------------------------------------------------------------------

def material(name, color, rough=0.5, metal=0.0, emit=None, emit_strength=0.0, use_vcol=True, alpha=1.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if use_vcol:
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs[6].default_value = (*color, 1)
        nt.links.new(attr.outputs['Color'], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    m.diffuse_color = (*color, 1)
    return m


# ----------------------------------------------------------------------------
# Armature
# ----------------------------------------------------------------------------

def new_armature(name):
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    return ob, arm


def add_bone(arm, name, head, tail, parent=None, deform=True, connect=False, xaxis=V(1, 0, 0), roll_z=None):
    eb = arm.edit_bones.new(name)
    eb.head = Vector(head)
    eb.tail = Vector(tail)
    if parent:
        eb.parent = arm.edit_bones[parent]
        eb.use_connect = connect
    eb.use_deform = deform
    d = (eb.tail - eb.head).normalized()
    if roll_z is not None:
        eb.align_roll(roll_z)
    elif xaxis is not None:
        z = Vector(xaxis).cross(d)
        if z.length > 1e-4:
            eb.align_roll(z.normalized())
    return eb


def skin_to(ob_mesh, ob_arm):
    ob_mesh.parent = ob_arm
    mod = ob_mesh.modifiers.new('Armature', 'ARMATURE')
    mod.object = ob_arm


def parent_to_bone(ob, ob_arm, bone):
    """Rigidly attach an object to a bone keeping its world transform."""
    mw = ob.matrix_world.copy()
    ob.parent = ob_arm
    ob.parent_type = 'BONE'
    ob.parent_bone = bone
    bpy.context.view_layer.update()
    pb = ob_arm.pose.bones[bone]
    # bone-parent matrix is at the bone tail
    bone_mat = ob_arm.matrix_world @ pb.matrix @ Matrix.Translation(V(0, pb.bone.length, 0))
    ob.matrix_parent_inverse = bone_mat.inverted()
    ob.matrix_world = mw


# ----------------------------------------------------------------------------
# Animation baking
# ----------------------------------------------------------------------------

def ease(kind, t):
    t = clamp(t)
    if kind == 'lin':
        return t
    if kind == 'in':
        return t * t * t
    if kind == 'in2':
        return t * t
    if kind == 'out':
        return 1 - (1 - t) ** 3
    if kind == 'out2':
        return 1 - (1 - t) ** 2
    if kind == 'snap':  # very fast attack, soft landing
        return 1 - (1 - t) ** 5
    if kind == 'back':  # overshoot
        c1 = 1.70158 * 1.2
        c3 = c1 + 1
        return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
    if kind == 'hold':
        return 0.0 if t < 1 else 1.0
    return t * t * (3 - 2 * t)  # 'io'


def track(keys, t):
    """keys: list of (time, value, ease_into_this_key). value: float or tuple."""
    if t <= keys[0][0]:
        return keys[0][1]
    for i in range(1, len(keys)):
        t1, v1, e = keys[i]
        t0, v0 = keys[i - 1][0], keys[i - 1][1]
        if t <= t1:
            u = ease(e, (t - t0) / max(1e-6, t1 - t0))
            if isinstance(v0, (tuple, list)):
                return tuple(a + (b - a) * u for a, b in zip(v0, v1))
            return v0 + (v1 - v0) * u
    return keys[-1][1]


def set_rot_mode(ob_arm, mode='XYZ'):
    for pb in ob_arm.pose.bones:
        pb.rotation_mode = mode


def reset_pose(ob_arm):
    for pb in ob_arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)


def bake_action(ob_arm, name, duration, pose_fn, keyed_bones, loop=False):
    """Create an action by sampling pose_fn(t) every frame.

    pose_fn(t) must apply a pose to ob_arm.pose.bones (after reset_pose).
    keyed_bones: {bone: ('loc','rot','scale')}
    """
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ob_arm.animation_data_create()
    ob_arm.animation_data.action = act
    nframes = int(round(duration * FPS))
    for f in range(nframes + 1):
        t = f / FPS
        if loop and f == nframes:
            t = 0.0  # exact loop closure
        reset_pose(ob_arm)
        pose_fn(t)
        for bn, chans in keyed_bones.items():
            pb = ob_arm.pose.bones[bn]
            if 'loc' in chans:
                pb.keyframe_insert('location', frame=f)
            if 'rot' in chans:
                pb.keyframe_insert('rotation_euler', frame=f)
            if 'scale' in chans:
                pb.keyframe_insert('scale', frame=f)
    # linear interpolation for dense keys
    for layer in act.layers:
        for strip in layer.strips:
            for slot in act.slots:
                cb = strip.channelbag(slot)
                if cb:
                    for fc in cb.fcurves:
                        for kp in fc.keyframe_points:
                            kp.interpolation = 'LINEAR'
    tr = ob_arm.animation_data.nla_tracks.new()
    tr.name = name
    st = tr.strips.new(name, 0, act)
    tr.mute = True
    ob_arm.animation_data.action = None
    return act


def sample_sockets(ob_arm, act, sockets, duration):
    """Sample world positions of sockets for each frame. sockets: {name: (bone, local_offset_along_bone_space)}.
    Returns dict name -> list of [x,y,z] in glTF (Y-up) coordinates."""
    ob_arm.animation_data.action = act
    sc = bpy.context.scene
    nframes = int(round(duration * FPS))
    out = {k: [] for k in sockets}
    for f in range(nframes + 1):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        for k, (bn, off) in sockets.items():
            pb = ob_arm.pose.bones[bn]
            p = ob_arm.matrix_world @ pb.matrix @ Vector(off)
            out[k].append([round(p.x, 3), round(p.z, 3), round(-p.y, 3)])
    ob_arm.animation_data.action = None
    return out


# ----------------------------------------------------------------------------
# Preview rendering
# ----------------------------------------------------------------------------

def preview_setup(bg_top=(0.18, 0.2, 0.36), bg_bottom=(0.95, 0.72, 0.62), sun_dir=(0.6, 0.9, 0.12), sun_col=(1.0, 0.75, 0.6), sun_power=3.0):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 960
    sc.render.resolution_y = 720
    sc.render.film_transparent = False
    try:
        sc.view_settings.view_transform = 'AgX'
    except Exception:
        pass
    world = bpy.data.worlds.new('W')
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == 'BACKGROUND')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.45
    ramp.color_ramp.elements[0].color = (*bg_bottom, 1)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (*bg_top, 1)
    nt.links.new(tc.outputs['Window'], sep.inputs[0])
    nt.links.new(sep.outputs['Y'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = sun_power
    sun.color = sun_col
    sun.angle = 0.05
    so = bpy.data.objects.new('Sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = Vector(sun_dir).to_track_quat('Z', 'Y').to_euler()
    fill = bpy.data.lights.new('Fill', 'SUN')
    fill.energy = 0.8
    fill.color = (0.6, 0.62, 0.95)
    fo = bpy.data.objects.new('Fill', fill)
    sc.collection.objects.link(fo)
    fo.rotation_euler = Vector((-0.4, -0.6, 0.7)).to_track_quat('Z', 'Y').to_euler()
    # ground plane
    me = bpy.data.meshes.new('ground')
    s = 60
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('PreviewGround', me)
    gm = material('PreviewGround', (0.85, 0.82, 0.88), rough=0.15, use_vcol=False)
    me.materials.append(gm)
    sc.collection.objects.link(g)
    return g


def render(path, cam_loc, target, lens=35, res=(960, 720)):
    sc = bpy.context.scene
    cam = sc.camera
    if cam is None:
        cd = bpy.data.cameras.new('Cam')
        cam = bpy.data.objects.new('Cam', cd)
        sc.collection.objects.link(cam)
        sc.camera = cam
    cam.data.lens = lens
    cam.data.clip_end = 500
    cam.location = Vector(cam_loc)
    d = Vector(target) - Vector(cam_loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def contact_sheet(paths, cols, out, label_px=0):
    """Compose rendered PNGs into a grid (uses numpy bundled with Blender)."""
    import numpy as np
    imgs = []
    for p in paths:
        im = bpy.data.images.load(p)
        w, h = im.size
        a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
        imgs.append(a)
        bpy.data.images.remove(im)
    h, w = imgs[0].shape[:2]
    rows = (len(imgs) + cols - 1) // cols
    sheet = np.ones((rows * h, cols * w, 4), dtype=np.float32)
    for i, a in enumerate(imgs):
        r, c = divmod(i, cols)
        # images are stored bottom-up
        y0 = (rows - 1 - r) * h
        sheet[y0:y0 + h, c * w:(c + 1) * w] = a
        sheet[y0:y0 + h, c * w:c * w + 2] = 0
        sheet[y0:y0 + 2, c * w:(c + 1) * w] = 0
    img = bpy.data.images.new('sheet', cols * w, rows * h, alpha=True)
    img.pixels = sheet.ravel()
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            pass


def export_glb(path, objects=None, animations=True):
    if objects is not None:
        for o in bpy.context.scene.objects:
            o.select_set(False)
        for o in objects:
            o.select_set(True)
    kw = dict(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
              use_selection=objects is not None, export_animations=animations,
              export_animation_mode='ACTIONS', export_force_sampling=True,
              export_optimize_animation_size=False, export_def_bones=False,
              export_extras=True)
    props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    if 'export_vertex_color' in props:
        kw['export_vertex_color'] = 'ACTIVE'
    if 'export_all_vertex_colors' in props:
        kw['export_all_vertex_colors'] = True
    kw = {k: v for k, v in kw.items() if k in props}
    bpy.ops.export_scene.gltf(**kw)
    print('EXPORTED', path, os.path.getsize(path))
