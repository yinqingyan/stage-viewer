// 设计师用的生成器：选模型 → 确认灯具桌椅 → 基本设置 → 生成单文件 html 并下载。
// 全部在浏览器里完成，模型不离开设计师的电脑。
// VIEWER（查看器模板，含注入标记）由 build.mjs 在本脚本之前定义。
// 中英两种界面：页面上固定的文字查 GEN_WORDS，代码里拼的句子用 L(中文, English)；切换语言时重画这些部分。
import { Fbx, readGraph, detect, libraryEntry, roleOf, makeConfig, strip, textures } from './fbx.js';
import LIB from '../skill/stage-viewer/scripts/library.json';
import { mountExplainer } from './explainer.js';
import { lang, setLang, L, translatePage, addWords } from './i18n.js';

const MARK = '<script>/*__STAGE__*/</script>';
const MAIL = '<a href="mailto:stageviewer.app@outlook.com">stageviewer.app@outlook.com</a>';
const ROLES = () => [
  ['', L('不处理', 'Leave as is')],
  [L('灯具', 'Lights'), [['beam', L('光束灯', 'Beam')], ['wash', L('染色灯', 'Wash')], ['strobe', L('频闪', 'Strobe')], ['bar', L('灯条', 'LED bar')]]],
  [L('桌椅', 'Furniture'), [['chair', L('椅子', 'Chair')], ['stool', L('凳子', 'Stool')], ['table', L('桌子', 'Table')]]],
];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const user = s => `<span translate="no">${esc(s)}</span>`;  // 设计师自己的名字（文件名、组名），不翻译
const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';
const tick = () => new Promise(r => setTimeout(r, 30));  // 让进度文字先画出来

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
  '把 3ds Max 导出的舞美模型变成一个 html 文件。双击就能在电脑、手机上三维浏览，走进观众席看舞台，发微信、邮件即可分享。':
    'Turn your 3ds Max stage model into a single html file. Double-click to explore it in 3D on a computer or phone, walk into the audience and look at the stage, and share it by email or chat.',
  '模型只在你的电脑上处理，不会上传到任何地方': 'Your model is processed on your own computer and never uploaded',
  '全程在浏览器里完成，免费开源': 'Everything runs in your browser — free and open source',
  '第一次用？先看导出要求': 'First time? Read the export checklist',
  // 导出前
  '导出模型前，在 3ds Max 里做对 4 件事': 'Four things to get right in 3ds Max before you export',
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
  // 四步
  '四步，做出你的三维舞台': 'Four steps to your 3D stage',
  '选择模型': 'Choose your model', '把模型文件拖到这里': 'Drop your model file here', '或点击选择文件': 'or click to choose a file',
  '只在本机读取，不会上传': 'Read locally, never uploaded',
  '确认灯具和桌椅': 'Confirm lights and furniture',
  '自动找出模型里重复出现的灯具和桌椅，换成简单形状（灯口发光、光束、简单桌椅），文件会小很多。':
    'Repeated lights and furniture are found automatically and replaced by simple shapes (glowing lens, beam, simple furniture), which makes the file much smaller.',
  '「已认出」的不用管；没认出的选一个用途。拿不准就选「不处理」，会按模型原样显示，只是文件大一些。':
    '“Recognised” ones need nothing from you; choose a role for the rest. Not sure? “Leave as is” keeps it exactly as modelled — the file is just larger.',
  '基本设置': 'Settings', '项目名称': 'Project name', '导出的网页文件名和网页标题都用这个名字': 'Used for the file name and the page title',
  '比如：2027 春季发布会': 'e.g. Spring Launch 2027',
  '观众席在舞台的哪一侧': 'Which side is the audience on?',
  '按 3ds Max 的视图选。不确定就用默认；打开后「观众席」视角要是看到舞台背面，换一侧重新生成。':
    'Pick by 3ds Max viewport. If unsure keep the default; if the audience view shows the back of the stage, pick another side and generate again.',
  '前': 'Front', '后': 'Back', '左': 'Left', '右': 'Right',
  '前视图一侧（默认）': 'Front view side (default)', '后视图一侧': 'Back view side', '左视图一侧': 'Left view side', '右视图一侧': 'Right view side',
  '生成网页': 'Generate', '得到一个 html 文件，双击就能打开，发给导演和甲方。': 'You get one html file. Double-click to open it, then send it to the director or client.',
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
function applyLang(switched) {
  langBtn.textContent = lang === 'en' ? '中文' : 'English';
  document.title = lang === 'en' ? 'Stage Viewer Generator' : '舞美三维网页生成器';
  translatePage();
  renderInfo();
  renderKinds();
  showName();
  if (switched || !explainer) mountVideo();
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
  if (state === 'badType') { info.innerHTML = `<div class="msg bad">${L('只支持 .fbx 和 .glb。其他格式（.max、.obj、.c4d、.skp）请先导出成 FBX。', 'Only .fbx and .glb are supported. Export other formats (.max, .obj, .c4d, .skp) to FBX first.')}</div>`; return; }
  if (state === 'tooBig') { info.innerHTML = `<div class="msg bad">${L('文件太大，浏览器读不进来。请换用电脑上的 Chrome / Edge，或先在 3ds Max 里删掉用不到的部分。', 'The file is too large for the browser. Try Chrome or Edge on a computer, or remove unused parts in 3ds Max first.')}</div>`; return; }
  if (state === 'reading') { info.innerHTML = `<div class="msg">${name}${L('：正在读取…', ': reading…')}</div>`; return; }
  if (state === 'analyzing') { info.innerHTML = `<div class="msg">${name}${L('：正在分析灯具和桌椅…', ': looking for lights and furniture…')}</div>`; return; }
  let note = '';
  if (format === 'glb') note = `<div class="msg warn">${L('GLB 模型不做灯具识别，会原样生成。', 'GLB models are not scanned for lights; they are used as-is.')}</div>`;
  else if (readErr !== undefined) note = `<div class="msg warn">${L(`这个 FBX 不是二进制格式，或者读不懂（${esc(readErr)}），不能识别灯具，会原样生成。3ds Max 导出时「文件格式」选「二进制」可以解决。`,
    `This FBX is not binary or could not be read (${esc(readErr)}), so lights cannot be detected and it is used as-is. Export with File format “Binary” in 3ds Max to fix this.`)}</div>`;
  // 贴图没嵌入：网页里会是白色，提醒重新导出（不拦着，可以先生成白模版）
  const missing = texInfo.filter(t => !t.embedded).map(t => t.file);
  const list = `${missing.slice(0, 6).map(user).join(L('、', ', '))}${missing.length > 6 ? L(' 等', ' …') : ''}`;
  const texNote = !texInfo.length || !missing.length ? '' : `<div class="msg warn"><b>${L(`⚠ 有 ${missing.length} 张贴图没有嵌入：`, `⚠ ${missing.length} texture(s) not embedded: `)}</b>${list}<br>
     ${L('生成的网页里，用到这些贴图的地方会是白色或纯色（比如屏幕画面）。在 3ds Max 导出 FBX 时勾选「嵌入的媒体」后重新导出就好；也可以先继续生成看看。',
        'Anything using them (screen content, for example) will show white or a flat colour. Re-export from 3ds Max with “Embed Media” ticked — or carry on and generate anyway.')}</div>`;
  const texOk = texInfo.length && !missing.length ? L(` · ${texInfo.length} 张贴图已全部嵌入`, ` · all ${texInfo.length} texture(s) embedded`) : '';
  info.innerHTML = `<div class="msg ok">✓ ${name}${texOk}</div>` + note + texNote;
}

