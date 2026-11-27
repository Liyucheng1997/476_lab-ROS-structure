// 运行：npm test
// 每个测试开两个独立的上下文（相当于两个进程），它们之间真的走 UDP 发现和传输。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rcl from '../rcljs/index.js';
import { parseFlow, parseBlock, dump, parseArg } from '../rcl/yaml.js';
import { expandName, resolveName, parseRosArgs } from '../rcl/names.js';

const DOMAIN = 97;      // 用一个不常用的域，免得和正在跑的节点串台
const ctx = (extra = {}) => new rcl.Context().init([], { domainId: DOMAIN, localhostOnly: true, ...extra });
const until = async (cond, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('等待超时');
    await rcl.sleep(10);
  }
};
/** 开两个上下文、各一个节点，跑完自动关闭 */
async function pair(fn, optsA = {}, optsB = {}) {
  const [ca, cb] = [await ctx(optsA), await ctx(optsB)];
  const a = new rcl.Node('node_a', { context: ca }), b = new rcl.Node('node_b', { context: cb });
  rcl.spin(a); rcl.spin(b);
  try { await fn(a, b); } finally { await ca.shutdown(); await cb.shutdown(); }
}

test('CDR：字节布局和真实 ROS 2 一致', () => {
  // std_msgs/String "hi" → 封装头 + 长度 3 + 'h' 'i' \0
  assert.deepEqual([...rcl.serialize('std_msgs/msg/String', { data: 'hi' })], [0, 1, 0, 0, 3, 0, 0, 0, 0x68, 0x69, 0]);
  // 对齐：uint8 之后的 float64 要补到 8 字节边界
  const b = rcl.serialize('rcl_interfaces/msg/ParameterValue', { type: 3, double_value: 1.5 });
  assert.equal(b.readDoubleLE(4 + 16), 1.5);
});

test('CDR：嵌套、数组、默认值、64 位整数往返', () => {
  const img = { header: { stamp: { sec: 5, nanosec: 7 }, frame_id: '相机' }, height: 2, width: 3, encoding: 'rgb8', step: 9, data: new Uint8Array([1, 2, 3]) };
  assert.deepEqual(rcl.deserialize('sensor_msgs/msg/Image', rcl.serialize('sensor_msgs/msg/Image', img)), { ...img, is_bigendian: 0 });
  const r = rcl.deserialize('example_interfaces/srv/AddTwoInts_Request', rcl.serialize('example_interfaces/srv/AddTwoInts_Request', { a: -5, b: 2n ** 60n }));
  assert.deepEqual(r, { a: -5, b: 2n ** 60n });
  assert.equal(rcl.createMessage('geometry_msgs/msg/Pose').orientation.w, 1);
  const st = { status_list: [{ goal_info: { goal_id: { uuid: new Uint8Array(16).fill(9) }, stamp: { sec: 1, nanosec: 2 } }, status: 4 }] };
  assert.deepEqual(rcl.deserialize('action_msgs/msg/GoalStatusArray', rcl.serialize('action_msgs/msg/GoalStatusArray', st)), st);
  assert.throws(() => rcl.serialize('std_msgs/msg/Int32', { data: 2 ** 40 }));
});

test('YAML 与名字解析', () => {
  assert.deepEqual(parseFlow('{linear: {x: 2.0, y: 0}, name: "a b", list: [1, two, true]}'), { linear: { x: 2, y: 0 }, name: 'a b', list: [1, 'two', true] });
  assert.deepEqual(parseArg('data: hello world'), { data: 'hello world' });
  assert.deepEqual(parseBlock('talker:\n  ros__parameters:\n    rate: 2.5 # 注释\n    names: [a, b]\n'), { talker: { ros__parameters: { rate: 2.5, names: ['a', 'b'] } } });
  assert.equal(dump({ a: { b: 1 }, c: [1, 2], d: [{ x: 1, y: 2 }], e: '' }), 'a:\n  b: 1\nc:\n- 1\n- 2\nd:\n- x: 1\n  y: 2\ne: ""\n');
  assert.equal(expandName('chatter', 'n', '/ns'), '/ns/chatter');
  assert.equal(expandName('~/x', 'n', '/'), '/n/x');
  assert.equal(resolveName('chatter', 'n', '/', [['chatter', '/other']]), '/other');
  const a = parseRosArgs(['x', '--ros-args', '-r', '__node:=bob', '-p', 'k:=[1, 2]', '-r', 'a:=b']);
  assert.deepEqual([a.rest, a.nodeName, a.params, a.remaps], [['x'], 'bob', { k: [1, 2] }, [['a', 'b']]]);
});

