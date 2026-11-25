# 开发工具：用 Blender 做一个「型号库里没有」的灯具测试模型，测按组名猜用途、选具体型号。
# 用法：blender -b --python dev/make_fixture_test.py -- 输出.fbx
# 每台灯 = 一个 Empty（组）+ 两个零件，同款复制；外层组名像设计师平时起的名字。
import bpy, os, sys

out = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.location = loc
    e.parent = parent
    return e

def part(name, size, loc, parent, cyl=False):
    if cyl:
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=size[0] / 2, depth=size[2], location=(0, 0, 0))
    else:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
        bpy.context.object.scale = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o = bpy.context.object
    o.name = name
    o.parent = parent
    o.location = loc
    return o

def rig(group, unit, n, spacing, z, y, parts):
    g = empty(group, (0, y, z))
    for i in range(n):
        u = empty(f'{unit}_{i + 1:02d}', ((i - (n - 1) / 2) * spacing, 0, 0), g)
        for j, (sz, loc, cyl) in enumerate(parts):
            part(f'{unit}_{i + 1:02d}_p{j}', sz, loc, u, cyl)

part('舞台面', (20, 12, .2), (0, 0, -.1), None)
rig('天排光束', 'MegaPointe', 8, 2, 8, -2, [((.4, .3, .3), (0, 0, 0), False), ((.3, .3, .5), (0, 0, -.4), True)])
rig('地排', 'Fixture_A', 10, 1.5, .1, 5, [((1, .15, .12), (0, 0, 0), False), ((1, .05, .05), (0, -.08, 0), False)])
rig('频闪组', 'Unit', 4, 3, 7, 4, [((.5, .2, .3), (0, 0, 0), False), ((.4, .02, .15), (0, -.12, 0), False)])
rig('舞台两侧', 'LED PAR', 6, 1, 2, -5, [((.3, .3, .3), (0, 0, 0), True), ((.35, .05, .2), (0, 0, -.25), False)])
rig('观众席', '椅子', 12, .6, 0, -9, [((.45, .45, .05), (0, 0, .45), False), ((.45, .05, .5), (0, .2, .7), False)])
rig('桁架', 'Truss', 6, 3, 9, 0, [((3, .3, .3), (0, 0, 0), False), ((3, .05, .05), (0, 0, .15), False)])
bpy.ops.export_scene.fbx(filepath=out, object_types={'EMPTY', 'MESH'}, add_leaf_bones=False, bake_anim=False)
print('完成：', out)
