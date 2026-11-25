// 设计师用的生成器：选模型 → 确认灯具桌椅 → 基本设置 → 生成单文件 html 并下载。
// 全部在浏览器里完成，模型不离开设计师的电脑。
// VIEWER（查看器模板，含注入标记）由 build.mjs 在本脚本之前定义。
import { Fbx, readGraph, detect, libraryEntry, roleOf, makeConfig, strip, textures } from './fbx.js';
import LIB from '../skill/stage-viewer/scripts/library.json';
import { mountExplainer } from './explainer.js';

const MARK = '<script>/*__STAGE__*/</script>';
const ROLES = [
  ['', '不处理'],
  ['灯具', [['beam', '光束灯'], ['wash', '染色灯'], ['strobe', '频闪'], ['bar', '灯条']]],
  ['桌椅', [['chair', '椅子'], ['stool', '凳子'], ['table', '桌子']]],
];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';
const tick = () => new Promise(r => setTimeout(r, 30));  // 让进度文字先画出来

let file = null, bytes = null, format = '', fx = null, graph = null, kinds = [], texInfo = [];

// ---------- 30 秒说明动画（第一次打开时才搭起来） ----------
let explainer = null;
$('openExplain').onclick = () => {
  $('explain').showModal();
  explainer ||= mountExplainer($('explainHost'));
  explainer.play();
};
$('closeExplain').onclick = () => $('explain').close();
$('explain').onclick = e => e.target === $('explain') && $('explain').close();
$('explain').onclose = () => explainer?.stop();
// 录制视频用：#explainer 时直接打开，并暴露逐帧渲染
if (location.hash === '#explainer') { $('explain').showModal(); explainer = mountExplainer($('explainHost')); window.EXPLAINER = explainer; }

// ---------- 说明 ----------
$('openGuide').onclick = () => $('guide').showModal();
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

async function load(f) {
  const info = $('fileInfo');
  format = f.name.toLowerCase().split('.').pop();
  [2, 3, 4].forEach(n => stepState(n, 'off'));
  $('result').innerHTML = $('progress').textContent = '';
  if (!['fbx', 'glb'].includes(format)) {
    info.innerHTML = `<div class="msg bad">只支持 .fbx 和 .glb。其他格式（.max、.obj、.c4d、.skp）请先导出成 FBX。</div>`;
    return;
  }
  file = f;
  info.innerHTML = `<div class="msg">${esc(f.name)}（${mb(f.size)}）：正在读取…</div>`;
  await tick();
  try {
    bytes = new Uint8Array(await f.arrayBuffer());
  } catch {
    info.innerHTML = `<div class="msg bad">文件太大，浏览器读不进来。请换用电脑上的 Chrome / Edge，或先在 3ds Max 里删掉用不到的部分。</div>`;
    return;
  }
  fx = graph = null;
  kinds = [];
  texInfo = [];
  let note = '';
  if (format === 'fbx') {
    info.innerHTML = `<div class="msg">${esc(f.name)}（${mb(f.size)}）：正在分析灯具和桌椅…</div>`;
    await tick();
    try {
      fx = new Fbx(bytes);
      graph = readGraph(fx);
      kinds = detect(fx, graph);
      for (const k of kinds) k.role = k.known = roleOf(libraryEntry(k, LIB));
      texInfo = textures(fx);
    } catch (e) {
      fx = graph = null;
      note = `<div class="msg warn">这个 FBX 不是二进制格式，或者读不懂（${esc(e.message)}），不能识别灯具，会原样生成。3ds Max 导出时「文件格式」选「二进制」可以解决。</div>`;
    }
  } else {
    note = `<div class="msg warn">GLB 模型不做灯具识别，会原样生成。</div>`;
  }
  // 贴图没嵌入：网页里会是白色，提醒重新导出（不拦着，可以先生成白模版）
  const missing = texInfo.filter(t => !t.embedded).map(t => t.file);
  const texNote = !texInfo.length ? '' : missing.length
    ? `<div class="msg warn"><b>⚠ 有 ${missing.length} 张贴图没有嵌入：</b>${missing.slice(0, 6).map(esc).join('、')}${missing.length > 6 ? ` 等` : ''}<br>
       生成的网页里，用到这些贴图的地方会是白色或纯色（比如屏幕画面）。在 3ds Max 导出 FBX 时勾选「嵌入的媒体」后重新导出就好；也可以先继续生成看看。</div>`
    : '';
  const texOk = texInfo.length && !missing.length ? ` · ${texInfo.length} 张贴图已全部嵌入` : '';
  info.innerHTML = `<div class="msg ok">✓ ${esc(f.name)}（${mb(f.size)}）${texOk}</div>` + note + texNote;
  if (!$('title').value) $('title').value = f.name.replace(/\.[^.]+$/, '');
  showName();
  renderKinds();
  stepState(1, 'done');
  [2, 3, 4].forEach(n => stepState(n, 'on'));
}

