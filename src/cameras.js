import * as THREE from 'three';
import { tr } from './i18n.js';

// 转播机位：在场景里放机位，画出拍摄范围（视锥），角落窗口显示该机位的 16:9 画面。
// 按综艺转播设定：2/3 英寸传感器、变焦镜头，景别按画面里 1.75m 的人占多高来判断。
// 机位存在浏览器本地；「复制机位」得到的 JSON 放进配置 cameras，重新生成 html 后人人可见。
// 普通浏览和导摄模式（director.js 的顶视图）共用这里的机位数据和面板。

const SENSOR_H = 5.39;  // 2/3 英寸 16:9 传感器高度（mm）
const TYPES = {
  long:     { label: '长焦座机', h: 2.5 },  // 观众席后方机位台
  studio:   { label: '座机',     h: 1.6 },
  jib:      { label: '摇臂',     h: 4 },
  track:    { label: '轨道',     h: 1.3 },
  handheld: { label: '游机',     h: 1.5 },
};
// 常用 2/3 英寸转播镜头（厂商标称焦段，不含 2× 增倍镜）
const LENSES = {
  'UJ90x9B':   { label: 'Canon UJ90x9B',    min: 9,   max: 810, kind: '箱式长焦' },
  'UJ86x9.3B': { label: 'Canon UJ86x9.3B',  min: 9.3, max: 800, kind: '箱式长焦' },
  'UA107x8.4': { label: 'Fujinon UA107x8.4', min: 8.4, max: 900, kind: '箱式长焦' },
  'UA80x9':    { label: 'Fujinon UA80x9',   min: 9,   max: 720, kind: '箱式长焦' },
  'UJ27x6.5B': { label: 'Canon UJ27x6.5B',  min: 6.5, max: 175, kind: '演播室' },
  'UA27x6.5':  { label: 'Fujinon UA27x6.5', min: 6.5, max: 175, kind: '演播室' },
  'CJ24ex7.5B':{ label: 'Canon CJ24ex7.5B', min: 7.5, max: 180, kind: '便携' },
  'UA22x8':    { label: 'Fujinon UA22x8',   min: 8,   max: 176, kind: '便携' },
  'CJ15ex4.3B':{ label: 'Canon CJ15ex4.3B', min: 4.3, max: 64.5, kind: '便携广角' },
  'UA14x4.5':  { label: 'Fujinon UA14x4.5', min: 4.5, max: 63, kind: '便携广角' },
  'CJ12ex4.3B':{ label: 'Canon CJ12ex4.3B', min: 4.3, max: 51.6, kind: '便携广角' },
};
const DEFAULT_LENS = { long: 'UJ90x9B', studio: 'UJ27x6.5B', jib: 'CJ15ex4.3B', track: 'CJ15ex4.3B', handheld: 'CJ15ex4.3B' };
// 常用机位高度（镜头离脚下地面）
const HEIGHTS = [['三脚架', 1.5], ['机位台', 2.5], ['高机位台', 4], ['摇臂', 6], ['大摇臂', 9]];
const lensOf = c => LENSES[c.lens] || LENSES[DEFAULT_LENS[c.type]] || LENSES['UJ27x6.5B'];

const COLORS = ['#ffcf3f', '#4fd1ff', '#ff6b9a', '#8dff6b', '#c38bff', '#ff9f43', '#5fffd7', '#ff5b5b'];
const PERSON = 1.75, AIM_H = 1.5;  // 对准点：台面以上 1.5m（人胸口）
const deg = THREE.MathUtils.radToDeg, rad = THREE.MathUtils.degToRad;

const vfov = f => deg(2 * Math.atan(SENSOR_H / (2 * f)));

// 景别：人在画面里的高度 / 画面高度
function shotSize(c) {
  const d = c.pos.distanceTo(c.target);
  const frameH = 2 * d * Math.tan(rad(vfov(c.f) / 2));
  const r = PERSON / frameH;
  return r < 0.35 ? '大全景' : r < 1 ? '全景' : r < 2 ? '中景' : r < 4 ? '近景' : '特写';
}

