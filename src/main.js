import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FBXLoader } from './vendor/FBXLoader.js';
import { buildProps } from './props.js';
import { buildLights } from './lights.js';
import { setupCameras } from './cameras.js';
import { setupDirector } from './director.js';
import { setupShow } from './show.js';
import { setupMachines, KINDS } from './machines.js';

// 构建脚本把模型和配置注入为 window.STAGE = { model: { format, gzip, data }, config }
const STAGE = window.STAGE || {};
const CFG = {
  title: '舞美三维查看',
  audience: '+z',      // 观众席在模型的哪一侧：'+z' | '-z' | '+x' | '-x'
  lifts: [],           // 可选：升降屏，见 SKILL.md
  fixtures: [],        // 可选：灯具（去掉几何体后按灯型画灯口和光束），见 lights.js
  props: [],           // 可选：桌椅凳替身，见 props.js
  lightGroups: {},     // 可选：按组名单独设置，如 { "背后灯墙": { "glowOnly": true } }
  materialOverrides: [], // 可选：材质模式下按构件名(mesh)或材质名(material)改颜色/反光，见 SKILL.md
  labels: [],          // 可选：在构件顶面写字 { mesh, text, color }
  textures: [],        // 可选：替换构件贴图 { mesh, image }，图片铺满构件每个面
  cameras: [],         // 可选：转播机位（网页里「复制机位」得到的 JSON）
  aim: null,           // 可选：{ floorBelow: 3 } 地上的灯朝上、天上的灯朝观众席，见 lights.js
  seats: { minHeight: 0.3, maxHeight: 0.6, maxLength: 1.6 },
  app: 'viewer',       // 'show' = 秀导走位版（build_html.py --show）
  ...STAGE.config,
};
const AUDIENCE_SIDE = new URLSearchParams(location.search).get('audience') || CFG.audience;
// 项目名：生成时的 title 是默认值，点右上角的名字可以改，存在本机。
// 机位、走位的存储键仍用生成时的 title，改名不会丢数据
const nameKey = 'stage-name:' + CFG.title, nameEl = document.getElementById('name');
let projectName = CFG.title;
function setProjectName(n) {
  projectName = n?.trim() || CFG.title;
  document.title = nameEl.textContent = projectName;
  try { projectName === CFG.title ? localStorage.removeItem(nameKey) : localStorage.setItem(nameKey, projectName); } catch {}
}
try { setProjectName(localStorage.getItem(nameKey)); } catch { setProjectName(); }
nameEl.title = '点击修改项目名称';
nameEl.onclick = () => { const n = prompt('项目名称', projectName); if (n !== null) setProjectName(n); };

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16181d);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
camera.layers.enable(2);  // 灯光（lights.js 放在 2 层）
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.screenSpacePanning = true;

const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3d46, 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

// 全部双面：Max 模型里常有单面片，背面不渲染会穿帮，走动时的碰撞射线也要能从背面命中
const clayMat = new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
const wireMat = new THREE.MeshBasicMaterial({ color: 0x7fa8ff, wireframe: true });
const edgeMat = new THREE.LineBasicMaterial({ color: 0x2a2d35 });
const selMat = new THREE.MeshStandardMaterial({ color: 0x4c8dff, roughness: 0.6, emissive: 0x10306e, side: THREE.DoubleSide });

let model, box, size, center, grid, person, selected = null;
const meshes = [], edgeLines = [];

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // 用户还没手动转动镜头时，窗口变化（如手机横竖屏）后按新比例重新取景
  if (size && currentView) goTo(currentView, true);
}
addEventListener('resize', resize);
resize();

