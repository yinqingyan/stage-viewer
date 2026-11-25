// 设计师用的生成器：选模型 → 确认灯具桌椅 → 基本设置 → 生成单文件 html 并下载。
// 全部在浏览器里完成，模型不离开设计师的电脑。
// VIEWER（查看器模板，含注入标记）由 build.mjs 在本脚本之前定义。
import { Fbx, readGraph, detect, libraryEntry, roleOf, makeConfig, strip } from './fbx.js';
import LIB from '../skill/stage-viewer/scripts/library.json';

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

let file = null, bytes = null, format = '', fx = null, graph = null, kinds = [], aiNote = '';

// ---------- 说明 ----------
$('openGuide').onclick = () => $('guide').showModal();
$('closeGuide').onclick = () => $('guide').close();
$('guide').onclick = e => e.target === $('guide') && $('guide').close();

// ---------- AI 助手：用户自己的 OpenAI 格式接口，设置只存在本机浏览器 ----------
const AI_KEY = 'stage-generator-ai';
let ai = {};
try { ai = JSON.parse(localStorage.getItem(AI_KEY)) || {}; } catch {}
const aiReady = () => ai.base && ai.key && ai.model;
const showAiState = () => {
  $('aiState').textContent = aiReady() ? `已设置 · ${ai.model}` : '未设置';
  $('aiState').classList.toggle('on', !!aiReady());
};
showAiState();
$('openAi').onclick = () => {
  $('aiBase').value = ai.base || ''; $('aiKey').value = ai.key || ''; $('aiModel').value = ai.model || '';
  $('aiMsg').innerHTML = '';
  $('ai').showModal();
};
$('closeAi').onclick = () => $('ai').close();
const aiForm = () => ({ base: ($('aiBase').value.trim() || 'https://api.openai.com/v1').replace(/\/+$/, ''), key: $('aiKey').value.trim(), model: $('aiModel').value.trim() });
const aiSay = (cls, t) => $('aiMsg').innerHTML = `<div class="msg ${cls}">${t}</div>`;
$('aiSave').onclick = () => {
  const f = aiForm();
  if (!f.key || !f.model) return aiSay('warn', '请填 API Key 和模型名');
  ai = f;
  try { localStorage.setItem(AI_KEY, JSON.stringify(ai)); } catch {}
  showAiState();
  renderKinds();
  aiSay('ok', '已保存');
};
$('aiClear').onclick = () => {
  ai = {};
  try { localStorage.removeItem(AI_KEY); } catch {}
  $('aiBase').value = $('aiKey').value = $('aiModel').value = '';
  showAiState();
  renderKinds();
  aiSay('ok', '已清除');
};
$('aiTest').onclick = async () => {
  const f = aiForm();
  if (!f.key || !f.model) return aiSay('warn', '请填 API Key 和模型名');
  aiSay('', '连接中…');
  try {
    await chat(f, [{ role: 'user', content: '回复 OK' }], 5);
    aiSay('ok', '✓ 连接成功');
  } catch (e) { aiSay('bad', esc(e.message)); }
};

async function chat({ base, key, model }, messages, maxTokens) {
  let res;
  try {
    res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, messages, temperature: 0, ...(maxTokens && { max_tokens: maxTokens }) }),
    });
  } catch {
    throw new Error('连不上接口。检查地址是否正确；有的服务不允许网页直接调用（跨域限制），可以换一个服务商，或填自己的代理地址。');
  }
  const body = await res.text();
  if (!res.ok) {
    let m = body;
    try { m = JSON.parse(body).error?.message || body; } catch {}
    throw new Error(`接口返回错误 ${res.status}：${m.slice(0, 300)}`);
  }
  const text = JSON.parse(body).choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('接口返回的格式不是 OpenAI 格式');
  return text;
}

