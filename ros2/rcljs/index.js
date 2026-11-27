// rcljs：写节点时用的客户端库（相当于 rclcpp / rclpy 的位置）。
//
//   import * as rcl from '#rcljs';
//   await rcl.init();
//   const node = new rcl.Node('talker');
//   const pub = node.createPublisher('std_msgs/msg/String', 'chatter', 10);
//   node.createTimer(1000, () => pub.publish({ data: 'hello' }));
//   await rcl.spin(node);
import { Context, getDefaultContext, setDefaultContext } from '../rcl/context.js';
import { Node } from '../rcl/node.js';

export { Node, Context };
export { CallbackGroup, Executor } from '../rcl/executor.js';
export { ActionServer, ActionClient, GoalStatus } from '../rcl/action.js';
export { ParameterType } from '../rcl/parameters.js';
export { QoSProfiles } from '../dds/qos.js';
export { getType, getService, getAction, createMessage } from '../rosidl/idl.js';
export { serialize, deserialize } from '../rosidl/cdr.js';

/**
 * 初始化：解析命令行里的 --ros-args，启动中间件并开始发现其他节点。
 * @param argv 默认取 process.argv
 * @param options { domainId, localhostOnly, handleSignals }
 */
export async function init(argv, options = {}) {
  const ctx = await new Context().init(argv, options);
  setDefaultContext(ctx);
  if (options.handleSignals !== false) {
    const stop = () => ctx.shutdown().then(() => process.exit(0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
  return ctx;
}

/** 关闭：销毁所有节点，通知其他参与者自己下线 */
export const shutdown = (ctx = getDefaultContext()) => ctx.shutdown();
export const ok = () => { try { return getDefaultContext().ok; } catch { return false; } };
export const createNode = (name, opts) => new Node(name, opts);

/** 把节点交给执行器，开始处理回调。返回的 Promise 在 shutdown 时结束。 */
export function spin(node) {
  node.context.executor.addNode(node);
  return node.context.done;
}

/** 处理回调，直到给定的 Promise 有结果 */
export function spinUntilComplete(node, promise) {
  node.context.executor.addNode(node);
  return promise;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