function onLoad(root) {
  model = root;
  // 模型自带的灯光、相机会干扰查看器的打光和取景
  const extras = [];
  model.traverse(o => (o.isLight || o.isCamera) && extras.push(o));
  extras.forEach(o => o.removeFromParent());
  model.updateMatrixWorld(true);
  // 模型里的关键帧动画 = 升降、开合、旋转的机械，先摆到第一帧，再算尺寸、座位等
  machines = setupMachines(model, model.animations, { onSettle: () => { lights?.fit(); captureReflection(); } });
  if (location.hash === '#debug') window.STAGE_DEBUG = { model, machines };  // 测试脚本用
  buildProps(model, CFG.props);
  // 落地并水平居中：舞台面在 y=0 附近，中心在原点。
  // 机械不参与（升降台起点常在台面以下，算进去会把整个舞台抬高）
  const movers = new Set(machines.list.map(m => m.node));
  const isMover = o => { for (let p = o; p; p = p.parent) if (movers.has(p)) return true; return false; };
  box = new THREE.Box3();
  model.traverse(o => o.isMesh && !isMover(o) && box.expandByObject(o));
  if (box.isEmpty()) box.setFromObject(model);
  center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  scene.add(model);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  size = box.getSize(new THREE.Vector3());
  center = box.getCenter(new THREE.Vector3());

  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    // 带贴图的发光材质视为屏幕：不受光照影响，按原色自发光显示（V-Ray 普通材质上的贴图不算）
    const textured = [].concat(o.material).find(isScreen);
    if (textured) {
      o.userData.screenMat = new THREE.MeshBasicMaterial({
        map: textured.map || textured.emissiveMap, alphaMap: textured.alphaMap || null,
        transparent: !!textured.alphaMap, toneMapped: false, side: THREE.DoubleSide,
      });
    }
    // 家具替身没有原始材质，材质模式下用配置里的颜色，没有就用白模
    o.userData.origMat = o.userData.prop
      ? (o.userData.propColor ? propMaterial(o.userData.propColor) : clayMat)
      : Array.isArray(o.material) ? o.material.map(origMaterial) : origMaterial(o.material);  // 多维/子对象材质逐个还原
    const ov = overrides.find(v => (!v.mesh || v.mesh.test(o.name)) && (!v.material || [].concat(o.material).some(m => v.material.test(m.name))));
    if (ov) {
      o.userData.origMat = ov.mat;
      if (ov.reflect) reflectors.push(o);
    }
    o.material = clayMat;
    o.userData.box = new THREE.Box3().setFromObject(o);
    meshes.push(o);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 30), edgeMat);
    e.visible = false;
    o.add(e);
    edgeLines.push(e);
  });

  const r = Math.max(size.x, size.z);
  sun.position.set(r * 0.6, r * 1.2, r * 0.8);
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: r * 4 });
  sun.shadow.camera.updateProjectionMatrix();

  const g = Math.ceil(r * 1.6 / 10) * 10;
  grid = new THREE.Group();
  const fine = new THREE.GridHelper(g, g, 0x2e323c, 0x22252d);
  const coarse = new THREE.GridHelper(g, g / 5, 0x3c4150, 0x3c4150);
  coarse.position.y = 0.002;
  grid.add(fine, coarse);
  scene.add(grid);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(g, g), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  person = makePerson();
  // 起始位置：模型前沿往舞台方向 5 米，站在地面构件上（不站在模型外的空地，否则比地面矮一截）
  const edge = (AUDIENCE_SIDE.endsWith('x') ? size.x : size.z) / 2;
  person.position.copy(audienceDir().multiplyScalar(edge - 5));
  person.position.y = floorAt(person.position.x, person.position.z, 3);
  scene.add(person);

  document.getElementById('dims').textContent =
    `${size.x.toFixed(1)} × ${size.z.toFixed(1)} × ${size.y.toFixed(1)} m`;
  document.getElementById('loading').remove();
  setupLifts();
  setupMachinesPanel();
  CFG.labels.forEach(addLabel);
  CFG.textures.forEach(replaceTexture);
  const aim = CFG.aim && { floorBelow: CFG.aim.floorBelow ?? 3, forward: audienceDir() };
  lights = buildLights(scene, model, CFG.fixtures, meshes, aim, CFG.lightGroups);
  setupLights(lights);
  if (CFG.app === 'show') {
    person.visible = false;
    controls.enabled = false;
    show = setupShow({ renderer, scene, meshes, size, center, audienceDir, storageKey: 'stage-show:' + CFG.title, title: () => projectName, setTitle: setProjectName });
    applyMode(mode);
    return;
  }
  cams = setupCameras({
    scene, renderer, mainCamera: camera, meshes, floorAt,
    stageCenter: stageFront(), stageDir: audienceDir().negate(), storageKey: 'stage-cams:' + CFG.title, initial: CFG.cameras,
  });
  dp = setupDirector({ renderer, canvas, scene, cams, meshes, floorAt, size, center, audienceDir, mainControls: controls,
    // 导摄时机位面板展开，升降屏、灯光收起
    onToggle: on => { if (!on) return; ['#lifts', '#lights'].forEach(q => document.querySelector(q).classList.add('closed')); document.getElementById('cams').classList.remove('closed'); } });
  if (meshes.some(o => o.userData.screenMat)) screensBtn.hidden = false;
  applyMode(mode);

  const initial = new URLSearchParams(location.search).get('view') || 'front';
  goTo(initial, true);
}

// 模型以 base64（可选 gzip）内嵌在页面里，因此单文件双击即可打开
async function loadModel({ format, gzip, data }) {
  let buf = Uint8Array.from(atob(data), c => c.charCodeAt(0)).buffer;
  if (gzip) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if (format === 'fbx') {
    const root = new FBXLoader().parse(buf, '');
    // FBX 内部以厘米为单位，UnitScaleFactor 是文件单位相对厘米的倍数；统一换算成米
    root.scale.setScalar((root.userData.unitScaleFactor ?? 1) / 100);
    return root;
  }
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, '');
  gltf.scene.animations = gltf.animations;
  return gltf.scene;
}

