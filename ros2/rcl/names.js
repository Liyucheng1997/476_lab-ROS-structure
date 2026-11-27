// 名字解析与命令行参数（--ros-args）。
import fs from 'node:fs';
import { parseFlow, parseBlock } from './yaml.js';

export const normNs = ns => {
  ns = (ns || '').replace(/\/+$/, '');
  return ns === '' ? '/' : ns.startsWith('/') ? ns : '/' + ns;
};
export const joinName = (ns, name) => (ns === '/' ? '' : ns) + '/' + name;

/**
 * 把话题 / 服务名展开成完整名字：
 *   /abs      → /abs
 *   rel       → <命名空间>/rel
 *   ~/private → <命名空间>/<节点名>/private
 */
export function expandName(name, nodeName, ns) {
  if (!name || !/^(~|\/)?([A-Za-z_]\w*)?(\/[A-Za-z_]\w*)*$/.test(name)) throw new Error(`非法的名字：'${name}'`);
  if (name.startsWith('/')) return name;
  if (name === '~') return joinName(ns, nodeName);
  if (name.startsWith('~/')) return joinName(joinName(ns, nodeName), name.slice(2));
  return joinName(ns, name);
}

/** 展开后再套用重映射规则（-r from:=to） */
export function resolveName(name, nodeName, ns, remaps) {
  const fq = expandName(name, nodeName, ns);
  for (const [from, to] of remaps) if (expandName(from, nodeName, ns) === fq) return expandName(to, nodeName, ns);
  return fq;
}

const rule = s => {
  const i = (s || '').indexOf(':=');
  if (i < 0) throw new Error(`应写成 名字:=值 的形式：${s}`);
  return [s.slice(0, i), s.slice(i + 2)];
};

/**
 * 解析 --ros-args 之后的参数：
 *   -r from:=to   重映射（__node:=新节点名、__ns:=/命名空间 是两个特殊规则）
 *   -p name:=值   参数初值
 *   --params-file 文件.yaml
 *   --log-level   debug|info|warn|error|fatal
 */
export function parseRosArgs(argv) {
  const a = { remaps: [], params: {}, paramFiles: [], nodeName: null, ns: null, logLevel: null, rest: [] };
  let ros = false;
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--ros-args') ros = true;
    else if (x === '--') ros = false;
    else if (!ros) a.rest.push(x);
    else if (x === '-r' || x === '--remap') {
      const [from, to] = rule(argv[++i]);
      if (from === '__node' || from === '__name') a.nodeName = to;
      else if (from === '__ns') a.ns = to;
      else a.remaps.push([from, to]);
    } else if (x === '-p' || x === '--param') {
      const [k, v] = rule(argv[++i]);
      a.params[k] = parseFlow(v);
    } else if (x === '--params-file') a.paramFiles.push(parseBlock(fs.readFileSync(argv[++i], 'utf8')));
    else if (x === '--log-level') a.logLevel = argv[++i];
    else throw new Error(`未知的 --ros-args 参数：${x}`);
  }
  return a;
}
