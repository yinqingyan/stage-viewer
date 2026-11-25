// 设计师用的生成器：选模型 → 看一眼认出的灯具桌椅 → 生成单文件 html 并下载（项目名、观众席都有默认值）。
// 全部在浏览器里完成，模型不离开设计师的电脑。
// VIEWER（查看器模板，含注入标记）由 build.mjs 在本脚本之前定义。
// 中英两种界面：页面上固定的文字查 GEN_WORDS，代码里拼的句子用 L(中文, English)；切换语言时重画这些部分。
import { Fbx, readGraph, detect, libraryEntry, roleOf, makeConfig, strip, textures, SPEAKERS } from './fbx.js';
import LIB from '../skill/stage-viewer/scripts/library.json';
import { mountExplainer } from './explainer.js';
import { guess, FIXTURES, fixtureParams } from './guess.js';
import { lang, setLang, L, translatePage, addWords } from './i18n.js';

const MARK = '<script>/*__STAGE__*/</script>';
const MAIL = '<a href="mailto:stageviewer.app@outlook.com">stageviewer.app@outlook.com</a>';
const ROLES = () => [
  ['', L('不处理', 'Leave as is')],
  [L('灯具', 'Lights'), [['beam', L('光束灯', 'Beam')], ['wash', L('染色灯', 'Wash')], ['strobe', L('频闪', 'Strobe')], ['bar', L('灯条', 'LED bar')]]],
  [L('桌椅', 'Furniture'), [['chair', L('椅子', 'Chair')], ['stool', L('凳子', 'Stool')], ['table', L('桌子', 'Table')]]],
  [L('音响', 'Speakers'), [['speaker', L('线阵音箱', 'Line array')], ['sub', L('超低音箱', 'Subwoofer')]]],
];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const user = s => `<span translate="no">${esc(s)}</span>`;  // 设计师自己的名字（文件名、组名），不翻译
const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';
const tick = () => new Promise(r => setTimeout(r, 30));  // 让进度文字先画出来
const face = kind => $('faces').content.querySelector('.' + kind).outerHTML;  // 撒库拉表情：idea 成功、boom 失败

let file = null, bytes = null, format = '', fx = null, graph = null, kinds = [], texInfo = [];
let stage1 = null;  // 第 1 步显示什么：'reading' | 'analyzing' | 'badType' | 'tooBig' | 'ready'（+ 附加提示）