const failed = msg => document.querySelector('#loading div').textContent = msg;
// 秀导版可以不带模型：只用导入的舞美平面图
function showOnly() {
  size = new THREE.Vector3(40, 0, 30);
  center = new THREE.Vector3();
  grid = new THREE.Group();
  const coarse = new THREE.GridHelper(100, 20, 0x3c4150, 0x3c4150);
  coarse.position.y = 0.002;
  grid.add(new THREE.GridHelper(100, 100, 0x2e323c, 0x22252d), coarse);
  scene.add(grid);
  document.getElementById('loading').remove();
  controls.enabled = false;
  show = setupShow({ renderer, scene, meshes, size, center, audienceDir, storageKey: 'stage-show:' + CFG.title, title: () => projectName, setTitle: setProjectName });
}

// 等本文件其余部分（show 等变量）初始化完再启动
if (!STAGE.model) CFG.app === 'show' ? Promise.resolve().then(showOnly) : failed('页面里没有模型数据，请用 build_html.py 生成');
else loadModel(STAGE.model).then(onLoad).catch(err => failed('模型加载失败：' + err.message));

// 1.75m 人物参照
function makePerson() {
  const m = new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.7 });
  const p = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.0, 4, 12), m);
  body.position.y = 0.72;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), m);
  head.position.y = 1.62;
  p.add(body, head);
  p.traverse(o => o.castShadow = true);
  return p;
}

function audienceDir() {
  const s = AUDIENCE_SIDE[0] === '-' ? -1 : 1;
  return AUDIENCE_SIDE.endsWith('x') ? new THREE.Vector3(s, 0, 0) : new THREE.Vector3(0, 0, s);
}

// ---------- 机位 ----------
function viewPose(name) {
  const fwd = audienceDir();                       // 从舞台指向观众
  const left = new THREE.Vector3(-fwd.z, 0, fwd.x); // 观众面向舞台时的左手方向
  const depth = Math.abs(fwd.x) ? size.x : size.z;
  const width = Math.abs(fwd.x) ? size.z : size.x;
  // 让宽 w、高 h 的立面刚好填满画面所需的距离
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const fit = (w, h = size.y) => Math.max(w / 2 / (tan * camera.aspect), h / 2 / tan) * 1.15;
  const target = center.clone().setY(size.y * 0.4);
  const P = (v, t = target) => ({ pos: v, target: t });
  switch (name) {
    case 'front':    return P(target.clone().addScaledVector(fwd, depth / 2 + fit(width)).setY(size.y * 0.5));
    // 左 45° / 右 45°：从观众席一侧斜着看舞台
    case 'left':     return P(target.clone().addScaledVector(fwd.clone().add(left).normalize(), depth / 2 + fit(width)).setY(size.y * 0.55));
    case 'right':    return P(target.clone().addScaledVector(fwd.clone().sub(left).normalize(), depth / 2 + fit(width)).setY(size.y * 0.55));
    case 'top':      return P(center.clone().setY(Math.abs(fwd.x) ? fit(size.z, size.x) : fit(size.x, size.z)).addScaledVector(fwd, 0.01), center.clone().setY(0));
  }
}

let tween = null, currentView = null;
function goTo(name, instant = false) {
  const pose = viewPose(name);
  if (!pose) return;
  currentView = name;
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
  if (instant) {
    camera.position.copy(pose.pos);
    controls.target.copy(pose.target);
    controls.update();
    return;
  }
  tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), ...pose };
}
document.getElementById('views').onclick = e => {
  if (!e.target.dataset.view) return;
  if (walk.on) setWalk(false);
  goTo(e.target.dataset.view);
};
controls.addEventListener('start', () => {
  tween = null;
  currentView = null;
  document.querySelectorAll('#views button').forEach(b => b.classList.remove('on'));
});

// ---------- 显示模式 ----------
let mode = 'orig', showScreens = true;
// 3ds Max 材质类型（FBX 里的 ClassIDa）
const VRAY_LIGHT = 2093950526, VRAY_MTL = 935280431;
// 不自发光的 V-Ray 普通材质上的贴图是物体表面，不是屏幕；其余带贴图的（标准材质、V-Ray 发光材质）按屏幕处理
const isScreen = m => !!(m.map || m.emissiveMap) && !(m.userData.max?.cls === VRAY_MTL && !m.emissiveMap);
const srgb = c => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

