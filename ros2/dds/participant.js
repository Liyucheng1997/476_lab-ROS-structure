// 一个按 DDS / RTPS 思路写的小型中间件：
//   - 没有中心节点。每个进程是一个“参与者”，用 UDP 多播 + 本机端口探测互相发现；
//   - 发现分两步：先交换“我在这”（相当于 SPDP），再交换各自有哪些读者、写者（相当于 SEDP）；
//   - 话题名、类型名相同且 QoS 兼容的写者和读者自动匹配，之后数据点对点直发；
//   - 可靠传输用 心跳（HEARTBEAT）+ 应答（ACKNACK）+ 重发 实现，大消息自动分片。
// 线上格式是自己定的，不能和 Fast DDS 等真实 RTPS 实现互通。
import dgram from 'node:dgram';
import os from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { incompatible } from './qos.js';

const MAGIC = Buffer.from('MDDS');
const VERSION = 1;
const HDR = 18;                       // 魔数 4 + 版本 1 + 类型 1 + 参与者前缀 12
const K = { SPDP: 1, SEDP: 2, SEDP_REQ: 3, DATA: 4, HEARTBEAT: 5, ACKNACK: 6 };
const GROUP = '239.255.0.1';          // RTPS 规定的发现多播地址
const MAX_PEERS = 24;                 // 同一台机器上最多探测这么多个参与者端口
const FRAG = 8192;                    // 单个数据包里最多带这么多字节的消息体
const ANNOUNCE_MS = 1000, LEASE_MS = 5000, HEARTBEAT_MS = 100;

class Endpoint {
  constructor(p, kind, { topic, type, qos, node }) {
    this.p = p; this.kind = kind; this.id = p.nextId++;
    this.guid = `${p.prefixHex}.${this.id}`;
    this.topic = topic; this.type = type; this.qos = qos; this.node = node;
  }
  wire() { return { id: this.id, k: this.kind, t: this.topic, y: this.type, q: this.qos, n: this.node }; }
  _prune(map, live) { for (const g of map.keys()) if (!live.has(g)) map.delete(g); }
}

export class Writer extends Endpoint {
  constructor(p, o) {
    super(p, 'w', o);
    this.seq = 0;
    this.history = [];                // 连续的最近若干条，用于重发和晚加入的读者
    this.cap = o.qos.history === 'keep_all' ? 5000 : Math.max(1, o.qos.depth);
    this.matched = new Map();         // 读者 guid → 匹配状态
    this.hbTimer = null; this.lastHb = 0;
  }

  write(payload) {
    const s = { seq: ++this.seq, payload, ts: Date.now() };
    this.history.push(s);
    if (this.history.length > this.cap) this.history.shift();
    const sent = new Set();
    let reliable = false;
    for (const m of this.matched.values()) {
      if (m.local) { m.local._deliver(this.guid, s); continue; }
      if (m.reliable) reliable = true;
      if (sent.has(m.peer)) continue;   // 同一个进程里有多个读者时只发一份
      sent.add(m.peer);
      this.p._sendData(this, s, m.peer, 0);
    }
    if (reliable) this._startHb(Date.now() - this.lastHb > 20);
    return s.seq;
  }

  _match(r) {
    if (this.matched.has(r.guid)) return;
    const reliable = this.qos.reliability === 'reliable' && r.qos.reliability === 'reliable';
    const tl = this.qos.durability === 'transient_local' && r.qos.durability === 'transient_local';
    // startSeq：这个读者应该从哪一条开始收。晚加入的普通读者不补历史，transient_local 的才补。
    this.matched.set(r.guid, { id: r.id, peer: r.peer || null, local: r.peer ? null : r, reliable,
      startSeq: tl ? 0 : this.seq + 1, acked: 0 });
    if (r.peer && reliable) this._startHb(true);
  }

  _startHb(now) {
    if (now) this._heartbeat();
    if (!this.hbTimer) this.hbTimer = setInterval(() => this._heartbeat(), HEARTBEAT_MS);
  }

