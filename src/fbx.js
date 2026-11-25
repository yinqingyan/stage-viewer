// 二进制 FBX：读对象和父子关系、自动找灯具/家具型号、按型号生成配置、去掉几何体精简。
// 算法与 skill/stage-viewer/scripts/fbx_strip.py 一致（网页生成器用这一份，Python 版给命令行和 skill 用）。
// 不依赖 DOM，Node 里也能跑。

const td = new TextDecoder(), te = new TextEncoder();
export const LIGHTS = ['beam', 'wash', 'strobe', 'bar'];
export const PROPS = ['chair', 'stool', 'table'];

export class Fbx {
  constructor(buf) {
    this.u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.dv = new DataView(this.u8.buffer, this.u8.byteOffset, this.u8.byteLength);
    if (td.decode(this.u8.subarray(0, 18)) !== 'Kaydara FBX Binary') throw new Error('不是二进制 FBX');
    this.version = this.dv.getUint32(23, true);
    this.wide = this.version >= 7500;  // 7.5 起记录头是 64 位
    this.hsize = this.wide ? 24 : 12;
  }

  num(o) { return this.wide ? Number(this.dv.getBigUint64(o, true)) : this.dv.getUint32(o, true); }

  // 记录：{ end, name, po（属性起点）, pl（属性长度）, nprops }；空记录返回 null
  record(off) {
    const end = this.num(off);
    if (end === 0) return null;
    const w = this.wide ? 8 : 4, o = off + this.hsize, nl = this.u8[o];
    return { end, nprops: this.num(off + w), pl: this.num(off + 2 * w), name: td.decode(this.u8.subarray(o + 1, o + 1 + nl)), po: o + 1 + nl };
  }

  *children(off) {
    const r = this.record(off);
    for (let c = r.po + r.pl; c < r.end;) {
      const k = this.record(c);
      if (!k) break;
      yield c;
      c = k.end;
    }
  }

  *top() {
    for (let c = 27; ;) {
      const r = this.record(c);
      if (!r) return;
      yield [c, r.name];
      c = r.end;
    }
  }

  // 前 n 个简单属性：L → BigInt（对象 id），S/R → 字节
  props(off, n = 3) {
    const r = this.record(off), out = [];
    let p = r.po;
    for (let i = 0; i < Math.min(n, r.nprops); i++) {
      const t = String.fromCharCode(this.u8[p++]);
      if (t === 'L') { out.push(this.dv.getBigInt64(p, true)); p += 8; }
      else if (t === 'S' || t === 'R') { const k = this.dv.getUint32(p, true); p += 4; out.push(this.u8.subarray(p, p + k)); p += k; }
      else break;
    }
    return out;
  }

  // Geometry 里 Vertices 数组的长度（坐标个数），没有返回 0
  vertexCount(geoOff) {
    for (const c of this.children(geoOff)) {
      const r = this.record(c), t = String.fromCharCode(this.u8[r.po]);
      if (r.name === 'Vertices' && (t === 'd' || t === 'f')) return this.dv.getUint32(r.po + 1, true);
    }
    return 0;
  }
}

// 对象名属性是「名字\0\1类型」
function nameOf(b) {
  for (let i = 0; i + 1 < b.length; i++) if (b[i] === 0 && b[i + 1] === 1) return td.decode(b.subarray(0, i));
  return td.decode(b);
}

// objs：id → { kind, name, off }；parent：模型 → 父模型；geoOf：模型 → 几何体
export function readGraph(fx) {
  const tops = new Map([...fx.top()].map(([o, n]) => [n, o]));
  const objs = new Map(), parent = new Map(), geoOf = new Map();
  for (const c of fx.children(tops.get('Objects'))) {
    const pr = fx.props(c);
    objs.set(pr[0], { kind: fx.record(c).name, name: pr.length > 1 ? nameOf(pr[1]) : '', off: c });
  }
  for (const c of fx.children(tops.get('Connections'))) {
    const [k, ch, pa] = fx.props(c);
    if (!k || td.decode(k) !== 'OO' || !objs.has(ch) || !objs.has(pa)) continue;
    const a = objs.get(ch).kind, b = objs.get(pa).kind;
    if (a === 'Model' && b === 'Model') parent.set(ch, pa);
    else if (a === 'Geometry' && b === 'Model') geoOf.set(pa, ch);
  }
  return { objs, parent, geoOf };
}

