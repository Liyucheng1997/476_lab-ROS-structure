// node:fs 的替身：一个只读的虚拟文件系统，内容是打包时收进来的接口文件和示例包。
const raw = import.meta.glob('/ros2/{interfaces,packages}/**/*.{msg,srv,action}', { query: '?raw', import: 'default', eager: true });

/** 示例包里的可执行文件：路径 → 加载函数 */
export const modules = import.meta.glob('/ros2/packages/*/*.js');

export const files = new Map(Object.entries(raw));
for (const p of Object.keys(modules)) files.set(p, '');
const dirs = new Set(['/']);
for (const p of files.keys()) {
  const parts = p.split('/');
  for (let i = 2; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
}

export const existsSync = p => files.has(p) || dirs.has(p);
export function readFileSync(p) {
  if (!files.has(p)) throw new Error(`ENOENT: 没有这个文件 '${p}'`);
  globalThis.__labTrace?.({ type: 'fs', path: p, text: files.get(p) });
  return files.get(p);
}
export function readdirSync(d) {
  const prefix = d.replace(/\/$/, '') + '/', out = new Set();
  for (const p of [...files.keys(), ...dirs]) if (p.startsWith(prefix)) out.add(p.slice(prefix.length).split('/')[0]);
  return [...out].sort();
}
export const statSync = p => ({ isDirectory: () => dirs.has(p) });

export default { existsSync, readFileSync, readdirSync, statSync };