// 「材质」模式：按 FBX 里保留的 3ds Max / V-Ray 参数还原
//   V-Ray 发光材质 → 自发光（台面圆环、灯带等）
//   V-Ray 普通材质 → 漫反射颜色；反射有颜色的当金属（金、铜），反射强的按光泽度给低粗糙度
const origCache = new Map();
function origMaterial(src) {
  if (origCache.has(src)) return origCache.get(src);
  const max = src.userData.max || {};
  let mat;
  if (max.cls === VRAY_LIGHT) {
    mat = new THREE.MeshBasicMaterial({ color: max.lightColor ? srgb(max.lightColor) : 0xffffff, map: src.map || null, toneMapped: false, side: THREE.DoubleSide });
  } else {
    const refl = max.reflection || [0, 0, 0], strength = Math.max(...refl);
    const tinted = strength > 0.3 && Math.max(...refl) - Math.min(...refl) > 0.1;
    mat = new THREE.MeshStandardMaterial({
      color: tinted ? srgb(refl) : max.diffuse ? srgb(max.diffuse) : src.color ? src.color.clone() : 0xcccccc,
      map: src.map || null, alphaMap: src.alphaMap || null, emissiveMap: src.emissiveMap || null,
      emissive: src.emissiveMap ? 0xffffff : 0x000000,
      metalness: tinted ? 0.9 : max.metalness || 0,
      roughness: strength > 0.15 ? THREE.MathUtils.clamp(1 - (max.glossiness ?? 0.5), 0.12, 0.8) : 0.85,
      transparent: !!src.alphaMap || src.opacity < 1, opacity: src.opacity, side: THREE.DoubleSide,
    });
  }
  origCache.set(src, mat);
  return mat;
}
// 配置的材质覆盖。reflect（0~1）：亮面反光强度，反射内容来自舞台上方拍的环境图；color 是底色；glow 是微弱自发光，暗场里也能和地面分开
const overrides = CFG.materialOverrides.map(v => ({
  mesh: v.mesh && new RegExp(v.mesh), material: v.material && new RegExp(v.material), reflect: v.reflect,
  mat: v.reflect
    ? new THREE.MeshStandardMaterial({ color: v.color ?? 0x26262b, emissive: v.glow ?? 0x000000, metalness: v.reflect, roughness: v.roughness ?? 0.18, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: v.color ?? 0xcccccc, roughness: v.roughness ?? 0.7, side: THREE.DoubleSide }),
}));
const reflectors = [];
let cubeCam = null;
function captureReflection() {
  if (!reflectors.length || mode !== 'orig') return;
  if (!cubeCam) {
    cubeCam = new THREE.CubeCamera(0.1, 1000, new THREE.WebGLCubeRenderTarget(256));
    cubeCam.children.forEach(c => c.layers.enable(2));  // 反射里也有灯
    const b = new THREE.Box3();
    reflectors.forEach(o => b.expandByObject(o));
    const c = b.getCenter(new THREE.Vector3());
    cubeCam.position.set(c.x, b.max.y + 1.6, c.z);  // 站在台上的人眼高度
    scene.add(cubeCam);
    overrides.forEach(v => v.reflect && (v.mat.envMap = cubeCam.renderTarget.texture));
  }
  reflectors.forEach(o => o.visible = false);  // 拍的时候藏起镜面本身
  cubeCam.update(renderer, scene);
  reflectors.forEach(o => o.visible = true);
}

// 替换贴图：按自发光屏幕显示（不受环境明暗影响），材质模式和屏幕内容开关都用它
function replaceTexture({ mesh, image }) {
  const re = new RegExp(mesh);
  const tex = new THREE.TextureLoader().load(image, () => applyMode(mode));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide });
  for (const o of meshes) if (re.test(o.name)) o.userData.screenMat = o.userData.origMat = mat;
}

// 构件顶面写字：平放在顶面，文字朝向观众席
function addLabel({ mesh, text, color = '#d8d8d8' }) {
  const re = new RegExp(mesh), o = meshes.find(m => re.test(m.name));
  if (!o) return;
  const b = new THREE.Box3().setFromObject(o), sz = b.getSize(new THREE.Vector3());
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.font = 'bold 260px "PingFang SC","Microsoft YaHei",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const k = Math.min(1, 960 / g.measureText(text).width);
  g.setTransform(k, 0, 0, k, 512 * (1 - k), 256 * (1 - k));
  g.lineWidth = 22; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(text, 512, 256);  // 描边，白模底色上也看得清
  g.fillStyle = color; g.fillText(text, 512, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const w = Math.min(sz.x, sz.z) * 0.9;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  const fwd = audienceDir();
  plane.rotation.set(-Math.PI / 2, Math.atan2(fwd.x, fwd.z), 0, 'YXZ');
  plane.position.set((b.min.x + b.max.x) / 2, b.max.y + 0.02, (b.min.z + b.max.z) / 2);
  scene.add(plane);
}

const propCache = new Map();
const propMaterial = color => {
  if (!propCache.has(color)) propCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide }));
  return propCache.get(color);
};

function applyMode(m) {
  mode = m;
  document.getElementById('edges').classList.toggle('on', m === 'edges');
  for (const o of meshes) o.material = o === selected ? selMat : m === 'wire' ? wireMat
    : (showScreens && o.userData.screenMat) || (m === 'orig' ? o.userData.origMat : clayMat);
  edgeLines.forEach(e => e.visible = m === 'edges');
  captureReflection();
}
document.getElementById('edges').onclick = () => applyMode(mode === 'edges' ? 'orig' : 'edges');
// 显示菜单：白模+线、屏幕内容、人物比例、网格
const showMenu = document.getElementById('showMenu');
document.getElementById('showBtn').onclick = e => { e.stopPropagation(); showMenu.hidden = !showMenu.hidden; };
addEventListener('pointerdown', e => { if (!e.target.closest('#showWrap')) showMenu.hidden = true; });

