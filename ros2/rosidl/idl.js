// rosidl：读 .msg / .srv / .action 文件，得到类型描述。
// 真实的 ROS 2 在编译期把接口文件生成成各语言的代码；这里在运行时解析，
// 序列化时按类型描述逐字段处理（相当于“动态类型支持”）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 包的搜索路径：自带的包 + 环境变量 ROS_PACKAGE_PATH 里的目录 */
export const packagePaths = [
  path.join(here, '..', 'packages'),
  ...(process.env.ROS_PACKAGE_PATH || '').split(path.delimiter).filter(Boolean),
];
const searchPaths = [path.join(here, '..', 'interfaces'), ...packagePaths];

export const PRIMITIVES = new Set(['bool', 'byte', 'char', 'int8', 'uint8', 'int16', 'uint16',
  'int32', 'uint32', 'int64', 'uint64', 'float32', 'float64', 'string']);

/** 'int32[]'、'string<=10'、'geometry_msgs/Vector3[3]' → 类型描述 */
export function parseType(s, pkg) {
  const t = { base: s, nested: false, array: null, len: 0 };
  const m = s.match(/^(.+)\[(<=)?(\d*)\]$/);
  if (m) { t.array = m[3] && !m[2] ? 'fixed' : 'seq'; t.len = m[3] ? +m[3] : 0; s = m[1]; }
  if (/^string<=\d+$/.test(s)) s = 'string';
  if (PRIMITIVES.has(s)) { t.base = s; return t; }
  if (s === 'wstring') throw new Error('暂不支持 wstring');
  const p = s.split('/');
  t.nested = true;
  t.base = p.length === 1 ? `${pkg}/msg/${s}` : p.length === 2 ? `${p[0]}/msg/${p[1]}` : s;
  return t;
}

