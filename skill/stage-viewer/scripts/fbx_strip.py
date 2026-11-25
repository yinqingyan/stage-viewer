#!/usr/bin/env python3
"""去掉 FBX 里灯具的几何体，只保留灯具节点（位置、朝向），让巨大的灯光模型变小。只用 Python 标准库。

灯具由查看器按灯型画成「灯口圆片 + 光束」，所以不需要灯具本身的网格。
按块读取（mmap），1GB 以上的 FBX 也只占很少内存。

用法：
  python3 fbx_strip.py 输入.fbx 输出.fbx                       # 按默认规则识别灯具
  python3 fbx_strip.py 输入.fbx 输出.fbx --fixture '^灯_'       # 自定义：对象名匹配这个正则的组就是一台灯具
  python3 fbx_strip.py 输入.fbx 输出.fbx --keep-samples         # 每种灯具保留一台完整模型（调试灯口方向用）
  python3 fbx_strip.py 输入.fbx --detect 型号.json             # 不看名字，自动找出重复出现的灯具/家具，列出型号
  python3 fbx_strip.py 输入.fbx 输出.fbx --kinds 型号.json --config 配置.json
                                     # 精简型号.json 里填了用途（role）的型号，并把灯具、桌椅写进配置
"""
import argparse, hashlib, json, mmap, os, re, struct, sys

# 默认：3d66 等模型库下载的灯具组名，如 Group-1514655-27-698、3d66Group190
DEFAULT_FIXTURE = r'^(Group-\d+-\d+-|3d66Group)'
LIBRARY = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'library.json')
LIGHTS = ('beam', 'wash', 'strobe', 'bar')
PROPS = ('chair', 'stool', 'table')


class Fbx:
    def __init__(self, path):
        self.f = open(path, 'rb')
        self.raw = mmap.mmap(self.f.fileno(), 0, access=mmap.ACCESS_READ)
        if not self.raw[:18] == b'Kaydara FBX Binary':
            sys.exit('只支持二进制 FBX')
        self.version = struct.unpack_from('<I', self.raw, 23)[0]
        self.head = '<QQQ' if self.version >= 7500 else '<III'
        self.hsize = struct.calcsize(self.head)
        self.null = b'\0' * (self.hsize + 1)

    def record(self, off):
        """返回 (end, name, props_off, props_len, nprops)；end == 0 表示空记录"""
        end, nprops, plen = struct.unpack_from(self.head, self.raw, off)
        if end == 0:
            return 0, None, 0, 0, 0
        o = off + self.hsize
        name = self.raw[o + 1:o + 1 + self.raw[o]].decode('utf8', 'replace')
        return end, name, o + 1 + self.raw[o], plen, nprops

    def children(self, off):
        end, _, po, pl, _ = self.record(off)
        c = po + pl
        while c < end:
            e = self.record(c)[0]
            if e == 0:
                break
            yield c
            c = e

    def top(self):
        c = 27
        while True:
            e, name, *_ = self.record(c)
            if e == 0:
                return
            yield c, name
            c = e

    def props(self, off, n=3):
        """读出前 n 个简单属性（L / S），够识别对象 id、名字、类型和连接"""
        _, _, p, _, nprops = self.record(off)
        out = []
        for _ in range(min(n, nprops)):
            t = chr(self.raw[p]); p += 1
            if t == 'L':
                out.append(struct.unpack_from('<q', self.raw, p)[0]); p += 8
            elif t in 'SR':
                k = struct.unpack_from('<I', self.raw, p)[0]; p += 4
                out.append(bytes(self.raw[p:p + k])); p += k
            else:
                break
        return out

    def vertex_count(self, geo_off):
        """Geometry 记录里 Vertices 数组的长度（坐标个数），没有返回 0"""
        for c in self.children(geo_off):
            _, name, p, _, _ = self.record(c)
            if name == 'Vertices' and chr(self.raw[p]) in 'df':
                return struct.unpack_from('<I', self.raw, p + 1)[0]
        return 0


def name_of(prop):
    return prop.split(b'\x00\x01')[0].decode('utf8', 'replace')