// 贴图有没有嵌入：贴图图片放在与 Texture 相连的 Video 节点的 Content 里，长度 > 0 才算嵌入。
// 返回 [{ file, embedded }]，同名文件只列一次（有一处嵌入就算嵌入）
export function textures(fx) {
  const tops = new Map([...fx.top()].map(([o, n]) => [n, o]));
  const tex = new Map(), videos = new Map();
  const str = c => { if (c === undefined) return ''; const r = fx.record(c); return r.nprops && fx.u8[r.po] === 83 ? td.decode(fx.u8.subarray(r.po + 5, r.po + 5 + fx.dv.getUint32(r.po + 1, true))) : ''; };
  for (const c of fx.children(tops.get('Objects'))) {
    const kind = fx.record(c).name;
    if (kind !== 'Texture' && kind !== 'Video') continue;
    const [id] = fx.props(c, 1), kids = new Map([...fx.children(c)].map(k => [fx.record(k).name, k]));
    if (kind === 'Texture') tex.set(id, (str(kids.get('RelativeFilename')) || str(kids.get('FileName'))).split(/[\\/]/).pop());
    else {
      const k = kids.get('Content'), r = k && fx.record(k);
      videos.set(id, !!r && r.nprops > 0 && fx.u8[r.po] === 82 && fx.dv.getUint32(r.po + 1, true) > 0);  // 'R' + 长度
    }
  }
  const embedded = new Set();
  for (const c of fx.children(tops.get('Connections'))) {
    const [, ch, pa] = fx.props(c);
    if (videos.get(ch) && tex.has(pa)) embedded.add(pa);
  }
  const byFile = new Map();
  for (const [id, file] of tex) if (file) byFile.set(file, byFile.get(file) || embedded.has(id));
  return [...byFile].map(([file, ok]) => ({ file, embedded: ok }));
}

const prefix = name => name.replace(/\d+$/, '');
const most = counts => Object.keys(counts).reduce((a, b) => counts[b] > counts[a] ? b : a);

// 不看名字找灯具/家具：同一款模型重复出现，内部结构（部件嵌套、每个部件的顶点数）完全相同。
// 结构指纹重复 minCount 次以上、至少 2 个部件的是一个「型号」。指纹不含位置朝向，灯头单独转过也不影响。
export function detect(fx, { objs, parent, geoOf }, minCount = 4) {
  const kids = new Map();
  for (const [c, p] of parent) (kids.get(p) || kids.set(p, []).get(p)).push(c);
  const kidsOf = m => kids.get(m) || [];
  const intern = new Map(), sig = new Map(), size = new Map(), leaves = new Map();
  const walk = m => {
    if (sig.has(m)) return;
    kidsOf(m).forEach(walk);
    const own = geoOf.has(m) ? String(fx.vertexCount(objs.get(geoOf.get(m)).off)) : '-';
    const s = `${own}(${kidsOf(m).map(c => sig.get(c)).sort((a, b) => a - b).join(',')})`;
    if (!intern.has(s)) intern.set(s, intern.size);
    sig.set(m, intern.get(s));
    size.set(m, 1 + kidsOf(m).reduce((n, c) => n + size.get(c), 0));
    leaves.set(m, kidsOf(m).reduce((n, c) => n + leaves.get(c), 0) || 1);
  };
  const models = [...objs].filter(([, o]) => o.kind === 'Model').map(([m]) => m);
  models.forEach(walk);
  const occ = new Map();
  for (const m of models) (occ.get(sig.get(m)) || occ.set(sig.get(m), []).get(sig.get(m))).push(m);
  const rep = new Map([...occ].filter(([, ms]) => ms.length >= minCount && size.get(ms[0]) >= 2));

  // 灯具的每个部件也重复同样次数：每次都在同一种父组里、且次数相同，就只是那个组的部件。
  // 父组只包着它一个（外面套的空组）时不算
  const isPart = s => {
    const ps = new Set(rep.get(s).map(m => parent.get(m)));
    if (ps.has(undefined) || [...ps].some(p => kidsOf(p).length === 1)) return false;
    const psig = new Set([...ps].map(p => sig.get(p)));
    return psig.size === 1 && occ.get([...psig][0]).length === rep.get(s).length;
  };
  let units = new Map([...rep].filter(([s]) => !isPart(s)));
  let unitOf = new Map([...units].flatMap(([s, ms]) => ms.map(m => [m, s])));
  // 一套桌椅：桌子和整套次数相同，但整套里还有别的型号（椅子），桌子也单独算
  for (const [s, ms] of rep) {
    if (!units.has(s) && ms.every(m => kidsOf(parent.get(m)).some(c => c !== m && unitOf.has(c)))) units.set(s, ms);
  }
  unitOf = new Map([...units].flatMap(([s, ms]) => ms.map(m => [m, s])));
  // 只包着一个型号的空组：不单独算
  units = new Map([...units].filter(([, ms]) => !ms.every(m => kidsOf(m).length === 1 && unitOf.has(kidsOf(m)[0]))));

  // 精简过的模型没有顶点数，不同的灯可能结构相同：名字前缀不同的拆开（各自仍要重复 minCount 次）
  const split = [];
  for (const [s, ms] of units) {
    const by = new Map();
    for (const m of ms) {
      const k = prefix(objs.get(m).name);
      (by.get(k) || by.set(k, []).get(k)).push(m);
    }
    const big = [...by.values()].filter(g => g.length >= minCount);
    if (big.length > 1) {
      big[0].push(...[...by.values()].filter(g => g.length < minCount).flat());
      big.forEach(g => split.push([`${s}:${prefix(objs.get(g[0]).name)}`, g]));
    } else split.push([String(s), ms]);
  }

  const topName = m => { while (parent.has(m)) m = parent.get(m); return objs.get(m).name; };
  const keyOf = new Map(split.flatMap(([k, ms]) => ms.map(m => [m, k])));
  const below = function* (m) { for (const c of kidsOf(m)) { yield c; yield* below(c); } };
  const count = (list, f) => list.reduce((o, x) => (o[f(x)] = (o[f(x)] || 0) + 1, o), {});
  const kinds = split.sort((a, b) => b[1].length - a[1].length).map(([key, ms]) => {
    // 整个型号都在另一个型号里面（如灯具内部重复的螺丝）；或者里面包着别的型号（如一整排灯架）
    const inside = new Set(ms.map(m => {
      let hit = null;
      for (let p = parent.get(m); p !== undefined; p = parent.get(p)) hit = keyOf.get(p) || hit;
      return hit;
    }));
    const contains = count([...below(ms[0])].filter(c => keyOf.has(c)), c => keyOf.get(c));
    return { key, count: ms.length, parts: size.get(ms[0]) - 1, leaves: leaves.get(ms[0]), sample: objs.get(ms[0]).name,
             names: count(ms, m => prefix(objs.get(m).name)), groups: count(ms, topName),
             inside: inside.size === 1 ? [...inside][0] : null, contains, ids: ms };
  });
  const id = new Map(kinds.map((k, i) => [k.key, `K${i + 1}`]));
  for (const k of kinds) {
    k.id = id.get(k.key);
    k.inside = id.get(k.inside) || null;
    k.contains = Object.fromEntries(Object.entries(k.contains).map(([c, n]) => [id.get(c), n]));
    k.name = most(k.names);
  }
  return kinds;
}

