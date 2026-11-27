// rmw 实现：把 rmw 接口翻译成 dds/ 里那个中间件的调用。
// 和真实的 rmw_fastrtps_cpp 一样，这一层负责：
//   - 名字改写：话题 /chatter → rt/chatter，服务 /add → rq/addRequest + rr/addReply；
//   - 用类型支持把消息序列化成 CDR；
//   - 用“请求话题 + 应答话题 + 请求编号”拼出服务；
//   - 从发现数据里还原出 ROS 的计算图（节点、话题、服务）。
import { Participant } from '../dds/participant.js';
import { serialize, deserialize } from '../rosidl/cdr.js';
import { ddsTypeName, rosTypeName } from '../rosidl/idl.js';

export const identifier = 'rmw_minidds';

export async function init(options) {
  return new Rmw(await new Participant(options).start());
}

class Rmw {
  constructor(p) { this.p = p; this.identifier = identifier; }
  async shutdown() { await this.p.close(); }
  onGraphChange(cb) { this.p.on('graph', cb); return () => this.p.off('graph', cb); }
  onIncompatibleQos(cb) { this.p.on('incompatible_qos', cb); }

  /* ---------- 节点 ---------- */
  createNode(name, ns) {
    const n = { name, ns, fqn: (ns === '/' ? '' : ns) + '/' + name };
    this.p.nodes.push({ name, ns });
    this.p._localChanged();
    return n;
  }
  destroyNode(n) {
    this.p.nodes = this.p.nodes.filter(x => x.name !== n.name || x.ns !== n.ns);
    this.p._localChanged();
  }

  /* ---------- 话题 ---------- */
  createPublisher(node, topic, type, qos) {
    return { type, writer: this.p.createWriter({ topic: 'rt' + topic, type: ddsTypeName(type.name), qos, node: node.fqn }) };
  }
  publish(pub, msg) { return pub.writer.write(serialize(pub.type, msg)); }
  publishSerialized(pub, buf) { return pub.writer.write(buf); }

  createSubscription(node, topic, type, qos, onReady) {
    return { type, reader: this.p.createReader({ topic: 'rt' + topic, type: ddsTypeName(type.name), qos, node: node.fqn, onData: onReady }) };
  }
  hasData(h) { return h.reader.queue.length > 0; }
  /** 取一条消息；raw 为真时不反序列化，直接给 CDR 字节 */
  take(sub, raw = false) {
    const s = sub.reader.take();
    return s && { msg: raw ? s.payload : deserialize(sub.type, s.payload),
      info: { publisherGid: s.writerGuid, sequence: s.seq, sourceTimestamp: s.ts } };
  }
  /** 匹配上的对端个数 */
  matchedCount(h) { return h.writer && !h.reader ? h.writer.matched.size : h.reader.writers.size; }

  /* ---------- 服务 ----------
   * 请求和应答的消息体前面带 24 字节的头：客户端标识 16 字节 + 请求编号 8 字节。
   * 应答会发给所有匹配的客户端，各客户端按头里的标识挑出自己的。 */
  createClient(node, name, srv, qos) {
    const c = { srv, seq: 0, onReady: null };
    c.writer = this.p.createWriter({ topic: `rq${name}Request`, type: ddsTypeName(srv.Request.name), qos, node: node.fqn });
    c.reader = this.p.createReader({ topic: `rr${name}Reply`, type: ddsTypeName(srv.Response.name), qos, node: node.fqn, onData: () => c.onReady?.() });
    c.id = Buffer.alloc(16);
    this.p.prefix.copy(c.id);
    c.id.writeUInt32LE(c.writer.id, 12);
    return c;
  }
  sendRequest(c, request) {
    const h = Buffer.alloc(24);
    c.id.copy(h);
    h.writeDoubleLE(++c.seq, 16);
    c.writer.write(Buffer.concat([h, serialize(c.srv.Request, request)]));
    return c.seq;
  }
  takeResponse(c) {
    for (let s; (s = c.reader.take());) {
      if (s.payload.compare(c.id, 0, 16, 0, 16) !== 0) continue;   // 别的客户端的应答
      return { sequence: s.payload.readDoubleLE(16), msg: deserialize(c.srv.Response, s.payload.subarray(24)) };
    }
    return null;
  }
  serverIsAvailable(c) { return c.writer.matched.size > 0 && c.reader.writers.size > 0; }

  createService(node, name, srv, qos, onReady) {
    return {
      srv,
      reader: this.p.createReader({ topic: `rq${name}Request`, type: ddsTypeName(srv.Request.name), qos, node: node.fqn, onData: onReady }),
      writer: this.p.createWriter({ topic: `rr${name}Reply`, type: ddsTypeName(srv.Response.name), qos, node: node.fqn }),
    };
  }
  takeRequest(s) {
    const d = s.reader.take();
    return d && { header: d.payload.subarray(0, 24), msg: deserialize(s.srv.Request, d.payload.subarray(24)) };
  }
  sendResponse(s, header, response) {
    s.writer.write(Buffer.concat([header, serialize(s.srv.Response, response)]));
  }

  destroy(h) {
    if (h.writer) this.p.deleteEndpoint(h.writer);
    if (h.reader) this.p.deleteEndpoint(h.reader);
  }

  /* ---------- 计算图 ---------- */
  getNodes() {
    return this.p.allNodes().map(n => ({ ...n, fqn: (n.ns === '/' ? '' : n.ns) + '/' + n.name }));
  }
  /** 所有话题上的端点：[{ topic, type, kind: 'pub'|'sub', node, qos, gid }] */
  getTopicEndpoints() {
    const out = [];
    for (const e of this.p.endpoints()) {
      if (e.topic.startsWith('rt/')) out.push({ topic: e.topic.slice(2), type: rosTypeName(e.type), kind: e.kind === 'w' ? 'pub' : 'sub', node: e.node, qos: e.qos, gid: e.guid });
    }
    return out;
  }
  /** 所有服务端点：[{ service, type, kind: 'server'|'client', node }] */
  getServiceEndpoints() {
    const out = [];
    for (const e of this.p.endpoints()) {
      if (!e.topic.startsWith('rq/')) continue;
      out.push({ service: e.topic.slice(2, -'Request'.length), type: rosTypeName(e.type).replace(/_Request$/, ''), kind: e.kind === 'r' ? 'server' : 'client', node: e.node });
    }
    return out;
  }
}