def read_graph(fx):
    """读对象与父子连接：objs id -> (kind, name, type, offset)；parent 模型 -> 父模型；geo_of 模型 -> 几何体"""
    tops = dict((name, off) for off, name in fx.top())
    objs = {}
    for c in fx.children(tops['Objects']):
        pr = fx.props(c)
        kind = fx.record(c)[1]
        objs[pr[0]] = (kind, name_of(pr[1]) if len(pr) > 1 else '', pr[2] if len(pr) > 2 else b'', c)
    parent, geo_of = {}, {}
    for c in fx.children(tops['Connections']):
        kind, ch, pa = fx.props(c)
        if kind == b'OO' and ch in objs and pa in objs:
            if objs[ch][0] == 'Model' and objs[pa][0] == 'Model':
                parent[ch] = pa
            elif objs[ch][0] == 'Geometry' and objs[pa][0] == 'Model':
                geo_of[pa] = ch
    return objs, parent, geo_of


def detect(fx, objs, parent, geo_of, min_count=4):
    """不看名字找灯具/家具：同一款模型在场景里重复出现，内部结构（部件嵌套、每个部件的顶点数）完全相同。
    给每个组算结构指纹，重复出现 min_count 次以上、至少 2 个部件的就是一个「型号」。
    灯头被单独转动过也不影响，指纹不含位置和朝向；精简过的模型没有几何体，只按嵌套结构比较。"""
    kids = {}
    for c, p in parent.items():
        kids.setdefault(p, []).append(c)
    verts = {g: fx.vertex_count(objs[g][3]) for g in geo_of.values()}
    sig, size, leaves = {}, {}, {}  # leaves：末端部件数，与查看器 props 的 parts 同义

    def walk(m):
        if m in sig:
            return
        for c in kids.get(m, []):
            walk(c)
        own = str(verts[geo_of[m]]) if m in geo_of else '-'
        sub = ','.join(sorted(sig[c] for c in kids.get(m, [])))
        sig[m] = hashlib.md5(f'{own}({sub})'.encode()).hexdigest()[:12]
        size[m] = 1 + sum(size[c] for c in kids.get(m, []))
        leaves[m] = sum(leaves[c] for c in kids.get(m, [])) or 1

    models = [m for m, o in objs.items() if o[0] == 'Model']
    sys.setrecursionlimit(max(10000, len(models) * 2))
    for m in models:
        walk(m)
    occ = {}
    for m in models:
        occ.setdefault(sig[m], []).append(m)
    rep = {s: ms for s, ms in occ.items() if len(ms) >= min_count and size[ms[0]] >= 2}

    # 灯具的每个部件也重复同样次数：如果某指纹每次出现都在同一个指纹的父组里、且次数相同，它只是那个组的部件。
    # 父组只包着它一个（外面套的空组）时不算，型号仍是它自己
    def is_part(s):
        ps = {parent.get(m) for m in rep[s]}
        if None in ps or any(len(kids[p]) == 1 for p in ps):
            return False
        psig = {sig[p] for p in ps}
        return len(psig) == 1 and len(occ[psig.pop()]) == len(rep[s])
    units = {s: ms for s, ms in rep.items() if not is_part(s)}
    unit_of = {m: s for s, ms in units.items() for m in ms}
    # 一套桌椅：桌子和整套次数相同，但整套里还有别的型号（椅子），桌子也单独算
    for s, ms in rep.items():
        if s not in units and all(any(c in unit_of for c in kids[parent[m]] if c != m) for m in ms):
            units[s] = ms
    unit_of = {m: s for s, ms in units.items() for m in ms}
    # 只包着一个型号的空组：不单独算
    units = {s: ms for s, ms in units.items()
             if not all(len(kids.get(m, [])) == 1 and kids[m][0] in unit_of for m in ms)}
    unit_of = {m: s for s, ms in units.items() for m in ms}

    # 精简过的模型没有顶点数，不同的灯可能结构相同；名字前缀不同的拆开（各自仍要重复 min_count 次）
    prefix = lambda m: re.sub(r'\d+$', '', objs[m][1])
    split = []
    for s, ms in units.items():
        by = {}
        for m in ms:
            by.setdefault(prefix(m), []).append(m)
        big = [g for g in by.values() if len(g) >= min_count]
        if len(big) > 1:
            rest = [m for g in by.values() if len(g) < min_count for m in g]
            big[0] += rest
            split += [(f'{s}:{prefix(g[0])}', g) for g in big]
        else:
            split.append((s, ms))

    top = lambda m: objs[m][1] if m not in parent else top(parent[m])
    key_of = {m: k for k, ms in split for m in ms}
    def below(m):
        for c in kids.get(m, []):
            yield c
            yield from below(c)
    kinds = []
    for key, ms in sorted(split, key=lambda kv: -len(kv[1])):
        names = {}
        for m in ms:
            names[prefix(m)] = names.get(prefix(m), 0) + 1
        groups = {}
        for m in ms:
            groups[top(m)] = groups.get(top(m), 0) + 1
        # 整个型号都在另一个型号里面（如灯具内部重复的螺丝）；或者它里面包着别的型号（如一整排灯架）
        inside = set()
        for m in ms:
            p, hit = parent.get(m), None
            while p is not None:
                hit = key_of.get(p) or hit
                p = parent.get(p)
            inside.add(hit)
        contains = {}
        for c in below(ms[0]):
            if c in key_of:
                contains[key_of[c]] = contains.get(key_of[c], 0) + 1
        kinds.append({'key': key, 'count': len(ms), 'parts': size[ms[0]] - 1, 'leaves': leaves[ms[0]], 'sample': objs[ms[0]][1],
                      'names': names, 'groups': groups, 'inside': inside.pop() if len(inside) == 1 else None,
                      'contains': contains, 'ids': ms})
    return kinds