// 已知型号：名字前缀匹配，有 parts 的还要末端部件数相同
export function libraryEntry(kind, lib) {
  return [...lib.fixtures, ...lib.props].find(e => new RegExp(e.match).test(kind.name) && (e.parts ?? kind.leaves) === kind.leaves) || null;
}
export const roleOf = e => e ? e.type || e.shape : '';

// 按填了用途（role）的型号生成配置里的 fixtures、props。
// 查看器按名字正则找节点（取最外层匹配的；桌椅再按 parts 过滤），先试名字前缀，
// 选中的和这个型号不完全一致时（如名字都叫「组…」），改成逐个列出节点名。
export function makeConfig(kinds, { objs, parent }, lib) {
  const kids = new Map(), leaves = new Map();
  for (const [c, p] of parent) (kids.get(p) || kids.set(p, []).get(p)).push(c);
  const leaf = m => {
    if (!leaves.has(m)) leaves.set(m, (kids.get(m) || []).reduce((n, c) => n + leaf(c), 0) || 1);
    return leaves.get(m);
  };
  const models = [...objs].filter(([, o]) => o.kind === 'Model').map(([m]) => m);
  const select = (regex, parts) => {
    const r = new RegExp(regex), hit = new Set(models.filter(m => r.test(objs.get(m).name)));
    const underHit = m => { for (let p = parent.get(m); p !== undefined; p = parent.get(p)) if (hit.has(p)) return true; return false; };
    return new Set([...hit].filter(m => !underHit(m) && (parts == null || leaf(m) === parts)));
  };
  const same = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const fixtures = [], props = [], notes = [];
  for (const k of kinds) {
    const role = k.role;
    if (!role) continue;
    const light = LIGHTS.includes(role);
    let known = libraryEntry(k, lib);
    if (known && roleOf(known) !== role) known = null;
    const e = { ...known }, parts = light ? null : k.leaves, ids = new Set(k.ids);
    let regex = known ? known.match : '^' + esc(k.name);
    if (!same(select(regex, parts), ids)) {
      regex = '^(' + [...new Set(k.ids.map(m => esc(objs.get(m).name)))].sort().join('|') + ')$';
      if (!same(select(regex, parts), ids)) notes.push({ type: 'dup', id: k.id, name: k.name });  // 节点名有重名，可能多选或漏选几个
    }
    e.match = regex;
    if (light) { e.type = role; fixtures.push(e); }
    else { e.shape = role; e.parts = parts; props.push(e); }
    if (!known) notes.push({ type: 'unknown', id: k.id, name: k.name });  // 不在已知型号里，先按默认大小显示
  }
  return { fixtures, props, notes };
}

