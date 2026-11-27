// 动作客户端：ros2 run demo_nodes fibonacci_action_client 10
import * as rcl from '#rcljs';

const ctx = await rcl.init();
const order = Number(ctx.args.rest[0] ?? 10);
const node = new rcl.Node('fibonacci_action_client');
const log = node.getLogger();
const client = new rcl.ActionClient(node, 'example_interfaces/action/Fibonacci', 'fibonacci');
rcl.spin(node);

log.info('Waiting for action server...');
await client.waitForServer();
const goal = await client.sendGoal({ order }, {
  feedback: fb => log.info(`Received feedback: [${fb.sequence.join(', ')}]`),
});
if (!goal.accepted) {
  log.error('Goal rejected');
} else {
  log.info('Goal accepted');
  const { status, result } = await goal.getResult();
  log.info(`Result (status ${status}): [${result.sequence.join(', ')}]`);
}
await rcl.shutdown();
