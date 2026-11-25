#!/usr/bin/env python3
"""把 3D 模型（FBX / GLB）打包成可双击打开的单个 HTML 舞美查看器。只用 Python 标准库。

用法：
  python3 build_html.py 模型.fbx                          # 生成 模型.html
  python3 build_html.py 模型.fbx -o 输出.html -c 配置.json --title 晚会名
  python3 build_html.py 模型.fbx --inspect                # 只检查：构件名、贴图是否嵌入、单位
  python3 build_html.py --show --title 晚会名 -o 秀导走位.html  # 秀导版不带模型，网页里导入舞美平面图
"""
import argparse, base64, gzip, json, os, re, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, '..', 'assets', 'viewer-template.html')
MARK = '<script>/*__STAGE__*/</script>'


# ---------- 二进制 FBX 解析（只读出检查需要的节点） ----------
class Node:
    __slots__ = ('name', 'props', 'children')

    def __init__(self, name, props, children):
        self.name, self.props, self.children = name, props, children

    def find(self, name):
        return next((c for c in self.children if c.name == name), None)


PRIM = {'Y': '<h', 'C': '<?', 'I': '<i', 'F': '<f', 'D': '<d', 'L': '<q'}


def parse_fbx(raw):
    if not raw.startswith(b'Kaydara FBX Binary'):
        raise ValueError('不是二进制 FBX（ASCII FBX 也能显示，但无法检查）')
    version = struct.unpack_from('<I', raw, 23)[0]
    wide = version >= 7500
    head, null = ('<QQQ', 25) if wide else ('<III', 13)

    def read(off):
        end, nprops, plen = struct.unpack_from(head, raw, off)
        if end == 0:
            return None, off + null
        off += struct.calcsize(head)
        name = raw[off + 1:off + 1 + raw[off]].decode('utf8', 'replace')
        off += 1 + raw[off]
        props, p = [], off
        for _ in range(nprops):
            t = chr(raw[p]); p += 1
            if t in PRIM:
                props.append(struct.unpack_from(PRIM[t], raw, p)[0]); p += struct.calcsize(PRIM[t])
            elif t in 'SR':
                n = struct.unpack_from('<I', raw, p)[0]; p += 4
                props.append(raw[p:p + n] if t == 'S' else n); p += n  # 二进制数据只记长度
            else:  # 数组：长度、编码、压缩后字节数
                clen = struct.unpack_from('<III', raw, p)[2]; p += 12 + clen
                props.append(None)
        children, c = [], off + plen
        while c < end:
            child, c = read(c)
            if child is None:
                break
            children.append(child)
        return Node(name, props, children), end

    top, off = [], 27
    while off < len(raw) - null:
        node, off = read(off)
        if node is None:
            break
        top.append(node)
    return version, Node('', [], top)


def obj_name(prop):
    return prop.split(b'\x00\x01')[0].decode('utf8', 'replace')


def inspect_fbx(raw):
    version, root = parse_fbx(raw)
    info = {'version': version, 'unit_cm': 1.0, 'meshes': [], 'textures': []}
    gs = root.find('GlobalSettings')
    props = gs and gs.find('Properties70')
    for p in props.children if props else []:
        if p.props and p.props[0] == b'UnitScaleFactor':
            info['unit_cm'] = p.props[-1]
    objects = root.find('Objects')
    by_id = {o.props[0]: o for o in objects.children} if objects else {}
    links = {}  # 子 id -> 父 id 列表
    conns = root.find('Connections')
    for c in conns.children if conns else []:
        links.setdefault(c.props[1], []).append(c.props[2])
    for o in by_id.values():
        if o.name == 'Model' and o.props[2] == b'Mesh':
            info['meshes'].append(obj_name(o.props[1]))
        elif o.name == 'Texture':
            fn = o.find('RelativeFilename') or o.find('FileName')
            path = fn.props[0].decode('utf8', 'replace') if fn else ''
            # 贴图图片放在与之相连的 Video 节点的 Content 里；长度 > 0 才算嵌入
            embedded = False
            for vid, parents in links.items():
                v = by_id.get(vid)
                if v is not None and v.name == 'Video' and o.props[0] in parents:
                    content = v.find('Content')
                    embedded = embedded or bool(content and content.props and content.props[0])
            info['textures'].append({'name': obj_name(o.props[1]), 'file': re.split(r'[\\/]', path)[-1], 'embedded': embedded})
    return info


