// node:path 的替身（只有 POSIX 风格）
const norm = p => {
  const out = [];
  for (const s of p.split('/')) {
    if (s === '..') out.pop();
    else if (s && s !== '.') out.push(s);
  }
  return (p.startsWith('/') ? '/' : '') + out.join('/');
};
export const join = (...parts) => norm(parts.filter(Boolean).join('/'));
export const resolve = (...parts) => norm(parts.reduce((acc, p) => p.startsWith('/') ? p : `${acc}/${p}`, '/'));
export const dirname = p => norm(p).split('/').slice(0, -1).join('/') || '/';
export const basename = p => norm(p).split('/').pop();
export const delimiter = ':';
export const sep = '/';
export default { join, resolve, dirname, basename, delimiter, sep };
