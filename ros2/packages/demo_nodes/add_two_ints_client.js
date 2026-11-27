// 客户端：ros2 run demo_nodes add_two_ints_client 2 3
import * as rcl from '#rcljs';

const ctx = await rcl.init();
const [a = 2, b = 3] = ctx.args.rest.map(Number);
const node = new rcl.Node('add_two_ints_client');
const client = node.createClient('example_interfaces/srv/AddTwoInts', 'add_two_ints');
rcl.spin(node);

while (!await client.waitForService(1000)) node.getLogger().info('service not available, waiting again...');
const response = await client.call({ a, b });
node.getLogger().info(`Result of add_two_ints: ${a} + ${b} = ${response.sum}`);
await rcl.shutdown();
