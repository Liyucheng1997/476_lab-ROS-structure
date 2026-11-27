#!/usr/bin/env node
// ros2 命令行工具。自己也是一个（隐藏的）节点：启动后先等一小会儿让发现完成，再查询或收发。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as rcl from '../rcljs/index.js';
import { packagePaths, listInterfaces, interfaceText } from '../rosidl/idl.js';
import { parseArg, dump } from '../rcl/yaml.js';
import { toValueMsg, fromValueMsg, ParameterType } from '../rcl/parameters.js';

const HELP = `用法：ros2 <命令> <子命令> [参数]

  run <包> <可执行文件> [--ros-args ...]      运行一个节点
  launch <文件.launch.js>                     按启动文件一次拉起多个节点
  node list [-a] | info <节点>
  topic list [-t] | info [-v] <话题> | type <话题> | echo [--once] <话题> | hz <话题>
        pub [--once] [-r 频率] [-t 次数] <话题> <类型> "<YAML>"
  service list [-t] | type <服务> | call <服务> <类型> "<YAML>"
  param list [节点] | get <节点> <参数> | set <节点> <参数> <值> | dump <节点> | describe <节点> <参数>
  action list [-t] | info <动作> | send_goal [-f] <动作> <类型> "<YAML>"
  interface list | packages | show <类型>
  pkg list | executables [包]
  doctor                                      显示域号、中间件、端口等环境信息

环境变量：ROS_DOMAIN_ID（默认 0）、ROS_LOCALHOST_ONLY=1、ROS_STATIC_PEERS、ROS_PACKAGE_PATH`;

// 按路径加载脚本。浏览器里的演示环境会换成自己的加载方式（见 src/lab/）
const load = file => globalThis.__rosImport ? globalThis.__rosImport(file) : import(/* @vite-ignore */ pathToFileURL(file).href);
const die = msg => { console.error(msg); process.exit(1); };
const hidden = name => name.split('/').some(t => t.startsWith('_'));
const short = (name, kind) => name.split('/').length === 2 ? name.replace('/', `/${kind}/`) : name;

/** 拆出开关和位置参数：flags 是不带值的开关，values 是带值的 */
function parse(args, flags = [], values = []) {
  const o = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (flags.includes(args[i])) o[args[i]] = true;
    else if (values.includes(args[i])) o[args[i]] = args[++i];
    else o._.push(args[i]);
  }
  return o;
}

let node;
/** 建一个隐藏节点，等发现完成 */
async function start(wait = 500) {
  await rcl.init([], { handleSignals: true });
  node = new rcl.Node(`_ros2cli_${process.pid}`, { enableRosout: false, startParameterServices: false });
  rcl.spin(node);
  await rcl.sleep(wait);
  return node;
}
async function finish(code = 0) {
  await rcl.sleep(50);
  await rcl.shutdown();
  process.exit(code);
}
/** 等某个条件成立（比如话题出现），超时返回最后一次的值 */
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v || Date.now() > end) return v;
    await rcl.sleep(50);
  }
}

const topics = () => node.rmw.getTopicEndpoints();
const services = () => node.rmw.getServiceEndpoints();
const topicType = name => waitFor(() => topics().find(e => e.topic === name)?.type);
/** 所有动作：Map 名字 → 类型（从 <名字>/_action/feedback 话题认出来） */
function actions() {
  const m = new Map();
  for (const e of topics()) {
    if (e.topic.endsWith('/_action/feedback')) m.set(e.topic.slice(0, -'/_action/feedback'.length), e.type.replace(/_FeedbackMessage$/, ''));
  }
  return new Map([...m].sort());
}
const printMap = (m, withTypes) => { for (const [k, v] of m) console.log(withTypes ? `${k} [${[v].flat().join(', ')}]` : k); };
const group = (list, key) => {
  const m = new Map();
  for (const e of list) m.set(e[key], [...new Set([...(m.get(e[key]) || []), e.type])]);
  return new Map([...m].sort());
};

