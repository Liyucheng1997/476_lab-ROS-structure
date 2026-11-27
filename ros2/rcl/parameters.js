// 参数：属于节点自己，先声明后使用，类型由默认值决定；
// 通过一组服务对外提供读写，每次变更发布到 /parameter_events。
import { QoSProfiles } from '../dds/qos.js';
import { now } from './logging.js';

export const ParameterType = { NOT_SET: 0, BOOL: 1, INTEGER: 2, DOUBLE: 3, STRING: 4, BYTE_ARRAY: 5,
  BOOL_ARRAY: 6, INTEGER_ARRAY: 7, DOUBLE_ARRAY: 8, STRING_ARRAY: 9 };
const FIELD = [null, 'bool_value', 'integer_value', 'double_value', 'string_value', 'byte_array_value',
  'bool_array_value', 'integer_array_value', 'double_array_value', 'string_array_value'];

export function typeOf(v) {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'boolean') return 1;
  if (typeof v === 'bigint') return 2;
  if (typeof v === 'number') return Number.isInteger(v) ? 2 : 3;
  if (typeof v === 'string') return 4;
  if (v instanceof Uint8Array) return 5;
  if (Array.isArray(v)) {
    if (typeof v[0] === 'boolean') return 6;
    if (typeof v[0] === 'number') return v.every(Number.isInteger) ? 7 : 8;
    return 9;
  }
  throw new Error(`不支持的参数值：${v}`);
}
export const toValueMsg = (v, type = typeOf(v)) => type ? { type, [FIELD[type]]: v } : { type: 0 };
export const fromValueMsg = m => m.type ? m[FIELD[m.type]] : undefined;

/** 值能不能放进这个类型的参数里（整数可以当浮点数用，空数组可以当任意数组用） */
function fits(v, type) {
  const t = typeOf(v);
  return t === type || (type === 3 && t === 2) || (type === 8 && t === 7) || (type >= 6 && Array.isArray(v) && !v.length);
}

/** 参数文件里嵌套的写法摊平成 a.b.c */
function flatten(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

export class Parameters {
  constructor(node, args, options) {
    this.node = node;
    this.params = new Map();          // 名字 → { value, type, descriptor }
    this.callbacks = [];
    // 初值的优先级：命令行 -p > 参数文件 > 代码里传的 parameters
    this.overrides = { ...options.parameters };
    for (const doc of args.paramFiles) for (const key of ['/**', node.name, node.fqn]) Object.assign(this.overrides, flatten(doc[key]?.ros__parameters));
    Object.assign(this.overrides, args.params);
    this.events = node.createPublisher('rcl_interfaces/msg/ParameterEvent', '/parameter_events', QoSProfiles.parameter_events);
    this.declare('use_sim_time', false);
    if (options.startParameterServices !== false) this._serve();
  }

  declare(name, defaultValue, descriptor = {}) {
    if (this.params.has(name)) throw new Error(`参数 '${name}' 已经声明过了`);
    let value = defaultValue;
    const type = typeOf(defaultValue);
    if (name in this.overrides) {
      value = this.overrides[name];
      if (type && !fits(value, type)) throw new Error(`参数 '${name}' 的初值类型不对：${JSON.stringify(value)}`);
    }
    this.params.set(name, { value, type: type || typeOf(value), descriptor });
    this._event('new_parameters', name);
    return value;
  }
  has(name) { return this.params.has(name); }
  get(name) {
    const p = this.params.get(name);
    if (!p) throw new Error(`参数 '${name}' 没有声明`);
    return p.value;
  }
  /** 返回 { successful, reason }。类型不符、只读、或被回调拒绝时不会生效。 */
  set(name, value) {
    const p = this.params.get(name);
    const fail = reason => ({ successful: false, reason });
    if (!p) return fail(`参数 '${name}' 没有声明`);
    if (p.descriptor.read_only) return fail(`参数 '${name}' 是只读的`);
    if (!fits(value, p.type)) return fail(`参数 '${name}' 的类型不对`);
    for (const cb of this.callbacks) {
      const r = cb([{ name, value }]);
      if (r && r.successful === false) return fail(r.reason || '被节点拒绝');
    }
    p.value = value;
    this._event('changed_parameters', name);
    return { successful: true, reason: '' };
  }
  /** 注册“有人要改参数”的回调：cb([{name, value}]) 返回 { successful: false, reason } 可以拒绝 */
  onSet(cb) { this.callbacks.push(cb); }

  _msg(name) {
    const p = this.params.get(name);
    return { name, value: toValueMsg(p.value, p.type) };
  }
  _event(kind, name) {
    this.events.publish({ stamp: now(), node: this.node.fqn, [kind]: [this._msg(name)] });
  }

  _serve() {
    const node = this.node, srv = n => `rcl_interfaces/srv/${n}`, q = { qos: QoSProfiles.parameters };
    node.createService(srv('GetParameters'), '~/get_parameters',
      req => ({ values: req.names.map(n => this.params.has(n) ? this._msg(n).value : { type: 0 }) }), q);
    node.createService(srv('SetParameters'), '~/set_parameters',
      req => ({ results: req.parameters.map(p => this.set(p.name, fromValueMsg(p.value))) }), q);
    node.createService(srv('ListParameters'), '~/list_parameters',
      req => ({ result: { names: [...this.params.keys()].filter(n => !req.prefixes.length || req.prefixes.some(p => n.startsWith(p))) } }), q);
    node.createService(srv('DescribeParameters'), '~/describe_parameters',
      req => ({ descriptors: req.names.filter(n => this.params.has(n)).map(n => ({ ...this.params.get(n).descriptor, name: n, type: this.params.get(n).type })) }), q);
    node.createService(srv('GetParameterTypes'), '~/get_parameter_types',
      req => ({ types: req.names.map(n => this.params.get(n)?.type ?? 0) }), q);
  }
}
