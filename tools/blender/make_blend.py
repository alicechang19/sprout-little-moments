# Builds models/blend/<id>/<id>.blend from the rigger's Blender handoff (node tools/rig-imported.mjs <id> --blend):
# the cut, repainted, skinned scan with its armature, the "lids" shape key, the book page or can spout, and
# a textured material wired to the lossless PNGs next to it. From then on the .blend is the source:
# edit it in Blender, then `node tools/blend.mjs export <id>` writes models/web again.
#
# Run through tools/blend.mjs, or: Blender -b --factory-startup -P tools/blender/make_blend.py -- <id>
import bpy, os, sys

ID = sys.argv[sys.argv.index('--') + 1]
DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'models', 'blend', ID))

bpy.ops.wm.read_factory_settings(use_empty=True)
# BLENDER bone heuristic keeps each joint's glTF frame, so poses.js quaternions still apply after export
bpy.ops.import_scene.gltf(filepath=os.path.join(DIR, f'{ID}-rigged.glb'), bone_heuristic='BLENDER', merge_vertices=False)


def image(kind, colour):
    img = bpy.data.images.load(os.path.join(DIR, f'{ID}-{kind}.png'))
    img.filepath = f'//{ID}-{kind}.png'  # relative, so the folder can move
    img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    return img


IMAGES = {'color': image('color', True), 'normal': image('normal', False), 'orm': image('orm', False)}


def textured(mat):
    """glTF metallic-roughness from the shared atlas: colour, normal, and ORM (G roughness, B metal)."""
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); out.location = (500, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); bsdf.location = (200, 0)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    tex = {}
    for k, y in (('color', 300), ('orm', 0), ('normal', -300)):
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = IMAGES[k]; n.location = (-500, y); n.name = n.label = k
        tex[k] = n
    nt.links.new(tex['color'].outputs['Color'], bsdf.inputs['Base Color'])
    sep = nt.nodes.new('ShaderNodeSeparateColor'); sep.location = (-200, 0)
    nt.links.new(tex['orm'].outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.location = (-200, -300)
    nt.links.new(tex['normal'].outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])


for mat in bpy.data.materials:
    if mat.name in (f'{ID}_textured', f'{ID}_page'):
        textured(mat)
        mat.use_backface_culling = mat.name == f'{ID}_textured'  # the page is seen from both sides

for ob in bpy.data.objects:
    if ob.type == 'ARMATURE':
        ob.show_in_front = True
        ob.data.display_type = 'STICK'
    # the importer's stand-in shape for empties that are glTF nodes
    if ob.type == 'MESH' and ob.name == 'Icosphere' and not ob.parent:
        bpy.data.objects.remove(ob)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(DIR, f'{ID}.blend'), relative_remap=True, compress=True)
print(f'{ID}: wrote models/blend/{ID}/{ID}.blend')
