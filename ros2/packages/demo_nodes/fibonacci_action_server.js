// 动作服务端：算斐波那契数列，每算一项发一次反馈，可以中途取消。
import * as rcl from '#rcljs';

await rcl.init();
const node = new rcl.Node('fibonacci_action_server');
const log = node.getLogger();

new rcl.ActionServer(node, 'example_interfaces/action/Fibonacci', 'fibonacci', async goal => {
  log.info(`Executing goal: order = ${goal.request.order}`);
  const sequence = [0, 1];
  for (let i = 1; i < goal.request.order; i++) {
    if (goal.isCancelRequested) {
      goal.canceled();
      log.info('Goal canceled');
      return { sequence };
    }
    sequence.push(sequence[i] + sequence[i - 1]);
    goal.publishFeedback({ sequence });
    log.info(`Publishing feedback: [${sequence.join(', ')}]`);
    await rcl.sleep(500);
  }
  goal.succeed();
  log.info('Goal succeeded');
  return { sequence };
}, {
  goalCallback: goal => goal.order >= 1 && goal.order <= 46,   // 再大 int32 就装不下了
});
await rcl.spin(node);