  /** 告诉每个可靠读者“我这里有第 first 到 last 条”，直到对方确认全收到 */
  _heartbeat() {
    this.lastHb = Date.now();
    const first = this.history.length ? this.history[0].seq : this.seq + 1;
    let pending = false;
    for (const m of this.matched.values()) {
      if (m.local || !m.reliable || m.acked > this.seq) continue;
      pending = true;
      const b = Buffer.allocUnsafe(24);
      b.writeUInt32LE(this.id, 0); b.writeUInt32LE(m.id, 4);
      b.writeDoubleLE(Math.max(first, m.startSeq), 8); b.writeDoubleLE(this.seq, 16);
      this.p._send(K.HEARTBEAT, [b], m.peer);
    }
    if (!pending) this._stopHb();
  }
  _stopHb() { clearInterval(this.hbTimer); this.hbTimer = null; }

  _onAcknack(prefix, readerId, base, missing) {
    const m = this.matched.get(`${prefix}.${readerId}`);
    if (!m) return;
    if (base > m.acked) m.acked = base;
    const first = this.history[0]?.seq;
    for (const seq of missing) {
      const s = this.history[seq - first];
      if (s) this.p._sendData(this, s, m.peer, readerId);
    }
  }
}

export class Reader extends Endpoint {
  constructor(p, o) {
    super(p, 'r', o);
    this.onData = o.onData;
    this.cap = o.qos.history === 'keep_all' ? 5000 : Math.max(1, o.qos.depth);
    this.queue = [];                  // 已按序到达、等上层取走的消息
    this.writers = new Map();         // 写者 guid → 接收状态
  }

  _match(w) {
    if (this.writers.has(w.guid)) return;
    const reliable = this.qos.reliability === 'reliable' && w.qos.reliability === 'reliable';
    const tl = this.qos.durability === 'transient_local' && w.qos.durability === 'transient_local';
    this.writers.set(w.guid, { guid: w.guid, peer: w.peer || null, reliable,
      expected: null, buf: new Map(), frags: new Map() });
    if (!w.peer && tl) for (const s of w.history) this._deliver(w.guid, s);
  }

  _onData(prefix, writerId, seq, fi, fc, ts, chunk) {
    const w = this.writers.get(`${prefix}.${writerId}`);
    if (!w) return;
    if (w.expected !== null && seq < w.expected) return;      // 重复或过期
    if (w.reliable && w.buf.has(seq)) return;
    let payload = chunk;
    if (fc > 1) {                                              // 分片：凑齐再往下走
      let f = w.frags.get(seq);
      if (!f) {
        f = { parts: new Array(fc), got: 0 };
        w.frags.set(seq, f);
        if (w.frags.size > 16) w.frags.delete(w.frags.keys().next().value);
      }
      if (!f.parts[fi]) { f.parts[fi] = chunk; f.got++; }
      if (f.got < fc) return;
      w.frags.delete(seq);
      payload = Buffer.concat(f.parts);
    }
    const s = { seq, payload, ts };
    if (!w.reliable) { w.expected = seq + 1; this._deliver(w.guid, s); return; }
    w.buf.set(seq, s);
    this._drain(w);          // 还没收到过心跳（expected 为 null）时先攒着
  }

  _onHeartbeat(prefix, writerId, first, last) {
    const w = this.writers.get(`${prefix}.${writerId}`);
    if (!w || !w.reliable) return;
    if (w.expected === null || w.expected < first) {           // 起点，或者更早的已经拿不到了
      w.expected = first;
      for (const k of w.buf.keys()) if (k < first) w.buf.delete(k);
    }
    this._drain(w);
    const missing = [];
    for (let s = w.expected; s <= last && missing.length < 64; s++) if (!w.buf.has(s)) missing.push(s);
    const b = Buffer.allocUnsafe(18 + 8 * missing.length);
    b.writeUInt32LE(writerId, 0); b.writeUInt32LE(this.id, 4);
    b.writeDoubleLE(w.expected, 8); b.writeUInt16LE(missing.length, 16);
    missing.forEach((s, i) => b.writeDoubleLE(s, 18 + 8 * i));
    this.p._send(K.ACKNACK, [b], w.peer);
  }