test('话题：自动发现、收发、计算图', () => pair(async (a, b) => {
  const got = [];
  const pub = a.createPublisher('std_msgs/msg/String', 'chatter', 10);
  b.createSubscription('std_msgs/msg/String', 'chatter', m => got.push(m.data), 10);
  await until(() => pub.subscriptionCount === 1);
  for (let i = 0; i < 5; i++) pub.publish({ data: `msg ${i}` });
  await until(() => got.length === 5);
  assert.deepEqual(got, ['msg 0', 'msg 1', 'msg 2', 'msg 3', 'msg 4']);
  assert.deepEqual(b.getNodeNames().sort(), ['/node_a', '/node_b']);
  assert.deepEqual(b.getTopicNamesAndTypes().get('/chatter'), ['std_msgs/msg/String']);
  assert.equal(b.countPublishers('chatter'), 1);
  assert.ok(b.getServiceNamesAndTypes().has('/node_a/get_parameters'));
}));

test('可靠传输：30% 丢包下一条不丢、顺序不乱', () => pair(async (a, b) => {
  const got = [];
  const pub = a.createPublisher('std_msgs/msg/Int32', 'n', { depth: 300 });
  b.createSubscription('std_msgs/msg/Int32', 'n', m => got.push(m.data), { depth: 300 });
  await until(() => pub.subscriptionCount === 1);
  for (let i = 0; i < 200; i++) pub.publish({ data: i });
  await until(() => got.length === 200, 15000);
  assert.deepEqual(got, Array.from({ length: 200 }, (_, i) => i));
}, { lossRate: 0.3 }, { lossRate: 0.3 }));

test('尽力而为：丢包时会丢，但不会乱序或重复', () => pair(async (a, b) => {
  const got = [];
  const pub = a.createPublisher('std_msgs/msg/Int32', 'n', 'sensor_data');
  b.createSubscription('std_msgs/msg/Int32', 'n', m => got.push(m.data), { reliability: 'best_effort', depth: 500 });
  await until(() => pub.subscriptionCount === 1);
  for (let i = 0; i < 200; i++) pub.publish({ data: i });
  await rcl.sleep(300);
  assert.ok(got.length > 20 && got.length < 200, `收到 ${got.length} 条`);
  assert.ok(got.every((v, i) => i === 0 || v > got[i - 1]));
}, { lossRate: 0.5 }));

test('大消息分片：2 MB 图像在丢包下完整到达', () => pair(async (a, b) => {
  const data = new Uint8Array(2 << 20).map((_, i) => i * 7);
  let got = null;
  const pub = a.createPublisher('sensor_msgs/msg/Image', 'image', 1);
  b.createSubscription('sensor_msgs/msg/Image', 'image', m => { got = m; }, 1);
  await until(() => pub.subscriptionCount === 1);
  pub.publish({ width: 1024, height: 2048, encoding: 'mono8', data });
  await until(() => got, 15000);
  assert.equal(Buffer.compare(got.data, data), 0);
}, { lossRate: 0.02 }));

