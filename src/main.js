import './style.css';
import { Stage } from './engine.js';
import { sections } from './scenes/index.js';

const $ = (id) => document.getElementById(id);
const scenes = sections.flatMap((s) => s.scenes);
const stage = new Stage($('gl'));
if (import.meta.env.DEV) window.__stage = stage; // 仅开发时：方便在控制台调试

let current = null; // 当前场景
let stepIdx = -1;   // -1 = 全景，未进入分步讲解
let selected = null;
let timer = null;

/* ---------- 导航 ---------- */
const nav = $('nav');
for (const sec of sections) {
  const h = document.createElement('div');
  h.className = 'nav-sec'; h.textContent = sec.title;
  nav.appendChild(h);
  for (const sc of sec.scenes) {
    const b = document.createElement('button');
    b.className = 'nav-item'; b.type = 'button'; b.textContent = sc.nav || sc.title; b.dataset.id = sc.id;
    b.onclick = () => { location.hash = sc.id; };
    nav.appendChild(b);
  }
}

function openScene(id) {
  const sc = scenes.find((s) => s.id === id) || scenes[0];
  if (current === sc) return;
  current = sc; stepIdx = -1; selected = null; stopAuto();
  for (const b of nav.querySelectorAll('.nav-item')) {
    const on = b.dataset.id === sc.id;
    b.classList.toggle('active', on);
    if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  $('sceneTitle').textContent = sc.title;
  $('sceneSub').textContent = sc.subtitle || '';
  document.title = `${sc.title} · ROS 图解`;
  renderStepper();
  renderInfo();
  syncInsets();
  stage.load(sc);
}

/* ---------- 右侧详情 ---------- */
function renderInfo() {
  const el = $('info');
  el.scrollTop = 0;
  el.innerHTML = '';
  const wrap = document.createElement('div');
  const node = selected && current.nodes.find((n) => n.id === selected);
  if (node) {
    const back = document.createElement('button');
    back.className = 'back'; back.type = 'button'; back.textContent = '‹ 场景说明';
    back.onclick = () => select(null);
    wrap.appendChild(back);
    const h = document.createElement('h2'); h.textContent = node.title || node.label; wrap.appendChild(h);
    if (node.sub) { const t = document.createElement('div'); t.className = 'tag'; t.textContent = node.sub; wrap.appendChild(t); }
    const body = document.createElement('div'); body.className = 'body';
    body.innerHTML = node.d || '<p>暂无更多说明。</p>';
    wrap.appendChild(body);
    if (node.code) { const pre = document.createElement('pre'); pre.textContent = node.code; wrap.appendChild(pre); }
  } else {
    const eb = document.createElement('div'); eb.className = 'eyebrow'; eb.textContent = '场景说明'; wrap.appendChild(eb);
    const h = document.createElement('h2'); h.textContent = current.title; wrap.appendChild(h);
    const body = document.createElement('div'); body.className = 'body';
    body.innerHTML = current.intro || '';
    wrap.appendChild(body);
    const tip = document.createElement('div'); tip.className = 'tip';
    tip.textContent = current.steps ? '点击图中的方块查看细节；用下方的「开始讲解」按步骤看完整流程。' : '点击图中的方块查看细节与示例代码。';
    wrap.appendChild(tip);
  }
  el.appendChild(wrap);
}

function select(id) {
  selected = id;
  stage.select(id);
  renderInfo();
  if (id) $('hint').classList.add('gone');
}
stage.onSelect = select;

/* ---------- 分步讲解 ---------- */
function renderStepper() {
  const el = $('stepper');
  const steps = current.steps;
  if (!steps) { el.hidden = true; return; }
  el.hidden = false;
  const s = steps[stepIdx];
  const dots = steps.map((_, i) => `<button class="st-dot${i === stepIdx ? ' on' : ''}" data-i="${i}" type="button" aria-label="第 ${i + 1} 步"></button>`).join('');
  if (!s) {
    el.innerHTML = `
      <div class="st-top"><div class="st-title">分步讲解</div><div class="st-count">共 ${steps.length} 步</div></div>
      <div class="st-text">${current.stepsHint || '按顺序高亮每个环节，看清数据和控制是怎么流动的。'}</div>
      <div class="st-row"><div class="st-dots">${dots}</div><button class="btn btn-primary" data-act="next" type="button">开始讲解</button></div>`;
  } else {
    el.innerHTML = `
      <div class="st-top"><div class="st-title">${s.title}</div><div class="st-count">${stepIdx + 1} / ${steps.length}</div></div>
      <div class="st-text">${s.text}</div>
      <div class="st-row">
        <div class="st-dots">${dots}</div>
        <button class="btn btn-sm" data-act="exit" type="button">全景</button>
        <button class="btn btn-sm" data-act="auto" type="button">${timer ? '暂停' : '自动播放'}</button>
        <button class="btn btn-sm" data-act="prev" type="button" ${stepIdx === 0 ? 'disabled' : ''}>上一步</button>
        <button class="btn btn-sm btn-primary" data-act="next" type="button" ${stepIdx === steps.length - 1 ? 'disabled' : ''}>下一步</button>
      </div>`;
  }
}

function goStep(i) {
  const steps = current.steps;
  if (!steps) return;
  stepIdx = Math.max(-1, Math.min(steps.length - 1, i));
  if (stepIdx === steps.length - 1 || stepIdx === -1) stopAuto();
  if (selected) { selected = null; stage.select(null); renderInfo(); }
  stage.setStep(steps[stepIdx] || null);
  renderStepper();
  syncInsets();
  $('hint').classList.add('gone');
}

function stopAuto() { clearInterval(timer); timer = null; }

$('stepper').addEventListener('click', (ev) => {
  const t = ev.target.closest('button'); if (!t) return;
  if (t.dataset.i) { stopAuto(); return goStep(+t.dataset.i); }
  const act = t.dataset.act;
  if (act === 'next') { stopAuto(); goStep(stepIdx + 1); }
  else if (act === 'prev') { stopAuto(); goStep(stepIdx - 1); }
  else if (act === 'exit') { stopAuto(); goStep(-1); }
  else if (act === 'auto') {
    if (timer) stopAuto(); else timer = setInterval(() => goStep(stepIdx + 1), 5500);
    renderStepper();
  }
});

addEventListener('keydown', (ev) => {
  if (ev.target.closest('input, textarea')) return;
  if (ev.key === 'ArrowRight') { stopAuto(); goStep(stepIdx + 1); }
  else if (ev.key === 'ArrowLeft') { stopAuto(); goStep(stepIdx - 1); }
  else if (ev.key === 'Escape') { if (selected) select(null); else { stopAuto(); goStep(-1); } }
});

/* ---------- 画面留白：避开右侧面板与底部步骤条 ---------- */
function syncInsets() {
  if (innerWidth <= 860) return stage.setInsets(0, 0, 44);
  const st = $('stepper');
  stage.setInsets(372, st.hidden ? 0 : st.offsetHeight + 44, 64);
}
addEventListener('resize', syncInsets);

/* ---------- 主题 ---------- */
const themeBtn = $('themeBtn');
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  themeBtn.textContent = t === 'dark' ? '浅色模式' : '深色模式';
  stage.setTheme(t === 'dark');
}
themeBtn.onclick = () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('theme', t); } catch (e) { /* 隐私模式下忽略 */ }
  applyTheme(t);
};
applyTheme(document.documentElement.dataset.theme || 'light');

addEventListener('hashchange', () => openScene(location.hash.slice(1)));
openScene(location.hash.slice(1));
