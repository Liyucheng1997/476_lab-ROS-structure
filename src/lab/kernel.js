// 页面这一侧扮演“操作系统 + 网络”：
//   - 进程表：每个进程是一个 Web Worker，里面跑的是 ros2/ 目录的真实代码；
//   - 网络：进程的 UDP 套接字在这里登记端口，数据包由这里转发，可以加延迟、丢包；
//   - 旁路监听：每个转发的包、每次端口绑定、每次读文件都会作为事件发出来，供界面画图。
import { decode, channelOf } from './decode.js';

const now = () => performance.now();

export class Kernel {
  constructor() {
    this.procs = new Map();
    this.socks = [];                  // { pid, sock, port, reuse, groups }
    this.nextPid = 1; this.nextPort = 49152; this.nextPkt = 1;
    this.net = { delay: 100, loss: 0 };
    this.met = new Set();             // 已经互相打过招呼的进程对
    this.listeners = {};
  }
  on(ev, fn) { (this.listeners[ev] ??= []).push(fn); }
  emit(ev, ...a) { for (const fn of this.listeners[ev] || []) fn(...a); }
  alive() { return [...this.procs.values()].filter(p => p.alive); }

  /** 启动一个进程。argv 形如 ['node', '/ros2/cli/ros2.js', 'run', 'demo_nodes', 'talker'] */
  spawn(argv, { env = {}, parent = null, childId = null, tty = null } = {}) {
    const pid = this.nextPid++;
    const worker = new Worker(new URL('./proc.worker.js', import.meta.url), { type: 'module' });
    const proc = { pid, argv, env, parent, childId, tty, worker, alive: true, raw: false, state: null, trace: [],
      cmd: `ros2 ${argv.slice(2).join(' ')}`, started: now() };
    this.procs.set(pid, proc);
    worker.onmessage = e => this._onMessage(proc, e.data);
    worker.onerror = e => { this._out(proc, 'stderr', `进程崩溃：${e.message}`); this._exit(proc, 1); };
    worker.postMessage({ type: 'start', pid, argv, env });
    this.emit('spawn', proc);
    this.trace(proc, `操作系统创建进程 ${pid}：<code>${esc(proc.cmd)}</code>`);
    for (const old of [...this.procs.values()].filter(p => !p.alive).slice(0, -40)) this.procs.delete(old.pid);
    return proc;
  }

  /** 发信号（Ctrl+C）。进程有机会先说一声“我走了”；不退就强制结束 */
  kill(pid, name = 'SIGINT') {
    const proc = this.procs.get(pid);
    if (!proc?.alive) return;
    proc.worker.postMessage({ type: 'signal', name });
    setTimeout(() => this._exit(proc, 130), 800);
  }
  stdin(pid, data) { this.procs.get(pid)?.worker.postMessage({ type: 'stdin', data }); }

  trace(proc, html, detail) {
    const ev = { t: now(), html, detail };
    proc.trace.push(ev);
    this.emit('trace', proc, ev);
  }

  _out(proc, stream, text) {
    const parent = proc.parent && this.procs.get(proc.parent);
    if (parent?.alive) parent.worker.postMessage({ type: 'child', op: 'out', id: proc.childId, stream, text });
    else this.emit('out', proc, stream, text);
  }

  _exit(proc, code) {
    if (!proc.alive) return;
    proc.alive = false;
    proc.worker.terminate();
    this.socks = this.socks.filter(s => s.pid !== proc.pid);
    const parent = proc.parent && this.procs.get(proc.parent);
    if (parent?.alive) parent.worker.postMessage({ type: 'child', op: 'exit', id: proc.childId, code });
    this.trace(proc, `进程退出（退出码 ${code}）`);
    this.emit('exit', proc, code);
  }

  _onMessage(proc, m) {
    if (!proc.alive) return;
    switch (m.type) {
      case 'out': return this._out(proc, m.stream, m.text);
      case 'exit': return this._exit(proc, m.code);
      case 'raw': proc.raw = m.on; return this.emit('raw', proc);
      case 'net': return this._net(proc, m);
      case 'state': return this._state(proc, m.state);
      case 'trace': return this._traceFrom(proc, m.ev);
      case 'spawn': {
        const child = this.spawn(m.argv, { env: proc.env, parent: proc.pid, childId: m.id, tty: proc.tty });
        return proc.worker.postMessage({ type: 'child', op: 'pid', id: m.id, pid: child.pid });
      }
      case 'killchild': {
        const child = [...this.procs.values()].find(p => p.parent === proc.pid && p.childId === m.id);
        return child && this.kill(child.pid);
      }
    }
  }

  /* ---------- 网络 ---------- */