test('QoS：transient_local 补发历史，普通订阅者不补', () => pair(async (a, b) => {
  const latched = a.createPublisher('std_msgs/msg/String', 'map', { durability: 'transient_local', depth: 2 });
  const plain = a.createPublisher('std_msgs/msg/String', 'plain', 10);
  for (const p of [latched, plain]) for (const d of ['1', '2', '3']) p.publish({ data: d });
  await rcl.sleep(100);
  const got = { map: [], plain: [] };
  b.createSubscription('std_msgs/msg/String', 'map', m => got.map.push(m.data), { durability: 'transient_local', depth: 10 });
  b.createSubscription('std_msgs/msg/String', 'plain', m => got.plain.push(m.data), 10);
  await until(() => plain.subscriptionCount === 1);
  plain.publish({ data: '4' });
  await until(() => got.map.length === 2 && got.plain.length === 1);
  assert.deepEqual(got, { map: ['2', '3'], plain: ['4'] });
}));

test('QoS：不兼容的两端不匹配', () => pair(async (a, b) => {
  const pub = a.createPublisher('std_msgs/msg/String', 'x', 'sensor_data');          // 尽力而为
  const sub = b.createSubscription('std_msgs/msg/String', 'x', () => {}, 10);        // 要求可靠
  await until(() => b.countPublishers('x') === 1);
  await rcl.sleep(100);
  assert.equal(pub.subscriptionCount, 0);
  assert.equal(sub.publisherCount, 0);
}));

test('服务：请求应答、async 回调、多个客户端各取各的应答', () => pair(async (a, b) => {
  a.createService('example_interfaces/srv/AddTwoInts', 'add', async (req, res) => {
    await rcl.sleep(req.a);              // a 越大答得越晚，制造乱序
    res.sum = req.a + req.b;
    return res;
  }, { callbackGroup: a.createCallbackGroup('reentrant') });
  const c1 = b.createClient('example_interfaces/srv/AddTwoInts', 'add');
  const c2 = b.createClient('example_interfaces/srv/AddTwoInts', 'add');
  assert.ok(await c1.waitForService(3000) && await c2.waitForService(3000));
  const r = await Promise.all([c1.call({ a: 60, b: 1 }), c2.call({ a: 5, b: 2 }), c1.call({ a: 1, b: 3 })]);
  assert.deepEqual(r.map(x => x.sum), [61, 7, 4]);
  assert.equal(await b.createClient('std_srvs/srv/Trigger', 'nobody').waitForService(100), false);
}));

test('参数：声明、远程读写、类型检查、回调拒绝、事件', () => pair(async (a, b) => {
  assert.equal(a.declareParameter('speed', 1.5), 1.5);
  a.declareParameter('name', 'x', { read_only: true });
  a.onSetParameters(([p]) => p.name === 'speed' && p.value > 10 ? { successful: false, reason: '太快' } : { successful: true });
  const events = [];
  b.createSubscription('rcl_interfaces/msg/ParameterEvent', '/parameter_events', e => events.push(e), 'parameter_events');
  const set = b.createClient('rcl_interfaces/srv/SetParameters', '/node_a/set_parameters');
  const get = b.createClient('rcl_interfaces/srv/GetParameters', '/node_a/get_parameters');
  const list = b.createClient('rcl_interfaces/srv/ListParameters', '/node_a/list_parameters');
  await set.waitForService(3000); await get.waitForService(3000); await list.waitForService(3000);
  const P = (name, type, field, v) => ({ name, value: { type, [field]: v } });
  const { results } = await set.call({ parameters: [
    P('speed', 2, 'integer_value', 3),       // 整数给浮点参数：可以
    P('speed', 3, 'double_value', 99),       // 被回调拒绝
    P('speed', 4, 'string_value', 'fast'),   // 类型不对
    P('name', 4, 'string_value', 'y'),       // 只读
    P('nope', 1, 'bool_value', true),        // 没声明
  ] });
  assert.deepEqual(results.map(r => r.successful), [true, false, false, false, false]);
  assert.equal(results[1].reason, '太快');
  assert.equal(a.getParameter('speed'), 3);
  assert.equal((await get.call({ names: ['speed'] })).values[0].double_value, 3);
  assert.deepEqual((await list.call({})).result.names, ['use_sim_time', 'speed', 'name']);
  await until(() => events.some(e => e.node === '/node_a' && e.changed_parameters[0]?.name === 'speed'));
}));

