# Opens a Sprout's .blend ready to look at: textured shading, framed on the model, bones on top.
# Blender models/blend/<id>/<id>.blend --python tools/blender/view.py
import bpy


def setup():
    for win in bpy.context.window_manager.windows:
        for area in win.screen.areas:
            if area.type != 'VIEW_3D':
                continue
            space = area.spaces.active
            space.shading.type = 'MATERIAL'
            space.overlay.show_relationship_lines = False
            region = next(r for r in area.regions if r.type == 'WINDOW')
            with bpy.context.temp_override(window=win, area=area, region=region):
                bpy.ops.object.select_all(action='SELECT')
                bpy.ops.view3d.view_axis(type='FRONT')
                bpy.ops.view3d.view_selected()
                bpy.ops.object.select_all(action='DESELECT')
    return None  # run once


bpy.app.timers.register(setup, first_interval=0.5)