  /** 把缓冲区里从 expected 开始连续的消息按顺序交出去 */
  _drain(w) {
    if (w.expected === null) return;
    let s;
    while ((s = w.buf.get(w.expected))) {
      w.buf.delete(w.expected++);
      this._deliver(w.guid, s);
    }
  }

  _deliver(writerGuid, s) {
    this.queue.push({ payload: s.payload, seq: s.seq, ts: s.ts, writerGuid });
    if (this.queue.length > this.cap) this.queue.shift();
    this.onData?.();
  }

  take() { return this.queue.shift() ?? null; }
}

export class Participant extends EventEmitter {
  constructor({ domainId = 0, localhostOnly = false, staticPeers = [], lossRate = 0 } = {}) {
    super();
    if (!(domainId >= 0 && domainId <= 232)) throw new Error('ROS_DOMAIN_ID 需在 0–232 之间');
    this.domainId = domainId; this.localhostOnly = localhostOnly;
    this.staticPeers = staticPeers; this.lossRate = lossRate;   // lossRate：测试用，模拟丢包
    this.prefix = crypto.randomBytes(12); this.prefixHex = this.prefix.toString('hex');
    this.base = 7400 + 250 * domainId;                          // 和 RTPS 一样的端口算法
    this.peers = new Map();           // 对方前缀 → { addr, port, lastSeen, epoch, nodes, endpoints }
    this.local = new Map();           // 实体 id → 本地读者 / 写者
    this.nodes = [];                  // 本进程里的 ROS 节点 [{ name, ns }]
    this.epoch = 0;                   // 本地实体每变一次加一，对方靠它判断手里的列表是否过期
    this.nextId = 1; this.closed = false; this.warned = new Set(); this.timers = [];
  }

  async start() {
    const addr = this.localhostOnly ? '127.0.0.1' : '0.0.0.0';
    const bind = port => new Promise((resolve, reject) => {
      const s = dgram.createSocket('udp4');
      s.once('error', e => { s.close(); reject(e); });
      s.bind({ port, address: addr, exclusive: true }, () => { s.removeAllListeners('error'); resolve(s); });
    });
    // 单播端口：7410 + 250×域号 + 2×序号，第一个没被占用的就是自己的
    for (let pid = 0; pid < MAX_PEERS && !this.sock; pid++) this.sock = await bind(this.base + 10 + 2 * pid).catch(() => null);
    this.sock ??= await bind(0);
    this.port = this.sock.address().port;
    try { this.sock.setRecvBufferSize(4 << 20); this.sock.setSendBufferSize(4 << 20); } catch { /* 系统不允许就用默认值 */ }
    this.sock.on('error', () => {});
    this.sock.on('message', (m, r) => this._onPacket(m, r));

    if (!this.localhostOnly) {
      // 多播端口大家共用，只收不发
      const ms = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      ms.on('error', () => {});
      ms.on('message', (m, r) => this._onPacket(m, r));
      await new Promise(resolve => { ms.once('error', resolve); ms.bind(this.base, resolve); });
      try { ms.addMembership(GROUP); } catch { /* 没有可用网卡 */ }
      for (const list of Object.values(os.networkInterfaces())) for (const i of list) {
        if (i.family === 'IPv4' && !i.internal) try { ms.addMembership(GROUP, i.address); } catch { /* 已加入 */ }
      }
      this.msock = ms;
    }
    for (const d of [0, 150, 400]) this.timers.push(setTimeout(() => this._announce(), d));
    this.timers.push(setInterval(() => this._tick(), ANNOUNCE_MS));
    return this;
  }

