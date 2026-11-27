// 够用的 YAML 子集：命令行里的 "{a: 1, b: [2, 3]}"、参数文件里的缩进写法，以及把消息打印出来。

export function scalar(s) {
  s = s.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true' || s === 'false') return s === 'true';
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  const m = s.match(/^(['"])([\s\S]*)\1$/);
  return m ? m[2] : s;
}

/** 解析单行写法：{k: v}、[a, b] 或单个值 */
export function parseFlow(text) {
  const s = String(text);
  let i = 0;
  const fail = () => { throw new Error(`YAML 解析失败：${s}`); };
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const token = stop => {
    ws();
    if (s[i] === '"' || s[i] === "'") {
      const j = s.indexOf(s[i], i + 1);
      if (j < 0) fail();
      const t = s.slice(i, j + 1);
      i = j + 1;
      return t;
    }
    const st = i;
    while (i < s.length && !stop.includes(s[i])) i++;
    return s.slice(st, i).trim();
  };
  const list = (close, item) => {
    i++;
    for (;;) {
      ws();
      if (s[i] === close) { i++; return; }
      item();
      ws();
      if (s[i] === ',') i++; else if (s[i] !== close) fail();
    }
  };
  const value = stop => {
    ws();
    if (s[i] === '{') {
      const o = {};
      list('}', () => {
        const k = String(scalar(token(':')));
        ws();
        if (s[i++] !== ':') fail();
        o[k] = value(',}');
      });
      return o;
    }
    if (s[i] === '[') { const a = []; list(']', () => a.push(value(',]'))); return a; }
    return scalar(token(stop));
  };
  const v = value('');
  ws();
  if (i < s.length) fail();
  return v;
}

/** 命令行参数：允许省略最外层的大括号，如 "data: hello" */
export function parseArg(text) {
  const t = String(text ?? '').trim();
  return parseFlow(/^[A-Za-z_]\w*:(\s|$)/.test(t) ? `{${t}}` : t);
}

/** 解析多行缩进写法（参数文件） */
export function parseBlock(text) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/(^|\s)#.*$/, '')).filter(l => l.trim())
    .map(l => ({ ind: l.search(/\S/), t: l.trim() }));
  let i = 0;
  const block = ind => {
    if (lines[i].t.startsWith('-')) {
      const a = [];
      while (i < lines.length && lines[i].ind === ind && lines[i].t.startsWith('-')) {
        const rest = lines[i++].t.slice(1).trim();
        a.push(rest ? parseFlow(rest) : block(lines[i].ind));
      }
      return a;
    }
    const o = {};
    while (i < lines.length && lines[i].ind === ind) {
      const m = lines[i].t.match(/^("[^"]*"|'[^']*'|[^:]+):\s*(.*)$/);
      if (!m) throw new Error(`YAML 解析失败：${lines[i].t}`);
      i++;
      const k = m[1].replace(/^['"]|['"]$/g, '');
      o[k] = m[2] ? parseFlow(m[2]) : (i < lines.length && lines[i].ind > ind) ? block(lines[i].ind) : null;
    }
    return o;
  };
  return lines.length ? block(lines[0].ind) : {};
}

const isArr = v => Array.isArray(v) || ArrayBuffer.isView(v);
const isObj = v => v !== null && typeof v === 'object' && !isArr(v);
const fmt = v => typeof v !== 'string' ? String(v)
  : (v === '' || /^[\s\d\-[\]{}'"#&*!|>%@`]|: |\n|\s$|^(true|false|null|~)$/.test(v)) ? JSON.stringify(v) : v;

/** 把对象打印成 YAML（ros2 topic echo 的那种样子） */
export function dump(v, ind = '') {
  let out = '';
  for (const [k, x] of Object.entries(v)) {
    if (isArr(x)) {
      if (!x.length) { out += `${ind}${k}: []\n`; continue; }
      out += `${ind}${k}:\n`;
      const n = Math.min(x.length, 64);
      for (let j = 0; j < n; j++) {
        out += isObj(x[j]) ? `${ind}- ${dump(x[j], ind + '  ').slice(ind.length + 2)}` : `${ind}- ${fmt(x[j])}\n`;
      }
      if (x.length > n) out += `${ind}- '...'  # 共 ${x.length} 项\n`;
    } else if (isObj(x)) out += `${ind}${k}:\n${dump(x, ind + '  ')}`;
    else out += `${ind}${k}: ${fmt(x)}\n`;
  }
  return out;
}
