// 进程（Web Worker）这一侧的运行时：把 process、console、信号、标准输入接到页面上的“内核”。
import './shims/base.js';
import { EventEmitter } from './shims/events.js';
import { modules } from './shims/fs.js';

const handlers = new Map();

export const rt = {
  exited: false,
  handles: 0,           // 打开着的套接字和子进程数；归零且主程序跑完时进程自然退出（和 Node 一样）
  mainDone: false,
  post(msg) { if (!rt.exited) self.postMessage(msg); },
  on(type, fn) { handlers.set(type, fn); },
  dispatch(msg) { handlers.get(msg.type)?.(msg); },
  hold() { rt.handles++; },
  release() { rt.handles--; rt.checkIdle(); },
  checkIdle() {
    if (!rt.mainDone || rt.handles > 0) return;
    setTimeout(() => { if (rt.handles <= 0) process.exit(0); }, 60);
  },
};

export function boot({ pid, argv, env }) {
  const proc = new EventEmitter();
  const stdin = new EventEmitter();
  Object.assign(stdin, { isTTY: true, setEncoding() {}, setRawMode(on) { rt.post({ type: 'raw', on }); } });
  Object.assign(proc, {
    pid, argv, env, execPath: 'node', platform: 'browser', version: 'Web Worker',
    stdin, stdout: { isTTY: false }, stderr: { isTTY: false },
    exit(code = 0) {
      if (rt.exited) return;
      rt.post({ type: 'exit', code });
      rt.exited = true;
      self.close();
    },
  });
  globalThis.process = proc;

  const text = args => args.map(a => typeof a === 'string' ? a : a instanceof Error ? a.stack : JSON.stringify(a)).join(' ');
  console.log = console.info = (...a) => rt.post({ type: 'out', stream: 'stdout', text: text(a) });
  console.error = console.warn = (...a) => rt.post({ type: 'out', stream: 'stderr', text: text(a) });

  rt.on('stdin', m => stdin.emit('data', m.data));
  rt.on('signal', m => { if (!proc.emit(m.name)) proc.exit(130); });

  globalThis.__labTrace = ev => rt.post({ type: 'trace', ev });
  // ros2 run / launch 要按路径加载脚本；打包之后只能从预先收进来的模块表里取
  globalThis.__rosImport = file => {
    if (!modules[file]) throw new Error(`找不到可执行文件 ${file}`);
    rt.post({ type: 'trace', ev: { type: 'import', path: file } });
    return modules[file]();
  };
  reportState();
}

/** 定时把中间件的内部状态（节点、读者写者、匹配关系）报给页面，用来画图 */
async function reportState() {
  const { getDefaultContext } = await import('../../ros2/rcl/context.js');
  let last = '';
  setInterval(() => {
    let p;
    try { p = getDefaultContext().rmw.p; } catch { return; }
    if (!p.port) return;
    const state = {
      prefix: p.prefixHex, port: p.port, domain: p.domainId, nodes: p.nodes, peers: [...p.peers.keys()],
      eps: [...p.local.values()].map(e => ({ ...e.wire(), m: [...(e.kind === 'w' ? e.matched : e.writers).keys()] })),
    };
    const json = JSON.stringify(state);
    if (json !== last) { last = json; rt.post({ type: 'state', state }); }
  }, 100);
}