  async close() {
    if (this.closed) return;
    this._announce(true);
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    for (const e of this.local.values()) if (e.kind === 'w') e._stopHb();
    await new Promise(r => setTimeout(r, 20));    // 让“我走了”发出去
    this.sock.close(); this.msock?.close();
  }

  createWriter(o) { return this._add(new Writer(this, o)); }
  createReader(o) { return this._add(new Reader(this, o)); }
  _add(e) { this.local.set(e.id, e); this._localChanged(); return e; }
  deleteEndpoint(e) {
    if (e.kind === 'w') e._stopHb();
    this.local.delete(e.id);
    this._localChanged();
  }

  /** 本地实体变了：重新匹配，并把新列表发给所有已知的参与者 */
  _localChanged() {
    this.epoch++;
    if (this._dirty) return;
    this._dirty = true;
    setImmediate(() => {
      this._dirty = false;
      if (this.closed) return;
      this._rematch();
      for (const p of this.peers.values()) this._sendSedp(p);
    });
  }

  /* ---------- 收发 ---------- */

  _send(kind, bufs, to) {
    if (this.closed) return;
    if (this.lossRate && kind >= K.DATA && Math.random() < this.lossRate) return;
    const h = Buffer.allocUnsafe(HDR);
    MAGIC.copy(h); h[4] = VERSION; h[5] = kind; this.prefix.copy(h, 6);
    this.sock.send([h, ...bufs], to.port, to.addr, () => {});
  }
  _sendJson(kind, obj, to) { this._send(kind, [Buffer.from(JSON.stringify(obj))], to); }

  _sendData(w, s, peer, readerId) {
    const n = Math.max(1, Math.ceil(s.payload.length / FRAG));
    for (let i = 0; i < n; i++) {
      const h = Buffer.allocUnsafe(28);
      h.writeUInt32LE(w.id, 0); h.writeUInt32LE(readerId, 4); h.writeDoubleLE(s.seq, 8);
      h.writeUInt16LE(i, 16); h.writeUInt16LE(n, 18); h.writeDoubleLE(s.ts, 20);
      this._send(K.DATA, [h, s.payload.subarray(i * FRAG, (i + 1) * FRAG)], peer);
    }
  }

  _onPacket(msg, rinfo) {
    if (this.closed || msg.length < HDR || msg.compare(MAGIC, 0, 4, 0, 4) !== 0 || msg[4] !== VERSION) return;
    const prefix = msg.toString('hex', 6, 18);
    if (prefix === this.prefixHex) return;
    const b = msg.subarray(HDR);
    try {
      switch (msg[5]) {
        case K.SPDP: return this._onSpdp(prefix, JSON.parse(b), rinfo);
        case K.SEDP: return this._onSedp(prefix, JSON.parse(b));
        case K.SEDP_REQ: { const p = this.peers.get(prefix); return p && this._sendSedp(p); }
        case K.DATA: {
          const writerId = b.readUInt32LE(0), readerId = b.readUInt32LE(4);
          const args = [prefix, writerId, b.readDoubleLE(8), b.readUInt16LE(16), b.readUInt16LE(18), b.readDoubleLE(20), b.subarray(28)];
          if (readerId) { const r = this.local.get(readerId); if (r?.kind === 'r') r._onData(...args); }
          else for (const r of this.local.values()) if (r.kind === 'r') r._onData(...args);
          return;
        }
        case K.HEARTBEAT: {
          const r = this.local.get(b.readUInt32LE(4));
          if (r?.kind === 'r') r._onHeartbeat(prefix, b.readUInt32LE(0), b.readDoubleLE(8), b.readDoubleLE(16));
          return;
        }
        case K.ACKNACK: {
          const w = this.local.get(b.readUInt32LE(0));
          if (w?.kind !== 'w') return;
          const missing = [];
          for (let i = 0, n = b.readUInt16LE(16); i < n; i++) missing.push(b.readDoubleLE(18 + 8 * i));
          return w._onAcknack(prefix, b.readUInt32LE(4), b.readDoubleLE(8), missing);
        }
      }
    } catch { /* 损坏的包直接丢弃 */ }
  }