const toggle = (id, get) => {
  const btn = document.getElementById(id);
  btn.onclick = () => {
    const on = btn.classList.toggle('on'), o = get();
    o.visible = on && !(o === person && walk.on);  // 走动时"我"就是那个人，不显示
  };
};
toggle('person', () => person);
toggle('grid', () => grid);

const screensBtn = document.getElementById('screens');
screensBtn.onclick = () => {
  showScreens = !showScreens;
  screensBtn.classList.toggle('on', showScreens);
  applyMode(mode);
};

// ---------- 点选构件 ----------
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let down = null;
canvas.addEventListener('pointerdown', e => down = [e.clientX, e.clientY]);
canvas.addEventListener('pointerup', e => {
  if (dp?.on || show) return;
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  ptr.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
  ray.setFromCamera(ptr, camera);
  if (cams && cams.onClick(ray)) return;
  const hit = ray.intersectObjects(meshes, false)[0];
  select(hit ? hit.object : null);
});

function select(o) {
  selected = o;
  applyMode(mode);
  const info = document.getElementById('info');
  if (!o) { info.style.display = 'none'; return; }
  const b = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
  const path = [];
  for (let p = o.parent; p && p !== model; p = p.parent) if (p.name) path.unshift(p.name);
  info.innerHTML = `<b>${o.name || '未命名构件'}</b>` +
    (path.length ? `<div><span class="k">所属组</span> ${path.join(' / ')}</div>` : '') +
    `<div><span class="k">宽×深×高</span> ${b.x.toFixed(2)} × ${b.z.toFixed(2)} × ${b.y.toFixed(2)} m</div>` +
    `<div class="hint">点击空白处取消选择</div>`;
  info.style.display = 'block';
}

// ---------- 升降屏 ----------
// 升降屏由配置 lifts 提供（按 Max 里的构件名）；高度指屏幕底边离正下方台面的距离，初始为模型里的位置
//   不填 rise/top：只能从当前位置往下降，最低落到台面
//   rise：从当前位置最多再升多少米；top：底边最高到多少米
const LIFTS = CFG.lifts;
const LIFT_SPEED = 1;  // m/s
const lifts = [];

function setupLifts() {
  const panel = document.querySelector('#lifts .sec-body');
  for (const { name, label, rise, top } of LIFTS) {
    const o = model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));  // FBX 加载时名字里的空格等会被替换
    if (!o) continue;
    const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
    // 从底边略上方往下找台面（排除屏幕自身）；底边略插进台面时按 0 算
    walkRay.set(new THREE.Vector3(c.x, b.min.y + 0.3, c.z), down3);
    walkRay.far = Infinity;
    const hit = walkRay.intersectObjects(meshes.filter(m => m !== o), false)[0];
    const h0 = Math.max(0, b.min.y - (hit ? hit.point.y : 0));
    const min = rise || top ? h0 : 0, max = top ?? h0 + (rise || 0);
    const L = { o, base: o.getWorldPosition(new THREE.Vector3()), h0, h: h0, target: h0 };
    const row = document.createElement('div');
    row.className = 'lift';
    row.innerHTML = `<div class="lift-head"><span>${label}</span><span class="k">离台面 <b>${h0.toFixed(1)}</b> m</span></div>
      <div class="lift-ctl"><button data-to="${min}">降到底</button><input type="range" min="${min}" max="${max}" step="any" value="${h0}"><button data-to="${max}">升到顶</button></div>`;
    L.readout = row.querySelector('b');
    L.slider = row.querySelector('input');
    L.slider.oninput = () => L.target = +L.slider.value;
    row.querySelectorAll('button').forEach(btn => btn.onclick = () => L.slider.value = L.target = +btn.dataset.to);
    panel.append(row);
    lifts.push(L);
  }
  document.getElementById('lifts').hidden = !lifts.length;
}

// 机械面板：每个会动的部件一行，滑块 0 = 起点（第一帧）、1 = 终点（最后一帧）
function setupMachinesPanel() {
  const sec = document.getElementById('machines'), body = sec.querySelector('.sec-body');
  if (!machines.list.length) return;
  sec.hidden = false;
  body.innerHTML = '<div class="lg-all"><button data-all="0">全部到起点</button><button data-all="1">全部到终点</button></div>';
  for (const m of machines.list) {
    const row = document.createElement('div');
    row.className = 'lift';
    row.innerHTML = `<div class="lift-head"><span></span><span class="k">${KINDS[m.kind]} · ${m.detail}</span></div>
      <div class="lift-ctl"><button data-to="0">起点</button><input type="range" min="0" max="1" step="any" value="0"><button data-to="1">终点</button></div>`;
    row.querySelector('span').textContent = m.name.replace(/_/g, ' ');
    const slider = row.querySelector('input');
    slider.oninput = () => machines.set(m, +slider.value);
    slider.onchange = () => { lights?.fit(); captureReflection(); };
    m.onMove = t => slider.value = t;
    row.querySelectorAll('[data-to]').forEach(b => b.onclick = () => machines.go(m, +b.dataset.to));
    body.append(row);
  }
  body.querySelectorAll('[data-all]').forEach(b => b.onclick = () => machines.list.forEach(m => machines.go(m, +b.dataset.all)));
}

