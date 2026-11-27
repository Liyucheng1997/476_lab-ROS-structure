// node:dgram 的替身：UDP 套接字。绑定端口、收发数据包都交给页面上的“内核”，
// 由它在各个进程之间转发——所以每一个包都能被看到。
import { EventEmitter } from './events.js';
import { rt } from '../runtime.js';

const socks = new Map();
let nextId = 1;

rt.on('net', m => {
  const s = socks.get(m.sock);
  if (!s) return;
  if (m.op === 'msg') {
    const deliver = () => s.closed || s.emit('message', Buffer.from(m.data), m.rinfo);
    if (m.delay > 0) setTimeout(deliver, m.delay); else deliver();     // 模拟网络延迟
  }
  else if (m.op === 'bound') s._bound(m);
});

class Socket extends EventEmitter {
  constructor(o) {
    super();
    this.id = nextId++; this.reuse = !!o.reuseAddr; this.closed = false;
    socks.set(this.id, this);
    rt.hold();
  }
  bind(a, cb) {
    const o = typeof a === 'object' ? a : { port: a };
    this._cb = typeof cb === 'function' ? cb : null;
    rt.post({ type: 'net', op: 'bind', sock: this.id, port: o.port || 0, reuse: this.reuse });
  }
  _bound(m) {
    if (m.error) {
      const e = new Error(`bind EADDRINUSE 0.0.0.0:${m.port}`);
      e.code = 'EADDRINUSE';
      this.emit('error', e);
    } else { this.port = m.port; this._cb?.(); }
  }
  address() { return { address: '0.0.0.0', family: 'IPv4', port: this.port }; }
  send(bufs, port, addr, cb) {
    const data = Array.isArray(bufs) ? Buffer.concat(bufs) : bufs;
    rt.post({ type: 'net', op: 'send', sock: this.id, port, addr, data: new Uint8Array(data) });
    cb?.();
  }
  addMembership(group, iface) { if (!iface) rt.post({ type: 'net', op: 'join', sock: this.id, group }); }
  setRecvBufferSize() {} setSendBufferSize() {} setMulticastLoopback() {}
  close() {
    if (this.closed) return;
    this.closed = true;
    socks.delete(this.id);
    rt.post({ type: 'net', op: 'close', sock: this.id });
    rt.release();
  }
}

export const createSocket = o => new Socket(typeof o === 'string' ? { type: o } : o);
export default { createSocket };