async function load(f) {
  file = f;
  format = f.name.toLowerCase().split('.').pop();
  [2, 3, 4].forEach(n => stepState(n, 'off'));
  $('result').innerHTML = $('progress').textContent = '';
  if (!['fbx', 'glb'].includes(format)) { stage1 = { state: 'badType' }; renderInfo(); return; }
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
      for (const k of kinds) k.role = k.known = roleOf(libraryEntry(k, LIB));
      texInfo = textures(fx);
    } catch (e) {
      fx = graph = null;
      stage1.readErr = e.message;
    }
  }
  renderInfo();
  if (!$('title').value) $('title').value = f.name.replace(/\.[^.]+$/, '');
  showName();
  renderKinds();
  stepState(1, 'done');
  [2, 3, 4].forEach(n => stepState(n, 'on'));
  // 拖放区在首屏，载入后带着往下走到第 2 步
  setTimeout(() => $('s2').scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
}

// ---------- 2. 确认灯具和桌椅 ----------
function roleSelect(k) {
  const opts = ROLES().map(([v, l]) => Array.isArray(l)
    ? `<optgroup label="${v}">${l.map(([v2, l2]) => `<option value="${v2}"${k.role === v2 ? ' selected' : ''}>${l2}</option>`).join('')}</optgroup>`
    : `<option value="${v}"${k.role === v ? ' selected' : ''}>${l}</option>`).join('');
  return `<select data-k="${k.id}" class="${k.role ? 'set' : ''}">${opts}</select>`;
}
function row(k) {
  const groups = Object.entries(k.groups).sort((a, b) => b[1] - a[1]);
  const where = groups.slice(0, 3).map(([g, n]) => `${user(g)} ×${n}`).join(L('、', ', '));
  const more = groups.length > 3 ? L(` 等 ${groups.length} 个组`, ` and ${groups.length - 3} more`) : '';
  const what = Object.keys(k.contains).length
    ? `<div class="k">${L('一个整体，里面有 ', 'A whole unit containing ')}${Object.entries(k.contains).map(([c, n]) => `${n} × ${user(kinds.find(x => x.id === c)?.name || c)}`).join(L('、', ', '))}</div>`
    : `<div class="k">${L(`每个 ${k.parts} 个部件`, `${k.parts} parts each`)}</div>`;
  return `<tr><td><b translate="no">${esc(k.name)}</b>${k.known ? `<span class="tag">${L('已认出', 'Recognised')}</span>` : ''}${what}</td>
    <td class="num">${k.count}${L(' 个', '')}</td><td class="where"><span class="k">${where}${more}</span></td><td class="role">${roleSelect(k)}</td></tr>`;
}
function renderKinds() {
  const box = $('kinds');
  if (!stage1 || stage1.state !== 'ready') { box.innerHTML = ''; return; }
  if (!fx) { box.innerHTML = `<div class="msg">${L('跳过这一步。', 'Nothing to do here.')}</div>`; return; }
  if (!kinds.length) { box.innerHTML = `<div class="msg">${L('没有找到重复出现的灯具或桌椅，模型会原样显示。', 'No repeated lights or furniture found; the model is used as-is.')}</div>`; return; }
  // 「整体」（一整排灯架、一套桌椅）一般不用管，收起来
  const main = kinds.filter(k => !Object.keys(k.contains).length), groups = kinds.filter(k => Object.keys(k.contains).length);
  const head = `<thead><tr><th>${L('型号', 'Type')}</th><th>${L('数量', 'Count')}</th><th>${L('在哪些组里', 'In groups')}</th><th style="width:150px">${L('用途', 'Role')}</th></tr></thead>`;
  const known = kinds.filter(k => k.known).length;
  box.innerHTML = `<div class="msg ${known === main.length ? 'ok' : ''}">${L(`找到 ${main.length} 种，已自动认出 ${known} 种${known < main.length ? '，其余请选一下用途' : ''}。`,
      `Found ${main.length} type(s); ${known} recognised automatically${known < main.length ? ' — please choose a role for the rest' : ''}.`)}</div>
    <table class="kinds">${head}<tbody>${main.map(row).join('')}</tbody></table>
    ${groups.length ? `<details><summary>${L(`另有 ${groups.length} 种「整体」（灯架、成套桌椅等，一般不用管）`, `${groups.length} more “whole units” (rigs, table sets — usually leave these alone)`)}</summary>
      <table class="kinds">${head}<tbody>${groups.map(row).join('')}</tbody></table></details>` : ''}`;
  box.querySelectorAll('select').forEach(s => s.onchange = () => {
    kinds.find(k => k.id === s.dataset.k).role = s.value;
    s.classList.toggle('set', !!s.value);
  });
}

