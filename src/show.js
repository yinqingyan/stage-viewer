import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// 秀导版：舞美顶视图 + 音乐分轨时间轴，排演员走位。
//   人：单人（演员）或一组（舞团），平面图上是带名字的圆点
//   分轨：每组、每个人一条轨道；每次移动是轨道上的一段素材（几分几秒到几分几秒，从哪沿什么路线走到哪），素材之间原地不动
//   画移动：时间轴走到出发时间，在平面图上拖人，拖过的线就是路线，松手处是到位位置；多人一起拖生成一组联动素材
//   组：组轨道上的一段 = 组员们联动的素材，拖它整组一起改时间；展开后可单独拖某个组员的素材，他仍跟着组
//   标记：音乐上的标记点（前奏、副歌…），用来跳转和导出截图
//   保存：一个 .json，音乐也打包在里面；导出：开场和每个标记一张顶视图截图（zip）

const FPS = 25, FRAME = 1 / FPS, CUT = 6, WARN = 3, WALK = 1.5, DOT_M = 0.9, ABOVE = 60;  // 剖切高度 m；超过 WARN m/s 标红；新素材按 WALK m/s 估时长
// 颜色预设：12 个色相（避开正红，红色留给「太快」）× 3 种深浅 + 4 个中性色 = 40 种
const HUES = [210, 45, 140, 280, 25, 185, 320, 95, 235, 60, 165, 300];
const PALETTE = [[0.55, 0.8], [0.75, 0.8], [0.38, 0.7]].flatMap(([l, sat]) => HUES.map(h => '#' + new THREE.Color().setHSL(h / 360, sat, l, THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace)))
  .concat(['#f2f2f2', '#b8bcc6', '#7d828f', '#4a4e58']);