// ---------- 语言 ----------
const LANG_KEY = 'stage-generator-lang';
let saved = null;
try { saved = localStorage.getItem(LANG_KEY); } catch {}
setLang(new URLSearchParams(location.search).get('lang') || saved || (navigator.language.startsWith('zh') ? 'zh' : 'en'));
addWords({
  // 顶栏、头图
  '舞美三维网页生成器': 'Stage Viewer Generator', '模型准备说明': 'Model guide', '关闭': 'Close',
  '把 3ds Max、C4D、SketchUp、Blender 等软件做的舞美模型变成一个 html 文件。双击就能在电脑、手机上三维浏览，走进观众席看舞台，发微信、邮件即可分享。':
    'Turn a stage model from 3ds Max, C4D, SketchUp, Blender or similar into a single html file. Double-click to explore it in 3D on a computer or phone, walk into the audience and look at the stage, and share it by email or chat.',
  '模型只在你的电脑上处理，不会上传到任何地方': 'Your model is processed on your own computer and never uploaded',
  '全程在浏览器里完成，免费开源': 'Everything runs in your browser — free and open source',
  '第一次用？先看导出要求': 'First time? Read the export checklist',
  // 导出前
  '导出模型前，做对这 4 件事': 'Four things to get right before you export',
  '做对了，生成的网页才有画面、认得出灯、会动。': 'Get these right and your stage shows its screens, recognises its lights and moves.',
  '勾选「嵌入的媒体」': 'Tick “Embed Media”', '屏幕画面和贴图才会显示，不然是白模。': 'Otherwise screen content and textures are missing and you get a plain white model.',
  '格式选「二进制」，单位厘米或米': 'Choose “Binary”, units in centimeters or meters',
  'ASCII 格式认不出灯具；单位错了人会像蚂蚁或巨人。': 'ASCII files cannot be scanned for lights; with wrong units people look like ants or giants.',
  '每台灯一个组，同款灯用复制': 'One group per fixture, copy the same model',
  '最外层的组名就是网页上的灯光开关名，比如「天排光束」「舞台两侧」。': 'The outermost group name becomes the light switch on the page, e.g. “Top beams” or “Stage sides”.',
  '会动的机械：编成组，打关键帧': 'Moving machinery: group it and keyframe it', '测试版': 'Beta',
  '第 0 帧放起点、最后一帧放终点，导出时勾「动画」和「烘焙动画」。网页里会多一个机械面板，每个部件一个滑块。':
    'Frame 0 at the start, the last frame at the end of travel; tick “Animation” and “Bake Animation” when exporting. The page gets a machinery panel with a slider per part.',
  '看 30 秒动画': 'Watch the 30-second animation', '完整的模型准备说明 →': 'Full model preparation guide →',
  '30 秒动画，讲的就是上面 4 件事': 'The 30-second animation covers the same 4 points',
  // 三步
  '三步，做出你的三维舞台': 'Three steps to your 3D stage',
  '选择模型': 'Choose your model', '把模型文件拖到这里': 'Drop your model file here', '或点击选择文件': 'or click to choose a file',
  '只在本机读取，不会上传': 'Read locally, never uploaded',
  '看一眼认出的东西': 'Check what was found',
  '模型里重复出现的灯、椅子、音箱都列在下面，用途已经尽量帮你填好。猜的看一眼对不对，没认出的选一下；拿不准就留「不处理」，照原样显示也没问题。':
    'Every repeated light, chair and speaker in the model is listed below with its role filled in as far as possible. Glance at the guesses, pick a role for anything not recognised; if unsure leave it as “Leave as is” and it is shown exactly as modelled.',
  '选了用途会怎样？': 'What does a role do?',
  '已认出': 'Recognised', '自己选用途': 'You pick the role', '不处理': 'Leave as is',
  '：这种东西会换成简单形状（灯口发光、光束、简单桌椅），文件小很多。灯口放在灯具中心、用默认大小，光束方向自动定（地上的灯朝上，天上的灯朝观众席），位置是近似的。':
    ': it is replaced by a simple shape (glowing lens, beam, simple furniture), which makes the file much smaller. The lens sits at the fixture centre with a default size, and the beam is aimed automatically (floor lights point up, overhead lights face the audience), so the position is approximate.',
  '：不是灯具桌椅、或者拿不准的选这个。按模型原样显示，但不发光、没有灯光开关，文件也大一些。': ': for anything that is not a light or furniture, or when unsure. It is shown as modelled, but does not glow, has no light switch, and keeps the file larger.',
  '想让你常用的灯被自动认出？': 'Want your usual fixtures recognised automatically? ',
  '把一台灯的模型发给撒库拉（联系方式在页面最下面），我们加进库里。': 'Send one fixture model to us (contact at the bottom of the page) and we will add it to the library.',
  '生成网页': 'Generate', '得到一个 html 文件，双击就能打开，发给导演和甲方。下面两项都已填好，不改也行。': 'You get one html file. Double-click to open it, then send it to the director or client. Both settings below are already filled in; change them only if you want to.',
  '项目名称': 'Project name', '网页标题和文件名': 'Page title and file name',
  '比如：2027 春季发布会': 'e.g. Spring Launch 2027',
  '观众席在舞台的哪一侧': 'Which side is the audience on?',
  '按建模软件里的前、后、左、右视图。打开后「观众席」视角要是看到舞台背面，换一侧重新生成。':
    'As in your modelling software’s front / back / left / right views. If the audience view shows the back of the stage, pick another side and generate again.',
  '前': 'Front', '后': 'Back', '左': 'Left', '右': 'Right',
  '前视图一侧': 'Front view side', '后视图一侧': 'Back view side', '左视图一侧': 'Left view side', '右视图一侧': 'Right view side',
  '生成的舞台太大或太小？': 'Stage too big or too small?', '模型单位': 'Model units',
  '一般不用改。打开网页后右上角会写舞台的长宽高，和实际差了 10 倍、100 倍、1000 倍，就在这里选建模时用的单位，再生成一次。':
    'Usually leave this alone. The page shows the stage size in the top-right corner; if it is off by 10×, 100× or 1000×, pick the units you modelled in and generate again.',
  '自动（按文件里记的）': 'Automatic (from the file)', '毫米': 'Millimetres', '厘米': 'Centimetres', '米': 'Metres', '英寸': 'Inches',
  '将导出：': 'Will save as:', '生成并下载': 'Generate and download',
  // 页脚
  '免费开源': 'Free and open source',
  '有需求和建议？认识撒库拉的直接微信，不认识的发邮件：': 'Bugs or feature requests? Contact: ',
});
translatePage();
const langBtn = $('langBtn');
langBtn.onclick = () => {
  setLang(lang === 'en' ? 'zh' : 'en');
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
  applyLang(true);
};
// switched：真的换了语言，说明动画要按新语言重搭
// 「已认出」说明里的型号库数量按 library.json 实际收录的显示，库变大不用改字
function renderLibNote() {
  const n = LIB.fixtures.length, p = LIB.props.length;
  $('libNote').textContent = L(`：型号库里有的，参数准确，不用管。型号库还在扩充，目前收录 ${n} 款灯、${p} 款桌椅，所以多数型号要你自己选。`,
    `: it is in our library, so the settings are exact — nothing to do. The library is still growing (${n} lights and ${p} furniture models so far), so most types need you to pick.`);
}
function applyLang(switched) {
  langBtn.textContent = lang === 'en' ? '中文' : 'English';
  document.title = lang === 'en' ? 'Stage Viewer Generator' : '舞美三维网页生成器';
  translatePage();
  renderLibNote();
  renderInfo();
  renderKinds();
  showName();
  if (switched || !explainer) mountVideo();
}
// 第 3 步的「能不能直接生成」：没认出的、猜的都在这里再说一遍，设计师不用回头翻第 2 步
function renderReady() {
  const box = $('ready');
  if (!stage1 || stage1.state !== 'ready') { box.innerHTML = ''; return; }
  const main = kinds.filter(k => !Object.keys(k.contains).length);
  const ask = main.filter(k => stateOf(k) === 'ask' && !k.role), guessed = main.filter(k => k.guessed && !k.known);
  const names = list => list.slice(0, 3).map(k => user(k.name)).join(L('、', ', ')) + (list.length > 3 ? L(` 等 ${list.length} 种`, ` and ${list.length - 3} more`) : '');
  if (!fx || !main.length) { box.innerHTML = `<div class="msg ok">✓ ${L('可以生成了。', 'Ready to generate.')}</div>`; return; }
  if (ask.length) box.innerHTML = `<div class="msg warn">${L(`还有 ${ask.length} 种没选用途：`, `${ask.length} type(s) still have no role: `)}<b>${names(ask)}</b>${L('。不选也能生成，它们会照原样显示。', '. You can generate anyway; they are shown as modelled.')}</div>`;
  else if (guessed.length) box.innerHTML = `<div class="msg ok">✓ ${L(`可以生成了。有 ${guessed.length} 种是按名字猜的（`, `Ready to generate. ${guessed.length} type(s) were guessed from names (`)}<b>${names(guessed)}</b>${L('），猜错了回第 2 步改。', '); go back to step 2 if a guess is wrong.')}</div>`;
  else box.innerHTML = `<div class="msg ok">✓ ${L('全部认出，可以生成了。', 'Everything recognised. Ready to generate.')}</div>`;
}

// ---------- 30 秒说明动画：收在「导出前」一节里，点「看 30 秒动画」才展开并播放；下面给对应语言的 MP4 下载 ----------
let explainer = null;
function mountVideo() {
  explainer?.stop();
  explainer = mountExplainer($('explainHost'));
  $('videoDl').href = `video/guide-${lang}.mp4`;
  $('videoDl').textContent = L('⬇ 下载视频（MP4）', '⬇ Download video (MP4)');
  if (location.hash === '#explainer') { $('video').hidden = false; window.EXPLAINER = explainer; }  // 录制视频用：展开并暴露逐帧渲染
}
$('openExplain').onclick = () => {
  const v = $('video');
  const first = v.hidden;
  v.hidden = false;  // 动画自己有 ResizeObserver，展开后会按容器宽度重排
  v.scrollIntoView({ behavior: 'smooth', block: first ? 'nearest' : 'center' });
  explainer.play();
};

// ---------- 说明 ----------
document.querySelectorAll('[data-guide]').forEach(b => b.onclick = () => $('guide').showModal());
$('closeGuide').onclick = () => $('guide').close();
$('guide').onclick = e => e.target === $('guide') && $('guide').close();

// ---------- 1. 选择模型 ----------
const drop = $('drop');
$('file').onchange = e => e.target.files[0] && load(e.target.files[0]);
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && load(e.dataTransfer.files[0]); };

