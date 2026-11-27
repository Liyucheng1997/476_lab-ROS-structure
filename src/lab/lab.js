// 「实机运行」页：终端 + 实时 3D 图 + 数据包 / 启动过程 / 序列化 三个观察面板。
// 画面上的一切都来自真实运行：内核转发的每个数据包、进程上报的中间件状态。
import './shims/base.js';
import './lab.css';
import { Kernel, esc } from './kernel.js';
import { Terminal } from './terminal.js';
import { KIND, HEADER, DATA_HEADER, channelOf } from './decode.js';
import { listInterfaces, interfaceText, getType, createMessage, rosTypeName, ddsTypeName } from '../../ros2/rosidl/idl.js';
import { serialize, deserialize } from '../../ros2/rosidl/cdr.js';
import { dump, parseArg } from '../../ros2/rcl/yaml.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DROP_COLOR = '#ff453a';
const fqn = n => (n.ns === '/' ? '' : n.ns) + '/' + n.name;
const KIND_NAME = { topic: '话题', service: '服务', action: '动作' };

const DEMOS = [
  { name: '话题：talker 发，listener 收', run: [[0, 'ros2 run demo_nodes talker'], [1, 'ros2 run demo_nodes listener']] },
  { name: '服务：调用加法', run: [[0, 'ros2 run demo_nodes add_two_ints_server'], [1, 'ros2 service call /add_two_ints "{a: 40, b: 2}"', 1500]] },
  { name: '动作：斐波那契（带进度反馈）', run: [[0, 'ros2 run demo_nodes fibonacci_action_server'], [1, 'ros2 action send_goal -f /fibonacci example_interfaces/action/Fibonacci "{order: 6}"', 1500]] },
  { name: '参数：运行中改参数', run: [[0, 'ros2 run demo_nodes talker'], [1, 'ros2 run demo_nodes listener'], [2, 'ros2 param set /talker greeting 你好', 3000]] },
  { name: '可靠传输：丢包 30% 时怎么补发', loss: 30, run: [[0, 'ros2 run demo_nodes talker'], [1, 'ros2 run demo_nodes listener']] },
  { name: '小乌龟：用方向键遥控', run: [[0, 'ros2 run turtlesim turtlesim_node'], [1, 'ros2 run turtlesim turtle_teleop_key', 800], [2, 'ros2 topic echo /turtle1/pose', 800]] },
  { name: 'launch：一条命令启动三个节点', run: [[0, 'ros2 launch demo_nodes/talker_listener.launch.js']] },
];

const GUIDE = `
<div class="eyebrow">实机运行</div>
<h2>在浏览器里跑真正的 ROS 2</h2>
<div class="body">
<p>下面的终端运行的是仓库 <code>ros2/</code> 目录里<b>原封不动的代码</b>。每条 <code>ros2</code> 命令都会启动一个独立进程（一个 Web Worker），进程之间靠 UDP 数据包互相发现和通信。</p>
<p>这个页面扮演“操作系统和网络”：它转发每一个数据包，所以能把它们全都画出来。</p>
<h3>怎么看这张图</h3>
<ul>
<li><b>上排</b>是进程，<b>下排蓝色</b>是话题、服务、动作；连线表示谁发布、谁订阅。</li>
<li>飞过的小点是真实的数据包：<span class="dot" style="background:${KIND.DATA.color}"></span>数据经过话题飞向订阅者，<span class="dot" style="background:${KIND.SPDP.color}"></span>发现、<span class="dot" style="background:${KIND.SEDP.color}"></span>实体列表、<span class="dot" style="background:${KIND.HEARTBEAT.color}"></span>心跳、<span class="dot" style="background:${KIND.ACKNACK.color}"></span>应答在进程之间直接飞，<span class="dot" style="background:${DROP_COLOR}"></span>半路消失的是被丢掉的包。</li>
<li>点击方块看它的细节；上方三个标签页分别看每个数据包、进程的启动过程、消息怎么变成字节。</li>
</ul>
<h3>试一试</h3>
<p>在「演示」里选一个，或者点下面的命令把它填进当前终端：</p>
<div class="tries">
${['ros2 run demo_nodes talker', 'ros2 topic echo /chatter', 'ros2 topic list -t', 'ros2 node info /talker', 'ros2 topic pub /chatter std_msgs/msg/String "data: 我也来说一句"', 'ros2 param set /talker greeting 你好', 'ros2 topic hz /chatter', 'ros2 doctor'].map(c => `<button type="button" class="try">${esc(c)}</button>`).join('')}
</div>
<p>把终端上方的「延迟」调大，数据包会飞得更慢，先后顺序看得更清楚；把「丢包」调高，可以看到心跳和应答怎么把丢掉的消息补回来。</p>
<h3>和真机的差别</h3>
<p>代码相同，换掉的只有最底下的操作系统接口：UDP 套接字、文件系统、进程。真机上的用法见仓库的 README。</p>
</div>`;

