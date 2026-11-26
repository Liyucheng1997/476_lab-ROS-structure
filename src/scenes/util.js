// 场景数据的小工具：N = 节点，E = 连线，G = 分组底板，tree = 目录树

/** 节点。o: { w, h, t(厚度), z, sub, kind: 'accent'|'muted'|'file', align, d(详情 HTML), code, title } */
export const N = (id, label, x, y, o = {}) => {
  const { w = 2.7, h = 0.9, t = 0.3, z = 0, ...rest } = o;
  return { id, label, pos: [x, y, z], size: [w, h, t], ...rest };
};

/** 连线。o: { label, flow: true|'back'|'both'|false, bend: [x,y,z], dashed, bidir, arrow, at } */
export const E = (from, to, o = {}) => ({ id: `${from}>${to}`, from, to, ...o });

/** 分组底板（中心点 + 宽高） */
export const G = (label, x, y, w, h, o = {}) => ({ label, x, y, w, h, ...o });

/** 目录树：rows = [[层级, id, 名称, { d, code, sub }]]，返回左对齐、逐层缩进并向前凸出的节点 */
export const tree = (x0, y0, rows, { rowH = 0.66, w = 4.4, indent = 0.55 } = {}) =>
  rows.map(([depth, id, label, o = {}], i) =>
    N(id, label, x0 + depth * indent + w / 2, y0 - i * rowH, {
      w, h: 0.52, t: 0.22, z: depth * 0.28, kind: 'file', align: 'left', ...o,
    }));