def library_entry(kind, lib):
    """在已知型号里找：名字前缀匹配，有 parts 的还要末端部件数相同"""
    name = max(kind['names'], key=kind['names'].get)
    for e in lib['fixtures'] + lib['props']:
        if re.search(e['match'], name) and e.get('parts', kind['leaves']) == kind['leaves']:
            return e
    return None


def make_config(kinds, objs, parent):
    """按填了用途的型号生成配置里的 fixtures、props。
    查看器按名字正则找节点（取最外层匹配的；桌椅再按 parts 过滤），所以先试名字前缀，
    选中的节点和这个型号不完全一致时（如名字都叫「组…」），改成逐个列出节点名。"""
    lib = json.load(open(LIBRARY, encoding='utf8'))
    kids, leaves = {}, {}
    for c, p in parent.items():
        kids.setdefault(p, []).append(c)
    def leaf(m):
        if m not in leaves:
            leaves[m] = sum(leaf(c) for c in kids.get(m, [])) or 1
        return leaves[m]
    models = [m for m, o in objs.items() if o[0] == 'Model']
    def select(regex, parts):
        r = re.compile(regex)
        hit = {m for m in models if r.search(objs[m][1])}
        def under_hit(m):
            p = parent.get(m)
            while p is not None:
                if p in hit:
                    return True
                p = parent.get(p)
            return False
        return {m for m in hit if not under_hit(m) and (parts is None or leaf(m) == parts)}

    fixtures, props, notes = [], [], []
    for k in kinds:
        role = k.get('role')
        if not role:
            continue
        if role not in LIGHTS + PROPS:
            sys.exit(f"{k['id']} 的用途「{role}」不认识，只能是 {'、'.join(LIGHTS + PROPS)} 或留空")
        light = role in LIGHTS
        known = library_entry(k, lib)
        if known and known.get('type' if light else 'shape') != role:
            known = None
        e = dict(known) if known else {}
        parts = None if light else k['leaves']
        name = max(k['names'], key=k['names'].get)
        regex = known['match'] if known else '^' + re.escape(name)
        if select(regex, parts) != set(k['ids']):
            regex = '^(' + '|'.join(sorted({re.escape(objs[m][1]) for m in k['ids']})) + ')$'
            if select(regex, parts) != set(k['ids']):
                notes.append(f"{k['id']}：节点名有重名，配置可能多选或漏选几个")
        e['match'] = regex
        if light:
            e['type'] = role
            fixtures.append(e)
        else:
            e['shape'], e['parts'] = role, parts
            props.append(e)
        if not known:
            notes.append(f"{k['id']}（{name}，{role}）：不在已知型号里，{'灯口按灯具中心、默认大小' if light else '按默认尺寸'}显示")
    return fixtures, props, notes


