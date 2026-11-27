// rmw：中间件抽象接口。上面的 rcl 只调用这里约定的方法，不知道底下是哪种中间件。
// 用环境变量 RMW_IMPLEMENTATION 选择实现（目前只有 rmw_minidds 一种）。
//
// 一个实现要导出 init(options)，返回的对象需要提供：
//   createNode / destroyNode
//   createPublisher / publish / publishSerialized
//   createSubscription / hasData / take / matchedCount
//   createClient / sendRequest / takeResponse / serverIsAvailable
//   createService / takeRequest / sendResponse
//   destroy / shutdown
//   getNodes / getTopicEndpoints / getServiceEndpoints / onGraphChange / onIncompatibleQos
const implementations = {
  rmw_minidds: () => import('./rmw_minidds.js'),
};

export async function loadRmw(name = process.env.RMW_IMPLEMENTATION || 'rmw_minidds') {
  const load = implementations[name];
  if (!load) throw new Error(`找不到 rmw 实现 '${name}'，可用的有：${Object.keys(implementations).join('、')}`);
  return load();
}
