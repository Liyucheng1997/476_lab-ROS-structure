// CDR 序列化（XCDR1，小端）——和真实 ROS 2 / DDS 的消息体格式一致：
//   4 字节封装头 00 01 00 00，之后每个基本类型按自身大小对齐，
//   字符串 = uint32 长度（含结尾 \0）+ 字节 + \0，变长数组 = uint32 个数 + 元素。
import { getType } from './idl.js';

const SIZE = { bool: 1, byte: 1, char: 1, int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4,
  int64: 8, uint64: 8, float32: 4, float64: 8 };
const big = v => typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v) || 0));
const num = v => Number(v) || 0;
const isBytes = t => t.base === 'uint8' || t.base === 'byte';

class Writer {
  constructor() { this.b = Buffer.allocUnsafe(256); this.b.writeUInt32BE(0x00010000, 0); this.o = 4; }
  ensure(n) {
    if (this.o + n <= this.b.length) return;
    const nb = Buffer.allocUnsafe(Math.max(this.b.length * 2, this.o + n));
    this.b.copy(nb, 0, 0, this.o);
    this.b = nb;
  }
  /** 对齐是相对封装头之后的位置算的 */
  align(n) {
    const pad = (n - ((this.o - 4) % n)) % n;
    this.ensure(pad + n);
    this.b.fill(0, this.o, this.o + pad);
    this.o += pad;
  }
  prim(type, v) {
    if (type === 'string') {
      const s = v == null ? '' : String(v), len = Buffer.byteLength(s);
      this.align(4); this.ensure(len + 5);
      this.b.writeUInt32LE(len + 1, this.o);
      this.b.write(s, this.o + 4);
      this.b[this.o + 4 + len] = 0;
      this.trace?.(type, this.o, this.o + len + 5);
      this.o += len + 5;
      return;
    }
    const n = SIZE[type];
    this.align(n);
    const b = this.b, o = this.o;
    switch (type) {
      case 'bool': b[o] = v ? 1 : 0; break;
      case 'int8': b.writeInt8(num(v), o); break;
      case 'byte': case 'char': case 'uint8': b.writeUInt8(num(v), o); break;
      case 'int16': b.writeInt16LE(num(v), o); break;
      case 'uint16': b.writeUInt16LE(num(v), o); break;
      case 'int32': b.writeInt32LE(num(v), o); break;
      case 'uint32': b.writeUInt32LE(num(v), o); break;
      case 'int64': b.writeBigInt64LE(big(v), o); break;
      case 'uint64': b.writeBigUInt64LE(big(v), o); break;
      case 'float32': b.writeFloatLE(num(v), o); break;
      case 'float64': b.writeDoubleLE(num(v), o); break;
    }
    this.trace?.(type, o, o + n);
    this.o += n;
  }
  elem(t, v) { t.nested ? this.struct(getType(t.base), v ?? {}) : this.prim(t.base, v); }
  field(t, v) {
    if (!t.array) return this.elem(t, v);
    const arr = v ?? [];
    const n = t.array === 'fixed' ? t.len : arr.length;
    if (t.array === 'seq') {
      this.align(4); this.ensure(4);
      this.b.writeUInt32LE(n, this.o);
      this.trace?.('元素个数', this.o, this.o + 4);
      this.o += 4;
    }
    if (isBytes(t) && ArrayBuffer.isView(arr) && arr.length === n) {
      this.ensure(n);
      this.b.set(arr, this.o);
      if (n) this.trace?.(`${t.base}[${n}]`, this.o, this.o + n);
      this.o += n;
      return;
    }
    for (let i = 0; i < n; i++) {
      this.at?.push(`[${i}]`);
      this.elem(t, arr[i]);
      this.at?.pop();
    }
  }
  struct(def, obj) {
    if (!def.fields.length) return this.prim('uint8', 0); // 空结构体在 DDS 里占一个字节
    for (const f of def.fields) {
      this.at?.push(f.name);
      this.field(f.type, obj[f.name] ?? f.default);
      this.at?.pop();
    }
  }
}

class Reader {
  constructor(buf) { this.b = buf; this.o = 4; this.le = (buf[1] & 1) === 1; }
  align(n) { this.o += (n - ((this.o - 4) % n)) % n; }
  prim(type) {
    if (type === 'string') {
      this.align(4);
      const len = this.b.readUInt32LE(this.o);
      const s = this.b.toString('utf8', this.o + 4, this.o + 4 + Math.max(0, len - 1));
      this.o += 4 + len;
      return s;
    }
    const n = SIZE[type];
    this.align(n);
    const b = this.b, o = this.o;
    this.o += n;
    switch (type) {
      case 'bool': return b[o] !== 0;
      case 'int8': return b.readInt8(o);
      case 'byte': case 'char': case 'uint8': return b[o];
      case 'int16': return b.readInt16LE(o);
      case 'uint16': return b.readUInt16LE(o);
      case 'int32': return b.readInt32LE(o);
      case 'uint32': return b.readUInt32LE(o);
      case 'int64': return safe(b.readBigInt64LE(o));
      case 'uint64': return safe(b.readBigUInt64LE(o));
      case 'float32': return b.readFloatLE(o);
      case 'float64': return b.readDoubleLE(o);
    }
  }
  elem(t) { return t.nested ? this.struct(getType(t.base)) : this.prim(t.base); }
  field(t) {
    if (!t.array) return this.elem(t);
    let n = t.len;
    if (t.array === 'seq') { this.align(4); n = this.b.readUInt32LE(this.o); this.o += 4; }
    if (isBytes(t)) {
      const out = new Uint8Array(this.b.subarray(this.o, this.o + n));
      this.o += n;
      return out;
    }
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.elem(t);
    return out;
  }
  struct(def) {
    const obj = {};
    if (!def.fields.length) { this.o += 1; return obj; }
    for (const f of def.fields) obj[f.name] = this.field(f.type);
    return obj;
  }
}

// 64 位整数：能用普通数字精确表示就给数字，否则给 BigInt
const safe = v => (v >= -9007199254740991n && v <= 9007199254740991n) ? Number(v) : v;

/**
 * 消息对象 → CDR 字节。缺的字段按默认值填。
 * @param trace 可选，(字段路径, 类型, 起始偏移, 结束偏移) => void，每写一个基本类型调用一次（给可视化用）
 */
export function serialize(type, msg, trace) {
  const w = new Writer();
  if (trace) {
    w.at = [];
    w.trace = (t, start, end) => trace(w.at.join('.').replaceAll('.[', '['), t, start, end);
  }
  w.struct(getType(type), msg ?? {});
  return w.b.subarray(0, w.o);
}

/** CDR 字节 → 消息对象 */
export function deserialize(type, buf) {
  const r = new Reader(buf);
  if (!r.le) throw new Error('只支持小端 CDR');
  return r.struct(getType(type));
}