/* ---------------- 各个命令 ---------------- */
const commands = {
  node: {
    async list(args) {
      const o = parse(args, ['-a', '--all']);
      await start();
      for (const n of [...new Set(node.getNodeNames())].sort()) if (o['-a'] || o['--all'] || !hidden(n)) console.log(n);
    },
    async info(args) {
      const name = args[0] || die('用法：ros2 node info <节点>');
      await start();
      if (!node.getNodeNames().includes(name)) die(`找不到节点 ${name}`);
      const t = topics().filter(e => e.node === name), s = services().filter(e => e.node === name);
      const isAction = n => n.includes('/_action/');
      const section = (title, list, key) => {
        console.log(`  ${title}:`);
        for (const [k, v] of group(list, key)) console.log(`    ${k}: ${v.join(', ')}`);
      };
      console.log(name);
      section('Subscribers', t.filter(e => e.kind === 'sub' && !isAction(e.topic)), 'topic');
      section('Publishers', t.filter(e => e.kind === 'pub' && !isAction(e.topic)), 'topic');
      section('Service Servers', s.filter(e => e.kind === 'server' && !isAction(e.service)), 'service');
      section('Service Clients', s.filter(e => e.kind === 'client' && !isAction(e.service)), 'service');
      const act = kind => s.filter(e => e.kind === kind && e.service.endsWith('/_action/send_goal'))
        .map(e => ({ action: e.service.slice(0, -'/_action/send_goal'.length), type: e.type.replace(/_SendGoal$/, '') }));
      section('Action Servers', act('server'), 'action');
      section('Action Clients', act('client'), 'action');
    },
  },

  topic: {
    async list(args) {
      const o = parse(args, ['-t', '--include-hidden-topics']);
      await start();
      const m = group(topics().filter(e => o['--include-hidden-topics'] || !hidden(e.topic)), 'topic');
      printMap(m, o['-t']);
    },
    async type(args) {
      await start();
      console.log(await topicType(args[0]) || die(`找不到话题 ${args[0]}`));
    },
    async info(args) {
      const o = parse(args, ['-v', '--verbose']);
      const name = o._[0] || die('用法：ros2 topic info [-v] <话题>');
      await start();
      const eps = topics().filter(e => e.topic === name);
      if (!eps.length) die(`找不到话题 ${name}`);
      const pubs = eps.filter(e => e.kind === 'pub'), subs = eps.filter(e => e.kind === 'sub');
      console.log(`Type: ${[...new Set(eps.map(e => e.type))].join(', ')}`);
      console.log(`Publisher count: ${pubs.length}`);
      console.log(`Subscription count: ${subs.length}`);
      if (!o['-v'] && !o['--verbose']) return;
      for (const e of eps) {
        console.log(`\nNode name: ${e.node}\nEndpoint type: ${e.kind === 'pub' ? 'PUBLISHER' : 'SUBSCRIPTION'}\nGID: ${e.gid}`);
        console.log(`QoS profile:\n  Reliability: ${e.qos.reliability.toUpperCase()}\n  Durability: ${e.qos.durability.toUpperCase()}\n  History (Depth): ${e.qos.history.toUpperCase()} (${e.qos.depth})`);
      }
    },
    async echo(args) {
      const o = parse(args, ['--once'], ['--qos-reliability', '--qos-durability']);
      const name = o._[0] || die('用法：ros2 topic echo [--once] <话题> [类型]');
      await start();
      const type = o._[1] ? short(o._[1], 'msg') : await topicType(name) || die(`话题 ${name} 还没有人发布，无法确定类型（可以在话题后面写上类型）`);
      // 跟着发布者的 QoS 走，否则可能因为不兼容而收不到
      const pubs = topics().filter(e => e.topic === name && e.kind === 'pub');
      const qos = {
        reliability: o['--qos-reliability'] ?? (pubs.some(e => e.qos.reliability === 'best_effort') ? 'best_effort' : 'reliable'),
        durability: o['--qos-durability'] ?? (pubs.length && pubs.every(e => e.qos.durability === 'transient_local') ? 'transient_local' : 'volatile'),
        depth: 10,
      };
      let done = false;
      await new Promise(resolve => node.createSubscription(type, name, msg => {
        if (done) return;
        console.log(dump(msg) + '---');
        if (o['--once']) { done = true; resolve(); }
      }, qos));
    },
    async hz(args) {
      const name = args[0] || die('用法：ros2 topic hz <话题>');
      await start();
      const type = await topicType(name) || die(`找不到话题 ${name}`);
      let last = 0, gaps = [];
      node.createSubscription(type, name, () => {
        const t = performance.now();
        if (last) gaps.push((t - last) / 1000);
        last = t;
      }, { raw: true, qos: { reliability: 'best_effort', depth: 100 } });
      setInterval(() => {
        if (!gaps.length) return console.log('no new messages');
        const mean = gaps.reduce((a, b) => a + b) / gaps.length;
        const std = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
        console.log(`average rate: ${(1 / mean).toFixed(3)}\n\tmin: ${Math.min(...gaps).toFixed(3)}s max: ${Math.max(...gaps).toFixed(3)}s std dev: ${std.toFixed(5)}s window: ${gaps.length + 1}`);
        gaps = gaps.slice(-1000);
      }, 1000);
      await new Promise(() => {});
    },
    async pub(args) {
      const o = parse(args, ['--once', '-1'], ['-r', '--rate', '-t', '--times']);
      const [name, type, yaml] = o._;
      if (!type) die('用法：ros2 topic pub [--once] [-r 频率] <话题> <类型> "<YAML>"');
      const msg = parseArg(yaml || '{}');
      const once = o['--once'] || o['-1'];
      const times = once ? 1 : Number(o['-t'] ?? o['--times'] ?? Infinity);
      const rate = Number(o['-r'] ?? o['--rate'] ?? 1);
      await start(200);
      const pub = node.createPublisher(short(type, 'msg'), name, 10);
      if (!await waitFor(() => pub.subscriptionCount > 0, once ? 3000 : 500)) console.log('Waiting for at least 1 matching subscription(s)... 没等到，仍然发布');
      console.log('publisher: beginning loop');
      for (let i = 1; i <= times; i++) {
        pub.publish(msg);
        console.log(`publishing #${i}: ${JSON.stringify(msg)}\n`);
        if (i < times) await rcl.sleep(1000 / rate);
      }
      await rcl.sleep(300);       // 留点时间让可靠传输确认送达
    },
  },

  service: {
    async list(args) {
      const o = parse(args, ['-t', '--include-hidden-services']);
      await start();
      printMap(group(services().filter(e => e.kind === 'server' && (o['--include-hidden-services'] || !hidden(e.service))), 'service'), o['-t']);
    },
    async type(args) {
      await start();
      console.log(services().find(e => e.service === args[0] && e.kind === 'server')?.type || die(`找不到服务 ${args[0]}`));
    },
    async call(args) {
      const name = args[0] || die('用法：ros2 service call <服务> [类型] "<YAML>"');
      // 类型可以省略：第二个参数长得不像类型名时，就当它是请求内容，类型去计算图里查
      const typed = /^\w+(\/\w+){1,2}$/.test(args[1] || '');
      await start(200);
      const t = typed ? short(args[1], 'srv')
        : await waitFor(() => services().find(e => e.service === name && e.kind === 'server')?.type) || die(`找不到服务 ${name}`);
      const request = parseArg(args[typed ? 2 : 1] || '{}');
      const client = node.createClient(t, name);
      if (!await client.waitForService(5000)) die(`等不到服务 ${name} 上线`);
      console.log(`requester: making request: ${JSON.stringify(request)}\n`);
      const response = await client.call(request, { timeout: 10000 });
      console.log(`response:\n${dump(response)}`);
    },
  },

  param: {
    async list(args) {
      await start();
      const nodes = args[0] ? [args[0]] : [...new Set(node.getNodeNames())].filter(n => !hidden(n)).sort();
      for (const n of nodes) {
        const r = await paramCall(n, 'ListParameters', 'list_parameters', {});
        if (!r) continue;
        if (!args[0]) console.log(`${n}:`);
        for (const p of r.result.names.sort()) console.log(`  ${p}`);
      }
    },
    async get(args) {
      const [n, name] = args;
      if (!name) die('用法：ros2 param get <节点> <参数>');
      await start();
      const r = await paramCall(n, 'GetParameters', 'get_parameters', { names: [name] }) || die(`找不到节点 ${n}`);
      const v = r.values[0];
      if (!v.type) die('Parameter not set.');
      console.log(`${TYPE_NAMES[v.type]} value is: ${JSON.stringify(fromValueMsg(v), (k, x) => ArrayBuffer.isView(x) ? [...x] : x)}`);
    },
    async set(args) {
      const [n, name, value] = args;
      if (value === undefined) die('用法：ros2 param set <节点> <参数> <值>');
      await start();
      const r = await paramCall(n, 'SetParameters', 'set_parameters', { parameters: [{ name, value: toValueMsg(parseArg(value)) }] }) || die(`找不到节点 ${n}`);
      const res = r.results[0];
      if (!res.successful) die(`Setting parameter failed: ${res.reason}`);
      console.log('Set parameter successful');
    },
    async dump(args) {
      const n = args[0] || die('用法：ros2 param dump <节点>');
      await start();
      const names = (await paramCall(n, 'ListParameters', 'list_parameters', {}) || die(`找不到节点 ${n}`)).result.names.sort();
      const { values } = await paramCall(n, 'GetParameters', 'get_parameters', { names });
      const params = Object.fromEntries(names.map((k, i) => [k, fromValueMsg(values[i])]));
      console.log(dump({ [n]: { ros__parameters: params } }).trimEnd());
    },
    async describe(args) {
      const [n, name] = args;
      if (!name) die('用法：ros2 param describe <节点> <参数>');
      await start();
      const d = (await paramCall(n, 'DescribeParameters', 'describe_parameters', { names: [name] }) || die(`找不到节点 ${n}`)).descriptors[0] || die('Parameter not set.');
      console.log(`Parameter name: ${d.name}\n  Type: ${TYPE_NAMES[d.type].toLowerCase()}\n  Description: ${d.description}\n  Constraints:${d.read_only ? '\n    Read only: true' : ''}`);
    },
  },

  action: {
    async list(args) {
      const o = parse(args, ['-t']);
      await start();
      printMap(actions(), o['-t']);
    },
    async info(args) {
      const name = args[0] || die('用法：ros2 action info <动作>');
      await start();
      const s = services().filter(e => e.service === `${name}/_action/send_goal`);
      const show = (title, kind) => {
        const list = s.filter(e => e.kind === kind);
        console.log(`${title}: ${list.length}`);
        for (const e of list) console.log(`    ${e.node}`);
      };
      console.log(`Action: ${name}`);
      show('Action clients', 'client');
      show('Action servers', 'server');
    },
    async send_goal(args) {
      const o = parse(args, ['-f', '--feedback']);
      const [name, type, yaml] = o._;
      if (!type) die('用法：ros2 action send_goal [-f] <动作> <类型> "<YAML>"');
      await start(200);
      const client = new rcl.ActionClient(node, short(type, 'action'), name);
      console.log('Waiting for an action server to become available...');
      if (!await client.waitForServer(5000)) die(`等不到动作服务端 ${name}`);
      const goal = parseArg(yaml || '{}');
      console.log(`Sending goal:\n${dump(goal, '     ')}`);
      const fb = o['-f'] || o['--feedback'];
      const gh = await client.sendGoal(goal, fb ? { feedback: f => console.log(`Feedback:\n${dump(f, '    ')}`) } : {});
      if (!gh.accepted) die('Goal was rejected.');
      console.log(`Goal accepted with ID: ${gh.goalId}\n`);
      process.removeAllListeners('SIGINT');
      process.once('SIGINT', async () => { console.log('Canceling goal...'); await gh.cancel(); });
      const r = await gh.getResult();
      console.log(`Result:\n${dump(r.result, '    ')}\nGoal finished with status: ${Object.keys(rcl.GoalStatus)[r.status]}`);
    },
  },

  interface: {
    list() {
      const all = listInterfaces();
      for (const [title, kind] of [['Messages', 'msg'], ['Services', 'srv'], ['Actions', 'action']]) {
        console.log(`${title}:`);
        for (const n of all.filter(x => x.split('/')[1] === kind)) console.log(`    ${n}`);
      }
    },
    packages() { for (const p of new Set(listInterfaces().map(n => n.split('/')[0]))) console.log(p); },
    show(args) {
      const name = args[0] || die('用法：ros2 interface show <类型>');
      const found = listInterfaces().find(n => n === name || n.replace(/\/(msg|srv|action)\//, '/') === name) || die(`找不到接口 ${name}`);
      console.log(interfaceText(found));
    },
  },

  pkg: {
    list() { for (const p of Object.keys(packages()).sort()) console.log(p); },
    executables(args) {
      for (const [p, exes] of Object.entries(packages()).sort()) if (!args[0] || args[0] === p) for (const e of exes) console.log(`${p} ${e}`);
    },
  },
};

const TYPE_NAMES = Object.keys(ParameterType).map(k => k[0] + k.slice(1).toLowerCase().replace('_array', ' array'));
TYPE_NAMES[4] = 'String';

/** 调用某个节点的参数服务。节点不存在返回 null。 */
async function paramCall(nodeName, type, suffix, request) {
  const client = node.createClient(`rcl_interfaces/srv/${type}`, `${nodeName}/${suffix}`);
  if (!await client.waitForService(1500)) return null;
  return client.call(request, { timeout: 5000 });
}

/** 所有包及其可执行文件：包目录下的每个 .js 文件就是一个可执行文件 */
function packages() {
  const out = {};
  for (const dir of packagePaths) {
    if (!fs.existsSync(dir)) continue;
    for (const p of fs.readdirSync(dir)) {
      const d = path.join(dir, p);
      if (!fs.statSync(d).isDirectory()) continue;
      const exes = fs.readdirSync(d).filter(f => f.endsWith('.js') && !f.endsWith('.launch.js')).map(f => f.slice(0, -3));
      if (exes.length) out[p] = [...(out[p] || []), ...exes];
    }
  }
  return out;
}
function findExecutable(pkg, exe) {
  for (const dir of packagePaths) {
    const f = path.join(dir, pkg, `${exe}.js`);
    if (fs.existsSync(f)) return f;
  }
  const exes = packages()[pkg];
  die(exes ? `包 ${pkg} 里没有 ${exe}，可用的有：${exes.join('、')}` : `找不到包 ${pkg}`);
}

/** ros2 run：在当前进程里直接加载节点脚本 */
async function run([pkg, exe, ...rest]) {
  if (!exe) die('用法：ros2 run <包> <可执行文件> [参数]');
  const file = findExecutable(pkg, exe);
  process.argv = [process.argv[0], file, ...rest];
  await load(file);
}

/**
 * ros2 launch：启动文件默认导出一个数组（或返回数组的函数），每项描述一个节点：
 *   { package, executable, name?, namespace?, parameters?: {…}, remappings?: [[from, to]], arguments?: [] }
 */
async function launch([file]) {
  if (!file) die('用法：ros2 launch <文件.launch.js>');
  let found = [file, ...packagePaths.map(d => path.join(d, file))].find(f => fs.existsSync(f)) || die(`找不到启动文件 ${file}`);
  found = path.resolve(found);
  let desc = found.endsWith('.json') ? JSON.parse(fs.readFileSync(found, 'utf8')) : (await load(found)).default;
  if (typeof desc === 'function') desc = await desc();
  const self = process.argv[1], children = [];
  desc.forEach((d, i) => {
    const ros = [];
    if (d.name) ros.push('-r', `__node:=${d.name}`);
    if (d.namespace) ros.push('-r', `__ns:=${d.namespace}`);
    for (const [from, to] of d.remappings || []) ros.push('-r', `${from}:=${to}`);
    for (const [k, v] of Object.entries(d.parameters || {})) ros.push('-p', `${k}:=${JSON.stringify(v)}`);
    const tag = `[${d.executable}-${i + 1}]`;
    const child = spawn(process.execPath, [self, 'run', d.package, d.executable, ...(d.arguments || []), ...(ros.length ? ['--ros-args', ...ros] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('spawn', () => console.log(`[INFO] [launch]: ${tag} 已启动，进程号 ${child.pid}`));
    for (const s of [child.stdout, child.stderr]) {
      let buf = '';
      s.on('data', c => {
        const lines = (buf + c).split(/\r?\n/);
        buf = lines.pop();
        for (const l of lines) console.log(`${tag} ${l}`);
      });
    }
    child.on('exit', code => {
      console.log(`[INFO] [launch]: ${tag} 已退出（${code ?? '被终止'}）`);
      children.splice(children.indexOf(child), 1);
      if (!children.length) process.exit(0);
    });
    children.push(child);
  });
  process.on('SIGINT', () => { for (const c of [...children]) c.kill(); });
}

async function doctor() {
  await start();
  const p = node.rmw.p;
  console.log(`中间件（RMW_IMPLEMENTATION）: ${node.rmw.identifier}`);
  console.log(`域号（ROS_DOMAIN_ID）: ${p.domainId}`);
  console.log(`发现多播: ${p.localhostOnly ? '关闭（ROS_LOCALHOST_ONLY=1）' : `239.255.0.1:${p.base}`}`);
  console.log(`本进程单播端口: ${p.port}`);
  console.log(`发现的其他参与者: ${p.peers.size} 个`);
  for (const peer of p.peers.values()) console.log(`  ${peer.addr}:${peer.port}  节点：${peer.nodes.map(n => n.name).join('、') || '（无）'}`);
  console.log(`Node.js: ${process.version}  平台: ${process.platform}`);
}

/* ---------------- 入口 ---------------- */
const [cmd, verb, ...rest] = process.argv.slice(2);
try {
  if (!cmd || cmd === '-h' || cmd === '--help') console.log(HELP);
  else if (cmd === 'run') await run([verb, ...rest]);
  else if (cmd === 'launch') await launch([verb, ...rest]);
  else if (cmd === 'doctor') { await doctor(); await finish(); }
  else {
    const fn = commands[cmd]?.[verb];
    if (!fn) die(`未知的命令：ros2 ${cmd} ${verb ?? ''}\n\n${HELP}`);
    await fn(rest);
    if (node) await finish();
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