function stepState(n, state) {  // state: 'off' | 'on' | 'done'
  const s = $('s' + n);
  s.classList.toggle('off', state === 'off');
  s.classList.toggle('done', state === 'done');
}

function renderInfo() {
  const info = $('fileInfo');
  if (!stage1 || !file) { info.innerHTML = ''; return; }
  const name = `${user(file.name)}（${mb(file.size)}）`;
  const { state, readErr } = stage1;
  if (state === 'badType') { info.innerHTML = `<div class="msg bad">${L('支持 .fbx、.glb、.obj、.3ds、.dae。其他格式（.max、.c4d、.skp、.3dm）请先在建模软件里导出成 FBX 或 GLB。', 'Supported: .fbx, .glb, .obj, .3ds, .dae. Export other formats (.max, .c4d, .skp, .3dm) to FBX or GLB first.')}</div>`; return; }
  if (state === 'tooBig') { info.innerHTML = `<div class="msg bad">${L('文件太大，浏览器读不进来。请换用电脑上的 Chrome / Edge，或先在 3ds Max 里删掉用不到的部分。', 'The file is too large for the browser. Try Chrome or Edge on a computer, or remove unused parts in 3ds Max first.')}</div>`; return; }
  if (state === 'reading') { info.innerHTML = `<div class="msg">${name}${L('：正在读取…', ': reading…')}</div>`; return; }
  if (state === 'analyzing') { info.innerHTML = `<div class="msg">${name}${L('：正在分析灯具和桌椅…', ': looking for lights and furniture…')}</div>`; return; }
  let note = '';
  if (format === 'glb') note = `<div class="msg warn">${L('GLB 模型不做灯具识别，会原样生成。', 'GLB models are not scanned for lights; they are used as-is.')}</div>`;
  // OBJ、3DS、DAE：贴图是单独的文件，拖进来的只有模型本身；也不记单位（查看器按舞台大小自动判断）
  else if (format !== 'fbx') note = `<div class="msg warn">${L(`${format.toUpperCase()} 模型不做灯具识别，会原样生成。这种格式的贴图是单独的文件，带不进来，屏幕画面会是白的；要贴图请导出成 FBX（勾选嵌入贴图）或 GLB。`,
    `${format.toUpperCase()} models are not scanned for lights and are used as-is. Their textures are separate files and are not included, so screens will be white; export FBX (with embedded textures) or GLB if you need them.`)}</div>`;
  else if (readErr !== undefined) note = `<div class="msg warn">${L(`这个 FBX 不是二进制格式，或者读不懂（${esc(readErr)}），不能识别灯具，会原样生成。3ds Max 导出时「文件格式」选「二进制」可以解决。`,
    `This FBX is not binary or could not be read (${esc(readErr)}), so lights cannot be detected and it is used as-is. Export with File format “Binary” in 3ds Max to fix this.`)}</div>`;
  // 贴图没嵌入：网页里会是白色，提醒重新导出（不拦着，可以先生成白模版）
  const missing = texInfo.filter(t => !t.embedded).map(t => t.file);
  const list = `${missing.slice(0, 6).map(user).join(L('、', ', '))}${missing.length > 6 ? L(' 等', ' …') : ''}`;
  const texNote = !texInfo.length || !missing.length ? '' : `<div class="msg warn"><b>${L(`⚠ 有 ${missing.length} 张贴图没有嵌入：`, `⚠ ${missing.length} texture(s) not embedded: `)}</b>${list}<br>
     ${L('生成的网页里，用到这些贴图的地方会是白色或纯色（比如屏幕画面）。导出 FBX 时勾选嵌入贴图（3ds Max 里叫「嵌入的媒体」）后重新导出就好；也可以先继续生成看看。',
        'Anything using them (screen content, for example) will show white or a flat colour. Re-export the FBX with embedded textures (“Embed Media” in 3ds Max) — or carry on and generate anyway.')}</div>`;
  const texOk = texInfo.length && !missing.length ? L(` · ${texInfo.length} 张贴图已全部嵌入`, ` · all ${texInfo.length} texture(s) embedded`) : '';
  // 模型大：先靠第 2 步精简灯具桌椅，还大就看说明第六节（网页大小约等于精简后的 FBX）
  const big = file.size > 100 * 1024 * 1024 ? `<div class="msg warn">${L(`模型有 ${mb(file.size)}，生成的网页会比较大，手机可能打不开。先在第 2 步给灯具桌椅选好用途，通常能小很多；还嫌大，看「模型准备说明」第六节「模型太大怎么办」。`,
    `This model is ${mb(file.size)}, so the page will be large and may not open on phones. Give lights and furniture a role in step 2 — that usually shrinks it a lot. Still too big? See section 6, “If the model is too big”, in the model preparation guide.`)}</div>` : '';
  info.innerHTML = `<div class="msg ok">✓ ${name}${texOk}</div>` + note + texNote + big;
}

