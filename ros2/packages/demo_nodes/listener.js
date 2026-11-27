// 订阅 /chatter，收到什么打印什么。
import * as rcl from '#rcljs';

await rcl.init();
const node = new rcl.Node('listener');
node.createSubscription('std_msgs/msg/String', 'chatter', msg => {
  node.getLogger().info(`I heard: [${msg.data}]`);
}, 10);
await rcl.spin(node);