// ---------- 2. 确认灯具和桌椅 ----------
function roleSelect(k) {
  const opts = ROLES.map(([v, l]) => Array.isArray(l)
    ? `<optgroup label="${v}">${l.map(([v2, l2]) => `<option value="${v2}"${k.role === v2 ? ' selected' : ''}>${l2}</option>`).join('')}</optgroup>`
    : `<option value="${v}"${k.role === v ? ' selected' : ''}>${l}</option>`).join('');
  return `<select data-k="${k.id}" class="${k.role ? 'set' : ''}">${opts}</select>`;
}
function row(k) {
  const where = Object.entries(k.groups).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g, n]) => `${esc(g)} ×${n}`).join('、');
  const more = Object.keys(k.groups).length > 3 ? ` 等 ${Object.keys(k.groups).length} 个组` : '';
  const what = k.contains && Object.keys(k.contains).length
    ? `<div class="k">一个整体，里面有 ${Object.entries(k.contains).map(([c, n]) => `${n} 个 ${esc(kinds.find(x => x.id === c)?.name || c)}`).join('、')}</div>`
    : `<div class="k">每个 ${k.parts} 个部件</div>`;
  return `<tr><td><b>${esc(k.name)}</b>${k.known ? '<span class="tag">已认出</span>' : ''}${what}</td>
    <td class="num">${k.count} 个</td><td class="where"><span class="k">${where}${more}</span></td><td class="role">${roleSelect(k)}</td></tr>`;
}
function renderKinds() {
  const box = $('kinds');
  if (!fx) { box.innerHTML = '<div class="msg">跳过这一步。</div>'; return; }
  if (!kinds.length) { box.innerHTML = '<div class="msg">没有找到重复出现的灯具或桌椅，模型会原样显示。</div>'; return; }
  // 「整体」（一整排灯架、一套桌椅）一般不用管，收起来
  const main = kinds.filter(k => !Object.keys(k.contains).length), groups = kinds.filter(k => Object.keys(k.contains).length);
  const head = '<thead><tr><th>型号</th><th>数量</th><th>在哪些组里</th><th style="width:150px">用途</th></tr></thead>';
  const known = kinds.filter(k => k.known).length;
  box.innerHTML = `<div class="msg ${known === main.length ? 'ok' : ''}">找到 ${main.length} 种，已自动认出 ${known} 种${known < main.length ? '，其余请选一下用途' : ''}。</div>
    <table class="kinds">${head}<tbody>${main.map(row).join('')}</tbody></table>
    ${groups.length ? `<details><summary>另有 ${groups.length} 种「整体」（灯架、成套桌椅等，一般不用管）</summary>
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
    const config = { title, audience: document.querySelector('input[name=side]:checked').value };
    let model = new Blob([bytes]), notes = [];
    const chosen = kinds.filter(k => k.role);
    if (fx && chosen.length) {
      await say(`精简 ${chosen.reduce((n, k) => n + k.count, 0)} 个灯具和桌椅…`);
      const c = makeConfig(chosen, graph, LIB);
      Object.assign(config, { fixtures: c.fixtures, props: c.props });
      // 地上的灯朝上、天上的灯朝观众席；默认只亮灯口，每组灯有自己的光束开关（默认关），不然光柱会罩住整个舞台
      if (c.fixtures.length) Object.assign(config, { aim: { floorBelow: 3 }, lightGroups: { '*': { beamSwitch: true } } });
      notes = c.notes;
      const r = strip(fx, graph, new Set(chosen.flatMap(k => k.ids)));
      model = new Blob(r.parts);
      await say(`  ${mb(bytes.length)} → ${mb(model.size)}`);
    }
    await say('压缩…');
    const gz = await new Response(model.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    await say('打包成网页…');
    const data = await toBase64(gz);
    const i = VIEWER.indexOf(MARK);
    const stage = `<script>window.STAGE={"model":{"format":"${format}","gzip":true,"data":"`;
    const tail = `"},"config":${JSON.stringify(config).replace(/</g, '\\u003c')}}</script>`;
    const html = new Blob([VIEWER.slice(0, i), stage, data, tail, VIEWER.slice(i + MARK.length)], { type: 'text/html' });
    const name = fileName();
    const url = URL.createObjectURL(html);
    const a = Object.assign(document.createElement('a'), { href: url, download: name, className: 'dl', textContent: `⬇ 下载 ${name}（${mb(html.size)}）` });
    $('result').innerHTML = '<div class="msg ok">✓ 生成好了。如果没有自动下载，点下面的按钮。双击下载的文件就能在浏览器里打开。</div>';
    $('result').append(a);
    if (notes.length) $('result').insertAdjacentHTML('beforeend', `<div class="msg warn">${notes.map(esc).join('<br>')}</div>`);
    a.click();
    stepState(4, 'done');
  } catch (e) {
    await say('');
    $('result').innerHTML = `<div class="msg bad">生成失败：${esc(e.message)}<br>请把这段提示和模型大小发到 <a href="mailto:stageviewer.app@outlook.com">stageviewer.app@outlook.com</a>，我们来看。</div>`;
  } finally {
    go.disabled = false;
  }
};