// 去掉 units 里每个组的几何体：网格节点改成 Null（保留位置朝向），删掉 Geometry 及其连接。
// 返回 Blob 片段数组（只引用原文件的字节，不复制）。keepSamples：每种保留第一台（调试用）
export function strip(fx, { objs, parent, geoOf }, units, keepSamples = false) {
  const fixtureOf = m => {
    let hit = null;
    while (parent.has(m)) { m = parent.get(m); if (units.has(m)) hit = m; }
    return hit;
  };
  const fixOf = new Map([...geoOf.keys()].map(m => [m, fixtureOf(m)]));
  const nparts = new Map();
  for (const fix of fixOf.values()) if (fix !== null) nparts.set(fix, (nparts.get(fix) || 0) + 1);
  const sampleOf = new Map(), stripModels = new Set();
  for (const [m, fix] of fixOf) {
    if (fix === null) continue;
    const kind = prefix(objs.get(fix).name) + '×' + nparts.get(fix);
    if (!sampleOf.has(kind)) sampleOf.set(kind, fix);
    if (keepSamples && sampleOf.get(kind) === fix) continue;
    stripModels.add(m);
  }
  const stripGeo = new Set([...stripModels].map(m => geoOf.get(m)));

  const u8 = fx.u8, dv = fx.dv, nul = new Uint8Array(fx.hsize + 1), out = [u8.subarray(0, 27)];
  let pos = 27;
  const u32 = o => dv.getUint32(o, true);
  // Model 的属性：L id, S 名字, S 类型；类型 Mesh 改成 Null
  const toNull = (po, pl) => {
    let p = po + 9;
    p += 5 + u32(p + 1);
    const k2 = u32(p + 1), tail = u8.subarray(p + 5 + k2, po + pl);
    const b = new Uint8Array(p - po + 9 + tail.length);
    b.set(u8.subarray(po, p));
    b[p - po] = 83;  // 'S'
    new DataView(b.buffer).setUint32(p - po + 1, 4, true);
    b.set(te.encode('Null'), p - po + 5);
    b.set(tail, p - po + 9);
    return b;
  };
  const emit = (off, edit) => {
    const r = fx.record(off);
    const props = edit ? edit(r.po, r.pl) : u8.subarray(r.po, r.po + r.pl);
    const nb = te.encode(r.name), head = new Uint8Array(fx.hsize + 1 + nb.length);
    head[fx.hsize] = nb.length;
    head.set(nb, fx.hsize + 1);
    out.push(head, props);
    pos += head.length + props.length;
    for (const k of fx.children(off)) emitFiltered(k, r.name);
    if (r.po + r.pl < r.end) { out.push(nul); pos += nul.length; }
    // 子记录写完才知道结束位置，回填记录头
    const h = new DataView(head.buffer);
    if (fx.wide) { h.setBigUint64(0, BigInt(pos), true); h.setBigUint64(8, BigInt(r.nprops), true); h.setBigUint64(16, BigInt(props.length), true); }
    else { h.setUint32(0, pos, true); h.setUint32(4, r.nprops, true); h.setUint32(8, props.length, true); }
  };
  const emitFiltered = (off, parentName) => {
    if (parentName === 'Objects') {
      const [id] = fx.props(off, 1);
      if (stripGeo.has(id)) return;
      if (stripModels.has(id)) return emit(off, toNull);
    }
    if (parentName === 'Connections') {
      const pr = fx.props(off);
      if (pr.length === 3 && (stripGeo.has(pr[1]) || stripGeo.has(pr[2]))) return;
    }
    emit(off);
  };
  const tops = [...fx.top()];
  for (const [off] of tops) emitFiltered(off, '');
  out.push(nul); pos += nul.length;
  // 文件尾：footer id + 16 字节对齐填充 + 版本 + 魔数（FBX 读取器靠它判断结束）
  const tailStart = fx.record(tops[tops.length - 1][0]).end + nul.length;
  out.push(u8.subarray(tailStart, tailStart + 16)); pos += 16;
  const pad = (Math.ceil(pos / 16) * 16 - pos) || 16;
  const end = new Uint8Array(pad + 4 + 4 + 120);
  new DataView(end.buffer).setUint32(pad + 4, fx.version, true);
  out.push(end, u8.subarray(u8.length - 16));
  return { parts: out, size: pos + end.length + 16, meshes: stripModels.size, kinds: [...sampleOf.keys()] };
}
