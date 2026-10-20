# A slowed-down, captioned walk through how a Sprout's Blender file is built, for watching in Blender's window:
# the raw scan, the cleaned mesh, the bones, the skin weights, the textures, then a test of the rig.
# Nothing is saved. Needs models/blend/<id>/ (node tools/blend.mjs make <id>).
#   Blender --factory-startup --python tools/blender/demo.py -- <id>
import bpy, blf, math, os, sys
from mathutils import Euler, Vector

ID = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'explore'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'models', 'src', f'{ID}-a250000.glb')
DIR = os.path.join(ROOT, 'models', 'blend', ID)
TICK = 1 / 30

caption = ['Getting ready…', '']
state = {'t': 0.0, 'done': set(), 'pose': False}


# ---------------------------------------------------------------- viewport helpers
def view3d():
    win = bpy.context.window_manager.windows[0]
    area = max((a for a in win.screen.areas if a.type == 'VIEW_3D'), key=lambda a: a.width * a.height)
    region = next(r for r in area.regions if r.type == 'WINDOW')
    return win, area, region, area.spaces.active


def draw_caption():
    scale = bpy.context.preferences.system.ui_scale
    for i, (text, size, y) in enumerate(((caption[0], 26, 70), (caption[1], 17, 36))):
        if not text:
            continue
        blf.size(0, size * scale)
        blf.enable(0, blf.SHADOW)
        blf.shadow(0, 5, 0, 0, 0, 0.9)
        blf.color(0, 1, 1, 1, 1)
        blf.position(0, 40 * scale, y * scale, 0)
        blf.draw(0, text)


def say(line1, line2=''):
    caption[0], caption[1] = line1, line2


def imported(path, **kw):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, **kw)
    return [o for o in bpy.data.objects if o not in before]


def show(objs, on):
    for o in objs:
        o.hide_viewport = not on