export function createLab(stage, host) {
  const kernel = new Kernel();
  const t0 = performance.now();
  let active = false, tab = 'guide', selId = null, showInternal = false;
  let packets = [], selPkt = null, bootPid = null, follow = true, lastIds = '';
  const hidden = new Set(['ROUTINE']);
  const terms = [];
  let current = null;       // 当前（最后点过的）终端

  /* ---------------- 界面骨架 ---------------- */
  const side = document.createElement('section');
  side.className = 'lab-side card';
  side.innerHTML = `
    <div class="seg" role="tablist">
      ${[['guide', '说明'], ['packets', '数据包'], ['boot', '启动过程'], ['cdr', '序列化']].map(([k, n]) => `<button type="button" role="tab" data-tab="${k}">${n}</button>`).join('')}
    </div>
    <div class="lab-pane info-like" data-pane="guide"></div>
    <div class="lab-pane" data-pane="packets">
      <div class="chips" id="pkFilters"></div>
      <div class="pk-detail" id="pkDetail"></div>
      <div class="pk-list" id="pkList"></div>
    </div>
    <div class="lab-pane" data-pane="boot">
      <p class="pane-note">一条 <code>ros2 run</code> 从敲下回车到开始通信，中间发生的每一步。真实的 ROS 2 在编译时把接口文件生成成代码；这里改成了运行时解析，所以“读取并解析接口文件”出现在启动过程里。</p>
      <div class="chips" id="bootProcs"></div>
      <ol class="tl" id="bootList"></ol>
    </div>
    <div class="lab-pane" data-pane="cdr">
      <p class="pane-note">一条消息从接口定义到线上字节的全过程。对应真实 ROS 2 里 rosidl 生成代码、rmw 做序列化这两步。</p>
      <label class="fld">接口<select id="cdrType"></select></label>
      <pre id="cdrSrc"></pre>
      <label class="fld">消息内容（可以改）<textarea id="cdrVal" rows="3" spellcheck="false"></textarea></label>
      <div id="cdrOut"></div>
    </div>`;
  const dock = document.createElement('section');
  dock.className = 'lab-dock card';
  dock.innerHTML = `
    <div class="dock-head">
      <b>终端</b>
      <button class="btn btn-sm" id="addTerm" type="button">＋ 终端</button>
      <select class="btn btn-sm" id="demo" aria-label="演示"><option value="">演示…</option>${DEMOS.map((d, i) => `<option value="${i}">${d.name}</option>`).join('')}</select>
      <button class="btn btn-sm" id="stopAll" type="button">全部停止</button>
      <span class="grow"></span>
      <label class="knob"><input type="checkbox" id="internal">内部话题</label>
      <label class="knob">延迟<input type="range" id="delay" min="0" max="1000" step="50" value="100"><output id="delayOut">100 ms</output></label>
      <label class="knob">丢包<input type="range" id="loss" min="0" max="60" step="5" value="0"><output id="lossOut">0%</output></label>
    </div>
    <div class="terms" id="terms"></div>`;
  host.append(side, dock);
  const $ = sel => host.querySelector(sel);
  const pane = name => side.querySelector(`[data-pane="${name}"]`);

  function setTab(name) {
    tab = name;
    for (const b of side.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === name);
    for (const p of side.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== name;
    if (name === 'boot') renderBoot();
    if (name === 'packets') $('#pkList').scrollTop = $('#pkList').scrollHeight;
    if (name === 'guide') renderGuide();
  }
  side.querySelector('.seg').onclick = ev => { const b = ev.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); };

  /* ---------------- 终端 ---------------- */
  function addTerm() {
    if (terms.length >= 4) return;
    const used = new Set(terms.map(t => t.n));
    let n = 1;
    while (used.has(n)) n++;
    const t = new Terminal(kernel, n, {
      onFocus: term => { current = term; for (const x of terms) x.el.classList.toggle('current', x === term); },
      onClose: term => {
        if (terms.length <= 1) return;
        terms.splice(terms.indexOf(term), 1);
        term.el.remove();
        if (current === term) current = terms[0];
        layoutTerms();
      },
    });
    terms.push(t);
    terms.sort((a, b) => a.n - b.n);
    $('#terms').replaceChildren(...terms.map(x => x.el));
    current ??= t;
    layoutTerms();
    return t;
  }
  function layoutTerms() {
    $('#terms').style.gridTemplateColumns = `repeat(${terms.length}, minmax(0, 1fr))`;
    $('#addTerm').disabled = terms.length >= 4;
  }
  $('#addTerm').onclick = () => addTerm()?.input.focus();
  $('#stopAll').onclick = stopAll;
  async function stopAll() {
    for (const p of kernel.alive()) if (!p.parent) kernel.kill(p.pid);
    await sleep(120);
    for (const p of kernel.alive()) kernel.kill(p.pid);
  }
  const setLoss = v => { kernel.net.loss = v / 100; $('#loss').value = v; $('#lossOut').textContent = `${v}%`; };
  $('#loss').oninput = ev => setLoss(+ev.target.value);
  $('#delay').oninput = ev => { kernel.net.delay = +ev.target.value; $('#delayOut').textContent = `${ev.target.value} ms`; };
  $('#internal').onchange = ev => { showInternal = ev.target.checked; $('#pkList').classList.toggle('show-internal', showInternal); rebuild(); renderGuide(); };
  $('#demo').onchange = async ev => {
    const d = DEMOS[ev.target.value];
    ev.target.value = '';
    if (!d) return;
    await stopAll();
    await sleep(900);
    clearPackets();
    setLoss(d.loss ?? 0);
    while (terms.length < Math.max(...d.run.map(r => r[0])) + 1) addTerm();
    for (const [i, cmd, wait] of d.run) {
      if (wait) await sleep(wait);
      terms[i].exec(cmd);
    }
  };
  addTerm(); addTerm();

  /* ---------------- 3D 图 ---------------- */
  function typeOfChannel(c, ep) {
    const t = rosTypeName(ep.y);
    if (c.kind === 'topic') return t;
    if (c.kind === 'service') return t.replace(/_(Request|Response)$/, '');
    return t.includes('/action/') ? t.replace(/_(FeedbackMessage|(SendGoal|GetResult)_(Request|Response))$/, '') : null;
  }
  const isCli = p => p.state?.nodes.every(n => n.name.startsWith('_ros2cli'));
  const procLabel = p => isCli(p) || !p.state?.nodes.length ? p.cmd : p.state.nodes.map(fqn).join('  ');

  /** 从各进程上报的状态拼出场景：上排进程，下排话题 / 服务 / 动作 */
  function buildSpec() {
    const procs = kernel.alive().filter(p => p.state).sort((a, b) => a.pid - b.pid);
    const chans = new Map(), edges = new Map();
    for (const p of procs) for (const e of p.state.eps) {
      const c = channelOf(e.t);
      if (c.internal && !showInternal) continue;
      const ch = chans.get(c.id) ?? { ...c, type: null };
      ch.type ??= typeOfChannel(c, e);
      chans.set(c.id, ch);
      // 箭头从进程指向通道：发布者、服务客户端、动作客户端
      const pre = e.t.slice(0, 2);
      const out = c.kind === 'topic' ? e.k === 'w' : pre === 'rt' ? e.k === 'r' : (pre === 'rq') === (e.k === 'w');
      const [from, to] = out ? [`p${p.pid}`, c.id] : [c.id, `p${p.pid}`];
      edges.set(`${from}>${to}`, { id: `${from}>${to}`, from, to, flow: false, bidir: c.kind !== 'topic' });
    }
    const list = [...chans.values()].sort((a, b) => a.name.localeCompare(b.name));
    const PW = 4.3, CW = 3.6, wide = Math.max(procs.length * PW, list.length * CW, 6) + 0.5;
    const nodes = procs.map((p, i) => ({
      id: `p${p.pid}`, label: procLabel(p), pos: [(i - (procs.length - 1) / 2) * PW, 2.2, 0], size: [3.8, 1.0, 0.3],
      sub: `${isCli(p) ? '命令行工具 · ' : ''}进程 ${p.pid} · UDP ${p.state.port}`, kind: isCli(p) ? 'muted' : undefined,
    }));
    list.forEach((c, i) => nodes.push({
      id: c.id, label: c.name, pos: [(i - (list.length - 1) / 2) * CW, -1.7, 0], size: [3.2, 0.9, 0.3], kind: 'accent',
      sub: `${KIND_NAME[c.kind]}${c.type ? ' · ' + c.type.split('/').pop() : ''}`,
    }));
    if (!procs.length) nodes.push({ id: 'empty', label: '还没有进程在运行', sub: '在下面的终端里敲一条 ros2 命令，或者选一个演示', pos: [0, 0.3, 0], size: [6.4, 1.1, 0.3], kind: 'muted' });
    const groups = procs.length ? [
      { label: '进程（每个都是中间件里的一个参与者）', x: 0, y: 2.33, w: wide, h: 1.9 },
      ...(list.length ? [{ label: '话题 · 服务 · 动作', x: 0, y: -1.57, w: wide, h: 1.8 }] : []),
    ] : [];
    return { nodes, groups, edges: [...edges.values()] };
  }

  let timer = null;
  function rebuild(fresh = false) {
    if (!active) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const spec = buildSpec();
      const sig = JSON.stringify(spec);
      if (!fresh && sig === rebuild.sig) return;
      rebuild.sig = sig;
      const ids = spec.nodes.map(n => n.id).join();
      const keep = new Set(stage.byId.keys());
      if (fresh) stage.load(spec); else stage.load(spec, { keepCamera: true, keep });
      if (!fresh && ids !== lastIds) stage.refit();
      lastIds = ids;
      if (selId && !stage.byId.has(selId)) selId = null;
      stage.select(selId);
      if (tab === 'guide') renderGuide();
    }, fresh ? 0 : 80);
  }

  /* ---------------- 数据包 ---------------- */
  const procName = pid => {
    const p = kernel.procs.get(pid);
    return p ? procLabel(p) : `进程 ${pid}`;
  };
  /** 数据包里的写者编号属于哪个端点（应答包里的写者在接收方那边） */
  function endpointOf(p) {
    if (p.writerId === undefined) return null;
    const owner = kernel.procs.get(p.kind === 'ACKNACK' ? p.to : p.from);
    return owner?.state?.eps.find(e => e.id === p.writerId) ?? null;
  }
  function where(p) {
    const ep = endpointOf(p), c = ep && channelOf(ep.t);
    return c ? `${c.name}${c.kind === 'topic' ? '' : `（${c.part}）`}` : `写者 ${p.writerId}`;
  }
  function summary(p) {
    switch (p.kind) {
      case 'SPDP': return p.bye ? '我下线了' : `我在这，端口 ${p.port}${p.multicast ? '（多播）' : ''}`;
      case 'SEDP': return `我有 ${p.nodes.length} 个节点、${p.eps.length} 个读者写者`;
      case 'SEDP_REQ': return '请把实体列表再发一份';
      case 'DATA': return `${where(p)} 第 ${p.seq} 条${p.frag[1] > 1 ? `，分片 ${p.frag[0] + 1}/${p.frag[1]}` : ''}${p.readerId ? '（重发）' : ''}`;
      case 'HEARTBEAT': return p.last < p.first ? `${where(p)}：还没有数据` : `${where(p)}：我有第 ${p.first}–${p.last} 条`;
      case 'ACKNACK': return `${where(p)}：第 ${p.base} 条之前都收到了${p.missing.length ? `，缺第 ${p.missing.join('、')} 条` : ''}`;
      default: return '未知的包';
    }
  }
  const pktClass = p => {
    const ep = endpointOf(p);
    return `k-${p.kind}${p.routine ? ' k-ROUTINE' : ''}${p.dropped ? ' dropped' : ''}${ep && channelOf(ep.t).internal ? ' internal' : ''}`;
  };
  const visible = p => !hidden.has(p.kind) && !(p.routine && hidden.has('ROUTINE')) && (showInternal || !(endpointOf(p) && channelOf(endpointOf(p).t).internal));

  const FILTERS = [['SPDP', '发现'], ['ROUTINE', '例行广播'], ['SEDP', '实体列表'], ['DATA', '数据'], ['HEARTBEAT', '心跳'], ['ACKNACK', '应答']];
  function renderFilters() {
    $('#pkFilters').innerHTML = FILTERS.map(([k, n]) => `<button type="button" class="chip${hidden.has(k) ? '' : ' on'}" data-k="${k}"><i style="background:${KIND[k]?.color ?? KIND.SPDP.color}"></i>${n}</button>`).join('')
      + '<button type="button" class="chip" data-k="clear">清空</button>';
    const list = $('#pkList');
    for (const [k] of FILTERS) list.classList.toggle(`hide-${k}`, hidden.has(k));
  }
  $('#pkFilters').onclick = ev => {
    const k = ev.target.closest('[data-k]')?.dataset.k;
    if (!k) return;
    if (k === 'clear') return clearPackets();
    hidden.has(k) ? hidden.delete(k) : hidden.add(k);
    renderFilters();
  };
  renderFilters();
  function clearPackets() { packets = []; selPkt = null; $('#pkList').replaceChildren(); renderPkt(); }

  kernel.on('packet', p => {
    packets.push(p);
    const list = $('#pkList');
    const row = document.createElement('button');
    row.type = 'button';
    // 进程刚启动时，它的状态可能还没报上来，写者编号暂时对不上话题名；等状态到了再补（见下面的 state 事件）
    row.className = `pk ${pktClass(p)}${p.writerId !== undefined && !endpointOf(p) ? ' unres' : ''}`;
    row.dataset.id = p.id;
    row.innerHTML = `<span class="pk-t">${((p.t - t0) / 1000).toFixed(2)}</span><span class="pk-dir">${p.from}→${p.to}</span><span class="pk-kind" style="color:${p.dropped ? DROP_COLOR : KIND[p.kind]?.color}">${p.dropped ? '丢失' : KIND[p.kind]?.name ?? '?'}</span><span class="pk-sum">${esc(summary(p))}</span>`;
    const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.appendChild(row);
    if (packets.length > 400) { packets.shift(); list.firstChild.remove(); }
    if (stick) list.scrollTop = list.scrollHeight;

    if (!active || document.hidden || !visible(p)) return;
    const a = `p${p.from}`, b = `p${p.to}`, dur = Math.max(0.5, p.delay / 1000);
    const ep = p.kind === 'DATA' && endpointOf(p), cid = ep && channelOf(ep.t).id;
    if (cid && stage.byId.has(cid)) stage.pulse([a, cid, b], p.dropped ? DROP_COLOR : KIND.DATA.color, { dur: dur * 1.3, fail: p.dropped, size: 1.15 });
    else stage.pulse([a, b], p.dropped ? DROP_COLOR : KIND[p.kind]?.color ?? '#888', { dur, lift: p.from < p.to ? 0.75 : -0.75, fail: p.dropped, size: 0.85 });
  });
  $('#pkList').onclick = ev => {
    const row = ev.target.closest('.pk');
    if (!row) return;
    selPkt = packets.find(p => p.id === +row.dataset.id) ?? null;
    for (const r of $('#pkList').querySelectorAll('.pk.sel')) r.classList.remove('sel');
    row.classList.add('sel');
    renderPkt();
  };

  function renderPkt() {
    const el = $('#pkDetail'), p = selPkt;
    if (!p) { el.innerHTML = '<p class="pane-note">每一行是内核转发的一个 UDP 数据包（进程号 → 进程号）。点一行看它的内容和原始字节。</p>'; return; }
    const k = KIND[p.kind] ?? { name: '未知', color: '#888', what: '' };
    const ep = endpointOf(p);
    const rows = [['方向', `进程 ${p.from}（${esc(procName(p.from))}，端口 ${p.fromPort}）→ 进程 ${p.to}（${esc(procName(p.to))}，端口 ${p.toPort}）`],
      ['大小', `${p.size} 字节${p.dropped ? '，<b style="color:' + DROP_COLOR + '">被网络丢掉了，对方没收到</b>' : ''}`]];
    let body = '', segs = [[HEADER, 'h1', '包头：魔数 MDDS、版本、类型、发送方的参与者标识']];
    if (ep) rows.push(['中间件话题', `<code>${esc(ep.t)}</code>`], ['类型', `<code>${esc(ep.y)}</code>`]);
    if (p.kind === 'DATA') {
      rows.push(['序号', `第 ${p.seq} 条${p.readerId ? `（重发给读者 ${p.readerId}）` : ''}`]);
      if (p.frag[1] > 1) rows.push(['分片', `${p.frag[0] + 1} / ${p.frag[1]}`]);
      segs.push([HEADER + DATA_HEADER, 'h2', '数据子头：写者编号、读者编号、序号、分片、时间戳']);
      const service = ep && !ep.t.startsWith('rt');
      if (service) segs.push([HEADER + DATA_HEADER + 24, 'h3', '请求头：客户端标识 + 请求编号（应答靠它找回是谁问的）']);
      segs.push([Infinity, 'h4', `消息体：CDR 序列化的结果${p.frag[1] > 1 ? '（这是其中一片）' : ''}`]);
      if (ep && p.frag[1] === 1) {
        try {
          const cdr = p.data.subarray(HEADER + DATA_HEADER + (service ? 24 : 0));
          const text = dump(deserialize(rosTypeName(ep.y), Buffer.from(cdr)));
          body = `<h4>解出来的消息</h4><pre>${esc(text.length > 1500 ? text.slice(0, 1500) + '…' : text) || '（空消息）'}</pre>`;
        } catch { /* 解不开就只显示字节 */ }
      }
    } else if (p.kind === 'HEARTBEAT') {
      rows.push(['内容', p.last < p.first ? '还没有可发的数据' : `我有第 ${p.first} 到第 ${p.last} 条`]);
      segs.push([Infinity, 'h2', '写者编号、读者编号、最早一条的序号、最新一条的序号']);
    } else if (p.kind === 'ACKNACK') {
      rows.push(['内容', `第 ${p.base} 条之前的都收到了${p.missing.length ? `；缺第 ${p.missing.join('、')} 条，请重发` : '，没有缺的'}`]);
      segs.push([Infinity, 'h2', '写者编号、读者编号、已连续收到的位置、缺失的序号列表']);
    } else {
      segs.push([Infinity, 'h4', 'JSON 文本']);
      if (p.kind === 'SPDP') rows.push(['内容', p.bye ? '我要下线了' : `我的单播端口是 ${p.port}，实体列表版本 ${p.epoch}`]);
      if (p.kind === 'SEDP') {
        const shown = p.eps.filter(e => showInternal || !channelOf(e.t).internal);
        rows.push(['节点', p.nodes.map(n => esc(fqn(n))).join('、') || '无']);
        body = `<h4>读者和写者（${shown.length}${shown.length < p.eps.length ? `，另有 ${p.eps.length - shown.length} 个内部的` : ''}）</h4><table>${shown.map(e => `<tr><td>${e.k === 'w' ? '写者' : '读者'}</td><td><code>${esc(e.t)}</code></td><td>${e.q.reliability === 'reliable' ? '可靠' : '尽力'}${e.q.durability === 'transient_local' ? ' · 保留历史' : ''}</td></tr>`).join('')}</table>`;
      }
    }
    el.innerHTML = `<div class="pk-card"><h3><i style="background:${p.dropped ? DROP_COLOR : k.color}"></i>${k.name} <small>#${p.id}</small></h3>
      <p class="what">${k.what}</p>
      <table>${rows.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table>${body}
      <h4>原始字节${p.size > 160 ? `（前 160 个，共 ${p.size}）` : ''}</h4>${hex(p.data, segs)}</div>`;
  }
  /** 十六进制显示，按段着色。segs = [[结束偏移, 样式, 说明], …] */
  function hex(data, segs) {
    let html = '', from = 0;
    const n = Math.min(data.length, 160);
    for (const [end, cls] of segs) {
      const to = Math.min(end, n);
      if (to <= from) continue;
      html += `<span class="${cls}">${[...data.subarray(from, to)].map(b => b.toString(16).padStart(2, '0')).join(' ')}</span> `;
      from = to;
    }
    return `<div class="hex">${html}</div><ul class="legend">${segs.filter(([, , t], i) => (i ? segs[i - 1][0] : 0) < n).map(([, cls, t]) => `<li><i class="${cls}"></i>${t}</li>`).join('')}</ul>`;
  }
  renderPkt();

  /* ---------------- 启动过程 ---------------- */
  function renderBoot() {
    if (tab !== 'boot') return;
    const all = [...kernel.procs.values()].slice(-10);
    if (!kernel.procs.has(bootPid)) bootPid = all.at(-1)?.pid ?? null;
    $('#bootProcs').innerHTML = all.length
      ? all.map(p => `<button type="button" class="chip${p.pid === bootPid ? ' on' : ''}${p.alive ? '' : ' dead'}" data-pid="${p.pid}" title="${esc(p.cmd)}">${p.pid} · ${esc(p.cmd.replace(/^ros2 (run \S+ )?/, '').slice(0, 26))}</button>`).join('')
      : '<span class="pane-note">还没有启动过进程。</span>';
    const proc = kernel.procs.get(bootPid);
    $('#bootList').innerHTML = proc ? proc.trace.map(ev => `<li><time>+${Math.round(ev.t - proc.started)} 毫秒</time><div>${ev.html}${ev.detail ? `<details><summary>展开</summary><pre>${esc(ev.detail)}</pre></details>` : ''}</div></li>`).join('') : '';
  }
  $('#bootProcs').onclick = ev => {
    const b = ev.target.closest('[data-pid]');
    if (b) { bootPid = +b.dataset.pid; follow = false; renderBoot(); }
  };
  kernel.on('trace', proc => { if (proc.pid === bootPid) renderBoot(); });

  /* ---------------- 序列化 ---------------- */
  const SAMPLES = {
    'std_msgs/msg/String': '{data: "你好 ROS"}',
    'geometry_msgs/msg/Twist': '{linear: {x: 2.0}, angular: {z: 1.5}}',
    'example_interfaces/srv/AddTwoInts_Request': '{a: 40, b: 2}',
    'example_interfaces/action/Fibonacci_Result': '{sequence: [0, 1, 1, 2, 3]}',
    'std_msgs/msg/Header': '{stamp: {sec: 1700000000, nanosec: 500}, frame_id: map}',
    'turtlesim/msg/Pose': '{x: 5.5, y: 5.5, theta: 1.57}',
  };
  const cdrTypes = listInterfaces().flatMap(n => {
    const kind = n.split('/')[1];
    return kind === 'msg' ? [n] : kind === 'srv' ? [`${n}_Request`, `${n}_Response`] : [`${n}_Goal`, `${n}_Result`, `${n}_Feedback`];
  });
  $('#cdrType').innerHTML = cdrTypes.map(t => `<option${t === 'std_msgs/msg/String' ? ' selected' : ''}>${t}</option>`).join('');
  const plain = v => JSON.stringify(v, (k, x) => ArrayBuffer.isView(x) ? [...x] : typeof x === 'bigint' ? Number(x) : x);
  function cdrPick() {
    const t = $('#cdrType').value;
    $('#cdrVal').value = SAMPLES[t] ?? plain(createMessage(t)).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ');
    renderCdr();
  }
  function renderCdr() {
    const t = $('#cdrType').value, out = $('#cdrOut');
    const base = t.replace(/_(Request|Response|Goal|Result|Feedback)$/, '');
    $('#cdrSrc').textContent = interfaceText(base) || '（空：没有任何字段）';
    try {
      const def = getType(t), regions = [];
      const buf = serialize(def, parseArg($('#cdrVal').value || '{}'), (path, type, s, e) => regions.push({ path, type, s, e }));
      const color = i => `hsl(${(i * 67 + 205) % 360} 70% var(--byte-l))`;
      const owner = new Array(buf.length).fill(-1);
      regions.forEach((r, i) => owner.fill(i, r.s, r.e));
      const n = Math.min(buf.length, 256);
      let bytes = '';
      for (let i = 0; i < n; i++) {
        const r = regions[owner[i]];
        const style = i < 4 ? '' : r ? ` style="background:${color(owner[i])}"` : '';
        const title = i < 4 ? '封装头：表示小端 CDR' : r ? `${r.path}（${r.type}）` : '对齐用的填充字节';
        bytes += `<span class="${i < 4 ? 'enc' : r ? '' : 'pad'}"${style} title="${esc(title)}">${buf[i].toString(16).padStart(2, '0')}</span>`;
      }
      const shown = regions.slice(0, 40);
      out.innerHTML = `
        <h4>① 解析接口，得到类型</h4>
        <p class="pane-note">${def.fields.length} 个字段。在中间件里这个类型叫 <code>${esc(ddsTypeName(t))}</code>。</p>
        <h4>② 按字段顺序写成字节（共 ${buf.length} 个）</h4>
        <div class="bytes">${bytes}</div>${buf.length > n ? `<p class="pane-note">只显示前 ${n} 个字节。</p>` : ''}
        <ul class="legend"><li><i class="enc"></i>封装头 4 字节</li><li><i class="pad"></i>对齐填充：每个值要落在自己大小的整数倍位置上</li></ul>
        <table class="regions"><tr><th>字段</th><th>类型</th><th>位置</th><th>字节</th></tr>
        ${shown.map((r, i) => `<tr><td><i style="background:${color(i)}"></i>${esc(r.path)}</td><td>${esc(r.type)}</td><td>${r.s}</td><td>${r.e - r.s}</td></tr>`).join('')}</table>
        ${regions.length > shown.length ? `<p class="pane-note">还有 ${regions.length - shown.length} 项没有列出。</p>` : ''}
        <h4>③ 交给中间件</h4>
        <p class="pane-note">这串字节前面加上包头和序号，就是「数据包」页里看到的数据包的消息体。字符串 = 4 字节长度 + 内容 + 结尾的 00；变长数组 = 4 字节个数 + 各个元素。</p>`;
    } catch (err) {
      out.innerHTML = `<p class="pane-note err">${esc(err.message)}</p>`;
    }
  }
  $('#cdrType').onchange = cdrPick;
  $('#cdrVal').oninput = renderCdr;
  $('#cdrVal').addEventListener('keydown', ev => ev.stopPropagation());
  cdrPick();

  /* ---------------- 说明 / 选中详情 ---------------- */
  function renderGuide() {
    const el = pane('guide');
    const proc = selId?.startsWith('p') && kernel.procs.get(+selId.slice(1));
    if (proc?.state) {
      const eps = proc.state.eps.filter(e => showInternal || !channelOf(e.t).internal);
      el.innerHTML = `<button class="back" type="button">‹ 说明</button><h2>${esc(procLabel(proc))}</h2>
        <div class="tag">进程 ${proc.pid} · UDP 端口 ${proc.state.port} · 域 ${proc.state.domain}</div>
        <div class="body"><p>启动命令：<code>${esc(proc.cmd)}</code></p>
        <p>它在中间件里是一个参与者，标识 <code>${proc.state.prefix.slice(0, 12)}…</code>，已经发现了 ${proc.state.peers.length} 个别的参与者。</p>
        <h3>它的读者和写者${eps.length < proc.state.eps.length ? `（另有 ${proc.state.eps.length - eps.length} 个内部的没列出）` : ''}</h3>
        ${eps.length ? `<table><tr><th>中间件话题</th><th></th><th>已匹配</th></tr>${eps.map(e => `<tr><td><code>${esc(e.t)}</code></td><td>${e.k === 'w' ? '写者' : '读者'}</td><td>${e.m.length}</td></tr>`).join('')}</table>` : '<p>没有。</p>'}
        <p><button class="btn btn-sm" type="button" data-boot="${proc.pid}">看它的启动过程</button></p></div>`;
      return;
    }
    const chan = selId && !proc ? chanInfo(selId) : null;
    if (chan) { el.innerHTML = chan; return; }
    el.innerHTML = GUIDE;
  }
  function chanInfo(id) {
    const members = [];
    let c = null, type = null;
    for (const p of kernel.alive()) for (const e of p.state?.eps ?? []) {
      const x = channelOf(e.t);
      if (x.id !== id) continue;
      c = x; type ??= typeOfChannel(x, e);
      members.push({ p, e });
    }
    if (!c) return null;
    let src = '';
    try { src = interfaceText(type); } catch { /* 没有源文件 */ }
    const names = [...new Set(members.map(m => m.e.t))].sort();
    const how = c.kind === 'topic' ? '话题在中间件里就是一个同名的话题，前面加上 <code>rt</code>。'
      : c.kind === 'service' ? '中间件里没有“服务”，它是用两个话题拼出来的：一个传请求（<code>rq…Request</code>），一个传应答（<code>rr…Reply</code>）。'
        : '中间件里没有“动作”，它是用 3 个服务加 2 个话题拼出来的：提交目标、取消、取结果，以及进度反馈和状态。';
    return `<button class="back" type="button">‹ 说明</button><h2>${esc(c.name)}</h2>
      <div class="tag">${KIND_NAME[c.kind]}${type ? ' · ' + esc(type) : ''}</div>
      <div class="body"><p>${how}</p>
      <h3>中间件里实际的话题</h3><ul>${names.map(n => `<li><code>${esc(n)}</code></li>`).join('')}</ul>
      <h3>谁在用</h3><table><tr><th>进程</th><th></th><th>中间件话题</th><th>QoS</th></tr>${members.map(({ p, e }) => `<tr><td>${p.pid} ${esc(procLabel(p))}</td><td>${e.k === 'w' ? '写' : '读'}</td><td><code>${esc(e.t.slice(e.t.lastIndexOf('/') + 1))}</code></td><td>${e.q.reliability === 'reliable' ? '可靠' : '尽力'}</td></tr>`).join('')}</table>
      ${src ? `<h3>接口定义</h3></div><pre>${esc(src)}</pre>` : '</div>'}`;
  }
  pane('guide').onclick = ev => {
    if (ev.target.closest('.back')) return select(null);
    const boot = ev.target.closest('[data-boot]');
    if (boot) { bootPid = +boot.dataset.boot; follow = false; return setTab('boot'); }
    const t = ev.target.closest('.try');
    if (t && current) { current.input.value = t.textContent; if (!current.fg) current.input.focus(); }
  };
  function select(id) {
    selId = id && id !== 'empty' ? id : null;
    stage.select(selId);
    if (selId || tab === 'guide') setTab('guide');
  }

  kernel.on('spawn', proc => { if (follow || bootPid === null) bootPid = proc.pid; renderBoot(); });
  kernel.on('state', () => {
    rebuild();
    for (const row of $('#pkList').querySelectorAll('.unres')) {
      const p = packets.find(x => x.id === +row.dataset.id);
      if (!p || !endpointOf(p)) continue;
      row.className = `pk ${pktClass(p)}${row.classList.contains('sel') ? ' sel' : ''}`;
      row.querySelector('.pk-sum').textContent = summary(p);
    }
  });
  kernel.on('exit', () => { rebuild(); renderBoot(); });
  setTab('guide');

  return {
    kernel,
    select,
    enter() { active = true; host.classList.add('lab-on'); lastIds = ''; rebuild(true); },
    leave() { active = false; host.classList.remove('lab-on'); clearTimeout(timer); },
    /** 3D 画面要给右侧面板和底部终端让出的像素 */
    insets: () => [side.offsetWidth + 16, dock.offsetHeight + 32],
  };
}