const SOLO = '#f2f2f2';
const isLight = hex => { const c = new THREE.Color(hex); return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b > 0.55; };
const pad = n => String(n).padStart(2, '0');
const tc = t => { const f = Math.round(t * FPS); return `${pad(Math.floor(f / FPS / 60))}:${pad(Math.floor(f / FPS) % 60)}:${pad(f % FPS)}`; };
const snap = t => Math.round(t * FPS) / FPS;
const r2 = v => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const plen = pts => pts.reduce((s, p, i) => i ? s + dist(p, pts[i - 1]) : 0, 0);
function along(pts, f) {
  const L = plen(pts) * f;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i], pts[i - 1]);
    if (acc + seg >= L && seg > 0) { const u = (L - acc) / seg; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u]; }
    acc += seg;
  }
  return pts[pts.length - 1];
}
// 手绘线化简成几个拐点（Douglas–Peucker），拐点在平面图上可以拖
function simplify(pts, tol = 0.35) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]], L = dist(a, b) || 1e-9;
  let far = 0, fi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L;
    if (d > far) { far = d; fi = i; }
  }
  return far > tol ? [...simplify(pts.slice(0, fi + 1), tol).slice(0, -1), ...simplify(pts.slice(fi), tol)] : [a, b];
}
const rotAround = (p, c, a) => { const dx = p[0] - c[0], dz = p[1] - c[1], co = Math.cos(a), si = Math.sin(a); return [c[0] + dx * co - dz * si, c[1] + dx * si + dz * co]; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function setupShow({ renderer, scene, meshes, size, center, audienceDir, storageKey, title, setTitle }) {
  const canvas = renderer.domElement;
  const $ = id => document.getElementById(id);
  const peopleBody = $('people').querySelector('.sec-body'), markBody = $('cueSec').querySelector('.sec-body');
  const hint = $('shHint'), ruler = $('shTL'), tcEl = $('shTC'), playBtn = $('shPlay'), boxEl = $('shBox');
  const tracks = $('shTracks'), playhead = $('shHead');

  // ---------- 顶视图 ----------
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
  const up = audienceDir().negate().setY(0).normalize();  // 屏幕上方 = 舞台
  cam.up.copy(up);
  const ctl = new OrbitControls(cam, canvas);
  ctl.enableRotate = false;
  ctl.screenSpacePanning = true;
  // 防误操作：左键只管选人、拖人、框选，不移动图；右键/中键拖 = 移动图；缩放见下面的滚轮处理
  ctl.enableZoom = false;
  ctl.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
  ctl.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
  // 滚轮：鼠标滚轮一格 = 缩放；触控板双指滑动 = 移动图，双指捏合（或 ⌘/Ctrl+滚动）= 缩放。触控板、妙控鼠标轻碰不会缩放
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const notch = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey || notch) {
      const before = toWorld(e);
      cam.zoom = Math.max(0.3, Math.min(40, cam.zoom * Math.exp(-e.deltaY * (e.ctrlKey && !notch ? 0.01 : 0.0015))));
      cam.updateProjectionMatrix();
      const after = toWorld(e), d = new THREE.Vector3(before[0] - after[0], 0, before[1] - after[1]);
      cam.position.add(d); ctl.target.add(d);
    } else {
      const w = wpp(), d = new THREE.Vector3().addScaledVector(rightV, e.deltaX * w).addScaledVector(up, -e.deltaY * w);
      cam.position.add(d); ctl.target.add(d);
    }
    cam.updateMatrixWorld();
  }, { passive: false });
  const rightV = new THREE.Vector3();
  // full：铺满整个画布（导出截图）；否则放在面板左边、时间轴上面的空白区域
  function fit(full = false) {
    const side = $('side').getBoundingClientRect(), bar = $('showBar').getBoundingClientRect();
    const L = 12, R = full || innerWidth <= 700 ? innerWidth - 12 : side.left - 12, T = 12, B = full ? innerHeight - 12 : bar.top - 12;
    cam.position.set(center.x, center.y + ABOVE + size.y, center.z);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    rightV.setFromMatrixColumn(cam.matrixWorld, 0);
    // 有平面图按图取景，否则按模型
    const [extH, extV] = bg ? bgDims() : [Math.abs(rightV.x) * size.x + Math.abs(rightV.z) * size.z, Math.abs(up.x) * size.x + Math.abs(up.z) * size.z];
    const wpp = Math.max(extH / Math.max(100, R - L), extV / Math.max(100, B - T)) * 1.06;
    Object.assign(cam, { left: -innerWidth / 2 * wpp, right: innerWidth / 2 * wpp, top: innerHeight / 2 * wpp, bottom: -innerHeight / 2 * wpp, zoom: 1 });
    const dx = (L + R) / 2 - innerWidth / 2, dy = (T + B) / 2 - innerHeight / 2;
    const c = center.clone().addScaledVector(rightV, -dx * wpp).addScaledVector(up, dy * wpp);
    cam.position.set(c.x, center.y + ABOVE + size.y, c.z);
    ctl.target.set(c.x, center.y, c.z);
    cam.lookAt(ctl.target);
    cam.updateProjectionMatrix();
    ctl.update();
  }
  addEventListener('resize', () => { fit(); layoutClips(); });
  const wpp = () => (cam.top - cam.bottom) / cam.zoom / innerHeight;
  const dotPx = () => Math.max(14, Math.min(32, DOT_M / wpp()));
  const DOT_Y = center.y + size.y + 5;
  const v3 = new THREE.Vector3();
  function toScreen(p) { v3.set(p[0], DOT_Y, p[1]).project(cam); return [(v3.x + 1) / 2 * innerWidth, (1 - v3.y) / 2 * innerHeight]; }
  function toWorld(e) { v3.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1, 0).unproject(cam); return [v3.x, v3.z]; }

  // ---------- 舞美平面图：导入 jpg/png 代替三维模型 ----------
  // 图的上方朝舞台、下方朝观众席，中心放在舞台中心；宽度（米）决定比例，人的大小和走速都按它算
  const bgKey = storageKey + ':bg';
  let bg = null;  // { data, w: 实际宽度 m, rot: 顺时针转了几个 90°, aspect: 高/宽 }
  const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }));
  bgMesh.rotation.x = -Math.PI / 2;
  const bgHolder = new THREE.Group();
  bgHolder.add(bgMesh);
  bgHolder.rotation.y = Math.atan2(-up.x, -up.z);
  bgHolder.position.set(center.x, center.y + size.y + 2, center.z);
  bgHolder.visible = false;
  scene.add(bgHolder);
  // 转过之后在屏幕上的宽、高（米）
  const bgDims = () => bg.rot % 2 ? [bg.w * bg.aspect, bg.w] : [bg.w, bg.w * bg.aspect];
  function applyBg() {
    bgHolder.visible = !!bg;
    $('bgRot').hidden = $('bgDel').hidden = $('bgWRow').hidden = !bg;
    $('bgLoad').textContent = bg ? '换一张' : '导入平面图';
    $('bgTip').textContent = bg
      ? '先量好比例：填这张图左右实际有多少米（图纸上的总宽）。人的圆点约 0.9 米，可以对照看比例对不对'
      : meshes.length ? '现在显示的是三维模型的顶视图。导入 jpg / png 平面图后改用图片（图的上方是舞台，下方是观众席）'
        : '导入舞台平面图 jpg / png（图的上方是舞台，下方是观众席）';
    if (!bg) return;
    bgMesh.scale.set(bg.w, bg.w * bg.aspect, 1);
    bgMesh.rotation.z = -bg.rot * Math.PI / 2;
    $('bgW').value = +bg.w.toFixed(2);
  }
  function setBg(b, save = true) {
    bg = b;
    bgMesh.material.map?.dispose();
    bgMesh.material.map = null;
    if (bg) {
      const tex = new THREE.TextureLoader().load(bg.data, () => { bgMesh.material.needsUpdate = true; });
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      bgMesh.material.map = tex;
    }
    bgMesh.material.needsUpdate = true;
    applyBg();
    if (save) {
      try { bg ? localStorage.setItem(bgKey, JSON.stringify(bg)) : localStorage.removeItem(bgKey); }
      catch { flash('平面图太大，浏览器没能自动记住，记得点「保存」'); }
    }
  }
  // 大图缩到长边 3000 像素，免得文件太大
  const loadImg = src => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
  $('bgLoad').onclick = () => $('bgFile').click();
  $('bgFile').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const im = await loadImg(await readURL(f));
      const k = Math.min(1, 3000 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(im, 0, 0, c.width, c.height);
      // 第一次导入时宽度按模型（没有模型就 40 米）估一个，换图时沿用原来的宽度
      const w = bg?.w ?? (meshes.length ? Math.abs(rightV.x) * size.x + Math.abs(rightV.z) * size.z : 40);
      setBg({ data: c.toDataURL('image/jpeg', 0.88), w: Math.round(w * 2) / 2, rot: 0, aspect: c.height / c.width });
      fit();
      flash('先在右边「舞美图」里填这张图的实际宽度（米）');
    } catch { alert('图片打不开，请用 jpg 或 png'); }
  };
  $('bgW').onchange = e => {
    const w = +e.target.value;
    if (!bg) return;
    if (!(w >= 1 && w <= 500)) { applyBg(); return; }
    setBg({ ...bg, w });
    fit();
  };
  $('bgRot').onclick = () => { setBg({ ...bg, rot: (bg.rot + 1) % 4 }); fit(); };
  $('bgDel').onclick = () => { if (confirm('去掉舞美平面图？人员和走位不受影响')) { setBg(null); fit(); } };

  // ---------- 数据 ----------
  // start：开场站位（null = 开场不在台上）；clip：{ id, who, t0, t1, path: 途经点, to: 到位点（null = 下场）, link: 联动编号 }
  const blank = () => ({ v: 2, people: [], groups: [], start: {}, clips: [], marks: [], nextId: 1, musicName: '' });
  let S = blank();
  try { const s = JSON.parse(localStorage.getItem(storageKey)); if (s?.v === 2) S = s; } catch {}
  const person = id => S.people.find(p => p.id === id);
  const group = id => S.groups.find(g => g.id === id);
  const members = gid => S.people.filter(p => p.group === gid).map(p => p.id);
  const colorOf = p => p.color || (p.group && group(p.group)?.color) || SOLO;  // 个人颜色优先于组颜色
  const wholeGroup = ids => S.groups.find(g => { const m = members(g.id); return m.length === ids.length && m.every(i => ids.includes(i)); });

  let byWho = new Map();  // who → 按时间排好的素材
  function reindex() {
    byWho = new Map();
    for (const c of S.clips) { if (!byWho.has(c.who)) byWho.set(c.who, []); byWho.get(c.who).push(c); }
    for (const l of byWho.values()) l.sort((a, b) => a.t0 - b.t0);
  }
  const clipsOf = id => byWho.get(id) || [];

  const hist = [];
  const pushHist = () => { hist.push(JSON.stringify(S)); if (hist.length > 80) hist.shift(); };
  let saveTimer;
  function changed() {
    S.clips = S.clips.filter(c => person(c.who));
    reindex();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(storageKey, JSON.stringify(S)); } catch {} }, 400);
    pathsDirty = true;
    sync();
    renderTracks();
  }

  // 时间 → 位置
  let T = 0, playing = false;
  function where(id, t) {
    let pos = S.start[id] ?? null;
    for (const c of clipsOf(id)) {
      if (t < c.t0) break;
      if (t >= c.t1) { pos = c.to; continue; }
      const pts = [pos, ...c.path, c.to].filter(Boolean);
      if (pts.length < 2) return c.to ?? pos;
      return along(pts, (t - c.t0) / (c.t1 - c.t0));
    }
    return pos;
  }
  function prevPos(c) {
    let pos = S.start[c.who] ?? null;
    for (const cc of clipsOf(c.who)) { if (cc === c) break; pos = cc.to; }
    return pos;
  }
  function routeOf(c) {
    let pos = S.start[c.who] ?? null;
    for (const cc of clipsOf(c.who)) { if (cc === c) break; pos = cc.to; }
    const pts = [pos, ...c.path, c.to].filter(Boolean);
    return pts.length > 1 ? pts : null;
  }
  const speed = c => { const pts = routeOf(c); return pts ? plen(pts) / Math.max(FRAME, c.t1 - c.t0) : 0; };
  // 这个人从 t 起能开始新动作的时间：正在走的话等走完
  function freeFrom(id, t) { for (const c of clipsOf(id)) if (c.t0 <= t + 1e-6 && t < c.t1 - 1e-6) return c.t1; return t; }
  const nextStart = (id, t) => clipsOf(id).find(c => c.t0 > t + 1e-6)?.t0 ?? Infinity;
  function addClip(who, t0, dur, path, to, link) {
    const t1 = Math.min(t0 + dur, nextStart(who, t0), duration());
    if (t1 - t0 < FRAME - 1e-6) return false;
    S.clips.push({ id: S.nextId++, who, t0: snap(t0), t1: snap(t1), path, to, link });
    reindex();
    return true;
  }

  // ---------- 圆点 ----------
  const texCache = new Map();
  function dotTex(color, label, on) {
    const key = color + '|' + label + '|' + on;
    if (!texCache.has(key)) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2);
      g.fillStyle = color; g.fill();
      g.lineWidth = on ? 7 : 3; g.strokeStyle = on ? '#ffffff' : 'rgba(0,0,0,.65)'; g.stroke();
      if (on) { g.beginPath(); g.arc(32, 32, 31, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke(); }
      const t = label.slice(0, 3);
      g.fillStyle = isLight(color) ? '#111' : '#fff';
      g.font = `bold ${t.length > 2 ? 19 : 25}px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(t, 32, 34);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      texCache.set(key, tex);
    }
    return texCache.get(key);
  }
  const dots = new Map();  // id → sprite
  const dotGroup = new THREE.Group();
  scene.add(dotGroup);
  let sel = new Set(), selMode = 'group', selClip = null;  // selClip: { link } 或 { id }
  const openG = new Set();  // 时间轴上展开了组员轨道的组
  function sync() {
    for (const [id, s] of dots) if (!person(id)) { dotGroup.remove(s); s.material.dispose(); dots.delete(id); }
    for (const id of sel) if (!person(id)) sel.delete(id);
    for (const p of S.people) {
      let s = dots.get(p.id);
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
        dots.set(p.id, s);
        dotGroup.add(s);
      }
      const on = sel.has(p.id);
      s.material.map = dotTex(colorOf(p), p.name, on);
      s.renderOrder = on ? 21 : 20;
      s.material.needsUpdate = true;
    }
    pathsDirty = true;
    renderPanel();
  }

  // 平面图上的路线：正在走的、选中的素材、选中的人接下来那一段
  const pathMat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 });
  const paths = new THREE.LineSegments(new THREE.BufferGeometry(), pathMat);
  paths.renderOrder = 15;
  const draft = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
  draft.renderOrder = 16;
  scene.add(paths, draft);
  let pathsDirty = true, pathsKey = '';
  const isSelClip = c => !!selClip && (selClip.link ? c.link === selClip.link : c.id === selClip.id);
  function shownClips() {
    const out = [];
    for (const [who, list] of byWho) {
      const next = sel.has(who) ? list.find(c => c.t0 > T) : null;
      for (const c of list) if ((c.t0 <= T && T <= c.t1) || isSelClip(c) || c === next) out.push(c);
    }
    return out;
  }
  function buildPaths() {
    const list = shownClips(), key = list.map(c => c.id).join(',');
    if (!pathsDirty && key === pathsKey) return;
    pathsDirty = false; pathsKey = key;
    const pos = [], col = [], c3 = new THREE.Color();
    for (const c of list) {
      const pts = routeOf(c);
      if (!pts) continue;
      c3.set(speed(c) > WARN ? '#ff3b30' : colorOf(person(c.who)));
      if (!isSelClip(c) && !(c.t0 <= T && T <= c.t1)) c3.multiplyScalar(0.55);  // 还没开始的那段暗一点
      for (let i = 1; i < pts.length; i++) {
        pos.push(pts[i - 1][0], DOT_Y - 1, pts[i - 1][1], pts[i][0], DOT_Y - 1, pts[i][1]);
        col.push(c3.r, c3.g, c3.b, c3.r, c3.g, c3.b);
      }
    }
    paths.geometry.dispose();
    paths.geometry = new THREE.BufferGeometry();
    paths.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    paths.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }

  // ---------- 拐点手柄、旋转手柄 ----------
  // 选中一段移动：它的拐点（白色带号）和到位点（黄色）可以拖，组的移动拖一个点全组同一个点一起动
  // 选中两人以上：队形外侧出现旋转手柄；选中了移动时转的是这段移动的到位队形，否则从当前时间出发转过去
  const hTex = new Map();
  function handleTex(kind, label) {
    const key = kind + label;
    if (!hTex.has(key)) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      g.lineWidth = 5; g.strokeStyle = '#000';
      if (kind === 'rot') {
        g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.fillStyle = '#ffd23f'; g.fill(); g.stroke();
        g.beginPath(); g.arc(32, 32, 14, -Math.PI * 0.9, Math.PI * 0.6); g.lineWidth = 5; g.stroke();
        g.beginPath(); g.moveTo(41, 46); g.lineTo(31, 52); g.lineTo(32, 40); g.fillStyle = '#000'; g.fill();
      } else {
        g.fillStyle = kind === 'end' ? '#ffd23f' : '#fff';
        g.fillRect(8, 8, 48, 48); g.strokeRect(8, 8, 48, 48);
        g.fillStyle = '#000'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(label, 32, 34);
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      hTex.set(key, t);
    }
    return hTex.get(key);
  }
  const handleGroup = new THREE.Group();
  scene.add(handleGroup);
  let handleList = [], hDrag = null;
  const selClips = () => selClip ? S.clips.filter(isSelClip) : [];
  const leadOf = l => l.reduce((a, c) => (c.who < a.who ? c : a), l[0]);
  function rotSetup() {
    const ids = [...sel];
    if (ids.length < 2) return null;
    const l = selClips().filter(c => c.to);
    const clipMode = l.length >= 2 && l.length === ids.length && l.every(c => sel.has(c.who));
    const base = new Map();
    if (clipMode) l.forEach(c => base.set(c.who, c.to));
    else ids.forEach(id => { const q = where(id, T < FRAME ? 0 : freeFrom(id, T)); if (q) base.set(id, q); });
    if (base.size < 2) return null;
    const pts = [...base.values()], c = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const rad = Math.max(...pts.map(p => dist(p, c)));
    return { clipMode, base, pivot: c, handle: [c[0] + up.x * (rad + 2.5), c[1] + up.z * (rad + 2.5)], clips: clipMode ? l : null };
  }
  function updateHandles() {
    handleList = [];
    if (!playing && !drag) {
      const l = selClips();
      if (l.length && routeOf(leadOf(l))) {
        const c = leadOf(l);
        // 挨得太近的拐点（如旋转的圆弧）只画一个，免得叠成一团
        let last = toScreen(prevPos(c) || c.path[0] || c.to);
        c.path.forEach((p, i) => { const sp = toScreen(p); if (Math.hypot(sp[0] - last[0], sp[1] - last[1]) < 22) return; last = sp; handleList.push({ kind: 'pt', i, pos: p, label: String(i + 1) }); });
        if (c.to) handleList.push({ kind: 'end', pos: c.to, label: '' });
      }
      const rs = hDrag?.kind === 'rot' ? hDrag.rs : rotSetup();
      if (rs) handleList.push({ kind: 'rot', pos: hDrag?.kind === 'rot' ? rotAround(rs.handle, rs.pivot, hDrag.angle) : rs.handle, label: '' });
    }
    while (handleGroup.children.length < handleList.length) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
      sp.renderOrder = 25;
      handleGroup.add(sp);
    }
    const w = wpp();
    handleGroup.children.forEach((sp, i) => {
      const h = handleList[i];
      sp.visible = !!h;
      if (!h) return;
      const tex = handleTex(h.kind, h.label);
      if (sp.material.map !== tex) { sp.material.map = tex; sp.material.needsUpdate = true; }
      const px = h.kind === 'rot' ? 26 : 16;
      sp.scale.set(px * w, px * w, 1);
      sp.position.set(h.pos[0], DOT_Y + 1, h.pos[1]);
    });
  }
  function hitHandle(x, y) {
    let best = null, bd = 12;
    for (const h of handleList) { const [sx, sy] = toScreen(h.pos), d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = h; } }
    return best;
  }
  // 拖拐点 / 到位点：同一段联动的每个人同一个点平移同样距离（队形不变）
  function startHandleDrag(h, w) {
    if (h.kind === 'rot') {
      const rs = rotSetup();
      hDrag = { kind: 'rot', rs, a0: Math.atan2(w[1] - rs.pivot[1], w[0] - rs.pivot[0]), angle: 0 };
      return;
    }
    const l = selClips();
    hDrag = { kind: h.kind, i: h.i, startW: w, list: l, orig: l.map(c => h.kind === 'end' ? c.to?.slice() : c.path[h.i]?.slice()), moved: false };
  }
  function moveHandleDrag(w, e) {
    if (hDrag.kind === 'rot') {
      let a = Math.atan2(w[1] - hDrag.rs.pivot[1], w[0] - hDrag.rs.pivot[0]) - hDrag.a0;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * Math.PI / 12;
      hDrag.angle = a;
      hint.textContent = `旋转 ${Math.round(Math.abs(a) * 180 / Math.PI)}°${hDrag.rs.clipMode ? '（到位队形）' : ''} · 按住 Shift 每 15° 一档`;
      hint.hidden = false;
      return;
    }
    if (!hDrag.moved) { hDrag.moved = true; pushHist(); }
    const d = [w[0] - hDrag.startW[0], w[1] - hDrag.startW[1]];
    hDrag.list.forEach((c, k) => {
      const o = hDrag.orig[k];
      if (!o) return;
      const q = [r2(o[0] + d[0]), r2(o[1] + d[1])];
      if (hDrag.kind === 'end') c.to = q; else c.path[hDrag.i] = q;
    });
    pathsDirty = true;
  }
  function endHandleDrag() {
    if (hDrag.kind === 'rot') { hint.hidden = !pending; if (Math.abs(hDrag.angle) > 0.01) commitRotate(hDrag.rs, hDrag.angle); }
    else if (hDrag.moved) changed();
    hDrag = null;
  }
  function commitRotate(rs, a) {
    pushHist();
    const rot = p => { const q = rotAround(p, rs.pivot, a); return [r2(q[0]), r2(q[1])]; };
    if (rs.clipMode) rs.clips.forEach(c => c.to = rot(c.to));
    else if (T < FRAME) rs.base.forEach((p, id) => S.start[id] = rot(p));
    else {
      // 从当前时间出发，每人沿圆弧转到新位置（整组刚性旋转）
      const steps = Math.max(1, Math.ceil(Math.abs(a) / (Math.PI / 12))), link = S.nextId++;
      let made = false;
      rs.base.forEach((p, id) => {
        const path = Array.from({ length: steps - 1 }, (_, k) => { const q = rotAround(p, rs.pivot, a * (k + 1) / steps); return [r2(q[0]), r2(q[1])]; });
        const to = rot(p), dur = Math.max(1, plen([p, ...path, to]) / WALK);
        if (addClip(id, freeFrom(id, T), dur, path, to, link)) made = true;
      });
      if (made) selClip = { link };
    }
    changed();
  }
  // 双击拐点删掉它；双击选中路线的线段在那里加一个拐点
  canvas.addEventListener('dblclick', e => {
    clearTimeout(clearTimer);
    const l = selClips();
    if (!l.length) return;
    const h = hitHandle(e.clientX, e.clientY);
    const lead = leadOf(l);
    if (h?.kind === 'pt') { pushHist(); l.forEach(c => c.path.splice(h.i, 1)); return changed(); }
    const pts = routeOf(lead);
    if (!pts) return;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = toScreen(pts[i - 1]), [bx, by] = toScreen(pts[i]);
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1, u = Math.max(0, Math.min(1, ((e.clientX - ax) * (bx - ax) + (e.clientY - ay) * (by - ay)) / L2));
      if (Math.hypot(ax + (bx - ax) * u - e.clientX, ay + (by - ay) * u - e.clientY) > 8) continue;
      const w = toWorld(e), at = prevPos(lead) ? i - 1 : i;  // 线段 i 前面插入；有出发点时 pts 比 path 多一个头
      pushHist();
      // 各人按自己相对领头者的到位偏移插入
      l.forEach(c => { const off = c.to && lead.to ? [c.to[0] - lead.to[0], c.to[1] - lead.to[1]] : [0, 0]; c.path.splice(Math.max(0, at), 0, [r2(w[0] + off[0]), r2(w[1] + off[1])]); });
      return changed();
    }
  });

  let drag = null;  // 平面图上的拖动：{ anchor, base, startW, pts, delta, moved }
  function updateDots() {
    const s = wpp() * dotPx();
    for (const p of S.people) {
      const d = dots.get(p.id), moving = drag?.moved && sel.has(p.id);
      let q = moving ? drag.base.get(p.id) : where(p.id, T);
      if (q && moving) q = [q[0] + drag.delta[0], q[1] + drag.delta[1]];
      if (hDrag?.kind === 'rot' && hDrag.rs.base.has(p.id)) q = rotAround(hDrag.rs.base.get(p.id), hDrag.rs.pivot, hDrag.angle);
      d.visible = !!q;
      if (q) d.position.set(q[0], DOT_Y, q[1]);
      d.scale.set(s, s, 1);
    }
    buildPaths();
    updateHandles();
  }

  // ---------- 平面图操作 ----------
  let pending = null;  // { kind: 'one' | 'group' | 'enter', n, name }
  function setPending(p, msg) { pending = p; hint.textContent = msg || ''; hint.hidden = !msg; }
  let flashTimer;
  function flash(msg) { clearTimeout(flashTimer); hint.textContent = msg; hint.hidden = false; flashTimer = setTimeout(() => { if (!pending) hint.hidden = true; }, 2500); }
  function hitDot(x, y) {
    let best = null, bd = dotPx() / 2 + 4;
    for (const [id, d] of dots) {
      if (!d.visible) continue;
      const [sx, sy] = toScreen([d.position.x, d.position.z]), dd = Math.hypot(sx - x, sy - y);
      if (dd < bd) { bd = dd; best = id; }
    }
    return best;
  }
  const expand = id => { const p = person(id); return selMode === 'group' && p.group ? members(p.group) : [id]; };
  function clickSelect(id, shift) {
    const ids = expand(id);
    if (shift) { const all = ids.every(i => sel.has(i)); ids.forEach(i => all ? sel.delete(i) : sel.add(i)); }
    else if (!ids.every(i => sel.has(i))) sel = new Set(ids);
    selClip = null;
    sync();
    renderTracks();
  }
  let box = null, emptyDown = null, clearTimer;
  const block = e => { ctl.enabled = false; e.stopPropagation(); };
  addEventListener('pointerdown', e => {
    if (e.target !== canvas || e.button !== 0) return;
    const w = toWorld(e);
    if (pending) { applyPending(w); return block(e); }
    const h = hitHandle(e.clientX, e.clientY);
    if (h) { play(false); startHandleDrag(h, w); return block(e); }
    const id = hitDot(e.clientX, e.clientY);
    if (id) {
      clickSelect(id, e.shiftKey);
      if (!sel.has(id)) return block(e);
      play(false);
      // 被拖的人正在走的话，从他走完的时间开始画
      const t = T < FRAME ? 0 : freeFrom(id, T);
      if (t !== T) seek(t);
      const base = new Map([...sel].map(i => [i, where(i, T < FRAME ? 0 : freeFrom(i, T))]));
      drag = { anchor: base.get(id), base, startW: w, pts: [base.get(id)], delta: [0, 0], moved: false };
      return block(e);
    }
    // 左键拖空白处 = 框选（按住 Shift 加选）；只点一下 = 取消选择
    box = { x0: e.clientX, y0: e.clientY, add: e.shiftKey };
    emptyDown = [e.clientX, e.clientY];
    block(e);
  }, true);
  addEventListener('pointermove', e => {
    if (hDrag) moveHandleDrag(toWorld(e), e);
    if (drag) {
      const w = toWorld(e), cur = [drag.anchor[0] + w[0] - drag.startW[0], drag.anchor[1] + w[1] - drag.startW[1]];
      drag.delta = [cur[0] - drag.anchor[0], cur[1] - drag.anchor[1]];
      if (Math.hypot(...drag.delta) > 0.15) drag.moved = true;
      if (dist(cur, drag.pts[drag.pts.length - 1]) > 0.25) drag.pts.push(cur);
      drag.cur = cur;
      draft.geometry.setFromPoints([...drag.pts, cur].map(p => new THREE.Vector3(p[0], DOT_Y, p[1])));
      draft.visible = drag.moved && T >= FRAME;
    }
    if (box) {
      const x = Math.min(box.x0, e.clientX), y = Math.min(box.y0, e.clientY);
      Object.assign(boxEl.style, { left: x + 'px', top: y + 'px', width: Math.abs(e.clientX - box.x0) + 'px', height: Math.abs(e.clientY - box.y0) + 'px' });
      box.x1 = e.clientX; box.y1 = e.clientY;
      boxEl.hidden = Math.hypot(box.x1 - box.x0, box.y1 - box.y0) < 5;
    }
  });
  addEventListener('pointerup', e => {
    if (hDrag) endHandleDrag();
    if (drag) { if (drag.moved) commitStroke(); drag = null; draft.visible = false; }
    if (box && Math.hypot((box.x1 ?? box.x0) - box.x0, (box.y1 ?? box.y0) - box.y0) < 5) { box = null; boxEl.hidden = true; }
    if (box) {
      emptyDown = null;
      if (!box.add) { sel = new Set(); selClip = null; }
      const [x0, x1] = [box.x0, box.x1 ?? box.x0].sort((a, b) => a - b), [y0, y1] = [box.y0, box.y1 ?? box.y0].sort((a, b) => a - b);
      for (const [id, d] of dots) {
        if (!d.visible) continue;
        const [sx, sy] = toScreen([d.position.x, d.position.z]);
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) expand(id).forEach(i => sel.add(i));
      }
      box = null; boxEl.hidden = true;
      sync(); renderTracks();
    }
    // 点空白处取消选择；稍等一下，双击路线加拐点时不取消
    if (emptyDown && e.target === canvas && Math.hypot(e.clientX - emptyDown[0], e.clientY - emptyDown[1]) < 5 && (sel.size || selClip)) {
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => { sel.clear(); selClip = null; sync(); renderTracks(); }, 280);
    }
    emptyDown = null;
    ctl.enabled = true;
  });
  // 手绘路线落到数据：00:00:00 时改开场站位；其他时间给每个选中的人加一段素材，保持和被拖那个人的相对位置
  function commitStroke() {
    pushHist();
    const { anchor, cur, base } = drag;
    const interior = simplify([anchor, ...drag.pts.slice(1), cur]).slice(1, -1);
    const ids = [...sel].filter(id => base.get(id));
    const link = ids.length > 1 ? S.nextId++ : null;
    let made = null;
    for (const id of ids) {
      const b = base.get(id), off = [b[0] - anchor[0], b[1] - anchor[1]], mv = p => [r2(p[0] + off[0]), r2(p[1] + off[1])];
      if (T < FRAME) { S.start[id] = mv(cur); continue; }
      const path = interior.map(mv), to = mv(cur), t0 = freeFrom(id, T);
      const dur = Math.max(1, plen([b, ...path, to]) / WALK);
      if (addClip(id, t0, dur, path, to, link)) made = S.clips[S.clips.length - 1];
    }
    if (made) selClip = link ? { link } : { id: made.id };
    else if (T >= FRAME && ids.length) flash('后面紧接着有别的动作，放不下。先把后面的素材往后拖');
    changed();
  }
  // 以 w 为中心排一个方阵，前排朝观众
  function grid(n, w) {
    const cols = Math.ceil(Math.sqrt(n * 2)), rows = Math.ceil(n / cols), sp = 1.5;
    return Array.from({ length: n }, (_, i) => {
      const cx = (i % cols - (cols - 1) / 2) * sp, cz = (Math.floor(i / cols) - (rows - 1) / 2) * sp;
      return [r2(w[0] + rightV.x * cx - up.x * cz), r2(w[1] + rightV.z * cx - up.z * cz)];
    });
  }
  const letter = i => i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + i % 26);
  // 在 T 把人放到 q：开场直接是开场站位，之后是一段「上场」素材
  function appear(id, q, link) {
    if (T < FRAME) S.start[id] = q;
    else { S.start[id] ??= null; addClip(id, freeFrom(id, T), FRAME, [], q, link); }
  }
  function applyPending(w) {
    pushHist();
    if (pending.kind === 'one') {
      const no = S.people.filter(p => !p.group).length + 1, id = S.nextId++;
      S.people.push({ id, name: String(no), group: null });
      appear(id, [r2(w[0]), r2(w[1])], null);
      sel = new Set([id]);
    } else if (pending.kind === 'group') {
      const used = new Set(S.groups.map(g => g.letter));
      let li = 0; while (used.has(letter(li))) li++;
      const g = { id: S.nextId++, letter: letter(li), name: pending.name || `舞团 ${letter(li)}`, color: PALETTE[S.groups.length % PALETTE.length] };
      S.groups.push(g);
      const link = T < FRAME ? null : S.nextId++;
      sel = new Set();
      grid(pending.n, w).forEach((q, i) => {
        const id = S.nextId++;
        S.people.push({ id, name: g.letter + (i + 1), group: g.id });
        appear(id, q, link);
        sel.add(id);
      });
    } else if (pending.kind === 'enter') {
      const ids = [...sel].filter(id => !where(id, T)), last = ids.map(lastKnown);
      const known = last.filter(Boolean), fallback = grid(ids.length, w);
      const cx = known.reduce((s, p) => s + p[0], 0) / (known.length || 1), cz = known.reduce((s, p) => s + p[1], 0) / (known.length || 1);
      const link = ids.length > 1 ? S.nextId++ : null;
      ids.forEach((id, i) => appear(id, last[i] ? [r2(w[0] + last[i][0] - cx), r2(w[1] + last[i][1] - cz)] : fallback[i], link));
    }
    selClip = null;
    setPending(null);
    changed();
  }
  function lastKnown(id) {
    const l = clipsOf(id);
    for (let i = l.length - 1; i >= 0; i--) if (l[i].to) return l[i].to;
    return S.start[id] || null;
  }

  // ---------- 右侧面板：放人、选中的人、选中的素材、标记 ----------
  function renderPanel() {
    const n = +($('shN')?.value || 12), gname = $('shGName')?.value || '';
    const sp = [...sel], selGroup = sp.length && wholeGroup(sp);
    const anyOff = sp.some(id => !where(id, T)), anyOn = sp.some(id => where(id, T));
    const cols = new Set(sp.map(id => colorOf(person(id)))), selColor = cols.size === 1 ? [...cols][0] : '';
    const sc = selClip && S.clips.filter(isSelClip);
    let clipBox = '';
    if (sc?.length) {
      const t0 = Math.min(...sc.map(c => c.t0)), t1 = Math.max(...sc.map(c => c.t1)), fast = sc.filter(c => speed(c) > WARN);
      clipBox = `<div class="sh-sel sh-clipbox"><div class="sh-sel-head">选中的移动 · ${sc.length} 人</div>
        <div class="k">${tc(t0)} → ${tc(t1)} · ${(t1 - t0).toFixed(1)} 秒</div>
        ${fast.length ? `<div class="sh-warn">太快（超过 ${WARN} m/s）：${fast.slice(0, 6).map(c => `${esc(person(c.who).name)} ${speed(c).toFixed(1)}`).join('、')}${fast.length > 6 ? ` 等 ${fast.length} 人` : ''}</div>` : ''}
        <div class="sh-acts"><button data-sh="clipDel" class="danger">删除这段移动</button></div></div>`;
    }
    peopleBody.innerHTML = `
      <div class="cam-row"><button data-sh="one">＋ 单人</button><button data-sh="group">＋ 一组</button>
        <input id="shN" type="number" min="2" max="300" value="${n}" aria-label="人数"><span class="k">人</span>
        <input id="shGName" placeholder="组名（可不填）" value="${esc(gname)}"></div>
      <div class="cam-row sh-seg"><span class="k">点人时</span><button data-sh="mGroup" class="${selMode === 'group' ? 'on' : ''}">选整组</button><button data-sh="mSingle" class="${selMode === 'single' ? 'on' : ''}">只选这个人</button></div>
      ${clipBox}
      ${sp.length ? `<div class="sh-sel">
        <div class="sh-sel-head">已选 ${sp.length} 人${selGroup ? ` · ${esc(selGroup.letter)} 组` : ''}</div>
        <label class="sh-field"><span>${selGroup ? '组名' : sp.length === 1 ? '名字' : '前缀'}</span>
          <input id="shPName" value="${esc(selGroup ? selGroup.name : sp.length === 1 ? person(sp[0]).name : '')}" placeholder="${sp.length > 1 && !selGroup ? '如「伴舞」→ 伴舞1、伴舞2…' : ''}" maxlength="12"></label>
        <div class="sh-field"><span>颜色</span><div class="sh-colors">
          ${PALETTE.map(col => `<button data-col="${col}" style="background:${col}" class="${selColor === col ? 'on' : ''}" aria-label="${col}"></button>`).join('')}
          <label class="sh-custom" title="自定义颜色"><input type="color" id="shPColor" value="${selColor || '#ffffff'}">＋</label></div></div>
        <div class="sh-acts">
          ${selGroup ? '<button data-sh="ungroup">解组</button>' : sp.length > 1 ? '<button data-sh="mkgroup">编成一组</button>' : ''}
          ${anyOn ? '<button data-sh="off">从这里下场</button>' : ''}${anyOff ? '<button data-sh="on">上场…</button>' : ''}
          <button data-sh="del" class="danger">删除人</button></div>
        <div class="k sh-tip">名字在圆点上显示前 3 个字</div></div>`
      : `<div class="k sh-tip">时间在 00:00:00 时拖人 = 调开场站位；其他时间拖人 = 从这个时间出发画一段移动，拖过的线就是路线</div>`}`;
    const pn = $('shPName');
    if (pn) pn.onchange = () => setName(pn.value.trim(), selGroup);
    const pc = $('shPColor');
    if (pc) pc.onchange = () => setColor(pc.value, selGroup);

    markBody.innerHTML = `<div class="sh-marks">${S.marks.map(m => `<div class="sh-mark"><button data-mk="${m.id}">${tc(m.t)}</button><input data-mkname="${m.id}" value="${esc(m.name)}" placeholder="名称"><button data-mkdel="${m.id}" aria-label="删除标记">×</button></div>`).join('')}</div>
      <div class="k sh-tip">${S.marks.length ? '点时间跳过去；时间轴上可拖动标记。导出截图时开场和每个标记各一张' : '时间轴走到要标记的位置，点底部「＋ 标记」（如 前奏、副歌、定点）'}</div>`;
    markBody.querySelectorAll('[data-mkname]').forEach(i => i.onchange = () => { pushHist(); S.marks.find(m => m.id === +i.dataset.mkname).name = i.value.trim(); changed(); });
  }
  function setName(v, g) {
    if (!v) return renderPanel();
    pushHist();
    const sp = [...sel];
    if (g) g.name = v;
    else if (sp.length === 1) person(sp[0]).name = v;
    else sp.forEach((id, i) => person(id).name = v + (i + 1));
    changed();
  }
  // 整组选中时改组颜色（组员个人颜色清掉），否则改选中的每个人
  function setColor(col, g) {
    pushHist();
    if (g) { g.color = col; members(g.id).forEach(id => delete person(id).color); }
    else sel.forEach(id => person(id).color = col);
    changed();
  }
  function addMark() {
    const t = snap(T);
    if (S.marks.some(m => Math.abs(m.t - t) < FRAME)) return;
    pushHist();
    S.marks.push({ id: S.nextId++, t, name: `标记 ${S.marks.length + 1}` });
    S.marks.sort((a, b) => a.t - b.t);
    changed();
  }
  function act(a) {
    const sp = [...sel];
    const n = Math.max(2, Math.min(300, +$('shN').value || 12));
    if (a === 'one') return setPending({ kind: 'one' }, '点击平面图放一个人 · Esc 取消');
    if (a === 'group') return setPending({ kind: 'group', n, name: $('shGName').value.trim() }, `点击平面图放 ${n} 人一组（方阵，之后可拖动调整） · Esc 取消`);
    if (a === 'mGroup' || a === 'mSingle') { selMode = a === 'mGroup' ? 'group' : 'single'; return renderPanel(); }
    if (a === 'on') return setPending({ kind: 'enter' }, `点击平面图，选中的人在 ${tc(T)} 上场到那里 · Esc 取消`);
    pushHist();
    if (a === 'mkgroup') {
      const used = new Set(S.groups.map(g => g.letter));
      let li = 0; while (used.has(letter(li))) li++;
      const g = { id: S.nextId++, letter: letter(li), name: `组 ${letter(li)}`, color: PALETTE[S.groups.length % PALETTE.length] };
      S.groups.push(g);
      sp.forEach(id => { person(id).group = g.id; delete person(id).color; });
    }
    if (a === 'ungroup') { const gid = person(sp[0]).group; sp.forEach(id => person(id).group = null); S.groups = S.groups.filter(g => g.id !== gid); }
    if (a === 'off') {
      const ids = sp.filter(id => where(id, T)), link = ids.length > 1 ? S.nextId++ : null;
      ids.forEach(id => { if (T < FRAME) S.start[id] = null; else addClip(id, freeFrom(id, T), FRAME, [], null, link); });
    }
    if (a === 'del') {
      S.people = S.people.filter(p => !sel.has(p.id));
      sp.forEach(id => delete S.start[id]);
      S.groups = S.groups.filter(g => members(g.id).length);
      sel.clear();
    }
    if (a === 'clipDel') { S.clips = S.clips.filter(c => !isSelClip(c)); selClip = null; }
    changed();
  }
  for (const body of [peopleBody, markBody]) body.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sh) return act(b.dataset.sh);
    if (b.dataset.col) return setColor(b.dataset.col, wholeGroup([...sel]));
    if (b.dataset.mk) return seek(S.marks.find(m => m.id === +b.dataset.mk).t);
    if (b.dataset.mkdel) { pushHist(); S.marks = S.marks.filter(m => m.id !== +b.dataset.mkdel); changed(); }
  });
  addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'Escape') { if (pending) setPending(null); else { sel.clear(); selClip = null; sync(); renderTracks(); } }
    if (e.code === 'Space') { e.preventDefault(); play(!playing); }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && hist.length) { e.preventDefault(); S = JSON.parse(hist.pop()); selClip = null; changed(); }
    if (e.code === 'Delete' || e.code === 'Backspace') { if (selClip) act('clipDel'); else if (sel.size) act('del'); }
  });

  // ---------- 音乐 ----------
  const audio = new Audio();
  let hasAudio = false, musicData = null, peaks = null;
  audio.addEventListener('loadedmetadata', () => { hasAudio = true; view = [0, duration()]; layoutClips(); });
  audio.addEventListener('ended', () => play(false));
  const lastEnd = () => Math.max(0, ...S.clips.map(c => c.t1), ...S.marks.map(m => m.t));
  const duration = () => hasAudio && isFinite(audio.duration) ? audio.duration : Math.max(120, lastEnd() + 30);
  function seek(t) {
    T = Math.max(0, Math.min(duration(), t));
    if (hasAudio) audio.currentTime = T;
  }
  function play(on) {
    playing = on;
    if (hasAudio) on ? audio.play() : audio.pause();
    playBtn.textContent = on ? '❚❚' : '▶';
    playBtn.classList.toggle('on', on);
  }
  async function loadPeaks(buf) {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const ab = await ac.decodeAudioData(buf);
      ac.close?.();
      const ch = ab.getChannelData(0), N = 4000, step = ch.length / N;
      peaks = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        let m = 0;
        for (let j = Math.floor(i * step), e = Math.floor((i + 1) * step); j < e; j += 16) m = Math.max(m, Math.abs(ch[j]));
        peaks[i] = m;
      }
    } catch { peaks = null; }
  }
  const readURL = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
  function dataToBuf(url) {
    const bin = atob(url.slice(url.indexOf(',') + 1)), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function setMusic(name, data) {
    play(false);
    hasAudio = false;
    musicData = data;
    S.musicName = name;
    audio.src = data;
    $('shMusicName').textContent = name;
    loadPeaks(dataToBuf(data));
    changed();
  }
  $('shMusic').onclick = () => $('shMusicFile').click();
  $('shMusicFile').onchange = async e => { const f = e.target.files[0]; if (f) setMusic(f.name, await readURL(f)); e.target.value = ''; };
  playBtn.onclick = () => play(!playing);
  $('shMark').onclick = addMark;
  $('shFit').onclick = () => fit();

  // ---------- 分轨时间轴 ----------
  // 顶部标尺（波形、刻度、标记）是一个 canvas；下面每条轨道左边是名字，右边是素材条，横向和标尺共用 view 时间范围
  let view = [0, duration()];
  const laneW = () => ruler.clientWidth;
  const X = t => (t - view[0]) / (view[1] - view[0]) * laneW();
  const Tx = x => view[0] + x / laneW() * (view[1] - view[0]);
  function drawRuler() {
    const dpr = devicePixelRatio || 1, w = ruler.clientWidth, h = ruler.clientHeight;
    if (ruler.width !== Math.round(w * dpr) || ruler.height !== Math.round(h * dpr)) { ruler.width = Math.round(w * dpr); ruler.height = Math.round(h * dpr); }
    const g = ruler.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#101216'; g.fillRect(0, 0, w, h);
    const D = duration();
    if (peaks) {
      g.fillStyle = '#34425c';
      for (let x = 0; x < w; x++) {
        const a = Math.floor(Tx(x) / D * peaks.length), b = Math.max(a + 1, Math.floor(Tx(x + 1) / D * peaks.length));
        let m = 0; for (let i = Math.max(0, a); i < Math.min(peaks.length, b); i++) m = Math.max(m, peaks[i]);
        const ph = m * (h - 16);
        g.fillRect(x, 14 + (h - 16 - ph) / 2, 1, Math.max(1, ph));
      }
    }
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300], step = steps.find(s => X(s) - X(0) > 70) || 600;
    g.fillStyle = '#8b91a0'; g.font = '10px sans-serif'; g.textBaseline = 'top';
    for (let t = Math.ceil(view[0] / step) * step; t < view[1]; t += step) { const x = X(t); g.fillRect(x, 0, 1, 5); g.fillText(`${Math.floor(t / 60)}:${pad(Math.floor(t % 60))}`, x + 3, 1); }
    g.font = 'bold 11px sans-serif';
    for (const m of S.marks) {
      const x = X(m.t);
      g.fillStyle = '#ffd23f'; g.fillRect(x - 1, 12, 2, h - 12);
      g.beginPath(); g.moveTo(x, 12); g.lineTo(x + 8, 16); g.lineTo(x, 20); g.fill();
      g.fillText(m.name, x + 10, 14);
    }
    g.fillStyle = '#ff3b30'; g.fillRect(X(T) - 1, 0, 2, h);
  }
  // 组轨道上的条 = 全部属于这个组的联动素材
  function groupBars(gid) {
    const m = new Set(members(gid)), bars = new Map();
    for (const c of S.clips) if (c.link) { if (!bars.has(c.link)) bars.set(c.link, []); bars.get(c.link).push(c); }
    return [...bars].filter(([, l]) => l.every(c => m.has(c.who)))
      .map(([link, l]) => ({ link, t0: Math.min(...l.map(c => c.t0)), t1: Math.max(...l.map(c => c.t1)), n: l.length, fast: l.some(c => speed(c) > WARN), kind: l.every(c => !routeOf(c)) ? (l[0].to ? '上场' : '下场') : '' }));
  }
  const clipLabel = c => !routeOf(c) ? (c.to ? '上场' : '下场') : `${(c.t1 - c.t0).toFixed(1)}s`;
  function renderTracks() {
    const row = (head, lane, cls = '') => `<div class="tk-row ${cls}"><div class="tk-head">${head}</div><div class="tk-lane">${lane}</div></div>`;
    const pHead = (p, indent) => `<button class="tk-name${sel.has(p.id) ? ' on' : ''}${where(p.id, T) ? '' : ' off'}${indent ? ' tk-indent' : ''}" data-p="${p.id}"><i style="background:${colorOf(p)}"></i>${esc(p.name)}</button>`;
    const pLane = p => clipsOf(p.id).map(c => `<div class="tk-clip${isSelClip(c) ? ' on' : ''}${speed(c) > WARN ? ' fast' : ''}${routeOf(c) ? '' : ' tk-tick'}${isLight(colorOf(p)) ? ' lt' : ''}" data-clip="${c.id}" data-t0="${c.t0}" data-t1="${c.t1}" style="--c:${colorOf(p)}"><span>${clipLabel(c)}</span></div>`).join('');
    let html = '';
    for (const g of S.groups) {
      const m = members(g.id), open = openG.has(g.id), allSel = m.length && m.every(i => sel.has(i));
      html += row(`<button class="tk-open" data-open="${g.id}" aria-label="展开组员">${open ? '▾' : '▸'}</button><button class="tk-name tk-gname${allSel ? ' on' : ''}" data-g="${g.id}"><i style="background:${g.color}"></i>${esc(g.letter)} · ${esc(g.name)}<span class="k">${m.length} 人</span></button>`,
        groupBars(g.id).map(b => `<div class="tk-clip tk-gclip${selClip?.link === b.link ? ' on' : ''}${b.fast ? ' fast' : ''}${b.kind ? ' tk-tick' : ''}${isLight(g.color) ? ' lt' : ''}" data-link="${b.link}" data-t0="${b.t0}" data-t1="${b.t1}" style="--c:${g.color}"><span>${b.kind || `${(b.t1 - b.t0).toFixed(1)}s`}</span></div>`).join(''), 'tk-group');
      if (open) for (const id of m) html += row(pHead(person(id), true), pLane(person(id)), 'tk-member');
    }
    const solos = S.people.filter(p => !p.group);
    if (solos.length) html += `<div class="tk-sep">演员</div>` + solos.map(p => row(pHead(p), pLane(p))).join('');
    if (!S.people.length) html = `<div class="tk-empty">右侧点「＋ 单人」或「＋ 一组」，再点平面图放人。每个人、每个组在这里有一条轨道，每段移动是轨道上的一段素材</div>`;
    tracks.querySelector('.tk-body').innerHTML = html;
    lastOff = '';
    layoutClips();
  }
  function layoutClips() {
    tracks.querySelectorAll('.tk-clip').forEach(el => {
      const x0 = X(+el.dataset.t0), x1 = X(+el.dataset.t1);
      el.style.left = x0 + 'px';
      el.style.width = Math.max(6, x1 - x0) + 'px';
    });
  }
  function placeHead() {
    const lane = tracks.querySelector('.tk-lane');
    const off = lane ? lane.offsetLeft : 0;
    playhead.style.left = off + X(T) + 'px';
    playhead.style.height = tracks.scrollHeight + 'px';
  }

  // 拖素材：中间 = 平移，两头 = 改出发 / 到位时间；组条带着所有联动素材一起改（各人之间的错开保持不变）
  let tkDrag = null;
  tracks.addEventListener('pointerdown', e => {
    const el = e.target.closest('.tk-clip');
    const lane = e.target.closest('.tk-lane');
    if (!el) {
      if (lane) { tkDrag = { seek: true, lane }; seek(Tx(e.clientX - lane.getBoundingClientRect().left)); tracks.setPointerCapture(e.pointerId); }
      return;
    }
    play(false);
    const r = el.getBoundingClientRect(), x = e.clientX - r.left;
    const mode = r.width > 18 && x < 7 ? 'l' : r.width > 18 && x > r.width - 7 ? 'r' : 'm';
    const list = el.dataset.link ? S.clips.filter(c => c.link === +el.dataset.link) : S.clips.filter(c => c.id === +el.dataset.clip);
    if (!list.length) return;
    selClip = el.dataset.link ? { link: +el.dataset.link } : { id: list[0].id };
    sel = new Set(list.map(c => c.who));
    tkDrag = { mode, list, orig: list.map(c => [c.t0, c.t1]), x0: e.clientX, moved: false };
    tracks.setPointerCapture(e.pointerId);
    sync();
    tracks.querySelectorAll('.tk-clip.on').forEach(x => x.classList.remove('on'));
    el.classList.add('on');
  });
  tracks.addEventListener('pointermove', e => {
    if (!tkDrag) return;
    if (tkDrag.seek) { seek(Tx(e.clientX - tkDrag.lane.getBoundingClientRect().left)); return; }
    if (!tkDrag.moved && Math.abs(e.clientX - tkDrag.x0) < 3) return;
    if (!tkDrag.moved) { tkDrag.moved = true; pushHist(); }
    const raw = (e.clientX - tkDrag.x0) / laneW() * (view[1] - view[0]);
    let lo = -Infinity, hi = Infinity;
    const D = duration();
    tkDrag.list.forEach((c, i) => {
      const [t0, t1] = tkDrag.orig[i], others = clipsOf(c.who).filter(x => x !== c);
      const prevEnd = Math.max(0, ...others.filter(x => x.t0 < t0).map(x => x.t1)), nextBeg = Math.min(D, ...others.filter(x => x.t0 >= t0).map(x => x.t0));
      const minLen = routeOf(c) ? 0.2 : FRAME;
      if (tkDrag.mode !== 'r') lo = Math.max(lo, prevEnd - t0);
      if (tkDrag.mode === 'l') hi = Math.min(hi, t1 - minLen - t0);
      if (tkDrag.mode === 'r') lo = Math.max(lo, t0 + minLen - t1);
      if (tkDrag.mode !== 'l') hi = Math.min(hi, nextBeg - t1);
    });
    const d = snap(Math.max(lo, Math.min(hi, raw)));
    tkDrag.list.forEach((c, i) => {
      const [t0, t1] = tkDrag.orig[i];
      if (tkDrag.mode !== 'r') c.t0 = snap(t0 + d);
      if (tkDrag.mode !== 'l') c.t1 = snap(t1 + d);
    });
    reindex();
    pathsDirty = true;
    const lead = tkDrag.list[0];
    seek(tkDrag.mode === 'l' ? lead.t0 : lead.t1);
    // 只更新位置，不重建 DOM，拖动不断
    tracks.querySelectorAll('.tk-clip').forEach(el => {
      const c = el.dataset.clip && S.clips.find(x => x.id === +el.dataset.clip);
      if (c) { el.dataset.t0 = c.t0; el.dataset.t1 = c.t1; el.querySelector('span').textContent = clipLabel(c); }
      if (el.dataset.link) {
        const l = S.clips.filter(x => x.link === +el.dataset.link);
        el.dataset.t0 = Math.min(...l.map(x => x.t0)); el.dataset.t1 = Math.max(...l.map(x => x.t1));
        if (!el.classList.contains('tk-tick')) el.querySelector('span').textContent = `${(el.dataset.t1 - el.dataset.t0).toFixed(1)}s`;
      }
    });
    layoutClips();
  });
  tracks.addEventListener('pointerup', () => {
    if (tkDrag?.list) { if (tkDrag.moved) changed(); else { renderPanel(); renderTracks(); } }
    tkDrag = null;
  });
  tracks.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.open) { const g = +b.dataset.open; openG.has(g) ? openG.delete(g) : openG.add(g); return renderTracks(); }
    selClip = null;
    if (b.dataset.g) sel = new Set(members(+b.dataset.g));
    if (b.dataset.p) { const id = +b.dataset.p; sel = e.shiftKey ? (sel.has(id) ? (sel.delete(id), sel) : sel.add(id)) : new Set([id]); }
    sync(); renderTracks();
  });

  // 标尺：点/拖 = 跳转，拖标记 = 改标记时间，滚轮 = 缩放，Shift+滚轮 = 平移；轨道上 Ctrl/⌘+滚轮 缩放、Shift+滚轮 平移
  let rDrag = null;
  ruler.addEventListener('pointerdown', e => {
    const m = S.marks.find(m => Math.abs(X(m.t) - e.offsetX) < 6);
    ruler.setPointerCapture(e.pointerId);
    if (m) { pushHist(); rDrag = { mark: m }; return; }
    rDrag = { seek: true };
    seek(Tx(e.offsetX));
  });
  ruler.addEventListener('pointermove', e => {
    if (!rDrag) return;
    const t = Math.max(0, Math.min(duration(), Tx(e.offsetX)));
    if (rDrag.mark) { rDrag.mark.t = snap(t); seek(rDrag.mark.t); } else seek(t);
  });
  ruler.addEventListener('pointerup', () => { if (rDrag?.mark) { S.marks.sort((a, b) => a.t - b.t); changed(); } rDrag = null; });
  function zoomTime(e, x) {
    const D = duration(), span = view[1] - view[0];
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = (e.deltaX || e.deltaY) / laneW() * span;
      view = [Math.max(0, Math.min(D - span, view[0] + d)), 0]; view[1] = view[0] + span;
    } else {
      const t = Tx(x), ns = Math.max(5, Math.min(D, span * Math.exp(e.deltaY * 0.002)));
      const a = Math.max(0, Math.min(D - ns, t - (t - view[0]) / span * ns));
      view = [a, a + ns];
    }
    layoutClips();
  }
  ruler.addEventListener('wheel', e => { e.preventDefault(); zoomTime(e, e.offsetX); }, { passive: false });
  tracks.addEventListener('wheel', e => {
    const lane = e.target.closest('.tk-lane');
    if (!lane || !(e.shiftKey || e.ctrlKey || e.metaKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) return;  // 普通滚轮上下翻轨道
    e.preventDefault();
    zoomTime(e.ctrlKey || e.metaKey ? { deltaY: e.deltaY, deltaX: 0, shiftKey: false } : e, e.clientX - lane.getBoundingClientRect().left);
  }, { passive: false });

  // ---------- 保存 / 打开 ----------
  const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const fname = s => s.replace(/[\\/:*?"<>|]/g, '_');
  $('shSave').onclick = () => {
    const file = { app: 'stage-show', v: 2, title: title(), show: S, music: musicData ? { name: S.musicName, data: musicData } : null, bg };
    download(new Blob([JSON.stringify(file)], { type: 'application/json' }), `${fname(title())}-走位.json`);
  };
  $('shOpen').onclick = () => $('shOpenFile').click();
  $('shOpenFile').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== 'stage-show' || j.v !== 2) throw 0;
      pushHist();
      S = j.show;
      if (j.title) setTitle(j.title);
      sel.clear(); selClip = null;
      if (j.music) setMusic(j.music.name, j.music.data);
      if (j.bg) { setBg(j.bg); fit(); }
      changed();
      seek(0);
    } catch { alert('不是这个版本的走位文件'); }
  };

  // ---------- 导出截图：开场 + 每个标记 ----------
  async function exportShots() {
    play(false);
    const keep = { T, pos: cam.position.clone(), target: ctl.target.clone(), zoom: cam.zoom, f: [cam.left, cam.right, cam.top, cam.bottom] };
    const keepSel = sel, keepClip = selClip;
    sel = new Set(); selClip = null; sync();
    fit(true);
    const shots = [{ t: 0, name: '开场' }, ...S.marks.filter(m => m.t > 0)], files = [];
    for (let i = 0; i < shots.length; i++) {
      const m = shots[i];
      T = m.t;
      pathsDirty = true;
      render();
      const W = canvas.width, head = Math.round(56 * W / innerWidth);
      const out = document.createElement('canvas');
      out.width = W; out.height = canvas.height + head;
      const g = out.getContext('2d');
      g.fillStyle = '#16181d'; g.fillRect(0, 0, W, head);
      g.drawImage(canvas, 0, head);
      const s = W / innerWidth, on = S.people.filter(p => where(p.id, T)).length, moving = S.clips.filter(c => c.t0 <= T && T < c.t1 && routeOf(c)).length;
      g.fillStyle = '#ffd23f'; g.font = `bold ${20 * s}px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif`; g.textBaseline = 'middle';
      const label = `${m.name}  ${tc(m.t)}`;
      g.fillText(label, 16 * s, head / 2);
      g.fillStyle = '#e6e8ee'; g.font = `${16 * s}px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif`;
      g.fillText(`在场 ${on} 人${moving ? ` · ${moving} 人正在走` : ''}  ·  ${title()}`, 16 * s + g.measureText(label).width * 1.25 + 24 * s, head / 2);
      const blob = await new Promise(ok => out.toBlob(ok, 'image/png'));
      files.push({ name: `${pad(i)}_${fname(m.name)}_${tc(m.t).replaceAll(':', '-')}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    download(zip(files), `${fname(title())}-站位截图.zip`);
    T = keep.T; sel = keepSel; selClip = keepClip;
    [cam.left, cam.right, cam.top, cam.bottom] = keep.f;
    cam.zoom = keep.zoom; cam.position.copy(keep.pos); ctl.target.copy(keep.target); cam.updateProjectionMatrix();
    sync();
    if (!S.marks.length) flash('只导出了开场。加「标记」后每个标记各导出一张');
  }
  $('shShots').onclick = exportShots;

  // ---------- 每帧 ----------
  let lastOff = '';
  function tick(dt) {
    if (playing) {
      if (hasAudio) T = audio.currentTime;
      else { T += dt; if (T >= duration()) { T = duration(); play(false); } }
      const span = view[1] - view[0];
      if (T > view[1] || T < view[0]) { view[0] = Math.max(0, Math.min(duration() - span, T - span * 0.1)); view[1] = view[0] + span; layoutClips(); }
    }
    tcEl.textContent = tc(T);
    drawRuler();
    placeHead();
    // 上下场状态变了才刷新名字的明暗
    const off = S.people.map(p => where(p.id, T) ? 1 : 0).join('');
    if (off !== lastOff) { lastOff = off; tracks.querySelectorAll('.tk-name[data-p]').forEach(b => b.classList.toggle('off', !where(+b.dataset.p, T))); }
  }
  function render() {
    ctl.update();
    updateDots();
    const hidden = [];
    // 有平面图时三维模型整个不画；否则剖掉 CUT 以上（灯架、天幕顶）
    for (const o of meshes) if (o.visible && (bg || o.userData.box && o.userData.box.min.y > CUT)) { o.visible = false; hidden.push(o); }
    renderer.render(scene, cam);
    hidden.forEach(o => o.visible = true);
  }

  document.body.classList.add('show');
  reindex();
  try { const b = JSON.parse(localStorage.getItem(bgKey)); setBg(b?.data ? b : null, false); } catch { setBg(null, false); }
  fit();
  if (S.musicName) $('shMusicName').textContent = `请重新导入「${S.musicName}」`;
  sync();
  renderTracks();
  if (!bg && !meshes.length) flash('先在右边「舞美图」导入舞台平面图');
  if (location.hash === '#debug') window.__show = { handles: () => handleList.map(h => ({ kind: h.kind, i: h.i, s: toScreen(h.pos) })), dot: id => toScreen(where(id, T)), get S() { return S; } };  // 自动化测试用
  return { tick, render, camera: cam };
}

// 只存储（不压缩）的 zip，PNG 本身已压缩
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u) { let c = ~0; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return ~c >>> 0; }
function zip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, name.length, true);
    parts.push(h, name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(c, name);
    off += 30 + name.length + n;
  }
  const size = central.reduce((s, p) => s + p.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e], { type: 'application/zip' });
}
