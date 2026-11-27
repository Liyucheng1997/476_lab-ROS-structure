// 节点，以及挂在节点上的发布者、订阅者、定时器、服务端、客户端。
import { getType, getService, createMessage } from '../rosidl/idl.js';
import { makeQos, QoSProfiles } from '../dds/qos.js';
import { resolveName, normNs, joinName, parseRosArgs } from './names.js';
import { Logger, now } from './logging.js';
import { Parameters } from './parameters.js';
import { CallbackGroup } from './executor.js';
import { getDefaultContext } from './context.js';

// 第四个参数可以直接是 QoS（数字 / 预设名 / 对象），也可以是 { qos, callbackGroup, raw }
const OPTION_KEYS = ['qos', 'callbackGroup', 'raw'];
const options = o => (o && typeof o === 'object' && OPTION_KEYS.some(k => k in o)) ? o : { qos: o };

class Publisher {
  constructor(node, type, topic, qos) {
    this.node = node; this.type = getType(type); this.topic = node.resolveName(topic); this.qos = makeQos(qos);
    this.handle = node.rmw.createPublisher(node.handle, this.topic, this.type, this.qos);
  }
  /** 发布一条消息。没写的字段取默认值。 */
  publish(msg) { this.node.rmw.publish(this.handle, msg); }
  /** 当前匹配上的订阅者个数 */
  get subscriptionCount() { return this.node.rmw.matchedCount(this.handle); }
  destroy() { this.node._remove(this); }
}

class Subscription {
  constructor(node, type, topic, callback, o) {
    this.node = node; this.type = getType(type); this.topic = node.resolveName(topic);
    this.callback = callback; this.qos = makeQos(o.qos); this.raw = !!o.raw;
    this.group = o.callbackGroup ?? node.defaultCallbackGroup;
    this.handle = node.rmw.createSubscription(node.handle, this.topic, this.type, this.qos, () => node._notify());
  }
  get publisherCount() { return this.node.rmw.matchedCount(this.handle); }
  hasWork() { return this.node.rmw.hasData(this.handle); }
  execute() {
    const s = this.node.rmw.take(this.handle, this.raw);
    if (s) return this.callback(s.msg, s.info);
  }
  destroy() { this.node._remove(this); }
}

class Timer {
  constructor(node, periodMs, callback, group) {
    this.node = node; this.period = periodMs; this.callback = callback; this.group = group;
    this.pending = false;
    this.reset();
  }
  reset() {
    this.cancel();
    this.next = performance.now() + this.period;
    this._arm();
  }
  /** 按固定的时间表排下一次，而不是“上次之后再等一个周期”，这样系统定时器不准也不会越跑越慢 */
  _arm() {
    this.timer = setTimeout(() => {
      this.pending = true;
      this.node._notify();
      this.next += this.period;
      if (this.next < performance.now()) this.next = performance.now() + this.period;   // 落后太多就不追了
      this._arm();
    }, Math.max(0, this.next - performance.now()));
  }
  cancel() { clearTimeout(this.timer); this.timer = null; this.pending = false; }
  get isCanceled() { return !this.timer; }
  hasWork() { return this.pending; }
  execute() { this.pending = false; return this.callback(); }
  destroy() { this.cancel(); this.node._remove(this); }
}

class Service {
  constructor(node, type, name, callback, o) {
    this.node = node; this.srv = getService(type); this.name = node.resolveName(name);
    this.callback = callback; this.group = o.callbackGroup ?? node.defaultCallbackGroup;
    this.handle = node.rmw.createService(node.handle, this.name, this.srv, makeQos(o.qos ?? QoSProfiles.services), () => node._notify());
  }
  hasWork() { return this.node.rmw.hasData(this.handle); }
  /** 回调形如 (request, response) => response，可以是 async；返回值或改过的 response 都算应答 */
  execute() {
    const r = this.node.rmw.takeRequest(this.handle);
    if (!r) return;
    const response = createMessage(this.srv.Response);
    const send = out => this.node.rmw.sendResponse(this.handle, r.header, out ?? response);
    const out = this.callback(r.msg, response);
    if (out && typeof out.then === 'function') return out.then(send);
    send(out);
  }
  destroy() { this.node._remove(this); }
}

class Client {
  constructor(node, type, name, o) {
    this.node = node; this.srv = getService(type); this.name = node.resolveName(name);
    this.pending = new Map();        // 请求编号 → Promise 的 resolve
    this.handle = node.rmw.createClient(node.handle, this.name, this.srv, makeQos(o.qos ?? QoSProfiles.services));
    // 应答到了直接兑现 Promise，不排进执行器；这样在回调里 await client.call() 不会把自己卡死
    this.handle.onReady = () => {
      for (let r; (r = node.rmw.takeResponse(this.handle));) {
        const resolve = this.pending.get(r.sequence);
        this.pending.delete(r.sequence);
        resolve?.(r.msg);
      }
    };
  }
  /** 服务端是否已经被发现 */
  isReady() { return this.node.rmw.serverIsAvailable(this.handle); }
  /** 等服务端上线。超时返回 false。 */
  async waitForService(timeoutMs = Infinity) {
    const end = Date.now() + timeoutMs;
    while (!this.isReady()) {
      if (Date.now() >= end || !this.node.context.ok) return false;
      await new Promise(r => setTimeout(r, 20));
    }
    return true;
  }
  /** 发请求，返回应答的 Promise */
  call(request, { timeout } = {}) {
    return new Promise((resolve, reject) => {
      const seq = this.node.rmw.sendRequest(this.handle, request);
      this.pending.set(seq, resolve);
      if (timeout) setTimeout(() => { if (this.pending.delete(seq)) reject(new Error(`调用服务 ${this.name} 超时`)); }, timeout);
    });
  }
  destroy() { this.node._remove(this); }
}

