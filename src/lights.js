import * as THREE from 'three';

// 灯具：灯具几何体被 fbx_strip.py 去掉后只剩节点。按配置 fixtures 找到每台灯的「灯口部件」，
// 在灯口画发光面，并按灯型画光束。配置项（坐标都在灯口部件自己的坐标系里，单位与 FBX 相同）：
//   { match: 灯具组名正则, type: 'beam'|'wash'|'strobe'|'bar', part: 灯口部件名正则,
//     lens: 灯口中心, dir: 出光方向, size: 圆形灯口半径 或 [宽, 高]（strobe、bar 的长方形发光面） }
// 灯具按所在的最外层组分组，每组一个开关。
// 生成器认出的新型号还没分析灯口：没有 part 时用灯具节点本身，lens 默认节点原点，dir 默认 +Z，size 用下面的默认大小（米）。
// 配置 aim（可选）统一光束方向、不用模型里灯头的姿态：灯口离地低于 floorBelow 米的朝正上方，其余朝观众席水平打出。
// 频闪只有面板发光，始终按面板自身朝向。
// 配置 lightGroups（可选）按组名单独设置，"*" 对所有组生效：
//   glowOnly: true    只亮灯口、不出光束
//   beamSwitch: true  给这组一个「光束」开关，默认关
// 每个灯口另有一颗始终正对镜头的星芒（星光镜效果），可整体开关。

export const TYPES = {
  beam:   { label: '光束灯', angle: 3,  length: 40, intensity: 0.28,  size: 0.1 },  // 窄、清晰的光柱
  wash:   { label: '染色灯', angle: 18, length: 25, intensity: 0.08,  size: 0.15 },  // 宽、柔
  strobe: { label: '频闪',   angle: 60, length: 3,  intensity: 0.10,  size: [0.4, 0.2] },  // 发光面板，光很快散开
  bar:    { label: '灯条',   angle: 6,  length: 8,  intensity: 0.035, size: [1, 0.05] },  // 一排灯珠形成的扇形光片
};
const MAX_HIT = 60;   // 光束最远找多远的落点（米）
const MIN_HIT = 0.8;  // 忽略灯口附近的命中（灯具挂在桁架里，射线会先碰到桁架）

const beamVert = /* glsl */`
  attribute float aR0, aR1, aLen;
  varying float vT, vEdge, vDist;
  void main() {
    float t = position.y;
    float r = mix(aR0, aR1, t);
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position.x * r, t * aLen, position.z * r, 1.0);
    vec3 n = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
    vEdge = abs(dot(n, normalize(-mv.xyz)));
    vT = t;
    vDist = t * aLen;
    gl_Position = projectionMatrix * mv;
  }`;
// 光柱：正对视线的中心最亮、边缘渐隐；按离灯口的实际距离衰减，末端再收一点
const beamFrag = /* glsl */`
  uniform float uIntensity, uDecay;
  varying float vT, vEdge, vDist;
  void main() {
    // 正对镜头（沿轴线看）的光束在这里会变透明，那种情况的眩光由灯口光晕表现
    float a = uIntensity * pow(vEdge, 1.6) * exp(-vDist / uDecay) * smoothstep(0.0, 0.02, vT) * smoothstep(1.0, 0.92, vT);
    gl_FragColor = vec4(vec3(a), 1.0);
  }`;
const spotFrag = /* glsl */`
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    gl_FragColor = vec4(vec3(uIntensity * smoothstep(1.0, 0.2, d)), 1.0);
  }`;
// 灯口光晕：中心很亮、迅速衰减的点光，密集排列时仍能分辨出一颗颗灯
const haloFrag = /* glsl */`
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float d = min(length(vUv - 0.5) * 2.0, 1.0);
    gl_FragColor = vec4(vec3(uIntensity * pow(1.0 - d, 4.0)), 1.0);
  }`;
const spotVert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };

// 光束几何：y 从 0 到 1；锥形用开口圆柱（法线沿径向），光片用平面（x 为灯条方向）
const coneGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0);
const sheetGeo = new THREE.PlaneGeometry(2, 1).translate(0, 0.5, 0);
const discGeo = new THREE.CircleGeometry(1, 24);
const rectGeo = new THREE.PlaneGeometry(1, 1);
const spotGeo = new THREE.PlaneGeometry(2, 2);

const lensOn = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide });
const lensOff = new THREE.MeshBasicMaterial({ color: 0x3a3d44, side: THREE.DoubleSide });

const isAncestor = (a, o) => { for (let p = o.parent; p; p = p.parent) if (p === a) return true; return false; };

const HALO = 3.5;  // 灯口光晕半径 = 灯口半径 × HALO
const STAR = { beam: 2.2, wash: 3, strobe: 1.2, bar: 1 };  // 星芒大小（米）

// 星芒贴图：亮核 + 横竖四道长芒 + 斜向四道短芒
function starTexture() {
  const N = 256, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), h = N / 2;
  g.globalCompositeOperation = 'lighter';
  const core = g.createRadialGradient(h, h, 0, h, h, h * 0.22);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, N, N);
  // 芒线要够粗：星芒在屏幕上常只有几十像素，太细的线会缩没
  for (const [angle, len, w] of [[0, 1, 14], [90, 1, 14], [45, 0.5, 8], [135, 0.5, 8]]) {
    g.save();
    g.translate(h, h);
    g.rotate(angle * Math.PI / 180);
    const ray = g.createLinearGradient(-h * len, 0, h * len, 0);
    ray.addColorStop(0, 'rgba(255,255,255,0)');
    ray.addColorStop(0.5, 'rgba(255,255,255,1)');
    ray.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ray;
    // 芒线做成两头尖的菱形，比矩形更像星光镜的效果
    g.beginPath();
    g.moveTo(-h * len, 0); g.lineTo(0, -w / 2); g.lineTo(h * len, 0); g.lineTo(0, w / 2);
    g.closePath();
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildLights(scene, root, fixtures = [], obstacles = [], aim = null, groupOpts = {}) {
  const beamMats = {}, spotMat = new THREE.ShaderMaterial({ vertexShader: spotVert, fragmentShader: spotFrag, uniforms: { uIntensity: { value: 0.35 } }, ...additive });
  // 灯口光晕：面朝出光方向，正对灯口看是一团亮光，侧面看几乎看不到，像真实的眩光
  const haloMat = new THREE.ShaderMaterial({ vertexShader: spotVert, fragmentShader: haloFrag, uniforms: { uIntensity: { value: 0.8 } }, ...additive });
  const starTex = starTexture(), starMats = {};
  for (const [k, t] of Object.entries(TYPES)) {
    starMats[k] = new THREE.PointsMaterial({ map: starTex, size: STAR[k], sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    beamMats[k] = new THREE.ShaderMaterial({ vertexShader: beamVert, fragmentShader: beamFrag, uniforms: { uIntensity: { value: t.intensity }, uDecay: { value: t.length * 0.6 } }, ...additive });
  }

  // 1. 收集每台灯：灯口世界位置、出光方向、灯口部件的朝向与缩放
  const groups = new Map();  // 组名 -> { type -> [灯] }
  const topOf = o => { while (o.parent && o.parent !== root) o = o.parent; return o; };
  for (const f of fixtures) {
    const re = new RegExp(f.match), partRe = f.part && new RegExp(f.part);
    const nodes = [];
    root.traverse(o => re.test(o.name) && !nodes.some(n => isAncestor(n, o)) && nodes.push(o));
    for (const node of nodes) {
      let part = partRe ? null : node;
      if (partRe) node.traverse(o => !part && partRe.test(o.name) && (part = o));
      if (!part) continue;
      const m = part.matrixWorld;
      const pos = new THREE.Vector3(...(f.lens || [0, 0, 0])).applyMatrix4(m);
      let dir = new THREE.Vector3(...(f.dir || [0, 0, 1])).transformDirection(m);
      if (aim && f.type !== 'strobe') dir = pos.y < aim.floorBelow ? new THREE.Vector3(0, 1, 0) : aim.forward.clone();
      const quat = new THREE.Quaternion(), scale = new THREE.Vector3();
      m.decompose(new THREE.Vector3(), quat, scale);
      const top = topOf(node);
      const g = groups.get(top) || new Map();
      groups.set(top, g);
      if (!g.has(f.type)) g.set(f.type, []);
      g.get(f.type).push({ f, pos, dir, quat, s: scale.x });
    }
  }

  // 2. 每组每种灯型合成实例化网格：灯口、光束、落点光斑
  const result = [], sets = [];
  const up = new THREE.Vector3(0, 1, 0), M = new THREE.Matrix4(), Q = new THREE.Quaternion();
  for (const [top, byType] of groups) {
    const parts = [], beams = [], glows = [], stars = [];
    for (const [type, list] of byType) {
      const T = TYPES[type];
      const tan = Math.tan(THREE.MathUtils.degToRad(T.angle / 2));
      const rect = type === 'strobe' || type === 'bar';
      const lens = new THREE.InstancedMesh(rect ? rectGeo : discGeo, lensOn, list.length);
      const beam = new THREE.InstancedMesh(type === 'bar' ? sheetGeo : coneGeo, beamMats[type], list.length);
      const r0 = new Float32Array(list.length), r1 = new Float32Array(list.length), len = new Float32Array(list.length);
      const spots = new THREE.InstancedMesh(spotGeo, spotMat, list.length);
      const halos = new THREE.InstancedMesh(spotGeo, haloMat, list.length);
      list.forEach((l, i) => {
        const sz = l.f.size ?? T.size, s = l.f.size == null ? 1 : l.s;  // 默认大小已经是米
        const size = Array.isArray(sz) ? sz.map(v => v * s) : [sz * s, sz * s];
        // 灯口：圆片/矩形法线（+Z）对准出光方向；矩形沿灯口部件自身的 x、y 轴
        const lq = rect ? l.quat : Q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), l.dir).clone();
        lens.setMatrixAt(i, M.compose(l.pos.clone().addScaledVector(l.dir, 0.005), lq, new THREE.Vector3(rect ? size[0] : size[0], rect ? size[1] : size[0], 1)));
        // 频闪、灯条本身就是发光面板/发光条，不加光晕（几百个排在一起会叠成一片白）
        const hr = rect ? 0 : size[0] * HALO;
        halos.setMatrixAt(i, M.compose(l.pos.clone().addScaledVector(l.dir, 0.01), Q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), l.dir), new THREE.Vector3(hr, hr, 1)));
        // 光束：+Y 对准出光方向；灯条的光片再绕出光方向转到与灯条平行
        let bq = new THREE.Quaternion().setFromUnitVectors(up, l.dir);
        if (type === 'bar') {
          const barAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(l.quat);
          const cur = new THREE.Vector3(1, 0, 0).applyQuaternion(bq);
          const twist = new THREE.Quaternion().setFromUnitVectors(cur, barAxis.projectOnPlane(l.dir).normalize());
          bq = twist.multiply(bq);
        }
        beam.setMatrixAt(i, M.compose(l.pos, bq, new THREE.Vector3(1, 1, 1)));
        r0[i] = type === 'bar' ? size[0] / 2 : size[0];
      });
      const star = new THREE.Points(new THREE.BufferGeometry().setFromPoints(list.map(l => l.pos.clone().addScaledVector(l.dir, 0.02))), starMats[type]);
      star.frustumCulled = false;
      star.layers.set(2);
      scene.add(star);
      stars.push(star);
      beam.geometry = beam.geometry.clone();
      beam.geometry.setAttribute('aR0', new THREE.InstancedBufferAttribute(r0, 1));
      beam.geometry.setAttribute('aR1', new THREE.InstancedBufferAttribute(r1, 1));
      beam.geometry.setAttribute('aLen', new THREE.InstancedBufferAttribute(len, 1));
      beam.frustumCulled = spots.frustumCulled = halos.frustumCulled = false;  // 实例分布很广，按单个包围球裁剪会误删
      lens.frustumCulled = false;
      // 灯光放在 2 层：主画面、机位窗口看得到，导摄顶视图里隐藏，免得挡住平面
      [lens, beam, spots, halos].forEach(o => o.layers.set(2));
      scene.add(lens, beam, spots, halos);
      sets.push({ type, list, beam, spots, tan, r0, r1, len });
      parts.push(lens);
      beams.push(beam, spots);
      glows.push(halos);
    }
    const count = [...byType.values()].reduce((n, l) => n + l.length, 0);
    const types = [...byType.keys()].map(k => TYPES[k].label).join('、');
    const name = top.name.replace(/_/g, ' ');
    const opts = groupOpts[name] || groupOpts[top.name] || groupOpts['*'] || {};
    const beamSwitch = !!opts.beamSwitch, beamOn = !opts.glowOnly && !beamSwitch;  // 有开关的组默认先关光束
    beams.forEach(m => m.visible = beamOn);
    result.push({ name, count, types, lenses: parts, beams, glows, stars, beamSwitch, beamOn, on: true });
  }

  // 光束长度与落点光斑：沿出光方向找第一个遮挡（升降屏移动后需要重算）
  const ray = new THREE.Raycaster();
  function fit() {
    for (const { type, list, beam, spots, tan, r0, r1, len } of sets) {
      const T = TYPES[type], spotted = type === 'beam' || type === 'wash';  // 落点光斑只给圆形光束
      let si = 0;
      list.forEach((l, i) => {
        let hit = null;
        if (type !== 'strobe') {
          ray.set(l.pos.clone().addScaledVector(l.dir, MIN_HIT), l.dir);
          ray.far = MAX_HIT;
          hit = ray.intersectObjects(obstacles, false)[0];
        }
        // 没有落点的光束（如打向天空）画到 1.5 倍标称长度，靠衰减自然消失
        const L = type === 'strobe' ? T.length : hit ? hit.distance + MIN_HIT : T.length * 1.5;
        len[i] = L;
        r1[i] = r0[i] + L * tan;
        if (hit && spotted) {
          const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : up;
          spots.setMatrixAt(si++, M.compose(hit.point.clone().addScaledVector(n, 0.02), Q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n), new THREE.Vector3(r1[i], r1[i], 1)));
        }
      });
      spots.count = si;
      spots.instanceMatrix.needsUpdate = true;
      beam.geometry.attributes.aLen.needsUpdate = beam.geometry.attributes.aR1.needsUpdate = true;
    }
  }
  fit();

  let starsOn = true;
  const show = g => {
    g.lenses.forEach(m => m.material = g.on ? lensOn : lensOff);
    g.beams.forEach(m => m.visible = g.on && g.beamOn);
    g.glows.forEach(m => m.visible = g.on);
    g.stars.forEach(m => m.visible = g.on && starsOn);
  };
  const setOn = (g, on) => { g.on = on; show(g); };
  const setBeam = (g, on) => { g.beamOn = on; show(g); };
  const setStars = on => { starsOn = on; result.forEach(show); };
  const setLevel = k => {
    for (const [t, mat] of Object.entries(beamMats)) mat.uniforms.uIntensity.value = TYPES[t].intensity * k;
    for (const mat of Object.values(starMats)) mat.color.setScalar(Math.min(k, 1.5));
    spotMat.uniforms.uIntensity.value = 0.35 * k;
    haloMat.uniforms.uIntensity.value = 0.8 * k;
  };
  return { groups: result, setOn, setBeam, setStars, setLevel, fit };
}
