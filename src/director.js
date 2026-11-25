import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// 导摄模式：舞美顶视图（正交俯视，舞台在上、观众席在下）。
//   放机位：面板选类型、填编号后点平面图；拖机位标签 = 移，拖对准点 = 摇
//   测距：按住拖一条线；从机位标签开始拖，显示水平距离和镜头到人胸口的斜距
//   剖切：高于剖切高度的构件（桁架、顶部灯具）在顶视图里隐藏
// 网址带 #dp 打开时直接进入。

const AIM_H = 1.5;

export function setupDirector({ renderer, canvas, scene, cams, meshes, floorAt, size, center, audienceDir, mainControls, onToggle }) {
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  cam.layers.enable(1);  // 机位标签、视锥
  cam.up.copy(audienceDir()).negate();  // 屏幕上方 = 舞台方向
  const ctl = new OrbitControls(cam, canvas);
  ctl.enabled = false;
  ctl.enableRotate = false;
  ctl.screenSpacePanning = true;
  ctl.zoomToCursor = true;
  ctl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  ctl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };

  const bar = document.getElementById('dpBar'), labels = document.getElementById('dpLabels');
  const measureBtn = bar.querySelector('[data-dp="measure"]'), cutInput = bar.querySelector('#dpCut'), cutVal = bar.querySelector('#dpCutV');
  let on = false, measuring = false, cut = +cutInput.value;

  // 全图：平面图放在机位窗口右边、面板左边之间的空白区域里居中
  function fit() {
    const aspect = innerWidth / innerHeight;
    const pip = document.getElementById('pip').getBoundingClientRect(), side = document.getElementById('side').getBoundingClientRect();
    const left = innerWidth > 700 && pip.width ? pip.right + 12 : 0, right = innerWidth > 700 ? side.left - 12 : innerWidth;
    const regionW = Math.max(200, right - left);
    const half = Math.max(size.z, size.x / (regionW / innerHeight)) / 2 * 1.05;
    Object.assign(cam, { left: -half * aspect, right: half * aspect, top: half, bottom: -half, zoom: 1 });
    cam.position.set(center.x, size.y + 100, center.z);
    cam.lookAt(center.x, 0, center.z);
    cam.updateMatrixWorld();
    const shift = ((left + right) / 2 - innerWidth / 2) * (2 * half / innerHeight);  // 区域中心偏离屏幕中心的距离（世界单位）
    const screenRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const c = new THREE.Vector3(center.x, 0, center.z).addScaledVector(screenRight, -shift);
    cam.position.set(c.x, size.y + 100, c.z);
    ctl.target.copy(c);
    cam.lookAt(ctl.target);
    cam.updateProjectionMatrix();
    ctl.update();
  }
  addEventListener('resize', () => {
    const aspect = innerWidth / innerHeight, half = cam.top;
    cam.left = -half * aspect; cam.right = half * aspect;
    cam.updateProjectionMatrix();
  });

  function setOn(v) {
    on = v;
    document.body.classList.toggle('dp', on);
    bar.hidden = !on;
    mainControls.enabled = !on;
    ctl.enabled = on;
    cams.setPlanMode(on);
    if (on && !fitted) { fit(); fitted = true; }
    if (!on) setMeasuring(false);
    labels.hidden = !on;
    measures.forEach(m => m.line.visible = on);  // 测距线只在导摄模式显示
    const url = location.pathname + location.search + (on ? '#dp' : '');
    try { history.replaceState(null, '', url); } catch {}
    onToggle?.(on);
  }
  let fitted = false;
  function setMeasuring(v) {
    measuring = v;
    measureBtn.classList.toggle('on', v);
  }
  bar.addEventListener('click', e => {
    const a = e.target.closest('[data-dp]')?.dataset.dp;
    if (a === 'exit') setOn(false);
    if (a === 'measure') setMeasuring(!measuring);
    if (a === 'clear') clearMeasures();
    if (a === 'fit') fit();
  });
  cutInput.oninput = () => { cut = +cutInput.value; cutVal.textContent = cut + 'm'; };

  // ---------- 拾取 ----------
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  ray.layers.enable(1);
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function setRay(e) {
    ptr.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
    ray.setFromCamera(ptr, cam);
  }
  // 平面图上点到的落脚面（剖切高度以下最高的面），没有就是地面
  function groundPoint() {
    const p = new THREE.Vector3();
    ray.ray.intersectPlane(ground, p);
    if (!p) return null;
    p.y = floorAt(p.x, p.z, cut);
    return p;
  }
  const pxToWorld = () => (cam.top - cam.bottom) / cam.zoom / innerHeight;

  // ---------- 测距 ----------
  const measures = [];
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false });
  function newMeasure(a, fromCam) {
    const line = new THREE.Line(new THREE.BufferGeometry(), lineMat);
    line.renderOrder = 11;
    line.layers.set(1);
    scene.add(line);
    const el = document.createElement('div');
    el.className = 'dp-label';
    labels.append(el);
    const m = { a, b: a.clone(), fromCam, line, el };
    measures.push(m);
    return m;
  }
  function updateMeasure(m) {
    const lift = 0.05;
    m.line.geometry.setFromPoints([m.a.clone().setY(m.a.y + lift), m.b.clone().setY(m.b.y + lift)]);
    const flat = Math.hypot(m.b.x - m.a.x, m.b.z - m.a.z);
    if (m.fromCam) {
      const lensPos = m.fromCam.pos, chest = m.b.clone().setY(m.b.y + AIM_H);
      m.el.innerHTML = `<b>${m.fromCam.label}</b> 水平 ${flat.toFixed(1)} m · 斜距 ${lensPos.distanceTo(chest).toFixed(1)} m`;
    } else m.el.textContent = `${flat.toFixed(1)} m`;
  }
  function clearMeasures() {
    measures.splice(0).forEach(m => { scene.remove(m.line); m.line.geometry.dispose(); m.el.remove(); });
  }

  // ---------- 指针 ----------
  let drag = null;
  addEventListener('pointerdown', e => {
    if (!on || e.target !== canvas || e.button === 2) return;
    setRay(e);
    const p = groundPoint();
    if (!p) return;
    // 放置 / 移动 / 对准（面板里点了按钮之后）
    if (cams.pending && cams.pending.kind !== 'pick') {
      cams.applyPending(p);
      return block(e);
    }
    const hit = ray.intersectObjects(cams.markers(), false)[0];
    if (measuring) {
      const c = hit?.object.userData.cam;
      drag = { kind: 'measure', m: newMeasure(c ? c.pos.clone().setY(c.pos.y - c.h) : p, c) };
      updateMeasure(drag.m);
      return block(e);
    }
    if (hit) {
      const o = hit.object;
      if (o.userData.endOf) { cams.select(o.userData.endOf); drag = { kind: 'end', c: o.userData.endOf, end: o.userData.end }; }
      else if (o.userData.aimOf) { cams.select(o.userData.aimOf); drag = { kind: 'aim', c: o.userData.aimOf }; }
      else { cams.select(o.userData.cam); drag = { kind: 'move', c: o.userData.cam, off: o.userData.cam.pos.clone().sub(p).setY(0) }; }
      return block(e);
    }
  }, true);
  function block(e) {
    ctl.enabled = false;  // 本次拖动不平移视图
    e.stopPropagation();
  }
  addEventListener('pointermove', e => {
    if (!drag) return;
    setRay(e);
    const p = groundPoint();
    if (!p) return;
    if (drag.kind === 'measure') { drag.m.b.copy(p); updateMeasure(drag.m); }
    if (drag.kind === 'move') { const q = p.clone().add(drag.off); q.y = floorAt(q.x, q.z, cut); cams.moveTo(drag.c, q); cams.refreshText(); }
    if (drag.kind === 'aim') { cams.aimAt(drag.c, p); cams.refreshText(); }
    if (drag.kind === 'end') { cams.setTrackEnd(drag.c, drag.end, p); cams.refreshText(); }
  });
  addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.kind === 'measure' && drag.m.a.distanceTo(drag.m.b) < 0.1) {  // 只点了一下，不留线
      scene.remove(drag.m.line); drag.m.el.remove(); measures.pop();
    }
    if (drag.kind !== 'measure') cams.save();
    drag = null;
    if (on) ctl.enabled = true;
  });

  // ---------- 渲染 ----------
  const v = new THREE.Vector3();
  function render() {
    ctl.update();
    cams.scaleMarkers(pxToWorld());
    // 剖切：高于剖切高度的构件不画
    const hidden = [];
    for (const o of meshes) if (o.visible && o.userData.box && o.userData.box.min.y > cut) { o.visible = false; hidden.push(o); }
    renderer.render(scene, cam);
    hidden.forEach(o => o.visible = true);
    for (const m of measures) {
      v.copy(m.a).add(m.b).multiplyScalar(0.5).project(cam);
      m.el.style.transform = `translate(${(v.x + 1) / 2 * innerWidth}px, ${(1 - v.y) / 2 * innerHeight}px) translate(-50%, -130%)`;
    }
  }

  document.getElementById('dpEnter').onclick = () => setOn(true);
  if (location.hash === '#dp') setOn(true);
  return { get on() { return on; }, camera: cam, render, setOn };
}
