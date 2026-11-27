// 日志：打印到终端，同时交给 sink（节点会把它发布到 /rosout）。
export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const COLOR = { debug: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m', fatal: '\x1b[31m' };

/** 当前时间，builtin_interfaces/Time 的形式 */
export function now() {
  const ms = Date.now();
  return { sec: Math.floor(ms / 1000), nanosec: (ms % 1000) * 1e6 };
}

export class Logger {
  constructor(name, level = 'info') {
    this.name = name;
    this.setLevel(level);
    this.sink = null;
  }
  setLevel(level) {
    if (!(level in LEVELS)) throw new Error(`未知的日志级别：${level}`);
    this.level = LEVELS[level];
  }
  log(level, text) {
    if (LEVELS[level] < this.level) return;
    const stamp = now();
    const line = `[${level.toUpperCase()}] [${stamp.sec}.${String(stamp.nanosec).padStart(9, '0')}] [${this.name}]: ${text}`;
    const err = LEVELS[level] >= LEVELS.warn;
    const tty = (err ? process.stderr : process.stdout).isTTY;
    (err ? console.error : console.log)(tty && COLOR[level] ? `${COLOR[level]}${line}\x1b[0m` : line);
    this.sink?.(LEVELS[level], String(text), stamp);
  }
  debug(t) { this.log('debug', t); }
  info(t) { this.log('info', t); }
  warn(t) { this.log('warn', t); }
  error(t) { this.log('error', t); }
  fatal(t) { this.log('fatal', t); }
}