// 圆形标签贴图（机位编号）
function tagTexture(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const x = cv.getContext('2d');
  x.font = 'bold 64px "PingFang SC","Microsoft YaHei",sans-serif';
  const w = Math.max(112, x.measureText(text).width + 48);
  x.fillStyle = color;
  x.beginPath(); x.roundRect(128 - w / 2, 8, w, 112, 56); x.fill();
  x.lineWidth = 6; x.strokeStyle = '#111'; x.stroke();
  x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 128, 68);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function setupCameras({ scene, renderer, mainCamera, meshes, floorAt, stageCenter, stageDir, storageKey, initial = [] }) {
  const body = document.querySelector('#cams .sec-body');
  const pip = document.getElementById('pip'), pipLabel = pip.querySelector('.pip-label');
  const hint = document.getElementById('camHint');
  const pipCam = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 2000);  // 机位模型、视锥在 1 层，窗口里不出现
  pipCam.layers.enable(2);  // 灯光在 2 层
  mainCamera.layers.enable(1);
  const pan0 = Math.atan2(stageDir.x, stageDir.z);  // 摇 0° = 正对舞台

  let cams = [], sel = null, pending = null;  // pending: { kind: 'pick' | 'place' | 'move' | 'aim' }
  let planMode = false;

  // 主持人参照：1.75m 人形站在选中机位的对准点下方，窗口里直接看出景别
  const standIn = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.08, 4, 12), skin);
  torso.position.y = 0.74;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), skin);
  head.position.y = 1.62;
  standIn.add(torso, head);
  scene.add(standIn);
  function placeStandIn() {
    standIn.visible = !!sel;
    if (!sel) return;
    const t = sel.target;
    standIn.position.set(t.x, floorAt(t.x, t.z, t.y), t.z);
    standIn.lookAt(sel.pos.x, standIn.position.y, sel.pos.z);
  }

  // ---------- 存取 ----------
  const r2 = v => +v.toFixed(2);
  const toJSON = c => ({
    type: c.type, label: c.label, lens: c.lens, f: +c.f.toFixed(1), h: r2(c.h), pos: c.pos.toArray().map(r2), target: c.target.toArray().map(r2),
    ...(c.track && { track: { a: c.track.a.toArray().map(r2), b: c.track.b.toArray().map(r2), t: r2(c.track.t), speed: c.track.speed, lock: c.track.lock, loop: c.track.loop } }),
  });
  const save = () => { try { localStorage.setItem(storageKey, JSON.stringify(cams.map(toJSON))); } catch {} };
  function load() {
    let list = initial;
    try { const s = localStorage.getItem(storageKey); if (s) list = JSON.parse(s); } catch {}
    list.forEach(j => add(j.type, new THREE.Vector3(...j.pos), new THREE.Vector3(...j.target), j));
  }

  // ---------- 场景里的机位 ----------
  function build(c) {
    const color = new THREE.Color(c.color);
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color });
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.6), mat);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.35, 16).rotateX(Math.PI / 2).translate(0, 0, -0.45), mat);
    cam.add(lens);
    cam.userData.cam = c;
    lens.userData.cam = c;
    // 立杆：显示机位高度
    const pole = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color }));
    // 视锥：机位到对准点距离处的取景框
    const frus = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    const fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTexture(c.label, c.color), depthTest: false }));
    tag.renderOrder = 10;
    tag.scale.set(1.4, 0.7, 1);
    tag.userData.cam = c;
    // 对准点手柄（顶视图里拖它就是「摇」）
    const aim = new THREE.Sprite(new THREE.SpriteMaterial({ color, depthTest: false }));
    aim.renderOrder = 10;
    aim.userData.aimOf = c;
    aim.visible = planMode;
    g.add(cam, pole, frus, fill, tag, aim);
    g.traverse(o => o.layers.set(1));
    scene.add(g);
    Object.assign(c, { g, cam, pole, frus, fill, tag, aim });
  }

  function update(c) {
    if (c.track) drawRail(c);
    if (focus) c.target.copy(focus.p);  // 定了焦点：怎么移都对准焦点
    c.cam.position.copy(c.pos);
    c.cam.lookAt(c.target);
    c.tag.position.copy(c.pos).add(new THREE.Vector3(0, 0.6, 0));
    c.aim.position.copy(c.target);
    c.pole.geometry.setFromPoints([c.pos, c.pos.clone().setY(c.pos.y - c.h)]);
    // 取景框四角
    const d = c.pos.distanceTo(c.target), t = Math.tan(rad(vfov(c.f) / 2));
    const hh = d * t, hw = hh * 16 / 9;
    const fwd = c.target.clone().sub(c.pos).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const corner = (sx, sy) => c.target.clone().addScaledVector(right, sx * hw).addScaledVector(up, sy * hh);
    const k = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    c.frus.geometry.setFromPoints([c.pos, k[0], c.pos, k[1], c.pos, k[2], c.pos, k[3], k[0], k[1], k[1], k[2], k[2], k[3], k[3], k[0]]);
    c.fill.geometry.setFromPoints([k[0], k[1], k[2], k[0], k[2], k[3]]);
    c.fill.geometry.computeBoundingSphere();
    c.frus.geometry.computeBoundingSphere();
    if (c === sel) placeStandIn();
  }

  let nextNo = 1;
  function add(type, pos, target, opt = {}) {
    const T = TYPES[type] || TYPES.studio;
    const no = nextNo++;
    const c = { type, no, label: opt.label || String(no), lens: opt.lens || DEFAULT_LENS[type], pos, target, h: opt.h ?? T.h };
    const L = lensOf(c);
    c.f = opt.f ?? Math.min(L.max, Math.max(L.min, 20));
    c.color = COLORS[(no - 1) % COLORS.length];
    build(c);
    if (opt.track) {
      const t = opt.track;
      c.track = { a: new THREE.Vector3(...t.a), b: new THREE.Vector3(...t.b), t: t.t ?? 0.5, speed: t.speed ?? 0.5, lock: !!t.lock, loop: t.loop ?? true };
    }
    ensureTrack(c);
    update(c);
    cams.push(c);
    return c;
  }

  // ---------- 轨道 ----------
  // 轨道机位带一根地面轨道 a→b，摄像机在 t（0~1）处；朝向不变 = 横移，锁定对准点 = 边移边摇
  const RAIL_W = 0.6;
  function ensureTrack(c) {
    if (c.type !== 'track') { if (c.rail) c.rail.visible = c.endA.visible = c.endB.visible = false; return; }
    if (!c.track) {
      const floor = c.pos.clone().setY(c.pos.y - c.h);
      c.track = { a: floor.clone().addScaledVector(across, -3), b: floor.clone().addScaledVector(across, 3), t: 0.5, speed: 0.5, lock: false, loop: true };  // 默认平行舞台
    }
    if (!c.rail) {
      const color = new THREE.Color(c.color);
      c.rail = new THREE.Mesh(new THREE.PlaneGeometry(1, RAIL_W).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
      c.rail.renderOrder = 9;
      const end = which => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, depthTest: false }));
        s.renderOrder = 10;
        s.userData.endOf = c; s.userData.end = which;
        return s;
      };
      c.endA = end('a'); c.endB = end('b');
      [c.rail, c.endA, c.endB].forEach(o => { o.layers.set(1); c.g.add(o); });
    }
    c.rail.visible = true;
    c.endA.visible = c.endB.visible = planMode;
    placeOnTrack(c, c.track.t);
  }
  // 轨道角度：0° = 平行舞台（横移），90° = 正对舞台（纵向推轨）
  const fwd0 = stageDir.clone().setY(0).normalize(), across = new THREE.Vector3(-fwd0.z, 0, fwd0.x);
  function trackAngle(c) {
    const d = c.track.b.clone().sub(c.track.a).setY(0);
    let a = deg(Math.atan2(d.dot(fwd0), d.dot(across)));
    if (a > 90) a -= 180; if (a < -90) a += 180;  // 轨道不分头尾
    return a;
  }
  function setTrackAngle(c, angle) {
    const { a, b } = c.track, mid = a.clone().add(b).multiplyScalar(0.5), len = trackLen(c);
    const dir = across.clone().multiplyScalar(Math.cos(rad(angle))).addScaledVector(fwd0, Math.sin(rad(angle)));
    a.copy(mid).addScaledVector(dir, -len / 2); b.copy(mid).addScaledVector(dir, len / 2);
    a.y = floorAt(a.x, a.z, mid.y + 1); b.y = floorAt(b.x, b.z, mid.y + 1);
    placeOnTrack(c, c.track.t);
  }
  const trackLen = c => Math.hypot(c.track.b.x - c.track.a.x, c.track.b.z - c.track.a.z);
  // 把摄像机放到轨道 t 处
  function placeOnTrack(c, t) {
    const tr = c.track;
    tr.t = THREE.MathUtils.clamp(t, 0, 1);
    const p = tr.a.clone().lerp(tr.b, tr.t);
    const np = p.setY(p.y + c.h);
    if (!tr.lock) c.target.add(np.clone().sub(c.pos));  // 横移：朝向不变
    c.pos.copy(np);
    update(c);
  }
  function drawRail(c) {
    if (!c.rail) return;
    const { a, b } = c.track;
    const len = Math.max(0.01, trackLen(c));
    c.rail.position.copy(a).add(b).multiplyScalar(0.5).setY(Math.max(a.y, b.y) + 0.03);
    c.rail.rotation.set(0, -Math.atan2(b.z - a.z, b.x - a.x), 0);
    c.rail.scale.set(len, 1, 1);
    c.endA.position.copy(a).setY(a.y + 0.05);
    c.endB.position.copy(b).setY(b.y + 0.05);
  }
  function setTrackEnd(c, which, p) {
    c.track[which].copy(p);
    placeOnTrack(c, c.track.t);
  }
  function setTrackLength(c, len) {
    const { a, b } = c.track, mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a).setY(0).normalize();
    a.copy(mid).addScaledVector(dir, -len / 2); b.copy(mid).addScaledVector(dir, len / 2);
    a.y = floorAt(a.x, a.z, mid.y + 1); b.y = floorAt(b.x, b.z, mid.y + 1);
    placeOnTrack(c, c.track.t);
  }

  // 预演：沿轨道匀速运动
  let playing = null;  // { c, dir }
  function play(c) {
    if (playing?.c === c) { playing = null; render(); return; }
    if (c.track.t >= 1) c.track.t = 0;
    playing = { c, dir: 1 };
    render();
  }
  function tick(dt) {
    if (!playing) return;
    const c = playing.c, tr = c.track;
    if (!cams.includes(c)) { playing = null; return; }
    let t = tr.t + playing.dir * tr.speed * dt / Math.max(0.1, trackLen(c));
    if (t >= 1 || t <= 0) {
      t = THREE.MathUtils.clamp(t, 0, 1);
      if (tr.loop) playing.dir *= -1;
      else { placeOnTrack(c, t); playing = null; render(); return; }
    }
    placeOnTrack(c, t);
    if (c === sel) refreshText();
  }

  function remove(c) {
    scene.remove(c.g);
    cams = cams.filter(x => x !== c);
    if (sel === c) sel = cams[0] || null;
    save(); render();
  }

  function relabel(c, label) {
    c.label = label || String(c.no);
    c.tag.material.map.dispose();
    c.tag.material.map = tagTexture(c.label, c.color);
    c.tag.material.needsUpdate = true;
  }

  // ---------- 推拉摇移 ----------
  // 摇：水平角，0° = 正对舞台；俯仰：仰为正
  function getPT(c) {
    const d = c.target.clone().sub(c.pos);
    let pan = deg(Math.atan2(d.x, d.z) - pan0);
    pan = ((pan + 540) % 360) - 180;
    return { pan, tilt: deg(Math.atan2(d.y, Math.hypot(d.x, d.z))), dist: d.length() };
  }
  function setPT(c, pan, tilt) {
    const { dist } = getPT(c);
    const a = rad(pan) + pan0, t = rad(THREE.MathUtils.clamp(tilt, -80, 60));
    c.target.set(c.pos.x + Math.sin(a) * Math.cos(t) * dist, c.pos.y + Math.sin(t) * dist, c.pos.z + Math.cos(a) * Math.cos(t) * dist);
    update(c);
  }
  function setZoom(c, f) {
    const L = lensOf(c);
    c.f = THREE.MathUtils.clamp(f, L.min, L.max);
    update(c);
  }
  // 地面点 p：移到这里 / 对准这里
  function moveTo(c, p) {
    const dx = p.x - c.pos.x, dz = p.z - c.pos.z;
    if (c.track) {  // 轨道整根跟着移
      for (const e of [c.track.a, c.track.b]) { e.x += dx; e.z += dz; e.y = floorAt(e.x, e.z, p.y + 1); }
    }
    c.pos.set(p.x, p.y + c.h, p.z);
    c.target.x += dx; c.target.z += dz;  // 移动时朝向不变
    update(c);
  }
  function aimAt(c, p) {
    c.target.set(p.x, p.y + AIM_H, p.z);
    update(c);
  }

  // ---------- 面板 ----------
  function render() {
    body.innerHTML = '';
    const top = document.createElement('div');
    top.className = 'cam-row';
    top.innerHTML = `<button data-act="add">＋ 添加机位</button><button data-act="focus" class="${focus ? 'on' : ''}">◎ 焦点位</button><button data-act="copy" title="复制机位配置，放进配置文件 cameras">复制</button>`;
    body.append(top);
    if (focus) {
      const fb = document.createElement('div');
      fb.className = 'cam-focus';
      fb.innerHTML = `<div class="sec-sub">焦点位 · 全部跟焦 <button data-act="unfocus">清除焦点</button></div>` +
        cams.map(c => `<div class="fd" data-fd="${c.no}"><i style="background:${c.color}"></i><b>${c.label}</b><span></span></div>`).join('');
      body.append(fb);
    }
    if (pending?.kind === 'pick') {
      const pick = document.createElement('div');
      pick.className = 'cam-pick';
      pick.innerHTML = `<label for="camNewLabel">编号</label><input id="camNewLabel" value="${nextNo}" maxlength="6">
        <div class="cam-types">${Object.entries(TYPES).map(([k, t]) => `<button data-type="${k}">${t.label}<span class="k">${LENSES[DEFAULT_LENS[k]].label.split(' ')[1]}</span></button>`).join('')}</div>`;
      body.append(pick);
    }
    for (const c of cams) {
      const b = document.createElement('button');
      b.className = 'cam-item' + (c === sel ? ' on' : '');
      b.innerHTML = `<i style="background:${c.color}"></i>${c.label} ${TYPES[c.type].label}<span class="k">${c.f.toFixed(0)}mm · ${shotSize(c)}</span>`;
      b.onclick = () => select(c);
      body.append(b);
    }
    if (sel) {
      const L = lensOf(sel), z = Math.log(sel.f / L.min) / Math.log(L.max / L.min) * 1000, pt = getPT(sel);
      const lensOpts = Object.entries(LENSES).map(([k, l]) => `<option value="${k}"${k === sel.lens ? ' selected' : ''}>${l.label}（${l.kind} ${l.min}–${l.max}mm）</option>`).join('');
      const typeOpts = Object.entries(TYPES).map(([k, t]) => `<option value="${k}"${k === sel.type ? ' selected' : ''}>${t.label}</option>`).join('');
      const hOpts = HEIGHTS.map(([n, h]) => `<option value="${h}">${n} ${h}m</option>`).join('');
      const ed = document.createElement('div');
      ed.className = 'cam-edit';
      ed.innerHTML = `
        <div class="cam-row2"><label for="camLabel">编号</label><input id="camLabel" value="${sel.label}" maxlength="6">
          <label for="camType">类型</label><select id="camType">${typeOpts}</select></div>
        <label for="camLens">镜头</label>
        <select id="camLens">${lensOpts}</select>
        <label for="camZoom">推拉（变焦） <b id="camF">${sel.f.toFixed(0)}mm</b> <span class="k" id="camShot">${shotSize(sel)}</span></label>
        <input id="camZoom" type="range" min="0" max="1000" step="1" value="${z}">
        <div class="cam-2">
          <div><label for="camPan">摇 <b id="camPanV">${pt.pan.toFixed(0)}°</b>${focus ? ' <span class="k">跟焦</span>' : ''}</label>
          <input id="camPan" type="range" min="-180" max="180" step="1" value="${pt.pan}"${focus ? ' disabled' : ''}></div>
          <div><label for="camTilt">俯仰 <b id="camTiltV">${pt.tilt.toFixed(0)}°</b></label>
          <input id="camTilt" type="range" min="-80" max="60" step="1" value="${pt.tilt}"${focus ? ' disabled' : ''}></div>
        </div>
        <label for="camH">高度 <b id="camHv">${sel.h.toFixed(1)}m</b><select id="camHp" aria-label="高度预设"><option value="">预设…</option>${hOpts}</select></label>
        <input id="camH" type="range" min="0.5" max="12" step="0.1" value="${sel.h}">
        ${sel.track && sel.type === 'track' ? `<div class="cam-track">
          <div class="sec-sub">轨道</div>
          <div class="cam-2">
            <div><label for="trkLen">长度 <b id="trkLenV">${trackLen(sel).toFixed(1)}m</b></label>
            <input id="trkLen" type="range" min="1" max="40" step="0.5" value="${trackLen(sel)}"></div>
            <div><label for="trkAng">角度 <b id="trkAngV">${trackAngle(sel).toFixed(0)}°</b></label>
            <input id="trkAng" type="range" min="-90" max="90" step="1" value="${trackAngle(sel)}"></div>
          </div>
          <label for="trkT">位置 <b id="trkTV">${(sel.track.t * trackLen(sel)).toFixed(1)}m</b><button data-trk="par" title="角度 0°">平行舞台</button><button data-trk="perp" title="角度 90°">垂直</button></label>
          <input id="trkT" type="range" min="0" max="1" step="0.001" value="${sel.track.t}">
          <div class="cam-row"><button data-trk="play" class="play">${playing?.c === sel ? '■ 停止' : '▶ 预演'}</button>
            <select id="trkSpeed" aria-label="速度">${[0.2, 0.3, 0.5, 0.8, 1, 1.5, 2].map(v => `<option value="${v}"${v === sel.track.speed ? ' selected' : ''}>${v} m/s</option>`).join('')}</select>
            <button data-trk="loop" class="${sel.track.loop ? 'on' : ''}">往返</button>
            ${focus ? '' : `<button data-trk="lock" class="${sel.track.lock ? 'on' : ''}" title="关：横移，朝向不变；开：边移边摇，一直对准对准点">边移边摇</button>`}</div>
        </div>` : ''}
        <div class="cam-row"><button data-act="move">移动</button>${focus ? '' : '<button data-act="aim">改朝向</button>'}<button data-act="del">删除</button></div>`;
      body.append(ed);
      const changed = () => { refreshText(); save(); };
      ed.querySelector('#camZoom').oninput = e => { setZoom(sel, L.min * Math.pow(L.max / L.min, e.target.value / 1000)); changed(); };
      ed.querySelector('#camPan').oninput = e => { setPT(sel, +e.target.value, getPT(sel).tilt); changed(); };
      ed.querySelector('#camTilt').oninput = e => { setPT(sel, getPT(sel).pan, +e.target.value); changed(); };
      const setH = h => {
        const floor = sel.pos.y - sel.h;
        sel.h = h;
        sel.pos.y = floor + h;
        update(sel); changed();
      };
      ed.querySelector('#camH').oninput = e => setH(+e.target.value);
      ed.querySelector('#camHp').onchange = e => { if (e.target.value) setH(+e.target.value); render(); };
      ed.querySelector('#camLens').onchange = e => { sel.lens = e.target.value; setZoom(sel, sel.f); save(); render(); };
      ed.querySelector('#camType').onchange = e => { sel.type = e.target.value; ensureTrack(sel); update(sel); save(); render(); };
      if (sel.track && sel.type === 'track') {
        const c = sel, tr = c.track;
        ed.querySelector('#trkLen').oninput = e => { setTrackLength(c, +e.target.value); changed(); };
        ed.querySelector('#trkAng').oninput = e => { setTrackAngle(c, +e.target.value); changed(); };
        ed.querySelector('#trkT').oninput = e => { placeOnTrack(c, +e.target.value); changed(); };
        ed.querySelector('#trkSpeed').onchange = e => { tr.speed = +e.target.value; save(); };
        ed.querySelectorAll('[data-trk]').forEach(b => b.onclick = () => {
          const k = b.dataset.trk;
          if (k === 'play') return play(c);
          if (k === 'lock') tr.lock = !tr.lock;
          if (k === 'loop') tr.loop = !tr.loop;
          if (k === 'par') setTrackAngle(c, 0);
          if (k === 'perp') setTrackAngle(c, 90);
          save(); render();
        });
      }
      ed.querySelector('#camLabel').onchange = e => { relabel(sel, e.target.value.trim()); save(); render(); };
    }
    pip.hidden = !sel;
    placeStandIn();
    refreshText();
  }
  // 拖动、滑块时只刷新文字，避免重建面板打断操作
  function refreshText() {
    if (!sel) return;
    const pt = getPT(sel), set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    pipLabel.textContent = `${sel.label} ${TYPES[sel.type].label} · ${lensOf(sel).label} · ${sel.f.toFixed(0)}mm · ${shotSize(sel)} · 高 ${sel.h.toFixed(1)}m`;
    set('camF', sel.f.toFixed(0) + 'mm'); set('camShot', shotSize(sel)); set('camHv', sel.h.toFixed(1) + 'm');
    set('camPanV', pt.pan.toFixed(0) + '°'); set('camTiltV', pt.tilt.toFixed(0) + '°');
    const pan = document.getElementById('camPan'); if (pan && document.activeElement !== pan) pan.value = pt.pan;
    const tilt = document.getElementById('camTilt'); if (tilt && document.activeElement !== tilt) tilt.value = pt.tilt;
    const L = lensOf(sel), zoom = document.getElementById('camZoom');
    if (zoom && document.activeElement !== zoom) zoom.value = Math.log(sel.f / L.min) / Math.log(L.max / L.min) * 1000;
    if (sel.track) {
      set('trkTV', (sel.track.t * trackLen(sel)).toFixed(1) + 'm'); set('trkLenV', trackLen(sel).toFixed(1) + 'm'); set('trkAngV', trackAngle(sel).toFixed(0) + '°');
      const ta = document.getElementById('trkAng'); if (ta && document.activeElement !== ta) ta.value = trackAngle(sel);
      const tt = document.getElementById('trkT'); if (tt && document.activeElement !== tt) tt.value = sel.track.t;
    }
    const item = body.querySelector('.cam-item.on .k'); if (item) item.textContent = `${sel.f.toFixed(0)}mm · ${shotSize(sel)}`;
  }

  function select(c) { sel = c; render(); }

  function setPending(p, msg) {
    pending = p;
    hint.textContent = msg || '';
    hint.hidden = !msg;
    render();
  }

  body.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act, type = e.target.closest('[data-type]')?.dataset.type;
    if (type) {
      const label = document.getElementById('camNewLabel')?.value.trim();
      return setPending({ kind: 'place', type, label }, `点击${planMode ? '平面图' : '地面或台面'}放置「${label || ''} ${TYPES[type].label}」 · Esc 取消`);
    }
    if (act === 'add') return setPending(pending?.kind === 'pick' ? null : { kind: 'pick' });
    if (act === 'move') return setPending({ kind: 'move' }, `点击新位置移动 ${sel.label} · Esc 取消`);
    if (act === 'aim') return setPending({ kind: 'aim' }, `点击要拍的位置，${sel.label} 对准那里 · Esc 取消`);
    if (act === 'del') return remove(sel);
    if (act === 'copy') return copy();
    if (act === 'focus') return setPending({ kind: 'focus' }, `点击舞台上的位置，所有机位对准那里 · Esc 取消`);
    if (act === 'unfocus') return clearFocus();
  });
  addEventListener('keydown', e => { if (e.code === 'Escape' && pending) setPending(null); });

  function copy() {
    const text = JSON.stringify(cams.map(toJSON));
    const done = () => { hint.textContent = '已复制机位。放进配置文件的 "cameras" 后重新生成，别人打开也能看到'; hint.hidden = false; setTimeout(() => hint.hidden = true, 3500); };
    navigator.clipboard?.writeText(text).then(done, () => { prompt(tr('复制下面的机位配置'), text); });
  }

  // 有待放置/移动/对准时，用地面点 p 完成；返回 true 表示用掉了这次点击
  function applyPending(p) {
    if (!pending || pending.kind === 'pick') return false;
    if (pending.kind === 'place') {
      const T = TYPES[pending.type];
      sel = add(pending.type, p.clone().setY(p.y + T.h), stageCenter.clone(), { label: pending.label });
    } else if (pending.kind === 'focus') setFocus(p);
    else if (pending.kind === 'move') moveTo(sel, p);
    else if (pending.kind === 'aim') aimAt(sel, p);
    save();
    setPending(null);
    return true;
  }

  // 普通浏览时主画面的点击
  function onClick(ray) {
    ray.layers.enable(1);
    const camHit = ray.intersectObjects(cams.flatMap(c => [c.cam, c.cam.children[0], c.tag]), false)[0];
    ray.layers.disable(1);
    if (!pending && camHit) { select(camHit.object.userData.cam); return true; }
    if (!pending) return false;
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) applyPending(hit.point);
    return true;
  }

  // ---------- 焦点位：所有机位对准同一点，给出距离 ----------
  let focus = null;  // { p: 胸口高度的点, ring, lines }
  const focusLabels = document.createElement('div');
  focusLabels.id = 'focusLabels';
  document.body.append(focusLabels);
  const focusLineMat = new THREE.LineBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthTest: false });
  function setFocus(p) {
    clearFocus(false);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true }));
    ring.position.copy(p).setY(p.y + 0.04);
    ring.renderOrder = 11;
    ring.layers.set(1);
    scene.add(ring);
    const lines = new THREE.LineSegments(new THREE.BufferGeometry(), focusLineMat);
    lines.renderOrder = 11;
    lines.layers.set(1);
    scene.add(lines);
    focus = { p: p.clone().setY(p.y + AIM_H), ring, lines };
    cams.forEach(update);
    if (!sel && cams.length) sel = cams[0];
    save();
    render();
  }
  function clearFocus(rerender = true) {
    if (!focus) return;
    scene.remove(focus.ring, focus.lines);
    focus.lines.geometry.dispose();
    focus = null;
    focusLabels.innerHTML = '';
    save();
    if (rerender) render();
  }
  // 每帧：连线跟着机位走，标签按当前画面相机投影到屏幕上
  const v3 = new THREE.Vector3();
  function renderOverlay(viewCam) {
    if (!focus) return;
    const pts = [];
    cams.forEach(c => pts.push(c.pos, focus.p));
    focus.lines.geometry.setFromPoints(pts);
    if (focusLabels.children.length !== cams.length) focusLabels.innerHTML = cams.map(() => '<div class="dp-label"></div>').join('');
    cams.forEach((c, i) => {
      const slant = c.pos.distanceTo(focus.p), flat = Math.hypot(c.pos.x - focus.p.x, c.pos.z - focus.p.z);
      const el = focusLabels.children[i];
      el.innerHTML = `<b>${c.label}</b>${slant.toFixed(1)} m`;
      v3.copy(c.pos).lerp(focus.p, 0.5).project(viewCam);
      el.hidden = v3.z > 1;
      el.style.transform = `translate(${(v3.x + 1) / 2 * innerWidth}px, ${(1 - v3.y) / 2 * innerHeight}px) translate(-50%, -50%)`;
      const row = body.querySelector(`[data-fd="${c.no}"] span`);
      if (row) row.textContent = `斜距 ${slant.toFixed(1)} m · 水平 ${flat.toFixed(1)} m · ${c.f.toFixed(0)}mm ${shotSize(c)}`;
    });
  }

  // ---------- 机位窗口 ----------
  function renderPip() {
    if (!sel || pip.hidden) return;
    const r = pip.getBoundingClientRect();
    if (!r.width) return;
    pipCam.fov = vfov(sel.f);
    pipCam.position.copy(sel.pos);
    pipCam.lookAt(sel.target);
    pipCam.updateProjectionMatrix();
    const y = innerHeight - r.bottom;
    renderer.setScissorTest(true);
    renderer.setScissor(r.left, y, r.width, r.height);
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.render(scene, pipCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
  }
  // 在窗口里拖动 = 摇、俯仰（按当前视场角换算，拖多少画面就转多少）；滚轮 = 推拉；双击放大
  let drag = null;
  pip.addEventListener('pointerdown', e => { if (!sel) return; drag = { x: e.clientX, y: e.clientY }; pip.setPointerCapture(e.pointerId); });
  pip.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = pip.getBoundingClientRect(), v = vfov(sel.f), h = v * 16 / 9;
    const pt = getPT(sel);
    setPT(sel, pt.pan + (e.clientX - drag.x) / r.width * h, pt.tilt + (e.clientY - drag.y) / r.height * v);
    drag = { x: e.clientX, y: e.clientY };
    refreshText();
  });
  pip.addEventListener('pointerup', () => { if (drag) save(); drag = null; });
  pip.addEventListener('wheel', e => {
    if (!sel) return;
    e.preventDefault();
    setZoom(sel, sel.f * Math.pow(1.0015, -e.deltaY));
    refreshText(); save();
  }, { passive: false });
  pip.addEventListener('dblclick', () => pip.classList.toggle('big'));

  // 导摄顶视图：标签、对准点按屏幕像素定大小
  function setPlanMode(on) {
    planMode = on;
    cams.forEach(c => {
      c.aim.visible = on; c.tag.scale.set(1.4, 0.7, 1);
      if (c.endA) c.endA.visible = c.endB.visible = on && c.type === 'track';
    });
  }
  function scaleMarkers(worldPerPx) {
    for (const c of cams) {
      c.tag.scale.set(worldPerPx * 56, worldPerPx * 28, 1);
      c.aim.scale.setScalar(worldPerPx * 12);
      if (c.endA) { c.endA.scale.setScalar(worldPerPx * 14); c.endB.scale.setScalar(worldPerPx * 14); }
    }
  }

  load();
  sel = cams[0] || null;
  render();
  return {
    onClick, renderPip, renderOverlay, applyPending, select, moveTo, aimAt, refreshText, save, setPlanMode, scaleMarkers, tick, setTrackEnd,
    get cams() { return cams; }, get sel() { return sel; }, get pending() { return pending; },
    markers: () => cams.flatMap(c => c.endA?.visible ? [c.tag, c.aim, c.endA, c.endB] : [c.tag, c.aim]),
  };
}