test('参数初值：命令行 -p 覆盖代码里的默认值', async () => {
  const c = await new rcl.Context().init(['--ros-args', '-p', 'rate:=5', '-r', '__node:=renamed', '-r', 'chatter:=/talk'], { domainId: DOMAIN, localhostOnly: true });
  try {
    const n = new rcl.Node('orig', { context: c });
    assert.equal(n.name, 'renamed');
    assert.equal(n.declareParameter('rate', 1), 5);
    assert.equal(n.createPublisher('std_msgs/msg/String', 'chatter').topic, '/talk');
  } finally { await c.shutdown(); }
});

test('动作：反馈、结果、取消', () => pair(async (a, b) => {
  new rcl.ActionServer(a, 'example_interfaces/action/Fibonacci', 'fib', async gh => {
    const seq = [0, 1];
    for (let i = 1; i < gh.request.order; i++) {
      if (gh.isCancelRequested) { gh.canceled(); return { sequence: seq }; }
      seq.push(seq[i] + seq[i - 1]);
      gh.publishFeedback({ sequence: seq });
      await rcl.sleep(10);
    }
    gh.succeed();
    return { sequence: seq };
  }, { goalCallback: goal => goal.order > 0 });
  const client = new rcl.ActionClient(b, 'example_interfaces/action/Fibonacci', 'fib');
  assert.ok(await client.waitForServer(3000));

  const feedback = [];
  const g1 = await client.sendGoal({ order: 6 }, { feedback: f => feedback.push(f.sequence.length) });
  assert.ok(g1.accepted);
  const r1 = await g1.getResult();
  assert.equal(r1.status, rcl.GoalStatus.SUCCEEDED);
  assert.deepEqual(r1.result.sequence, [0, 1, 1, 2, 3, 5, 8]);
  await until(() => feedback.length === 5);
  assert.deepEqual(feedback, [3, 4, 5, 6, 7]);

  assert.equal((await client.sendGoal({ order: 0 })).accepted, false);    // 被 goalCallback 拒绝

  const g2 = await client.sendGoal({ order: 1000 });
  await rcl.sleep(50);
  assert.equal((await g2.cancel()).goals_canceling.length, 1);
  const r2 = await g2.getResult();
  assert.equal(r2.status, rcl.GoalStatus.CANCELED);
  assert.ok(r2.result.sequence.length < 100);
}));

test('执行器：互斥组里的 async 回调不交错；不 spin 就不执行回调', async () => {
  const c = await ctx();
  try {
    const n = new rcl.Node('exec', { context: c });
    const log = [];
    const pub = n.createPublisher('std_msgs/msg/Int32', 't', 10);
    n.createSubscription('std_msgs/msg/Int32', 't', async m => { log.push(`开始${m.data}`); await rcl.sleep(20); log.push(`结束${m.data}`); }, 10);
    await rcl.sleep(20);
    pub.publish({ data: 1 }); pub.publish({ data: 2 });
    await rcl.sleep(80);
    assert.deepEqual(log, []);                                   // 还没 spin
    rcl.spin(n);
    await until(() => log.length === 4);
    assert.deepEqual(log, ['开始1', '结束1', '开始2', '结束2']);
  } finally { await c.shutdown(); }
});

test('节点下线：对方很快感知到', () => pair(async (a, b) => {
  const pub = a.createPublisher('std_msgs/msg/String', 'c', 10);
  b.createSubscription('std_msgs/msg/String', 'c', () => {}, 10);
  await until(() => pub.subscriptionCount === 1);
  await b.context.shutdown();
  await until(() => pub.subscriptionCount === 0 && a.getNodeNames().length === 1, 2000);
}));
