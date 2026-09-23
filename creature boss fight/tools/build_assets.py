"""Build the Tidal Bell's skinned creature and observatory in Blender 5.2.

Run: blender --background --python tools/build_assets.py
All forms, materials, rig, and keyframed clips are authored here so the source
is editable and the exported GLBs can be regenerated.
"""
import bpy
import math
import copy
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'assets'
OUT.mkdir(parents=True, exist_ok=True)


def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material(name, color, metallic=0, roughness=.55, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = emission
    return m


PEARL = material('01 porcelain shell', (.78,.91,.85), .12, .31)
SHELL_DARK = material('02 deep teal shell edges', (.075,.28,.31), .25, .4)
BODY = material('03 midnight blue flesh', (.025,.095,.13), .1, .62)
FIN = material('04 sea glass fin', (.22,.65,.66), .28, .31)
CORE = material('05 resonant heart', (.10,.72,.69), .05, .25, 1.35)
BRASS = material('06 patinated metal', (.38,.62,.55), .68, .4)
STONE = material('07 submerged basalt', (.052,.12,.145), .1, .76)
STONE2 = material('08 inlaid stone', (.085,.18,.19), .2, .54)
FLOORLINE = material('09 luminous survey inlay', (.13,.48,.5), .32, .35, .75)


def finish(obj, mat, name, smooth=True):
    obj.name = name
    obj.data.materials.append(mat)
    if smooth and obj.type == 'MESH':
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def uv(name, pos, scale, mat, segments=24, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=pos)
    o = bpy.context.object
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, mat, name)


def cylinder(name, pos, radius, depth, mat, vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=pos)
    o = finish(bpy.context.object, mat, name)
    bevel = o.modifiers.new('soft machined edge', 'BEVEL')
    bevel.width = min(.085, depth * .18)
    bevel.segments = 2
    o.modifiers.new('weighted normals', 'WEIGHTED_NORMAL')
    return o


def torus(name, pos, radius, thickness, mat, major_segments=96):
    bpy.ops.mesh.primitive_torus_add(major_segments=major_segments, minor_segments=8,
                                     location=pos, major_radius=radius, minor_radius=thickness)
    return finish(bpy.context.object, mat, name)


def rod(name, a, b, radius, mat, vertices=10):
    mid = (Vector(a) + Vector(b)) / 2
    direction = Vector(b) - Vector(a)
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=radius*.72,
                                    depth=direction.length, location=mid)
    o = bpy.context.object
    o.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    return finish(o, mat, name)


def blade(name, points, widths, mat):
    # Lens cross sections produce an organic, sharp fin rather than a box segment.
    verts = []
    for i, p in enumerate(points):
        p = Vector(p)
        tangent = Vector(points[min(i+1,len(points)-1)]) - Vector(points[max(i-1,0)])
        lateral = Vector((-tangent.y, tangent.x, 0)).normalized()
        w = widths[i]
        verts += [tuple(p+lateral*w), tuple(p+Vector((0,0,w*.22))),
                  tuple(p-lateral*w), tuple(p-Vector((0,0,w*.22)))]
    faces = []
    for i in range(len(points)-1):
        for j in range(4):
            a = i*4+j
            b = i*4+(j+1)%4
            faces.append((a,b,b+4,a+4))
    faces += [(3,2,1,0), tuple((len(points)-1)*4+j for j in range(4))]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    return finish(o, mat, name)


def shell_leaf(name, side, mat):
    verts=[]
    rows,cols=14,16
    start=-math.pi/2 if side>0 else math.pi/2
    for i in range(rows+1):
        lat=math.pi*i/rows
        for j in range(cols+1):
            az=start+math.pi*j/cols
            verts.append((1.27*math.sin(lat)*math.cos(az),
                          .31+1.13*math.sin(lat)*math.sin(az),
                          3.53+.96*math.cos(lat)))
    faces=[]
    for i in range(rows):
        for j in range(cols):
            a=i*(cols+1)+j
            faces.append((a,a+1,a+cols+2,a+cols+1) if side>0 else
                         (a+cols+1,a+cols+2,a+1,a))
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(verts,[],faces)
    mesh.update()
    o=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(o)
    return finish(o,mat,name)