  /* ---------- 发现 ---------- */

  _announce(bye = false) {
    const body = [Buffer.from(JSON.stringify({ port: this.port, epoch: this.epoch, bye }))];
    if (!this.localhostOnly) this._send(K.SPDP, body, { addr: GROUP, port: this.base });
    // 多播在有些机器上不通（防火墙、没联网），所以本机的端口再挨个敲一遍
    for (const host of ['127.0.0.1', ...this.staticPeers]) for (let pid = 0; pid < MAX_PEERS; pid++) {
      const port = this.base + 10 + 2 * pid;
      if (host !== '127.0.0.1' || port !== this.port) this._send(K.SPDP, body, { addr: host, port });
    }
    for (const p of this.peers.values()) if (bye) this._send(K.SPDP, body, p);
  }

  _tick() {
    this._announce();
    const now = Date.now();
    for (const [prefix, p] of this.peers) if (now - p.lastSeen > LEASE_MS) this._dropPeer(prefix);
  }

  _onSpdp(prefix, d, rinfo) {
    if (d.bye) return this._dropPeer(prefix);
    const now = Date.now();
    let p = this.peers.get(prefix);
    const isNew = !p;
    if (isNew) this.peers.set(prefix, p = { prefix, addr: rinfo.address, epoch: -1, reqAt: 0, nodes: [], endpoints: new Map() });
    if (rinfo.address === '127.0.0.1') p.addr = rinfo.address;
    p.port = d.port; p.lastSeen = now;
    if (isNew) {             // 第一次见：马上回一声并把自己的实体列表发过去，不用等下一轮广播
      this._sendJson(K.SPDP, { port: this.port, epoch: this.epoch }, p);
      this._sendSedp(p);
    }
    if (d.epoch !== p.epoch && now - p.reqAt > 200) { p.reqAt = now; this._send(K.SEDP_REQ, [], p); }
  }

  _sendSedp(p) {
    this._sendJson(K.SEDP, { epoch: this.epoch, nodes: this.nodes, eps: [...this.local.values()].map(e => e.wire()) }, p);
  }

  _onSedp(prefix, d) {
    const p = this.peers.get(prefix);
    if (!p) return;
    p.epoch = d.epoch; p.nodes = d.nodes;
    p.endpoints = new Map(d.eps.map(e => [e.id, { guid: `${prefix}.${e.id}`, id: e.id, kind: e.k, topic: e.t, type: e.y, qos: e.q, node: e.n, peer: p }]));
    this._rematch();
  }

  _dropPeer(prefix) {
    if (this.peers.delete(prefix)) this._rematch();
  }

  /** 把本地每个读者 / 写者和所有已知的对端逐个比对，建立或解除匹配 */
  _rematch() {
    const all = [...this.local.values()];
    for (const p of this.peers.values()) all.push(...p.endpoints.values());
    for (const L of this.local.values()) {
      const live = new Set();
      for (const R of all) {
        if (R.kind === L.kind || R.topic !== L.topic || R.type !== L.type) continue;
        const policy = L.kind === 'w' ? incompatible(L.qos, R.qos) : incompatible(R.qos, L.qos);
        if (policy) {
          const key = `${L.guid}|${R.guid}`;
          if (!this.warned.has(key)) { this.warned.add(key); this.emit('incompatible_qos', { local: L, remote: R, policy }); }
          continue;
        }
        live.add(R.guid);
        L._match(R);
      }
      L._prune(L.kind === 'w' ? L.matched : L.writers, live);
    }
    this.emit('graph');
  }

  /** 当前已知的所有读者、写者（本地 + 远端） */
  *endpoints() {
    yield* this.local.values();
    for (const p of this.peers.values()) yield* p.endpoints.values();
  }
  allNodes() {
    const out = [...this.nodes];
    for (const p of this.peers.values()) out.push(...p.nodes);
    return out;
  }
}