function literal(t, text) {
  text = text.trim();
  if (t.array) return JSON.parse(text.replace(/'/g, '"'));
  if (t.base === 'string') return text.replace(/^(['"])(.*)\1$/, '$2');
  if (t.base === 'bool') return /^(true|1)$/i.test(text);
  return Number(text);
}

function parseBlock(text, pkg) {
  const fields = [], constants = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/#.*$/, '').trim();
    if (!line) continue;
    let m = line.match(/^(\S+)\s+([A-Z][A-Z0-9_]*)\s*=\s*(.+)$/);
    if (m) {
      const type = parseType(m[1], pkg);
      constants.push({ name: m[2], type, value: literal(type, m[3]) });
      continue;
    }
    m = line.match(/^(\S+)\s+([a-zA-Z]\w*)(?:\s+(.+))?$/);
    if (!m) throw new Error(`无法解析接口定义：${line}`);
    const type = parseType(m[1], pkg);
    fields.push({ name: m[2], type, default: m[3] === undefined ? undefined : literal(type, m[3]) });
  }
  return { fields, constants };
}

const types = new Map(), services = new Map(), actions = new Map();

function readInterface(pkg, kind, name) {
  for (const d of searchPaths) {
    const f = path.join(d, pkg, kind, `${name}.${kind}`);
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').split(/^---[ \t]*$/m);
  }
  throw new Error(`找不到接口 ${pkg}/${kind}/${name}`);
}
function define(name, block) {
  const def = { name, ...block };
  types.set(name, def);
  return def;
}
const field = (type, name) => ({ name, type: parseType(type), default: undefined });
const full = (name, kind) => {
  const p = String(name).split('/');
  return p.length === 2 ? `${p[0]}/${kind}/${p[1]}` : name;
};

/** 取消息类型，如 'std_msgs/msg/String'（也接受 'std_msgs/String'） */
export function getType(name) {
  if (typeof name === 'object') return name;
  name = full(name, 'msg');
  if (types.has(name)) return types.get(name);
  const [pkg, kind, tn] = name.split('/');
  if (kind === 'msg') return define(name, parseBlock(readInterface(pkg, 'msg', tn)[0], pkg));
  if (kind === 'srv') {
    const m = tn.match(/^(.+)_(Request|Response)$/);
    if (m) return getService(`${pkg}/srv/${m[1]}`)[m[2]];
  }
  if (kind === 'action') {
    const m = tn.match(/^(.+?)_(Goal|Result|Feedback|FeedbackMessage|(SendGoal|GetResult)_(Request|Response))$/);
    if (m) { getAction(`${pkg}/action/${m[1]}`); if (types.has(name)) return types.get(name); }
  }
  throw new Error(`未知的消息类型：${name}`);
}

/** 取服务类型：{ name, Request, Response } */
export function getService(name) {
  if (typeof name === 'object') return name;
  name = full(name, 'srv');
  if (services.has(name)) return services.get(name);
  const [pkg, , tn] = name.split('/');
  const parts = readInterface(pkg, 'srv', tn);
  const s = {
    name,
    Request: define(`${name}_Request`, parseBlock(parts[0] || '', pkg)),
    Response: define(`${name}_Response`, parseBlock(parts[1] || '', pkg)),
  };
  services.set(name, s);
  return s;
}

/**
 * 取动作类型。动作在线上是 3 个服务 + 2 个话题，
 * 所以除了 Goal / Result / Feedback，还要拼出这些包装类型。
 */
export function getAction(name) {
  if (typeof name === 'object') return name;
  name = full(name, 'action');
  if (actions.has(name)) return actions.get(name);
  const [pkg, , tn] = name.split('/');
  const parts = readInterface(pkg, 'action', tn);
  const d = (suffix, fields) => define(`${name}_${suffix}`, Array.isArray(fields) ? { fields, constants: [] } : fields);
  const UUID = 'unique_identifier_msgs/msg/UUID', TIME = 'builtin_interfaces/msg/Time';
  const a = {
    name,
    Goal: d('Goal', parseBlock(parts[0] || '', pkg)),
    Result: d('Result', parseBlock(parts[1] || '', pkg)),
    Feedback: d('Feedback', parseBlock(parts[2] || '', pkg)),
  };
  a.SendGoal = {
    name: `${name}_SendGoal`,
    Request: d('SendGoal_Request', [field(UUID, 'goal_id'), field(`${name}_Goal`, 'goal')]),
    Response: d('SendGoal_Response', [field('bool', 'accepted'), field(TIME, 'stamp')]),
  };
  a.GetResult = {
    name: `${name}_GetResult`,
    Request: d('GetResult_Request', [field(UUID, 'goal_id')]),
    Response: d('GetResult_Response', [field('int8', 'status'), field(`${name}_Result`, 'result')]),
  };
  a.FeedbackMessage = d('FeedbackMessage', [field(UUID, 'goal_id'), field(`${name}_Feedback`, 'feedback')]);
  actions.set(name, a);
  return a;
}

function defaultValue(t) {
  const one = () => t.nested ? createMessage(t.base) : t.base === 'string' ? '' : t.base === 'bool' ? false : 0;
  if (!t.array) return one();
  const bytes = t.base === 'uint8' || t.base === 'byte';
  if (t.array === 'seq') return bytes ? new Uint8Array(0) : [];
  return bytes ? new Uint8Array(t.len) : Array.from({ length: t.len }, one);
}

/** 按类型定义造一个填好默认值的消息对象 */
export function createMessage(type) {
  const def = getType(type), msg = {};
  for (const f of def.fields) msg[f.name] = f.default !== undefined ? structuredClone(f.default) : defaultValue(f.type);
  return msg;
}

/** ROS 类型名 ↔ DDS 类型名：std_msgs/msg/String ↔ std_msgs::msg::dds_::String_ */
export function ddsTypeName(name) {
  const [pkg, kind, tn] = name.split('/');
  return `${pkg}::${kind}::dds_::${tn}_`;
}
export function rosTypeName(dds) {
  const p = dds.split('::');
  return `${p[0]}/${p[1]}/${p[3].slice(0, -1)}`;
}

/** 列出所有能找到的接口：['std_msgs/msg/String', ...] */
export function listInterfaces() {
  const out = new Set();
  for (const d of searchPaths) {
    if (!fs.existsSync(d)) continue;
    for (const pkg of fs.readdirSync(d)) for (const kind of ['msg', 'srv', 'action']) {
      const dir = path.join(d, pkg, kind);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.' + kind)) out.add(`${pkg}/${kind}/${f.slice(0, -kind.length - 1)}`);
    }
  }
  return [...out].sort();
}

/** 接口文件原文（给 ros2 interface show 用） */
export function interfaceText(name) {
  const [pkg, kind, tn] = name.split('/');
  return readInterface(pkg, kind, tn).join('---').trimEnd();
}
