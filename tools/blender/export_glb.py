# Exports models/blend/<id>/<id>.blend to <id>-export.glb beside it: skinned, with the "lids" shape key and
# custom properties (glTF extras, which the app reads as userData), and no images (the page loads the
# textures as plain files). tools/blend.mjs export packs that into models/web/<id>-model.js.
#
# Run through tools/blend.mjs, or: Blender -b --factory-startup <id>.blend -P tools/blender/export_glb.py -- <id>
import bpy, os, sys

ID = sys.argv[sys.argv.index('--') + 1]
DIR = os.path.dirname(bpy.data.filepath)

# export the rest pose, whatever pose the file was saved in
for ob in bpy.data.objects:
    if ob.type == 'ARMATURE':
        ob.data.pose_position = 'REST'

bpy.ops.export_scene.gltf(
    filepath=os.path.join(DIR, f'{ID}-export.glb'),
    export_format='GLB',
    export_image_format='NONE',
    export_extras=True,
    export_yup=True,
    export_apply=False,
    export_skins=True,
    export_def_bones=False,
    export_morph=True,
    export_morph_normal=True,
    export_animations=False,
    export_tangents=False,
    export_lights=False,
    export_cameras=False,
)
print(f'{ID}: exported {ID}-export.glb')