export class Node {
  /**
   * @param name 节点名
   * @param opts { namespace, context, parameters: {名字: 初值}, enableRosout, startParameterServices, useGlobalArguments }
   */
  constructor(name, opts = {}) {
    const ctx = this.context = opts.context ?? getDefaultContext();
    const args = opts.useGlobalArguments === false ? parseRosArgs([]) : ctx.args;
    this.rmw = ctx.rmw;
    this.name = args.nodeName ?? name;
    if (!/^[A-Za-z_]\w*$/.test(this.name)) throw new Error(`非法的节点名：'${this.name}'`);
    this.namespace = normNs(args.ns ?? opts.namespace);
    this.fqn = joinName(this.namespace, this.name);
    this._remaps = args.remaps;
    this.entities = new Set();       // 需要执行器调度的实体
    this._handles = new Set();       // 所有实体，销毁节点时一起清理
    this._executor = null;
    this.defaultCallbackGroup = new CallbackGroup(true);
    this.handle = this.rmw.createNode(this.name, this.namespace);
    this.logger = new Logger(this.fqn.slice(1).replace(/\//g, '.'), args.logLevel ?? 'info');
    if (opts.enableRosout !== false) {
      const rosout = this.createPublisher('rcl_interfaces/msg/Log', '/rosout', QoSProfiles.rosout);
      this.logger.sink = (level, msg, stamp) => rosout.publish({ stamp, level, name: this.logger.name, msg });
    }
    this.parameters = new Parameters(this, args, opts);
    ctx.nodes.add(this);
  }

  _add(e, scheduled) { this._handles.add(e); if (scheduled) this.entities.add(e); return e; }
  _remove(e) { this._handles.delete(e); this.entities.delete(e); if (e.handle) this.rmw.destroy(e.handle); }
  _notify() { this._executor?.wake(); }

  getLogger() { return this.logger; }
  now() { return now(); }
  resolveName(name) { return resolveName(name, this.name, this.namespace, this._remaps); }
  createCallbackGroup(kind = 'mutually_exclusive') { return new CallbackGroup(kind !== 'reentrant'); }

  createPublisher(type, topic, qos) { return this._add(new Publisher(this, type, topic, qos)); }
  createSubscription(type, topic, callback, opts) { return this._add(new Subscription(this, type, topic, callback, options(opts)), true); }
  /** 周期定时器，单位毫秒 */
  createTimer(periodMs, callback, callbackGroup = this.defaultCallbackGroup) { return this._add(new Timer(this, periodMs, callback, callbackGroup), true); }
  createService(type, name, callback, opts) { return this._add(new Service(this, type, name, callback, options(opts)), true); }
  createClient(type, name, opts) { return this._add(new Client(this, type, name, options(opts))); }

  declareParameter(name, defaultValue, descriptor) { return this.parameters.declare(name, defaultValue, descriptor); }
  getParameter(name) { return this.parameters.get(name); }
  setParameter(name, value) { return this.parameters.set(name, value); }
  hasParameter(name) { return this.parameters.has(name); }
  onSetParameters(callback) { this.parameters.onSet(callback); }

  /* ---------- 计算图查询 ---------- */
  getNodeNames() { return this.rmw.getNodes().map(n => n.fqn); }
  /** Map：话题名 → 类型名数组 */
  getTopicNamesAndTypes() { return group(this.rmw.getTopicEndpoints(), 'topic'); }
  getServiceNamesAndTypes() { return group(this.rmw.getServiceEndpoints().filter(e => e.kind === 'server'), 'service'); }
  countPublishers(topic) { return this._count(topic, 'pub'); }
  countSubscribers(topic) { return this._count(topic, 'sub'); }
  _count(topic, kind) {
    topic = this.resolveName(topic);
    return this.rmw.getTopicEndpoints().filter(e => e.topic === topic && e.kind === kind).length;
  }
  onGraphChange(callback) { return this.rmw.onGraphChange(callback); }

  destroy() {
    if (!this.context.nodes.delete(this)) return;
    for (const e of [...this._handles]) e.destroy();
    this.context.executor.removeNode(this);
    this.rmw.destroyNode(this.handle);
  }
}

function group(endpoints, key) {
  const m = new Map();
  for (const e of endpoints) {
    if (!m.has(e[key])) m.set(e[key], []);
    if (!m.get(e[key]).includes(e.type)) m.get(e[key]).push(e.type);
  }
  return new Map([...m].sort());
}