// ---------- 3. 基本设置 ----------
const projectName = () => $('title').value.trim() || (file ? file.name.replace(/\.[^.]+$/, '') : '');
const fileName = () => projectName().replace(/[\\/:*?"<>|]/g, '_') + '.html';
const showName = () => $('outName').textContent = projectName() ? fileName() : '—';
$('title').oninput = showName;

// ---------- 4. 生成 ----------
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
    let model = new Blob([bytes]), notes = [];
    const chosen = kinds.filter(k => k.role);
    if (fx && chosen.length) {
      const n = chosen.reduce((s, k) => s + k.count, 0);
      await say(L(`精简 ${n} 个灯具和桌椅…`, `Simplifying ${n} lights and furniture…`));
      const c = makeConfig(chosen, graph, LIB);
      Object.assign(config, { fixtures: c.fixtures, props: c.props });
      // 地上的灯朝上、天上的灯朝观众席；默认只亮灯口，每组灯有自己的光束开关（默认关），不然光柱会罩住整个舞台
      if (c.fixtures.length) Object.assign(config, { aim: { floorBelow: 3 }, lightGroups: { '*': { beamSwitch: true } } });
      notes = c.notes;
      const r = strip(fx, graph, new Set(chosen.flatMap(k => k.ids)));
      model = new Blob(r.parts);
      await say(`  ${mb(bytes.length)} → ${mb(model.size)}`);
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
    $('result').innerHTML = `<div class="msg ok">${L('✓ 生成好了。如果没有自动下载，点下面的按钮。双击下载的文件就能在浏览器里打开。', '✓ Done. If the download did not start, use the button below. Double-click the file to open it in a browser.')}</div>`;
    $('result').append(a);
    const noteText = n => n.type === 'dup'
      ? L(`${n.id}（${esc(n.name)}）：节点名有重名，可能多选或漏选几个`, `${n.id} (${esc(n.name)}): duplicate node names, a few may be missed or extra`)
      : L(`${n.id}（${esc(n.name)}）不在已知型号里，先按默认大小显示`, `${n.id} (${esc(n.name)}) is not a known type; shown at a default size for now`);
    if (notes.length) $('result').insertAdjacentHTML('beforeend', `<div class="msg warn" translate="no">${notes.map(noteText).join('<br>')}</div>`);
    a.click();
    stepState(4, 'done');
  } catch (e) {
    await say('');
    $('result').innerHTML = `<div class="msg bad">${L('生成失败：', 'Generation failed: ')}${esc(e.message)}<br>${L(`请把这段提示和模型大小发到 ${MAIL}，我们来看。`, `Please send this message and your model size to ${MAIL} and we will take a look.`)}</div>`;
  } finally {
    go.disabled = false;
  }
};

applyLang();