def skin(o, bone, arm):
    group = o.vertex_groups.new(name=bone)
    group.add(list(range(len(o.data.vertices))), 1, 'REPLACE')
    mod = o.modifiers.new('living rig', 'ARMATURE')
    mod.object = arm
    o.parent = arm


def build_creature():
    reset()
    bpy.ops.object.armature_add(location=(0,0,0))
    arm = bpy.context.object
    arm.name = 'The Hollow Bell | expressive skeleton'
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    eb.remove(eb[0])
    specs = {
        'root': ((0,0,.1),(0,0,1), None),
        'body': ((0,0,1),(0,0,2.6),'root'),
        'shell': ((0,0,2.45),(0,0,3.7),'body'),
        'shell_L': ((0,.31,3.30),(0,.31,4.05),'shell'),
        'shell_R': ((0,.31,3.30),(0,.31,4.05),'shell'),
        'heart': ((0,-.55,2.45),(0,-1.2,2.45),'body'),
        'fin_L': ((-.85,-.45,2.55),(-2.6,-.75,2.2),'body'),
        'tip_L': ((-2.6,-.75,2.2),(-4.0,-1.25,1.75),'fin_L'),
        'fin_R': ((.85,-.45,2.55),(2.6,-.75,2.2),'body'),
        'tip_R': ((2.6,-.75,2.2),(4.0,-1.25,1.75),'fin_R'),
        'leg_FL': ((-.7,-.5,1.4),(-1.55,-1.35,.3),'body'),
        'leg_FR': ((.7,-.5,1.4),(1.55,-1.35,.3),'body'),
        'leg_BL': ((-.65,.7,1.3),(-1.45,1.35,.2),'body'),
        'leg_BR': ((.65,.7,1.3),(1.45,1.35,.2),'body'),
        'antenna_L': ((-.37,-.78,3.1),(-.75,-1.8,4.35),'shell'),
        'antenna_R': ((.37,-.78,3.1),(.75,-1.8,4.35),'shell'),
    }
    for name,(head,tail,parent) in specs.items():
        b = eb.new(name)
        b.head, b.tail = head, tail
        if parent: b.parent = eb[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    parts = []
    def add(ob,bone):
        skin(ob,bone,arm)
        parts.append(ob)

    add(uv('pendulous abdomen',(0,.25,1.83),(1.03,1.14,1.07),BODY), 'body')
    add(uv('breast plate',(0,-.72,2.25),(.79,.39,.78),SHELL_DARK), 'body')
    add(uv('resonance heart',(0,-1.14,2.47),(.48,.21,.52),CORE),'heart')
    add(torus('heart retaining ring',(0,-1.34,2.47),.49,.055,BRASS),'heart')
    for x in (-.49,.49):
        add(uv('sensory pearl',(x,-.98,2.88),(.14,.11,.17),CORE), 'body')

    # High bell canopy and overlapping skirt: prominent shape even in silhouette.
    add(uv('hidden resonant mantle',(0,.31,3.43),(.72,.67,.72),CORE),'body')
    add(shell_leaf('left porcelain shell leaf',-1,PEARL),'shell_L')
    add(shell_leaf('right porcelain shell leaf',1,PEARL),'shell_R')
    add(uv('lower shell dark seam',(0,.32,2.94),(1.42,1.27,.37),SHELL_DARK),'shell')
    for i in range(7):
        angle=2*math.pi*i/7
        p=(math.cos(angle)*1.05, math.sin(angle)*1.05+.31,3.22)
        tip=(math.cos(angle)*1.47, math.sin(angle)*1.47+.31,2.67)
        add(blade('segmented porcelain bell skirt', [p,((p[0]+tip[0])*.5,(p[1]+tip[1])*.5,2.82),tip], [.35,.42,.03], PEARL),'shell_R' if math.cos(angle)>=0 else 'shell_L')
    for i in range(5):
        angle=math.pi*1.09 + i*(math.pi*.82/4)
        a=(math.cos(angle)*.29,math.sin(angle)*.29+.31,4.26)
        b=(math.cos(angle)*1.16,math.sin(angle)*1.04+.31,3.04)
        add(rod('fine shell flute',a,b,.028,BRASS),'shell_R' if math.cos(angle)>=0 else 'shell_L')
    add(uv('bell apex',(0,.30,4.39),(.29,.31,.23),BRASS),'shell')

    for side,letter in ((-1,'L'),(1,'R')):
        add(uv('arm joint '+letter,(side*.88,-.47,2.5),(.35,.37,.37),BRASS),'fin_'+letter)
        add(blade('broad swimming blade '+letter,
                  [(side*.87,-.47,2.48),(side*1.62,-.54,2.69),(side*2.55,-.78,2.26)],
                  [.24,.59,.21],FIN),'fin_'+letter)
        add(uv('elbow '+letter,(side*2.55,-.78,2.25),(.29,.27,.29),SHELL_DARK),'tip_'+letter)
        add(blade('bone white sickle tip '+letter,
                  [(side*2.56,-.78,2.27),(side*3.30,-1.02,2.06),(side*4.05,-1.30,1.77)],
                  [.24,.37,.025],PEARL),'tip_'+letter)
        for front,tag in ((-1,'F'),(1,'B')):
            x=side*(.7 if front==-1 else .65)
            y=-.5 if front==-1 else .7
            end=(side*(1.60 if front==-1 else 1.47), -1.38 if front==-1 else 1.36, .18)
            bone='leg_'+tag+letter
            add(blade('hinged walking leg '+tag+letter,
                      [(x,y,1.45),(side*1.15,(y+end[1])*.48,1.06),end],
                      [.22,.30,.065],BODY),bone)
            add(uv('leg socket '+tag+letter,(x,y,1.4),(.3,.30,.26),SHELL_DARK),bone)
            add(blade('pearl toe '+tag+letter,[end,(end[0]*1.07,end[1]*1.08,.08)], [.13,.015],PEARL),bone)
        add(rod('whisker stem '+letter,(side*.38,-.77,3.22),(side*.74,-1.73,4.35),.045,BRASS),'antenna_'+letter)
        add(uv('whisker pearl '+letter,(side*.74,-1.73,4.35),(.11,.11,.11),CORE),'antenna_'+letter)

    # Keyed rig clips: changes in center of mass precede every large movement.
    bones=arm.pose.bones
    def pose(frame, values):
        for n,p in bones.items():
            p.rotation_mode='XYZ'
            p.rotation_euler=(0,0,0)
            p.location=(0,0,0)
        for n, params in values.items():
            b=bones[n]
            if 'r' in params: b.rotation_euler=params['r']
            if 'l' in params: b.location=params['l']
        for p in bones.values():
            p.keyframe_insert(data_path='rotation_euler',frame=frame)
            p.keyframe_insert(data_path='location',frame=frame)

    clips={
      'idle':[(1,{}),(19,{'body':{'l':(0,0,.07),'r':(.025,0,0)},'shell':{'r':(.02,0,.035)},'antenna_L':{'r':(0,.12,0)},'antenna_R':{'r':(0,-.12,0)}}),(37,{})],
      'stride':[(1,{}),(9,{'body':{'l':(0,0,-.13),'r':(.06,0,0)},'leg_FL':{'r':(.42,0,0)},'leg_BR':{'r':(.32,0,0)},'leg_FR':{'r':(-.3,0,0)},'leg_BL':{'r':(-.35,0,0)}}),(17,{'body':{'l':(0,0,.08)},'leg_FL':{'r':(-.28,0,0)},'leg_BR':{'r':(-.33,0,0)},'leg_FR':{'r':(.38,0,0)},'leg_BL':{'r':(.40,0,0)}}),(25,{})],
      'sweep':[(1,{}),(12,{'body':{'r':(.12,0,-.16),'l':(0,0,-.14)},'fin_R':{'r':(0,0,.75)},'tip_R':{'r':(0,0,.3)}}),(18,{'body':{'r':(-.12,0,.35)},'fin_R':{'r':(0,0,-.9)},'tip_R':{'r':(0,0,-.52)},'shell':{'r':(.15,0,0)}}),(26,{'body':{'r':(-.1,0,.25)},'fin_R':{'r':(0,0,-.75)}}),(42,{})],
      'lance':[(1,{}),(12,{'body':{'l':(0,.25,-.18),'r':(-.16,0,0)},'fin_L':{'r':(0,0,-.65)},'fin_R':{'r':(0,0,.65)}}),(18,{'body':{'l':(0,-.23,.1),'r':(.22,0,0)},'fin_L':{'r':(0,0,.42)},'fin_R':{'r':(0,0,-.42)},'tip_L':{'r':(.25,0,0)},'tip_R':{'r':(.25,0,0)}}),(30,{'body':{'l':(0,-.1,.02)}}),(43,{})],
      'pulse':[(1,{}),(13,{'body':{'l':(0,0,-.22)},'shell':{'r':(-.22,0,0)},'fin_L':{'r':(0,0,.4)},'fin_R':{'r':(0,0,-.4)}}),(21,{'body':{'l':(0,0,.30)},'shell':{'r':(.24,0,0)},'heart':{'l':(0,-.16,0)},'fin_L':{'r':(0,0,-.45)},'fin_R':{'r':(0,0,.45)}}),(33,{'body':{'l':(0,0,.09)}}),(49,{})],
      'recoil':[(1,{}),(4,{'body':{'r':(-.22,0,.18),'l':(0,.16,-.16)},'shell':{'r':(-.12,0,0)},'fin_L':{'r':(0,0,.3)},'fin_R':{'r':(0,0,-.3)}}),(12,{})],
      'unfurl':[(1,{}),(13,{'body':{'l':(0,0,-.32)},'shell':{'r':(-.2,0,0)}}),(29,{'body':{'l':(0,0,.25)},'shell':{'l':(0,0,.52),'r':(.28,0,0)},'shell_L':{'l':(-.72,0,0)},'shell_R':{'l':(.72,0,0)},'fin_L':{'r':(0,0,.68)},'fin_R':{'r':(0,0,-.68)},'antenna_L':{'r':(0,.33,0)},'antenna_R':{'r':(0,-.33,0)}}),(47,{'shell':{'l':(0,0,.35)},'shell_L':{'l':(-.67,0,0)},'shell_R':{'l':(.67,0,0)},'fin_L':{'r':(0,0,.29)},'fin_R':{'r':(0,0,-.29)}})],
      'defeat':[(1,{}),(12,{'body':{'r':(.15,0,.2),'l':(0,0,-.25)},'fin_L':{'r':(0,0,.47)},'fin_R':{'r':(0,0,-.42)}}),(30,{'root':{'r':(.75,0,.32),'l':(0,0,-.48)},'body':{'r':(.24,0,0)},'shell':{'r':(.48,0,0)},'shell_L':{'l':(-1.1,0,.1)},'shell_R':{'l':(1.1,0,.1)},'fin_L':{'r':(0,0,1.1)},'fin_R':{'r':(0,0,-.9)}}),(53,{'root':{'r':(1.18,0,.48),'l':(0,0,-1.18)},'shell':{'r':(.6,0,0)},'shell_L':{'l':(-1.25,0,0)},'shell_R':{'l':(1.25,0,0)}})],
    }
    for name in ('idle','stride','sweep','lance','pulse','recoil'):
        phase_keys=[]
        for frame,values in clips[name]:
            raised=copy.deepcopy(values)
            shell=raised.setdefault('shell',{})
            prior=shell.get('l',(0,0,0))
            shell['l']=(prior[0],prior[1],prior[2]+.37)
            heart=raised.setdefault('heart',{})
            prior=heart.get('l',(0,0,0))
            heart['l']=(prior[0],prior[1]-.18,prior[2])
            raised['shell_L']={'l':(-.67,0,0)}
            raised['shell_R']={'l':(.67,0,0)}
            phase_keys.append((frame,raised))
        clips['phase_'+name]=phase_keys
    arm.animation_data_create()
    for name,keys in clips.items():
        action=bpy.data.actions.new(name)
        arm.animation_data.action=action
        for frame,values in keys: pose(frame,values)
        # Stash each clip in a distinct NLA track for glTF's NLA export.
        arm.animation_data.action=None
        track=arm.animation_data.nla_tracks.new()
        track.name=name
        strip=track.strips.new(name, int(keys[0][0]), action)
        strip.action_frame_start=keys[0][0]
        strip.action_frame_end=keys[-1][0]
        track.mute=True
    bpy.context.view_layer.objects.active=arm
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets_source.blend'))
    bpy.ops.export_scene.gltf(filepath=str(OUT/'hollow_bell.glb'),export_format='GLB',
                              export_animation_mode='NLA_TRACKS',export_nla_strips=True)


def build_arena():
    reset()
    cylinder('deep circular foundation',(0,0,-.55),13.85,1.1,STONE)
    cylinder('walkable pearl slate disc',(0,0,-.015),12.8,.08,STONE2)
    cylinder('central submerged well',(0,0,.005),3.12,.09,STONE)
    torus('bronze well lip',(0,0,.07),3.15,.12,BRASS)
    for r in (4.3,6.6,9.4,12.35):
        torus('survey distance circle',(0,0,.055),r,.035 if r!=12.35 else .07,FLOORLINE)
    for i in range(24):
        a=i*2*math.pi/24
        r0,r1=(11.6,12.1) if i%3 else (10.75,12.1)
        rod('radial measuring tick',(r0*math.cos(a),r0*math.sin(a),.09),
            (r1*math.cos(a),r1*math.sin(a),.09),.028,BRASS)
    for i in range(8):
        a=2*math.pi*i/8 + math.pi/8
        # Wide, low fins act as legible eight-sector landmarks, not scatter props.
        p0=(12.75*math.cos(a),12.75*math.sin(a),.11)
        p1=(13.48*math.cos(a),13.48*math.sin(a),.11)
        rod('perimeter divider',p0,p1,.08,BRASS)
    for i in range(4):
        a=i*math.pi/2 + math.pi/4
        x,y=16.0*math.cos(a),16.0*math.sin(a)
        cylinder('tuning plinth',(x,y,.24),1.18,.48,STONE)
        cylinder('plinth cap',(x,y,.52),1.0,.12,BRASS)
        for side in (-1,1):
            tangent=Vector((-math.sin(a), math.cos(a),0))
            p=Vector((x,y,.55))+side*tangent*.48
            rod('tuning fork prong',p,p+Vector((0,0,5.0)),.19,STONE2)
            uv('fork pearl',p+Vector((0,0,5.04)),(.23,.23,.23),CORE)
        rod('tuning fork bridge',Vector((x,y,3.74))-tangent*.48,
            Vector((x,y,3.74))+tangent*.48,.13,BRASS)
    # A large suspended survey ring frames the fight without occluding the floor.
    torus('broken halo arc',(0,0,8.3),15.8,.15,BRASS)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'arena_source.blend'))
    bpy.ops.export_scene.gltf(filepath=str(OUT/'observatory.glb'),export_format='GLB',
                              export_animations=False)