def report(info):
    print(f"FBX 版本 {info['version']}，单位：1 = {info['unit_cm']} cm")
    print(f"网格构件 {len(info['meshes'])} 个")
    missing = [t for t in info['textures'] if t['file'] and not t['embedded']]
    for t in info['textures']:
        if not t['file']:
            continue  # 没有文件名的空贴图节点，忽略
        print(f"  贴图 {t['file']}：{'已嵌入' if t['embedded'] else '未嵌入，网页里不会显示'}")
    if missing:
        print('⚠ 有贴图未嵌入：请在 3ds Max 导出 FBX 时勾选「嵌入的媒体 (Embed Media)」后重新导出。')
    return missing


def main():
    ap = argparse.ArgumentParser(description='3D 模型 → 单文件 HTML 舞美查看器')
    ap.add_argument('model', nargs='?', help='.fbx 或 .glb 文件（加 --show 时可省略，网页里导入舞美平面图）')
    ap.add_argument('-o', '--output', help='输出 html 路径（默认与模型同名）')
    ap.add_argument('-c', '--config', help='配置 JSON（观众席朝向、升降屏等，见 SKILL.md）')
    ap.add_argument('--title', help='页面标题，如晚会名称')
    ap.add_argument('--inspect', action='store_true', help='只检查模型，列出全部构件名，不生成')
    ap.add_argument('--show', action='store_true', help='生成秀导走位版（导入音乐、时间码、演员站位和路线、导出截图）')
    a = ap.parse_args()

    if not a.model:
        if not a.show:
            sys.exit('请给出模型文件。只有秀导版（--show）可以不带模型')
        if not a.output:
            sys.exit('不带模型时请用 -o 指定输出文件，如 -o 秀导走位.html')
        if a.inspect:
            sys.exit('--inspect 需要模型文件')
    ext = os.path.splitext(a.model or '')[1].lower()
    if a.model and ext not in ('.fbx', '.glb'):
        sys.exit('只支持 .fbx 和 .glb。其他格式请先在建模软件里导出为 FBX（3ds Max：文件 → 导出 → FBX）。')
    raw = open(a.model, 'rb').read() if a.model else None

    if ext == '.fbx':
        try:
            info = inspect_fbx(raw)
            report(info)
            if a.inspect:
                print('构件名：\n' + '\n'.join('  ' + n for n in info['meshes']))
                return
        except (ValueError, struct.error, IndexError) as e:
            print(f'（跳过检查：{e}）')
    elif a.inspect:
        sys.exit('--inspect 只支持 FBX')

    config = json.load(open(a.config, encoding='utf8')) if a.config else {}
    # 替换贴图：图片路径相对配置文件，打包时转成内嵌的 data URI
    for t in config.get('textures', []):
        path = os.path.join(os.path.dirname(os.path.abspath(a.config)), t['image'])
        mime = 'image/png' if path.lower().endswith('.png') else 'image/jpeg'
        t['image'] = f'data:{mime};base64,' + base64.b64encode(open(path, 'rb').read()).decode('ascii')
    if a.title:
        config['title'] = a.title
    if a.show:
        config['app'] = 'show'
    stage = {
        'model': raw and {'format': ext[1:], 'gzip': True, 'data': base64.b64encode(gzip.compress(raw, 9, mtime=0)).decode('ascii')},
        'config': config,
    }
    template = open(TEMPLATE, encoding='utf8').read()
    assert MARK in template, '模板缺少注入标记'
    payload = json.dumps(stage, ensure_ascii=False).replace('</', '<\\/')
    html = template.replace(MARK, f'<script>window.STAGE={payload}</script>', 1)

    out = a.output or os.path.splitext(a.model)[0] + '.html'
    with open(out, 'w', encoding='utf8') as f:
        f.write(html)
    print(f'完成：{out}（{len(html.encode("utf8")) / 1024 / 1024:.1f} MB），双击即可在浏览器打开')


if __name__ == '__main__':
    main()