async function load(f) {
  file = f;
  format = f.name.toLowerCase().split('.').pop();
  [2, 3].forEach(n => stepState(n, 'off'));
  $('result').innerHTML = $('progress').textContent = $('ready').innerHTML = '';
  $('kinds').classList.remove('adv');
  delete $('kinds').dataset.knownOpen;
  if (!['fbx', 'glb', 'obj', '3ds', 'dae'].includes(format)) { stage1 = { state: 'badType' }; renderInfo(); return; }
  stage1 = { state: 'reading' };
  renderInfo();
  await tick();
  try {
    bytes = new Uint8Array(await f.arrayBuffer());
  } catch {
    stage1 = { state: 'tooBig' };
    renderInfo();
    return;
  }
  fx = graph = null;
  kinds = [];
  texInfo = [];
  stage1 = { state: 'ready' };
  if (format === 'fbx') {
    stage1.state = 'analyzing';
    renderInfo();
    await tick();
    stage1.state = 'ready';
    try {
      fx = new Fbx(bytes);
      graph = readGraph(fx);
      kinds = detect(fx, graph);
      for (const k of kinds) {
        k.role = k.known = roleOf(libraryEntry(k, LIB));
        k.model = null;
        // 库里没有的，按名字猜：先看它自己的名字，再看所在的组名（数量多的先）。「整体」不猜，免得把整排桁架当成灯
        if (k.known || Object.keys(k.contains).length) continue;
        const g = guess([k.sample, k.name, ...Object.entries(k.groups).sort((a, b) => b[1] - a[1]).map(([n]) => n)]);
        if (g) Object.assign(k, { role: g.role, guessed: g.word, model: g.fixture });
      }
      texInfo = textures(fx);
    } catch (e) {
      fx = graph = null;
      stage1.readErr = e.message;
    }
  }
  renderInfo();
  if (!$('title').value) $('title').value = f.name.replace(/\.[^.]+$/, '');
  showName();
  stepState(1, 'done');
  stepState(3, 'on');
  renderKinds();  // 第 2 步没什么要看的（全认出、没找到、GLB）就直接标成完成
  // 拖放区在首屏，载入后带着往下走到第 2 步
  setTimeout(() => $('s2').scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
}

// ---------- 2. 看一眼认出的东西 ----------
function roleSelect(k) {
  const opts = ROLES().map(([v, l]) => Array.isArray(l)
    ? `<optgroup label="${v}">${l.map(([v2, l2]) => `<option value="${v2}"${k.role === v2 ? ' selected' : ''}>${l2}</option>`).join('')}</optgroup>`
    : `<option value="${v}"${k.role === v ? ' selected' : ''}>${l}</option>`).join('');
  return `<select data-k="${k.id}" class="${k.role ? 'set' : ''}">${opts}</select>${modelSelect(k)}`;
}
// 没认出的灯选了用途后，可以再选具体型号：按真实规格画灯口大小和光束角（docs/fixtures-reference.json）
const LIGHT_ROLES = ['beam', 'wash', 'strobe', 'bar'];
function modelSelect(k) {
  if (k.known || !LIGHT_ROLES.includes(k.role)) return '';
  const list = FIXTURES.filter(f => f.role === k.role), cn = b => /[\u4e00-\u9fff]/.test(b);
  // 中文界面国产品牌（品牌名带中文的）排前面，英文界面国际品牌排前面
  const brands = [...new Set(list.map(f => f.brand))].sort((a, b) => (cn(b) - cn(a)) * (lang === 'en' ? -1 : 1));
  const opts = brands.map(b => `<optgroup label="${esc(b)}">${list.filter(f => f.brand === b).map(f =>
    `<option value="${f.i}"${k.model === f.i ? ' selected' : ''}>${esc(f.model)}</option>`).join('')}</optgroup>`).join('');
  return `<select data-m="${k.id}" class="model ${k.model != null ? 'set' : ''}" translate="no"><option value="">${L('通用（默认大小）', 'Generic (default size)')}</option>${opts}</select>`;
}
// 每种东西载入时归一类：ask 没认出（要你选）、guess 按名字猜的（看一眼）、known 已认出（不用管）。
// 归类定了就不变：设计师改用途时行不会跳来跳去
const stateOf = k => k.st ||= k.known ? 'known' : k.guessed ? 'guess' : 'ask';
function row(k) {
  const groups = Object.entries(k.groups).sort((a, b) => b[1] - a[1]);
  const where = groups.slice(0, 3).map(([g, n]) => `${user(g)} ×${n}`).join(L('、', ', '));
  const more = groups.length > 3 ? L(` 等 ${groups.length} 个组`, ` and ${groups.length - 3} more`) : '';
  const unit = Object.keys(k.contains).length;
  const what = unit ? `<div class="k">${L('里面有 ', 'Contains ')}${Object.entries(k.contains).map(([c, n]) => `${n} × ${user(kinds.find(x => x.id === c)?.name || c)}`).join(L('、', ', '))}</div>` : '';
  const tag = k.known ? `<span class="tag">${L('已认出', 'Recognised')}</span>`
    : k.guessed ? `<span class="tag guess">${L('按名字猜：', 'Guessed from name: ')}<span translate="no">${esc(k.guessed)}</span></span>` : '';
  return `<tr data-k="${k.id}" data-state="${stateOf(k)}"><td><b translate="no">${esc(k.name)}</b>${tag}${what}</td>
    <td class="where"><span class="n">${k.count}${L(' 个', '')}</span> · ${where}${more}</td><td class="role">${roleSelect(k)}</td></tr>`;
}
function renderKinds() {
  const box = $('kinds');
  if (!stage1 || stage1.state !== 'ready') { box.innerHTML = ''; return; }
  const main = kinds.filter(k => !Object.keys(k.contains).length), units = kinds.filter(k => Object.keys(k.contains).length);
  // 没什么可看的：一句话，第 2 步直接算完成
  const skip = !fx ? L('这个模型不做灯具识别，直接到第 3 步生成。', 'This model is not scanned for lights; go straight to step 3.')
    : !main.length ? L('没有找到重复出现的灯具或桌椅，模型会原样显示。直接到第 3 步生成。', 'No repeated lights or furniture found; the model is used as-is. Go straight to step 3.') : '';
  if (skip) { box.innerHTML = `<div class="msg ok">✓ ${skip}</div>`; box.classList.remove('adv'); stepState(2, 'done'); renderReady(); return; }
  const ask = main.filter(k => stateOf(k) === 'ask'), guess = main.filter(k => stateOf(k) === 'guess'), known = main.filter(k => stateOf(k) === 'known');
  const left = ask.filter(k => !k.role);  // 没认出、设计师也还没选的
  const n = list => list.reduce((s, k) => s + k.count, 0);
  const sec = (cls, title, list, closed) => list.length ? `<tbody class="${cls}${closed ? ' closed' : ''}"><tr class="sec"><th colspan="3"><i></i>${title}<span>${L(`${list.length} 种，共 ${n(list)} 个`, `${list.length} type(s), ${n(list)} in total`)}</span></th></tr>${list.map(row).join('')}</tbody>` : '';
  const summary = !ask.length && !guess.length ? L('全部认出，不用管。', 'Everything recognised — nothing to do.')
    : L(`找到 ${main.length} 种${known.length ? `，已认出 ${known.length} 种` : ''}${guess.length ? `，按名字猜了 ${guess.length} 种` : ''}${ask.length ? `，${ask.length} 种没认出${left.length < ask.length ? `（已选 ${ask.length - left.length} 种）` : ''}` : ''}。`,
        `Found ${main.length} type(s)${known.length ? `, ${known.length} recognised` : ''}${guess.length ? `, ${guess.length} guessed from names` : ''}${ask.length ? `, ${ask.length} not recognised${left.length < ask.length ? ` (${ask.length - left.length} chosen)` : ''}` : ''}.`);
  const adv = box.classList.contains('adv');
  box.innerHTML = `<div class="msg ${left.length ? 'warn' : 'ok'}">${left.length ? '' : '✓ '}${summary}</div>
    <table class="kinds">
      ${sec('ask', L('没认出，请选用途', 'Not recognised — choose a role'), ask)}
      ${sec('guess', L('按名字猜的，看一眼对不对', 'Guessed from names — check them'), guess)}
      ${sec('known', L('已认出，不用管', 'Recognised — nothing to do'), known, !box.dataset.knownOpen)}
    </table>
    <details class="adv-toggle"${adv ? ' open' : ''}><summary>${L('高级：指定灯具型号、整体（灯架、成套桌椅）', 'Advanced: exact fixture models, whole units (rigs, table sets)')}</summary>
      <div class="units">
        ${main.some(k => !k.known && LIGHT_ROLES.includes(k.role)) ? `<p class="hint">${L('上面每种没认出的灯，用途下面多了一个型号框；选了具体型号，灯口大小和光束角就按真实规格画。', 'Each unrecognised light above now has a model box under its role; pick the exact model and the lens size and beam angle follow its real spec.')}</p>` : ''}
        ${units.length ? `<h4>${L(`整体 ${units.length} 种`, `${units.length} whole unit(s)`)}</h4><p class="hint">${L('一整排灯架、一套桌椅这类，一般留「不处理」。', 'Whole rigs or table sets — usually leave these alone.')}</p>
          <table class="kinds"><tbody>${units.map(row).join('')}</tbody></table>` : `<p class="hint">${L('这个模型里没有「整体」。', 'No whole units in this model.')}</p>`}
      </div></details>`;
  stepState(2, left.length || guess.length ? 'on' : 'done');
  box.querySelector('.adv-toggle').ontoggle = e => box.classList.toggle('adv', e.target.open);
  box.querySelector('tbody.known tr.sec')?.addEventListener('click', () => {
    const tb = box.querySelector('tbody.known');
    tb.classList.toggle('closed');
    box.dataset.knownOpen = tb.classList.contains('closed') ? '' : '1';
  });
  box.querySelectorAll('select[data-k]').forEach(s => s.onchange = () => {
    const k = kinds.find(k => k.id === s.dataset.k);
    k.role = s.value;
    if (k.model != null && FIXTURES[k.model].role !== k.role) k.model = null;  // 换了用途，型号作废
    k.guessed = null;
    renderKinds();  // 型号下拉框跟着用途变，行也会换到对应那一段
  });
  box.querySelectorAll('select[data-m]').forEach(s => s.onchange = () => {
    kinds.find(k => k.id === s.dataset.m).model = s.value === '' ? null : +s.value;
    s.classList.toggle('set', s.value !== '');
  });
  renderReady();
}

// ---------- 3. 生成：项目名称（默认文件名）、观众席 ----------
const projectName = () => $('title').value.trim() || (file ? file.name.replace(/\.[^.]+$/, '') : '');
const fileName = () => projectName().replace(/[\\/:*?"<>|]/g, '_') + '.html';
const showName = () => $('outName').textContent = projectName() ? fileName() : '—';
$('title').oninput = showName;

// ---------- 生成并下载 ----------
function toBase64(blob) {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result.slice(r.result.indexOf(',') + 1));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
}

$('go').onclick = async () => {
  const go = $('go'), prog = $('progress'), say = async t => { prog.textContent += t + '\n'; await tick(); };
  go.disabled = true;
  prog.textContent = '';
  $('result').innerHTML = '';
  try {
    const title = projectName();
    // 生成的网页用设计师当时的界面语言
    const config = { title, lang, audience: document.querySelector('input[name=side]:checked').value };
    if ($('unit').value) config.unit = +$('unit').value;
    let model = new Blob([bytes]), notes = [];
    const chosen = kinds.filter(k => k.role);
    for (const k of chosen) k.extra = !k.known && k.model != null ? fixtureParams(FIXTURES[k.model]) : undefined;
    if (fx && chosen.length) {
      const c = makeConfig(chosen, graph, LIB);
      Object.assign(config, { fixtures: c.fixtures, props: c.props, speakers: c.speakers });
      // 地上的灯朝上、天上的灯朝观众席；默认只亮灯口，每组灯有自己的光束开关（默认关），不然光柱会罩住整个舞台
      if (c.fixtures.length) Object.assign(config, { aim: { floorBelow: 3 }, lightGroups: { '*': { beamSwitch: true } } });
      notes = c.notes;
      // 音响原样保留，只精简灯具和桌椅
      const slim = chosen.filter(k => !SPEAKERS.includes(k.role)), n = slim.reduce((s, k) => s + k.count, 0);
      if (slim.length) {
        await say(L(`精简 ${n} 个灯具和桌椅…`, `Simplifying ${n} lights and furniture…`));
        const r = strip(fx, graph, new Set(slim.flatMap(k => k.ids)));
        model = new Blob(r.parts);
        await say(`  ${mb(bytes.length)} → ${mb(model.size)}`);
      }
    }
    await say(L('压缩…', 'Compressing…'));
    const gz = await new Response(model.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    await say(L('打包成网页…', 'Building the page…'));
    const data = await toBase64(gz);
    const i = VIEWER.indexOf(MARK);
    const stage = `<script>window.STAGE={"model":{"format":"${format}","gzip":true,"data":"`;
    const tail = `"},"config":${JSON.stringify(config).replace(/</g, '\\u003c')}}</script>`;
    const html = new Blob([VIEWER.slice(0, i), stage, data, tail, VIEWER.slice(i + MARK.length)], { type: 'text/html' });
    const name = fileName();
    const url = URL.createObjectURL(html);
    const a = Object.assign(document.createElement('a'), { href: url, download: name, className: 'dl', textContent: `⬇ ${L('下载', 'Download')} ${name}（${mb(html.size)}）` });
    a.translate = false;
    $('result').innerHTML = `<div class="msg ok with-face">${face('idea')}<span>${L('✓ 生成好了。如果没有自动下载，点下面的按钮。双击下载的文件就能在浏览器里打开。', '✓ Done. If the download did not start, use the button below. Double-click the file to open it in a browser.')}</span></div>`;
    $('result').append(a);
    const noteText = n => n.type === 'dup'
      ? L(`${n.id}（${esc(n.name)}）：节点名有重名，可能多选或漏选几个`, `${n.id} (${esc(n.name)}): duplicate node names, a few may be missed or extra`)
      : L(`${n.id}（${esc(n.name)}）不在已知型号里，先按默认大小显示`, `${n.id} (${esc(n.name)}) is not a known type; shown at a default size for now`);
    if (notes.length) $('result').insertAdjacentHTML('beforeend', `<div class="msg warn" translate="no">${notes.map(noteText).join('<br>')}</div>`);
    a.click();
    stepState(3, 'done');
  } catch (e) {
    await say('');
    $('result').innerHTML = `<div class="msg bad with-face">${face('boom')}<span>${L('生成失败：', 'Generation failed: ')}${esc(e.message)}<br>${L(`请把这段提示和模型大小发到 ${MAIL}，我们来看。`, `Please send this message and your model size to ${MAIL} and we will take a look.`)}</span></div>`;
  } finally {
    go.disabled = false;
  }
};

applyLang();