// ---------- 灯光分组开关 ----------
function setupLights({ groups, setOn, setBeam, setStars, setLevel }) {
  const sec = document.getElementById('lights'), body = sec.querySelector('.sec-body');
  if (!groups.length) return;
  sec.hidden = false;
  const rows = groups.map(g => {
    const row = document.createElement('div');
    row.className = 'lg-row';
    const b = document.createElement('button');
    b.className = 'lg on';
    b.innerHTML = `<span>${g.name}</span><span class="k">${g.count} 台 ${g.types}</span>`;
    b.onclick = () => { setOn(g, !g.on); b.classList.toggle('on', g.on); dimAmbient(groups); };
    row.append(b);
    if (g.beamSwitch) {
      const beam = document.createElement('button');
      beam.className = 'lg-beam';
      beam.textContent = '光束';
      beam.onclick = () => { setBeam(g, !g.beamOn); beam.classList.toggle('on', g.beamOn); };
      row.append(beam);
    }
    body.append(row);
    return [g, b];
  });
  body.querySelectorAll('[data-all]').forEach(btn => btn.onclick = () => {
    rows.forEach(([g, b]) => { setOn(g, btn.dataset.all === '1'); b.classList.toggle('on', g.on); });
    dimAmbient(groups);
  });
  document.getElementById('level').oninput = e => setLevel(+e.target.value);
  const stars = document.getElementById('stars');
  stars.onclick = () => setStars(stars.classList.toggle('on'));
  dimAmbient(groups);
}

// 有灯开着时把环境光压暗，让灯和屏幕更突出（屏幕自发光，不受影响）
function dimAmbient(groups) {
  const lit = groups.some(g => g.on);
  hemi.intensity = lit ? 0.35 : 1.2;
  sun.intensity = lit ? 0.7 : 2.2;
  scene.environmentIntensity = lit ? 0.15 : 0.5;
  captureReflection();
}

// 侧栏分区可折叠；手机上默认收起，免得挡住画面
document.querySelectorAll('#side section').forEach(sec => {
  sec.querySelector('.sec-head').onclick = () => sec.classList.toggle('closed');
  if (matchMedia('(max-width:600px)').matches) sec.classList.add('closed');
});

let lights = null, cams = null, dp = null, show = null, machines = null;
// 新机位默认对准舞台前区：屏幕中心往观众方向 6 米、台面以上 1.5 米（人胸口高度）；没有屏幕就用模型中心
function stageFront() {
  const b = new THREE.Box3();
  meshes.forEach(o => o.userData.screenMat && b.expandByObject(o));
  const c = b.isEmpty() ? center.clone() : b.getCenter(new THREE.Vector3()).addScaledVector(audienceDir(), 6);
  return c.setY(floorAt(c.x, c.z, 3) + 1.5);
}
function updateLifts(dt) {
  for (const L of lifts) {
    if (L.h === L.target) continue;
    const d = L.target - L.h, step = LIFT_SPEED * dt;
    L.h = Math.abs(d) <= step ? L.target : L.h + Math.sign(d) * step;
    const p = L.base.clone();
    p.y += L.h - L.h0;
    L.o.position.copy(L.o.parent.worldToLocal(p));
    L.readout.textContent = L.h.toFixed(1);
    if (L.h === L.target && lights) {  // 升降屏停下后重算光束落点
      L.o.updateMatrixWorld(true);
      lights.fit();
      captureReflection();
    }
  }
}

// ---------- 人物走动（第一人称） ----------
// 人物身高 1.75m：站姿眼高 1.63m，坐姿眼高为座面以上 0.8m
const EYE = 1.63, SIT_EYE = 0.8, STEP = 0.6, RADIUS = 0.35, SPEED = 8.8, RUN = 2;
const GRAVITY = 20, JUMP = 6;  // 起跳约 0.9m
const SIT_RANGE = 4;  // 观众席中间过道约 6m 宽，站在过道中也能坐到两侧座位
// 座位：按配置 seats 的高度、长边范围识别（默认对应观众席长凳）
const isSeat = b => {
  const s = b.getSize(new THREE.Vector3()), { minHeight, maxHeight, maxLength } = CFG.seats;
  return s.y > minHeight && s.y < maxHeight && Math.max(s.x, s.z) <= maxLength;
};
const walk = { on: false, yaw: 0, pitch: 0, feet: 0, vy: 0, seat: null, keys: new Set(), joy: new THREE.Vector2(), look: null };
const walkBtn = document.getElementById('walk');
walkBtn.onclick = () => setWalk(!walk.on);

