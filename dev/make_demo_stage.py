# 开发工具：用 Blender 做一个演示舞台（录宣传视频用）：舞台、主屏、两块升降屏、中央升降台、桁架、三组灯、观众席。
# 用法：blender -b --python dev/make_demo_stage.py -- 输出.fbx
# 灯和椅子按设计师常用的方式建：外层组 + 每台一个组 + 零件，同款复制；会动的东西是带关键帧的组（第 0 帧起点，第 60 帧终点）。
import bpy, math, os, struct, sys, zlib

out = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 0, 60


def png(path, w=640, h=360):
    """屏幕画面：紫到橙的夜空、一轮太阳、几道横向光带"""
    def px(x, y):
        t = y / h
        r, g, b = 40 + 200 * t, 20 + 70 * t, 120 - 60 * t
        d = math.hypot(x - w / 2, (y - h * .62) * 1.0) / (h * .22)
        if d < 1:
            r, g, b = 255, 190 - 60 * d, 90
        elif d < 1.6:
            k = (1.6 - d) / .6 * .6
            r, g, b = r + (255 - r) * k, g + (150 - g) * k, b + (80 - b) * k
        if y > h * .62 and int(y / (h * .035)) % 2 and d < 2.4:
            r, g, b = r * .35, g * .35, b * .5
        return bytes(max(0, min(255, int(v))) for v in (r, g, b))
    rows = b''.join(b'\0' + b''.join(px(x, y) for x in range(w)) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


def material(name, color, image=None, rough=.6, metal=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if image:
        tex = m.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(image)
        m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return m


def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    return e


def box(name, size, loc, parent=None, mat=None, cyl=False, face=False):
    """loc 是世界坐标；有 parent 时换成相对 parent 的位置（parent 不旋转）。face：朝观众的平面（屏幕画面，贴图铺满整面）"""
    if face:
        bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
        bpy.context.object.scale = (size[0], size[2], 1)
        bpy.context.object.rotation_euler = (math.radians(90), 0, 0)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    elif cyl:
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=size[0] / 2, depth=size[2], location=(0, 0, 0))
    else:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
        bpy.context.object.scale = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o = bpy.context.object
    o.name = name
    if mat:
        o.data.materials.append(mat)
    o.parent = parent
    p = parent.matrix_world.translation if parent else (0, 0, 0)
    o.location = [a - b for a, b in zip(loc, p)]
    bpy.context.view_layer.update()
    return o


def animate(e, z0, z1):
    """组从高度 z0 直线运动到 z1（第 0 → 60 帧）"""
    x, y, _ = e.location
    for f, z in ((0, z0), (60, z1)):
        e.location = (x, y, z)
        e.keyframe_insert('location', frame=f)
    e.location = (x, y, z0)
    for fc in e.animation_data.action.fcurves:
        for k in fc.keyframe_points:
            k.interpolation = 'LINEAR'


img = os.path.join(os.path.dirname(out), '演示屏幕画面.png')
png(img)
deck, floor, black = material('台面', (.08, .08, .09), rough=.25), material('地面', (.12, .12, .14)), material('黑', (.02, .02, .02))
steel, seat, screen = material('桁架', (.7, .7, .72), rough=.3, metal=1), material('座椅', (.45, .05, .08)), material('屏幕', (1, 1, 1), img)

# 舞台（Blender 里 Z 朝上，-Y 是观众席）：台面高 1.2 米，前沿 y=-4
box('舞台台面', (20, 10, 1.2), (0, 1, .6), mat=deck)
box('台口沿', (20, .1, .1), (0, -4, 1.2), mat=steel)
box('地面', (30, 32, .1), (0, -5, -.05), mat=floor)  # 整片铺满：升降屏藏在台面下时从上面看不到

# 主屏（不动）：12 × 6.75 米，带黑边
box('主屏', (12, 0, 6.75), (0, 5.5, 5.4), mat=screen, face=True)
box('主屏边框', (12.4, .1, 7.15), (0, 5.75, 5.4), mat=black)

# 两块升降屏：从台面下升起，底边升到台面以上 1.5 米
for side, x in (('左', -8.1), ('右', 8.1)):
    g = empty(f'升降屏-{side}', (x, 4.2, 0))
    box(f'升降屏-{side}-屏幕', (3.6, 0, 6.4), (x, 4.15, 0), g, screen, face=True)
    box(f'升降屏-{side}-边框', (3.9, .1, 6.7), (x, 4.25, 0), g, black)
    animate(g, -2.1, 5.9)  # 组中心高度：顶边藏在台面以下 → 底边离地 2.7 米

# 中央升降台：从和台面齐平升到 2 米高
g = empty('中央升降台', (0, 0, 1.05))
box('中央升降台-台面', (4, 3, .3), (0, 0, 1.05), g, material('升降台面', (.85, .85, .9), rough=.2))
box('中央升降台-立柱', (3.6, 2.6, 4), (0, 0, -1.05), g, black)
animate(g, 1.05, 3.05)

# 桁架：前后两道横梁 + 四根立柱
for name, y, z in (('前桁架', -3, 10), ('后桁架', 3.2, 10.6)):
    box(name, (23, .4, .4), (0, y, z), mat=steel)
    for x in (-11.5, 11.5):
        box(f'{name}-立柱{"左" if x < 0 else "右"}', (.4, .4, z), (x, y, z / 2), mat=steel)


def rig(group, unit, xs, y, z, parts):
    """一组灯：外层组名 = 网页上的灯光开关名；parts: [(尺寸, 相对位置, 圆柱?)]"""
    g = empty(group)
    for i, x in enumerate(xs):
        u = empty(f'{unit}_{i + 1:02d}', (x, y, z), g)
        for j, (sz, d, cyl) in enumerate(parts):
            box(f'{unit}_{i + 1:02d}_p{j}', sz, (x + d[0], y + d[1], z + d[2]), u, black, cyl)


row = lambda n, w: [(i - (n - 1) / 2) * w / (n - 1) for i in range(n)]
moving = [((.45, .3, .15), (0, 0, 0), False), ((.3, .3, .45), (0, 0, -.35), True)]       # 底座 + 灯头
par = [((.3, .3, .35), (0, 0, 0), True), ((.36, .05, .25), (0, 0, .25), False)]           # 灯体 + 吊架
rig('天排光束', 'Sharpy', row(12, 20), 3.2, 10.05, moving)
rig('面光', 'LED PAR', row(10, 18), -3, 9.45, par)
rig('地排光束', 'MegaPointe', row(8, 16), -3.3, 1.45, [((.45, .3, .15), (0, 0, -.15), False), ((.3, .3, .45), (0, 0, .2), True)])

# 观众席：8 排 × 16 座，面向舞台
g = empty('观众席')
for r in range(8):
    for c in range(16):
        x, y = (c - 7.5) * .6 + (.3 if c >= 8 else -.3), -7 - r * 1.05
        n = f'椅子_{r * 16 + c + 1:03d}'
        u = empty(n, (x, y, 0), g)
        box(f'{n}_座', (.5, .48, .1), (x, y, .45), u, seat)
        box(f'{n}_背', (.5, .08, .55), (x, y - .26, .75), u, seat)
        box(f'{n}_脚', (.12, .12, .4), (x, y, .2), u, black, cyl=True)

bpy.ops.export_scene.fbx(filepath=out, object_types={'EMPTY', 'MESH'}, bake_anim=True, bake_anim_use_all_bones=False,
                         bake_anim_use_nla_strips=False, bake_anim_use_all_actions=False, bake_anim_force_startend_keying=True,
                         path_mode='COPY', embed_textures=True, add_leaf_bones=False)
print('完成：', out)