  _net(proc, m) {
    const mine = this.socks.find(s => s.pid === proc.pid && s.sock === m.sock);
    if (m.op === 'bind') {
      const port = m.port || this.nextPort++;
      const taken = this.socks.some(s => s.port === port && !(s.reuse && m.reuse));
      proc.worker.postMessage({ type: 'net', op: 'bound', sock: m.sock, port, error: taken });
      if (taken) return this.trace(proc, `想绑定 UDP 端口 ${port}，已被别的进程占用，换下一个`);
      this.socks.push({ pid: proc.pid, sock: m.sock, port, reuse: m.reuse, groups: new Set() });
      return this.trace(proc, m.reuse
        ? `绑定多播端口 ${port}（同一个域里所有进程共用，只用来听别人的“我在这”）`
        : `绑定 UDP 端口 ${port}（自己独占，发现和数据都从这里收发）`);
    }
    if (!mine) return;
    if (m.op === 'join') { mine.groups.add(m.group); return this.trace(proc, `加入多播组 ${m.group}`); }
    if (m.op === 'close') { this.socks = this.socks.filter(s => s !== mine); return; }
    if (m.op !== 'send') return;

    const multicast = m.addr.startsWith('239.');
    if (!multicast && m.addr !== '127.0.0.1') return;       // 这个虚拟网络里只有一台机器
    const info = decode(m.data);
    for (const t of this.socks) {
      if (t.port !== m.port || t.pid === proc.pid || (multicast ? !t.groups.has(m.addr) : t.reuse)) continue;
      const target = this.procs.get(t.pid);
      let routine = false;
      if (info?.kind === 'SPDP' && !info.bye) {
        const key = `${proc.pid}>${t.pid}`;
        routine = this.met.has(key);                         // 第一次打招呼之后的都是例行广播
        this.met.add(key);
      }
      const dropped = !!info?.lossy && Math.random() < this.net.loss;
      const delay = this.net.delay;
      this.emit('packet', { id: this.nextPkt++, t: now(), from: proc.pid, to: t.pid, fromPort: mine.port, toPort: t.port,
        multicast, data: m.data, size: m.data.length, routine, dropped, delay, ...(info || { kind: '?' }) });
      if (dropped) continue;
      // 延迟交给接收方进程自己去等：页面在后台时浏览器会把页面里的定时器压到一秒一次，进程里的不会
      if (target.alive) target.worker.postMessage({ type: 'net', op: 'msg', sock: t.sock, data: m.data, delay,
        rinfo: { address: '127.0.0.1', family: 'IPv4', port: mine.port } });
    }
  }

  /* ---------- 进程上报的状态、启动过程 ---------- */

  pidOfPrefix(prefix) {
    for (const p of this.procs.values()) if (p.state?.prefix === prefix) return p.pid;
    return null;
  }

  _state(proc, state) {
    const old = proc.state || { nodes: [], eps: [], peers: [] };
    proc.state = state;
    if (!old.prefix) this.trace(proc, `中间件就绪：参与者标识 <code>${state.prefix.slice(0, 8)}…</code>，域号 ${state.domain}，开始广播“我在这”`);
    for (const n of state.nodes) {
      if (!old.nodes.some(o => o.name === n.name && o.ns === n.ns)) this.trace(proc, `创建节点 <code>${esc((n.ns === '/' ? '' : n.ns) + '/' + n.name)}</code>`);
    }
    const fresh = state.eps.filter(e => !old.eps.some(o => o.id === e.id));
    let internal = 0;
    for (const e of fresh) {
      const c = channelOf(e.t);
      if (c.internal) { internal++; continue; }
      const role = c.kind === 'topic' ? (e.k === 'w' ? '发布者' : '订阅者') : `${c.kind === 'service' ? '服务' : '动作'}的一部分（${c.part}）`;
      this.trace(proc, `创建${e.k === 'w' ? '写者' : '读者'} <code>${esc(e.t)}</code> —— ${c.kind === 'topic' ? '话题' : c.kind === 'service' ? '服务' : '动作'} ${esc(c.name)} 的${role}`,
        `中间件里的话题名：${e.t}\n中间件里的类型名：${e.y}\nQoS：${e.q.reliability} / ${e.q.durability} / 深度 ${e.q.depth}`);
    }
    if (internal) this.trace(proc, `创建内部用的读者、写者 ${internal} 个（参数服务、/rosout 日志、/parameter_events）`);
    for (const p of state.peers) if (!old.peers.includes(p)) this.trace(proc, `发现了另一个参与者：进程 ${this.pidOfPrefix(p) ?? '?'}`);
    for (const p of old.peers) if (!state.peers.includes(p)) this.trace(proc, `一个参与者下线了：<code>${p.slice(0, 8)}…</code>`);
    for (const e of state.eps) {
      const before = old.eps.find(o => o.id === e.id)?.m || [];
      const c = channelOf(e.t);
      if (c.internal) continue;
      for (const g of e.m) {
        if (before.includes(g)) continue;
        const pid = this.pidOfPrefix(g.split('.')[0]);
        this.trace(proc, `匹配成功：${esc(c.name)}${c.kind === 'topic' ? '' : `（${c.part}）`} 的${e.k === 'w' ? '写者' : '读者'} ↔ 进程 ${pid ?? '?'} 的${e.k === 'w' ? '读者' : '写者'}（名字、类型相同，QoS 兼容）`);
      }
    }
    this.emit('state', proc);
  }

  _traceFrom(proc, ev) {
    if (ev.type === 'import') this.trace(proc, `在包目录里找到可执行文件并加载：<code>${esc(ev.path)}</code>`);
    else if (ev.type === 'fs' && /\.(msg|srv|action)$/.test(ev.path)) {
      this.trace(proc, `读取并解析接口文件 <code>${esc(ev.path.replace(/^\/ros2\/(interfaces|packages)\//, ''))}</code>`, ev.text.trimEnd() || '（空）');
    }
  }
}

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
