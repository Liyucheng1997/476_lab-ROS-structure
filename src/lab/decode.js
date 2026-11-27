// 把线上的数据包解开给人看（格式见 ros2/dds/participant.js）。
const KINDS = [null, 'SPDP', 'SEDP', 'SEDP_REQ', 'DATA', 'HEARTBEAT', 'ACKNACK'];

/** 各类数据包：中文名、颜色、一句话说明 */
export const KIND = {
  SPDP: { name: '发现', color: '#8e8e93', what: '参与者广播“我在这，我的端口是多少”。相当于 DDS 的 SPDP。' },
  SEDP: { name: '实体列表', color: '#bf5af2', what: '把自己有哪些节点、写者、读者（话题名、类型、QoS）告诉对方，双方据此匹配。相当于 DDS 的 SEDP。' },
  SEDP_REQ: { name: '请求列表', color: '#bf5af2', what: '发现对方的实体列表版本比手里的新，请它重发一份。' },
  DATA: { name: '数据', color: '#0a84ff', what: '一条消息（或它的一个分片）：写者编号 + 序号 + CDR 消息体。' },
  HEARTBEAT: { name: '心跳', color: '#ff9f0a', what: '可靠写者告诉读者“我这里有第几条到第几条”，读者据此发现自己缺了哪些。' },
  ACKNACK: { name: '应答', color: '#30d158', what: '可靠读者回复“某条之前的我都收到了，还缺这几条”，写者据此重发。' },
};
export const HEADER = 18, DATA_HEADER = 28;

export function decode(u8) {
  if (u8.length < HEADER || u8[0] !== 0x4d || u8[1] !== 0x44 || u8[2] !== 0x44 || u8[3] !== 0x53) return null;
  const kind = KINDS[u8[5]];
  const dv = new DataView(u8.buffer, u8.byteOffset + HEADER, u8.byteLength - HEADER);
  const json = () => JSON.parse(new TextDecoder().decode(u8.subarray(HEADER)));
  try {
    switch (kind) {
      case 'SPDP': { const j = json(); return { kind, port: j.port, epoch: j.epoch, bye: !!j.bye }; }
      case 'SEDP': { const j = json(); return { kind, epoch: j.epoch, nodes: j.nodes, eps: j.eps }; }
      case 'SEDP_REQ': return { kind };
      case 'DATA': return { kind, lossy: true, writerId: dv.getUint32(0, true), readerId: dv.getUint32(4, true),
        seq: dv.getFloat64(8, true), frag: [dv.getUint16(16, true), dv.getUint16(18, true)], ts: dv.getFloat64(20, true) };
      case 'HEARTBEAT': return { kind, lossy: true, writerId: dv.getUint32(0, true), readerId: dv.getUint32(4, true),
        first: dv.getFloat64(8, true), last: dv.getFloat64(16, true) };
      case 'ACKNACK': {
        const missing = [];
        for (let i = 0, n = dv.getUint16(16, true); i < n; i++) missing.push(dv.getFloat64(18 + 8 * i, true));
        return { kind, lossy: true, writerId: dv.getUint32(0, true), readerId: dv.getUint32(4, true), base: dv.getFloat64(8, true), missing };
      }
    }
  } catch { /* 解不开就当未知包 */ }
  return null;
}

const PARAM_SERVICE = /\/(get_parameters|set_parameters|list_parameters|describe_parameters|get_parameter_types)$/;

/**
 * 中间件里的话题名 → 它在 ROS 层面属于哪个话题 / 服务 / 动作。
 *   rt/chatter              → 话题 /chatter
 *   rq/addRequest、rr/addReply → 服务 /add
 *   …/_action/…             → 动作
 */
export function channelOf(ddsTopic) {
  const pre = ddsTopic.slice(0, 2);
  let name = ddsTopic.slice(2), kind = 'topic', part = pre === 'rt' ? 'topic' : pre === 'rq' ? 'request' : 'reply';
  if (pre === 'rq') { name = name.replace(/Request$/, ''); kind = 'service'; }
  if (pre === 'rr') { name = name.replace(/Reply$/, ''); kind = 'service'; }
  const a = name.indexOf('/_action/');
  if (a >= 0) { part = `${name.slice(a + 9)}${pre === 'rt' ? '' : pre === 'rq' ? ' 请求' : ' 应答'}`; name = name.slice(0, a); kind = 'action'; }
  const internal = name === '/rosout' || name === '/parameter_events' || (kind === 'service' && PARAM_SERVICE.test(name));
  return { id: `${kind[0]}:${name}`, name, kind, part, internal };
}
