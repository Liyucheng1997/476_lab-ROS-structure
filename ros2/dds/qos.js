// 服务质量（QoS）：实现了可靠性、持久性、历史深度三项。
const base = { reliability: 'reliable', durability: 'volatile', history: 'keep_last', depth: 10 };

/** 和 ROS 2 同名的预设 */
export const QoSProfiles = {
  default: base,
  sensor_data: { ...base, reliability: 'best_effort', depth: 5 },
  services: base,
  parameters: { ...base, depth: 1000 },
  parameter_events: { ...base, depth: 1000 },
  rosout: { ...base, durability: 'transient_local', depth: 100 },
};

/** 数字 → 队列深度；字符串 → 预设名；对象 → 覆盖默认值 */
export function makeQos(q) {
  if (q == null) return { ...base };
  if (typeof q === 'number') return { ...base, depth: q };
  if (typeof q === 'string') {
    if (!QoSProfiles[q]) throw new Error(`未知的 QoS 预设：${q}`);
    return { ...QoSProfiles[q] };
  }
  return { ...base, ...q };
}

/**
 * 发布方“提供”的必须不弱于订阅方“要求”的，否则不匹配。
 * 返回不兼容的那一项的名字；兼容返回 null。
 */
export function incompatible(writer, reader) {
  if (reader.reliability === 'reliable' && writer.reliability !== 'reliable') return 'reliability';
  if (reader.durability === 'transient_local' && writer.durability !== 'transient_local') return 'durability';
  return null;
}
