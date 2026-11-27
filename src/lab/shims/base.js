// 浏览器里没有的 Node 全局对象：Buffer、process、setImmediate。必须最先导入。
import { Buffer } from 'buffer/';

globalThis.Buffer ??= Buffer;
globalThis.process ??= { env: {}, argv: [], platform: 'browser', version: 'browser', stdout: {}, stderr: {} };

if (!globalThis.setImmediate) {
  // 用 MessageChannel 而不是 setTimeout(0)，后者在浏览器里至少延迟 4 毫秒
  const ch = new MessageChannel(), queue = [];
  ch.port1.onmessage = () => queue.shift()?.();
  globalThis.setImmediate = (fn, ...args) => { queue.push(() => fn(...args)); ch.port2.postMessage(0); };
}