// 让 AI 给没认出的型号建议用途。只发名字、数量、部件数、所在组名和包含关系
const ROLE_NAMES = Object.fromEntries(ROLES.flatMap(([v, l]) => Array.isArray(l) ? l : [[v, l]]));
async function askAi() {
  const todo = kinds.filter(k => !k.known);
  const lines = todo.map(k => {
    const groups = Object.entries(k.groups).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([g, n]) => `${g}×${n}`).join('、');
    const inner = Object.entries(k.contains).map(([c, n]) => `${n} 个 ${kinds.find(x => x.id === c)?.name}`).join('、');
    return `${k.id}：名字「${k.name}」，${k.count} 个，每个 ${k.parts} 个部件，所在的组：${groups}${inner ? `；是一个整体，里面有 ${inner}` : ''}`;
  }).join('\n');
  const roles = Object.entries(ROLE_NAMES).filter(([v]) => v).map(([v, l]) => `${v}（${l}）`).join('、');
  const messages = [
    { role: 'system', content: '你是舞台美术和灯光设计助手。用户的 3ds Max 舞美模型里自动找到了一些重复出现的对象，请判断每种是什么。' },
    { role: 'user', content: `可选用途：${roles}；不是灯具也不是桌椅（舞台结构、桁架、装饰、屏幕模块，或者由多台灯/多把椅子组成的整体）填空字符串 ""。\n` +
      `组名常常说明了灯的用途，比如「beam」是光束灯、「闪」是频闪、「条」是灯条、「染色」「wash」是染色灯。拿不准就填 ""。\n\n${lines}\n\n` +
      '只输出一个 JSON 对象，不要其他文字，格式：{"K1": {"role": "beam", "reason": "一句话理由"}, ...}' },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await chat(ai, messages);
    try {
      const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      return Object.fromEntries(todo.filter(k => j[k.id] && (j[k.id].role === '' || j[k.id].role in ROLE_NAMES)).map(k => [k.id, j[k.id]]));
    } catch {
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: '格式不对，只输出那个 JSON 对象。' });
    }
  }
  throw new Error('AI 没有按格式回答，请再试一次或换一个模型');
}

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
  aiNote = '';
  let note = '';
  if (format === 'fbx') {
    info.innerHTML = `<div class="msg">${esc(f.name)}（${mb(f.size)}）：正在分析灯具和桌椅…</div>`;
    await tick();
    try {
      fx = new Fbx(bytes);
      graph = readGraph(fx);
      kinds = detect(fx, graph);
      for (const k of kinds) k.role = k.known = roleOf(libraryEntry(k, LIB));
    } catch (e) {
      fx = graph = null;
      note = `<div class="msg warn">这个 FBX 不是二进制格式，或者读不懂（${esc(e.message)}），不能识别灯具，会原样生成。3ds Max 导出时「文件格式」选「二进制」可以解决。</div>`;
    }
  } else {
    note = `<div class="msg warn">GLB 模型不做灯具识别，会原样生成。</div>`;
  }
  info.innerHTML = `<div class="msg ok">✓ ${esc(f.name)}（${mb(f.size)}）</div>` + note;
  if (!$('title').value) $('title').value = f.name.replace(/\.[^.]+$/, '');
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
  const why = k.why ? `<div class="why">🤖 ${esc(k.why)}</div>` : '';
  return `<tr><td><b>${esc(k.name)}</b>${k.known ? '<span class="tag">已认出</span>' : ''}${what}${why}</td>
    <td class="num">${k.count} 个</td><td class="where"><span class="k">${where}${more}</span></td><td class="role">${roleSelect(k)}</td></tr>`;
}
function renderKinds() {
  const box = $('kinds');
  if (!fx) { box.innerHTML = '<div class="msg">跳过这一步。</div>'; return; }
  if (!kinds.length) { box.innerHTML = '<div class="msg">没有找到重复出现的灯具或桌椅，模型会原样显示。</div>'; return; }
  // 「整体」（一整排灯架、一套桌椅）一般不用管，收起来
  const main = kinds.filter(k => !Object.keys(k.contains).length), groups = kinds.filter(k => Object.keys(k.contains).length);
  const head = '<thead><tr><th>型号</th><th>数量</th><th>在哪些组里</th><th style="width:150px">用途</th></tr></thead>';
  const known = kinds.filter(k => k.known).length, unknown = main.filter(k => !k.known).length;
  box.innerHTML = `<div class="msg ${known === main.length ? 'ok' : ''}">找到 ${main.length} 种，已自动认出 ${known} 种${known < main.length ? '，其余请选一下用途' : ''}。</div>
    ${unknown ? `<div class="ai-box"><div class="txt"><b>🤖 有 ${unknown} 种没认出来，可以让 AI 帮你判断</b>
      <span class="hint">${aiNote || (aiReady() ? `用你设置的 ${esc(ai.model)}，只发送型号名字、数量和分组名，不发送模型` : '用你自己的 AI 服务（OpenAI 格式的 API），设置一次就行。也可以不用 AI，直接在下面的下拉框里选。')}</span></div>
      <button class="go" id="askAi">${aiReady() ? '让 AI 判断' : '设置 AI 助手'}</button></div>` : ''}
    <table class="kinds">${head}<tbody>${main.map(row).join('')}</tbody></table>
    ${groups.length ? `<details><summary>另有 ${groups.length} 种「整体」（灯架、成套桌椅等，一般不用管）</summary>
      <table class="kinds">${head}<tbody>${groups.map(row).join('')}</tbody></table></details>` : ''}`;
  const btn = $('askAi');
  if (btn) btn.onclick = async () => {
    if (!aiReady()) return $('openAi').click();
    btn.disabled = true;
    btn.textContent = 'AI 正在判断…';
    try {
      const got = await askAi();
      for (const [id, { role, reason }] of Object.entries(got)) Object.assign(kinds.find(k => k.id === id), { role, why: `${ROLE_NAMES[role]}：${reason || ''}` });
      aiNote = `<span style="color:var(--ok)">AI 给出了 ${Object.keys(got).length} 种的建议（表格里 🤖 标着理由），请检查一下，不对可以改</span>`;
    } catch (e) {
      aiNote = `<span style="color:var(--bad)">${esc(e.message)}</span>`;
    }
    renderKinds();
  };
  box.querySelectorAll('select').forEach(s => s.onchange = () => {
    kinds.find(k => k.id === s.dataset.k).role = s.value;
    s.classList.toggle('set', !!s.value);
  });
}

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
    const title = $('title').value.trim() || file.name.replace(/\.[^.]+$/, '');
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
    const name = title.replace(/[\\/:*?"<>|]/g, '_') + '.html';
    const url = URL.createObjectURL(html);
    const a = Object.assign(document.createElement('a'), { href: url, download: name, className: 'dl', textContent: `⬇ 下载 ${name}（${mb(html.size)}）` });
    $('result').innerHTML = '<div class="msg ok">✓ 生成好了。如果没有自动下载，点下面的按钮。双击下载的文件就能在浏览器里打开。</div>';
    $('result').append(a);
    if (notes.length) $('result').insertAdjacentHTML('beforeend', `<div class="msg warn">${notes.map(esc).join('<br>')}</div>`);
    a.click();
    stepState(4, 'done');
  } catch (e) {
    await say('');
    $('result').innerHTML = `<div class="msg bad">生成失败：${esc(e.message)}</div>`;
  } finally {
    go.disabled = false;
  }
};
