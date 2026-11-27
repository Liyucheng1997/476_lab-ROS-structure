// 每隔一段时间往 /chatter 发一句话。
//   ros2 run demo_nodes talker
//   ros2 run demo_nodes talker --ros-args -p greeting:=你好 -p period_ms:=200
import * as rcl from '#rcljs';

await rcl.init();
const node = new rcl.Node('talker');
const period = node.declareParameter('period_ms', 1000, { description: '发布间隔（毫秒），启动后不可改', read_only: true });
node.declareParameter('greeting', 'Hello World', { description: '每条消息的开头，可以随时用 ros2 param set 修改' });

const pub = node.createPublisher('std_msgs/msg/String', 'chatter', 10);
let count = 0;
node.createTimer(period, () => {
  const msg = { data: `${node.getParameter('greeting')}: ${++count}` };
  node.getLogger().info(`Publishing: '${msg.data}'`);
  pub.publish(msg);
});
await rcl.spin(node);