def build_player():
    reset()
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=.49, radius2=.29, depth=1.35, location=(0,0,.83))
    finish(bpy.context.object, PEARL, 'survey warden cloak', False)
    uv('helmet',(0,-.04,1.73),(.32,.34,.34),STONE2)
    uv('visor',(0,-.32,1.73),(.23,.08,.095),CORE)
    torus('halo collar',(0,0,1.45),.37,.055,BRASS)
    for side in (-1,1):
        uv('shoulder plate',(side*.36,-.03,1.37),(.19,.28,.14),BRASS)
        rod('sleeve',(side*.38,-.08,1.38),(side*.46,-.22,.92),.15,STONE2)
        rod('boot',(side*.18,.03,.30),(side*.19,-.11,.055),.16,STONE2)
    rod('resonance staff',(.60,-.26,.36),(.60,-.26,1.89),.055,BRASS)
    blade('staff crescent',[(.44,-.26,1.77),(.60,-.26,2.09),(.83,-.26,1.80)],
          [.045,.13,.01],FIN)
    uv('staff light',(.60,-.26,2.01),(.13,.13,.13),CORE)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'warden_source.blend'))
    bpy.ops.export_scene.gltf(filepath=str(OUT/'warden.glb'),export_format='GLB',
                              export_animations=False)


build_creature()
build_arena()
build_player()
print('Tidal Bell assets exported to', OUT)