# ---------------------------------------------------------------- setting the scene up (hidden)
def prepare():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    win, area, region, space = view3d()
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.screen.screen_full_area()
    win, area, region, space = view3d()
    space.shading.type = 'MATERIAL'
    space.overlay.show_relationship_lines = False
    space.overlay.show_extras = False

    scan = imported(SRC)
    rig = imported(os.path.join(DIR, f'{ID}-rigged.glb'), bone_heuristic='BLENDER', merge_vertices=False)
    stand_in = lambda o: o.type == 'MESH' and o.name.startswith('Icosphere')  # the importer's shape for empties
    gone = [o for o in scan + rig if stand_in(o)]
    scan = [o for o in scan if not stand_in(o)]
    rig = [o for o in rig if not stand_in(o)]
    for o in gone:
        bpy.data.objects.remove(o)
    body = next(o for o in rig if o.name == 'body')
    arm = next(o for o in rig if o.type == 'ARMATURE')

    # the scan is in its own units: scale it to sit exactly where the rigged body is
    def height(objs):
        zs = [(o.matrix_world @ Vector(c)).z for o in objs if o.type == 'MESH' for c in o.bound_box]
        return max(zs) - min(zs)
    bpy.context.view_layer.update()
    s = height([body]) / height(scan)
    for o in scan:
        if not o.parent:
            o.scale = o.scale * s

    # textures on the rigged body (the handoff GLB carries none)
    imgs = {k: bpy.data.images.load(os.path.join(DIR, f'{ID}-{k}.png')) for k in ('color', 'normal', 'orm')}
    for k in ('normal', 'orm'):
        imgs[k].colorspace_settings.name = 'Non-Color'
    for mat in bpy.data.materials:
        if not mat.name.startswith(ID):
            continue
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        tex = {}
        for k in imgs:
            tex[k] = nt.nodes.new('ShaderNodeTexImage')
            tex[k].image = imgs[k]
        nt.links.new(tex['color'].outputs['Color'], bsdf.inputs['Base Color'])
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(tex['orm'].outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tex['normal'].outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])

    # skin weights as colours: one colour per bone, blended by weight
    pal = {'hips': (0.3, 0.75, 0.35), 'leg_L': (0.55, 0.3, 0.7), 'shin_L': (0.55, 0.3, 0.7), 'leg_R': (0.55, 0.3, 0.7),
           'shin_R': (0.55, 0.3, 0.7), 'arm_L': (0.9, 0.2, 0.2), 'arm_R': (0.2, 0.35, 0.9), 'head': (0.95, 0.85, 0.2)}
    names = [g.name for g in body.vertex_groups]
    cols = []
    for v in body.data.vertices:
        c = [0.0, 0.0, 0.0]
        for g in v.groups:
            p = pal.get(names[g.group], (0, 0, 0))
            for k in range(3):
                c[k] += p[k] * g.weight
        cols += c + [1.0]
    attr = body.data.color_attributes.new('weights', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', cols)
    body.data.color_attributes.active_color = attr

    arm.show_in_front = True
    arm.data.display_type = 'STICK'
    for b in arm.data.bones:
        b.hide = True
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'

    # frame the model, then keep the camera gently swaying so its shape reads
    with bpy.context.temp_override(window=win, area=area, region=region):
        for o in bpy.context.view_layer.objects:
            o.select_set(o == body)
        bpy.ops.view3d.view_selected()
        body.select_set(False)
    r3d = space.region_3d
    state.update(r3d_dist=r3d.view_distance * 0.9, r3d_loc=r3d.view_location.copy())

    show(rig, False)
    state.update(scan=scan, rig=rig, body=body, arm=arm)


# ---------------------------------------------------------------- the steps
def step_scan():
    show(state['scan'], True)
    say('1 · The raw scan', 'One mesh straight out of Tripo, the image-to-3D generator')


def step_wire():
    view3d()[3].overlay.show_wireframes = True
    say('1 · The raw scan', '250,000 triangles, and the leaves are fused onto the head')


def step_clean():
    sp = view3d()[3]
    sp.overlay.show_wireframes = False
    sp.shading.type = 'SOLID'
    sp.shading.color_type = 'SINGLE'
    show(state['scan'], False)
    show([o for o in state['rig'] if o.type != 'ARMATURE'], True)
    say('2 · Cleaned up', 'Each leaf cut free from the head, and the openings closed and smoothed')


def reveal(names, line):
    def go():
        arm = state['arm']
        arm.hide_viewport = False
        for n in names:
            if n in arm.data.bones:
                arm.data.bones[n].hide = False
        say('3 · A skeleton', line)
    return go


def step_weights():
    sp = view3d()[3]
    sp.shading.color_type = 'VERTEX'
    say('4 · Skin weights: which bone moves which part',
        'red: left leaf   ·   blue: right leaf   ·   yellow: head   ·   purple: legs   ·   green: body')


def step_textures():
    view3d()[3].shading.type = 'MATERIAL'
    say('5 · Textures', 'Colour, shine and fine surface detail, cleaned where the leaves were cut free')


def step_pose():
    state['pose'] = True
    lids = state['body'].data.shape_keys
    say('6 · Testing the rig', 'The same bones the app moves' + (', and the lids for blinking' if lids else ''))


def step_end():
    state['pose'] = False
    for pb in state['arm'].pose.bones:
        pb.rotation_euler = (0, 0, 0)
    say(f'Done: this is models/blend/{ID}/{ID}.blend', 'The demo saves nothing. Orbit with the middle mouse button, or close the window.')


STEPS = [
    (0.5, step_scan), (5, step_wire), (10, step_clean),
    (15, reveal(['hips'], 'hips: everything hangs from here')),
    (16.5, reveal(['leg_L', 'leg_R', 'shin_L', 'shin_R'], 'legs and shins')),
    (18, reveal(['arm_L', 'arm_R'], 'a leaf on each side, the arms')),
    (19.5, reveal(['head'], '8 bones, named exactly as the app expects')),
    (23, step_weights), (29, step_textures), (34, step_pose), (52, step_end),
]


def tick():
    if state['t'] == 0:
        prepare()
    state['t'] += TICK
    t = state['t']
    for i, (at, fn) in enumerate(STEPS):
        if t >= at and i not in state['done']:
            state['done'].add(i)
            fn()
    win, area, region, space = view3d()
    r3d = space.region_3d
    if t < 52:  # a gentle sway, so it reads as 3D without turning its back
        r3d.view_rotation = Euler((math.radians(82), 0, math.radians(14 * math.sin(t * 0.35)))).to_quaternion()
        r3d.view_distance = state['r3d_dist']
        r3d.view_location = state['r3d_loc']
    if state['pose']:
        p = t - 34
        pb = state['arm'].pose.bones
        wave = math.sin(p * 2.4)
        if 'arm_L' in pb: pb['arm_L'].rotation_euler = (0, 0, 0.5 + 0.35 * wave)
        if 'arm_R' in pb: pb['arm_R'].rotation_euler = (0, 0, -0.5 - 0.35 * wave)
        if 'head' in pb: pb['head'].rotation_euler = (0.12 * math.sin(p * 1.3), 0, 0.15 * math.sin(p * 0.9))
        if 'hips' in pb: pb['hips'].rotation_euler = (0, 0.12 * math.sin(p * 0.9), 0)
        keys = state['body'].data.shape_keys
        if keys and 'lids' in keys.key_blocks:
            b = (p % 2.6) / 0.35
            keys.key_blocks['lids'].value = math.sin(b * math.pi) if b < 1 else 0
    area.tag_redraw()
    return TICK if t < 53 else None


bpy.types.SpaceView3D.draw_handler_add(draw_caption, (), 'WINDOW', 'POST_PIXEL')
bpy.app.timers.register(tick, first_interval=1.0)
