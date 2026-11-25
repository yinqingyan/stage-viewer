# 开发工具：用 Blender 按 docs/机械测试模型需求.md 做一个带动画的机械测试模型（升降台、升降屏、开合屏、转台、主屏组）。
# 用法：blender -b --python dev/make_mechanics_test.py -- 输出.fbx
# 每样机械是一个 Empty（导出为 FBX 的 Null，相当于 3ds Max 的组），动画打在 Empty 上：第 0 帧初始位置，第 60 帧运动到头。
import bpy, math, os, struct, sys, zlib

out = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 0, 60


def png(path, w=256, h=144):
    """渐变测试图，当屏幕画面"""
    rows = b''.join(b'\0' + bytes(v for x in range(w) for v in (x * 255 // w, 80, 255 - y * 255 // h)) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


def material(name, color, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    if image:
        tex = m.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(image)
        m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return m


def box(name, size, loc, parent=None, mat=None, cylinder=False):
    if cylinder:
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=size[0] / 2, depth=size[2], location=loc)
    else:
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        bpy.context.object.scale = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o = bpy.context.object
    o.name = name
    if mat:
        o.data.materials.append(mat)
    if parent:
        o.parent = parent
        o.location = [a - b for a, b in zip(loc, parent.location)]
    return o


def group(name, loc, frames):
    """组 = Empty；frames: {帧号: (location, rotation_z 度)}"""
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.location = loc
    for f, (l, rz) in frames.items():
        e.location, e.rotation_euler = l, (0, 0, math.radians(rz))
        e.keyframe_insert('location', frame=f)
        e.keyframe_insert('rotation_euler', frame=f)
    e.location, e.rotation_euler = frames[0][0], (0, 0, math.radians(frames[0][1]))
    for fc in e.animation_data.action.fcurves:
        for k in fc.keyframe_points:
            k.interpolation = 'LINEAR'
    return e


img = os.path.join(os.path.dirname(out), '屏幕画面.png')
png(img)
grey, steel, screen = material('台面', (.35, .35, .38)), material('桁架', (.6, .6, .62)), material('屏幕', (1, 1, 1), img)

# 舞台面（不动）：Blender 里 Z 朝上，-Y 是前方（观众席）
box('舞台面', (24, 16, .2), (0, 0, -.1), mat=grey)
# 1 升降台：台面从 -1 米升到 +1.5 米
g = group('升降台', (0, -4, -1.15), {0: ((0, -4, -1.15), 0), 60: ((0, -4, 1.35), 0)})
box('升降台-台面', (4, 4, .3), (0, -4, -1.15), g, grey)
# 2 升降屏：底边从 3 米升到 8 米（屏高 3.5 米）
g = group('升降屏', (-8, 4, 4.75), {0: ((-8, 4, 4.75), 0), 60: ((-8, 4, 9.75), 0)})
box('升降屏-屏幕', (6, .15, 3.5), (-8, 4, 4.75), g, screen)
# 3 开合屏：左右两块从合拢各向两侧平移 3 米
for side, sx in (('左', -1), ('右', 1)):
    x0 = sx * 2
    g = group(f'开合屏-{side}', (x0, 6, 2.2), {0: ((x0, 6, 2.2), 0), 60: ((x0 + sx * 3, 6, 2.2), 0)})
    box(f'开合屏-{side}-板', (4, .2, 4), (x0, 6, 2.2), g, screen)
# 4 转台：绕竖轴转 180 度
g = group('转台', (7, -3, .15), {0: ((7, -3, .15), 0), 60: ((7, -3, .15), 180)})
box('转台-台面', (6, 6, .3), (7, -3, .15), g, grey, cylinder=True)
box('转台-标记', (.6, 2.4, .3), (7, -4.6, .45), g, steel)  # 看得出转了多少
# 5 主屏组：屏 + 边框 + 桁架，整组上升 4 米
g = group('主屏组', (8, 5, 3), {0: ((8, 5, 3), 0), 60: ((8, 5, 7), 0)})
box('主屏组-屏幕', (5, .15, 3), (8, 5, 3), g, screen)
for i, (sz, dz) in enumerate((((5.4, .2, .2), 1.6), ((5.4, .2, .2), -1.6))):
    box(f'主屏组-边框{i + 1}', sz, (8, 5, 3 + dz), g, steel)
for i, dx in enumerate((-2.6, 2.6)):
    box(f'主屏组-边框{i + 3}', (.2, .2, 3.4), (8 + dx, 5, 3), g, steel)
box('主屏组-桁架', (6, .4, .4), (8, 5, 5), g, steel)

bpy.ops.export_scene.fbx(filepath=out, object_types={'EMPTY', 'MESH'}, bake_anim=True, bake_anim_use_all_bones=False,
                         bake_anim_use_nla_strips=False, bake_anim_use_all_actions=False, bake_anim_force_startend_keying=True,
                         path_mode='COPY', embed_textures=True, add_leaf_bones=False)
print('完成：', out)