function setWalk(on) {
  walk.on = on;
  walkBtn.classList.toggle('on', on);
  document.body.classList.toggle('walking', on);
  controls.enabled = !on;
  fly.clear();
  tween = null;
  currentView = null;
  document.querySelectorAll('#views button').forEach(b => b.classList.remove('on'));
  if (on) {
    // 从橙色小人的位置出发，面朝舞台
    const p = person.position;
    walk.feet = floorAt(p.x, p.z, p.y + 1);
    camera.position.set(p.x, walk.feet + EYE, p.z);
    walk.yaw = Math.atan2(p.x - center.x, p.z - center.z);
    walk.pitch = 0.05;
    walk.vy = 0;
    walk.seat = null;
    person.visible = false;
  } else {
    person.visible = document.getElementById('person').classList.contains('on');
    walk.keys.clear();
    if (walk.seat) standUp();
  }
}

const down3 = new THREE.Vector3(0, -1, 0), walkRay = new THREE.Raycaster();
// (x,z) 处、高度 fromY 以下最近的落脚面；没有构件时就是地面 0
function floorAt(x, z, fromY) {
  walkRay.set(new THREE.Vector3(x, fromY, z), down3);
  walkRay.far = Infinity;
  const hit = walkRay.intersectObjects(meshes, false)[0];
  return hit ? hit.point.y : 0;
}
// 沿 d 方向移动是否会撞墙：在膝盖以上和头部两个高度各打一条水平射线
function blocked(d) {
  const len = d.length();
  if (!len) return false;
  walkRay.far = len + RADIUS;
  for (const h of [STEP + 0.05, EYE - 0.1]) {
    walkRay.set(camera.position.clone().setY(walk.feet + h), d.clone().divideScalar(len));
    if (walkRay.intersectObjects(meshes, false).length) return true;
  }
  return false;
}

function jump() {
  if (walk.seat) return standUp();
  if (walk.vy === 0 && grounded) walk.vy = JUMP;
}

// 坐到身边 SIT_RANGE 内最近的座位上（座面上离自己最近的点），面朝舞台
function sitDown() {
  if (walk.seat) return standUp();
  const me = camera.position, best = { d: SIT_RANGE, b: null, p: null };
  for (const o of meshes) {
    const b = o.userData.box;
    if (!b || !isSeat(b) || o.userData.noSeat) continue;
    const p = new THREE.Vector3(THREE.MathUtils.clamp(me.x, b.min.x + 0.25, b.max.x - 0.25), b.max.y,
                                THREE.MathUtils.clamp(me.z, b.min.z + 0.2, b.max.z - 0.2));
    const d = Math.hypot(p.x - me.x, p.z - me.z);
    if (d < best.d) Object.assign(best, { d, b, p });
  }
  if (!best.b) return flash(`附近 ${SIT_RANGE} 米内没有座位`);
  walk.seat = best.p;
  walk.stand = { pos: camera.position.clone(), feet: walk.feet };  // 站起来回到原地
  walk.vy = 0;
  camera.position.set(best.p.x, best.p.y + SIT_EYE, best.p.z);
  walk.yaw = Math.atan2(best.p.x - center.x, best.p.z - center.z);
  walk.pitch = 0.05;
  sitBtn.classList.add('on');
  sitBtn.textContent = '站起';
}
function standUp() {
  camera.position.copy(walk.stand.pos);
  walk.feet = walk.stand.feet;
  walk.seat = null;
  sitBtn.classList.remove('on');
  sitBtn.textContent = '坐下';
}

let grounded = true;
function updateWalk(dt) {
  const k = walk.keys;
  const ix = (k.has('KeyD') || k.has('ArrowRight')) - (k.has('KeyA') || k.has('ArrowLeft')) + walk.joy.x;
  const iz = (k.has('KeyW') || k.has('ArrowUp')) - (k.has('KeyS') || k.has('ArrowDown')) + walk.joy.y;
  if (walk.seat) {
    if (ix || iz) standUp();  // 坐着时一动就站起来
    else return camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
  }
  const speed = SPEED * (k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : 1) * dt;
  const sin = Math.sin(walk.yaw), cos = Math.cos(walk.yaw);
  const move = new THREE.Vector3(ix * cos - iz * sin, 0, -ix * sin - iz * cos);
  if (move.lengthSq() > 1) move.normalize();
  move.multiplyScalar(speed);
  // 撞墙时沿墙滑动：整体走不了就分别试 x、z 分量
  if (blocked(move)) {
    const mx = new THREE.Vector3(move.x, 0, 0), mz = new THREE.Vector3(0, 0, move.z);
    move.copy(!blocked(mx) ? mx : !blocked(mz) ? mz : new THREE.Vector3());
  }
  camera.position.add(move);
  // 能直接迈上 STEP 以内的台阶；离开地面后受重力下落
  const floor = floorAt(camera.position.x, camera.position.z, walk.feet + STEP);
  if (walk.vy !== 0 || walk.feet > floor + 0.05) {
    walk.vy -= GRAVITY * dt;
    walk.feet += walk.vy * dt;
    if (walk.feet <= floor) { walk.feet = floor; walk.vy = 0; }
  } else walk.feet = floor;
  grounded = walk.vy === 0;
  camera.position.y = walk.feet + EYE;
  camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
}