def write_config(path, fixtures, props):
    """写进配置：替换 fixtures、props，其余字段保留；有灯时补上 aim（地上的灯朝上、天上的灯朝观众席）"""
    cfg = json.load(open(path, encoding='utf8')) if os.path.exists(path) else {}
    cfg['fixtures'], cfg['props'] = fixtures, props
    if fixtures and 'aim' not in cfg:
        cfg['aim'] = {'floorBelow': 3}
    one = lambda o: json.dumps(o, ensure_ascii=False, separators=(', ', ': '))
    body = []
    for k, v in cfg.items():
        if isinstance(v, list) and v and all(isinstance(x, dict) for x in v):
            body.append(f'  {one(k)}: [\n' + ',\n'.join('    ' + one(x) for x in v) + '\n  ]')
        else:
            body.append(f'  {one(k)}: {one(v)}')
    open(path, 'w', encoding='utf8').write('{\n' + ',\n'.join(body) + '\n}\n')


def main():
    ap = argparse.ArgumentParser(description='去掉 FBX 中灯具的几何体')
    ap.add_argument('src'); ap.add_argument('dst', nargs='?')
    ap.add_argument('--fixture', default=DEFAULT_FIXTURE, help='灯具组名的正则（默认识别 3d66 灯具组）')
    ap.add_argument('--keep-samples', action='store_true', help='每种灯具保留第一台的几何体')
    ap.add_argument('--detect', metavar='型号.json', help='只分析不精简：自动找出重复出现的型号，写到这个 json')
    ap.add_argument('--kinds', metavar='型号.json', help='按 --detect 的结果精简：只去掉填了用途（role）的型号')
    ap.add_argument('--config', metavar='配置.json', help='配合 --kinds：把灯具、桌椅写进这个配置（其余字段保留）')
    a = ap.parse_args()
    fx = Fbx(a.src)
    pat = re.compile(a.fixture)

    # 1. 读对象与父子连接
    objs, parent, geo_of = read_graph(fx)
    if a.detect:
        kinds = detect(fx, objs, parent, geo_of)
        lib = json.load(open(LIBRARY, encoding='utf8'))
        for i, k in enumerate(kinds):
            k['id'] = f'K{i + 1}'
            known = library_entry(k, lib)
            k['role'] = (known.get('type') or known.get('shape')) if known else ''
        by_key = {k['key']: k['id'] for k in kinds}
        for k in kinds:
            k['inside'] = by_key.get(k['inside'])
            k['contains'] = {by_key[c]: n for c, n in k['contains'].items()}
            name = max(k['names'], key=k['names'].get)
            where = '、'.join(f'{g}×{n}' for g, n in sorted(k['groups'].items(), key=lambda x: -x[1])[:3])
            note = ('  （在 ' + k['inside'] + ' 里面）' if k['inside'] else '') + \
                   ('  （包含 ' + '、'.join(f'{c}×{n}' for c, n in k['contains'].items()) + '）' if k['contains'] else '')
            role = f"[{k['role']}]" if k['role'] else '[?]'
            print(f"{k['id']:>4} {role:<9}{k['count']:>4} 个  {k['parts']:>3} 个部件  {name}{note}  位于 {where}")
        doc = {'说明': '每种型号的 role 填用途：灯 ' + '/'.join(LIGHTS) + '，桌椅 ' + '/'.join(PROPS) +
                     '，留空表示不是灯具桌椅、原样保留。已知型号已自动填好。填完用 --kinds 型号.json --config 配置.json 精简并生成配置。',
               'kinds': [{k: v for k, v in kind.items() if k != 'ids'} for kind in kinds]}
        json.dump(doc, open(a.detect, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
        print(f'共 {len(kinds)} 种型号，已写入 {a.detect}（[?] 是没认出来的，需要填用途或留空）')
        return
    if not a.dst:
        ap.error('请给出输出文件')

    # 2. 找出每个网格所属的最外层灯具组；「型号」= 组名去掉末尾序号
    is_fix = lambda m: pat.search(objs[m][1])
    if a.kinds:
        # 重新分析一遍，按 key 对上用户填的用途
        roles = {k['key']: k.get('role') for k in json.load(open(a.kinds, encoding='utf8'))['kinds']}
        kinds = detect(fx, objs, parent, geo_of)
        for i, k in enumerate(kinds):
            k['id'], k['role'] = f'K{i + 1}', roles.get(k['key'])
        chosen = [k for k in kinds if k['role']]
        units = {m for k in chosen for m in k['ids']}
        is_fix = lambda m: m in units
        if a.config:
            fixtures, props, notes = make_config(chosen, objs, parent)
            write_config(a.config, fixtures, props)
            print(f'配置：{a.config}（灯具 {len(fixtures)} 种，桌椅 {len(props)} 种）')
            for n in notes:
                print('  注意：' + n)

    def fixture_of(m):
        hit = None
        while m in parent:
            m = parent[m]
            if is_fix(m):
                hit = m
        return hit

    fix_of = {m: fixture_of(m) for m in geo_of}
    parts = {}
    for m, fix in fix_of.items():
        if fix is not None:
            parts[fix] = parts.get(fix, 0) + 1
    model_of_type, strip_models = {}, set()
    for m, fix in fix_of.items():
        if fix is None:
            continue
        # 同名前缀的模型可能是不同东西（如 3d66Group 既有椅子也有凳子），再按部件数区分
        kind = re.sub(r'\d+$', '', objs[fix][1]) + f'×{parts[fix]}'
        model_of_type.setdefault(kind, fix)
        if a.keep_samples and model_of_type[kind] == fix:
            continue
        strip_models.add(m)
    strip_geo = {geo_of[m] for m in strip_models}
    print(f'灯具网格 {len(strip_models)} 个，型号 {len(model_of_type)} 种：' + '、'.join(model_of_type))

    # 3. 重写：去掉这些 Geometry 及其连接；网格节点改成 Null（保留变换，供查看器定位灯具）
    out = open(a.dst, 'wb')
    out.write(fx.raw[:27])
    pos = 27
    head = fx.head

    def emit(off, edit=None):
        """把 off 处的记录（含子节点）写到输出；edit 可改写属性字节。返回写出的字节数"""
        nonlocal pos
        end, name, po, pl, nprops = fx.record(off)
        props = bytes(fx.raw[po:po + pl]) if edit is None else edit(po, pl)
        start = pos
        nb = name.encode('utf8')
        # 先占位记录头，写完子节点再回填结束位置
        out.write(b'\0' * fx.hsize + bytes([len(nb)]) + nb + props)
        pos += fx.hsize + 1 + len(nb) + len(props)
        kids = list(fx.children(off))
        child_area = po + pl < end
        for k in kids:
            emit_filtered(k, name)
        if child_area:
            out.write(fx.null); pos += len(fx.null)
        cur = out.tell()
        out.seek(start)
        out.write(struct.pack(head, pos, nprops, len(props)))
        out.seek(cur)

    def to_null(po, pl):
        # Model 的属性：L id, S 名字, S 类型；把类型 Mesh 改成 Null
        p = po + 9  # 跳过 'L' + 8 字节 id
        assert fx.raw[p:p + 1] == b'S'
        p += 5 + struct.unpack_from('<I', fx.raw, p + 1)[0]
        assert fx.raw[p:p + 1] == b'S'
        k2 = struct.unpack_from('<I', fx.raw, p + 1)[0]
        tail = fx.raw[p + 5 + k2:po + pl]
        return bytes(fx.raw[po:p]) + b'S' + struct.pack('<I', 4) + b'Null' + bytes(tail)

    def emit_filtered(off, parent_name):
        if parent_name == 'Objects':
            pr = fx.props(off, 1)
            if pr and pr[0] in strip_geo:
                return
            if pr and pr[0] in strip_models:
                return emit(off, to_null)
        if parent_name == 'Connections':
            pr = fx.props(off)
            if len(pr) == 3 and (pr[1] in strip_geo or pr[2] in strip_geo):
                return
        emit(off)

    for off, name in fx.top():
        emit_filtered(off, '')
    out.write(fx.null); pos += len(fx.null)
    # 文件尾：footer id + 16 字节对齐填充 + 版本 + 魔数（FBX 读取器靠它判断结束）
    tail_start = list(fx.top())[-1][0]
    tail_start = fx.record(tail_start)[0] + len(fx.null)
    footer_id = bytes(fx.raw[tail_start:tail_start + 16])
    out.write(footer_id); pos += 16
    pad = ((pos + 15) & ~15) - pos or 16
    out.write(b'\0' * pad + b'\0' * 4 + struct.pack('<I', fx.version) + b'\0' * 120 + bytes(fx.raw[-16:]))
    out.close()
    print(f'完成：{a.dst}（{pos / 1e6:.1f} MB）')


if __name__ == '__main__':
    main()