// ---------- 鸟瞰飞行（非走动时 WASD 平移、E/Q 升降，镜头和旋转中心一起移动） ----------
const FLY_SPEED = 12, FLY_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'];
const fly = new Set();
addEventListener('keydown', e => {
  if (walk.on || dp?.on || show || !FLY_KEYS.includes(e.code) || /INPUT|SELECT/.test(e.target.tagName)) return;
  fly.add(e.code);
  tween = null;
  if (currentView) {
    currentView = null;
    document.querySelectorAll('#views button').forEach(b => b.classList.remove('on'));
  }
});
addEventListener('keyup', e => fly.delete(e.code));
addEventListener('blur', () => fly.clear());

function updateFly(dt) {
  const k = c => fly.has(c) ? 1 : 0;
  const fwd = k('KeyW') - k('KeyS'), right = k('KeyD') - k('KeyA'), up = k('KeyE') - k('KeyQ');
  if (!fwd && !right && !up) return;
  const f = new THREE.Vector3();
  camera.getWorldDirection(f);
  f.y = 0;
  if (f.lengthSq() < 1e-6) f.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0);  // 正俯视时用画面上方
  f.normalize();
  const r = new THREE.Vector3(-f.z, 0, f.x);
  const d = f.multiplyScalar(fwd).add(r.multiplyScalar(right)).setY(up);
  if (d.lengthSq() > 1) d.normalize();
  d.multiplyScalar(FLY_SPEED * (fly.has('ShiftLeft') || fly.has('ShiftRight') ? 3 : 1) * dt);
  // 不钻到地面以下
  if (camera.position.y + d.y < 0.5) d.y = 0.5 - camera.position.y;
  camera.position.add(d);
  controls.target.add(d);
}

addEventListener('keydown', e => {
  if (!walk.on) return;
  if (e.code === 'Escape') return setWalk(false);
  if (e.code === 'Space') { e.preventDefault(); return jump(); }
  if (e.code === 'KeyC') return sitDown();
  walk.keys.add(e.code);
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => walk.keys.delete(e.code));
addEventListener('blur', () => walk.keys.clear());

// 拖动画面转向（鼠标、单指通用）
canvas.addEventListener('pointerdown', e => {
  if (walk.on && walk.look === null) walk.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', e => {
  const l = walk.look;
  if (!walk.on || !l || l.id !== e.pointerId) return;
  walk.yaw -= (e.clientX - l.x) * 0.004;
  walk.pitch = THREE.MathUtils.clamp(walk.pitch - (e.clientY - l.y) * 0.004, -1.3, 1.3);
  l.x = e.clientX; l.y = e.clientY;
});
const endLook = e => { if (walk.look && walk.look.id === e.pointerId) walk.look = null; };
canvas.addEventListener('pointerup', endLook);
canvas.addEventListener('pointercancel', endLook);

const sitBtn = document.getElementById('sit');
sitBtn.onclick = sitDown;
document.getElementById('jump').onclick = jump;

const toast = document.getElementById('toast');
let toastTimer;
function flash(msg) {
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.style.display = 'none', 1800);
}

// 虚拟摇杆（触屏）
const joy = document.getElementById('joy'), knob = joy.firstElementChild;
let joyId = null;
const joyMove = e => {
  const r = joy.getBoundingClientRect(), R = r.width / 2;
  const v = new THREE.Vector2(e.clientX - r.left - R, e.clientY - r.top - R);
  if (v.length() > R) v.setLength(R);
  knob.style.transform = `translate(${v.x}px,${v.y}px)`;
  walk.joy.set(v.x / R, -v.y / R);
};
joy.addEventListener('pointerdown', e => { joyId = e.pointerId; joy.setPointerCapture(joyId); joyMove(e); });
joy.addEventListener('pointermove', e => e.pointerId === joyId && joyMove(e));
const joyEnd = e => {
  if (e.pointerId !== joyId) return;
  joyId = null;
  walk.joy.set(0, 0);
  knob.style.transform = '';
};
joy.addEventListener('pointerup', joyEnd);
joy.addEventListener('pointercancel', joyEnd);

// ---------- 渲染循环 ----------
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
let last = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / 0.9);
    const k = ease(tween.t);
    camera.position.lerpVectors(tween.p0, tween.pos, k);
    controls.target.lerpVectors(tween.t0, tween.target, k);
    if (tween.t === 1) tween = null;
  }
  updateLifts(dt);
  machines?.update(dt);
  cams?.tick(dt);
  if (walk.on) updateWalk(dt);
  else {
    updateFly(dt);
    controls.update();
  }
  show?.tick(dt);
  if (show) show.render();
  else if (dp?.on) dp.render();
  else renderer.render(scene, camera);
  cams?.renderOverlay(dp?.on ? dp.camera : camera);
  if (dp?.on) cams?.renderPip();  // 机位窗口只在导摄模式显示
});
