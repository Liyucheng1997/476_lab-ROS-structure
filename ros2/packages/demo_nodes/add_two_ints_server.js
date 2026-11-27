// 服务端：把请求里的两个整数加起来。
import * as rcl from '#rcljs';

await rcl.init();
const node = new rcl.Node('add_two_ints_server');
node.createService('example_interfaces/srv/AddTwoInts', 'add_two_ints', (request, response) => {
  response.sum = request.a + request.b;
  node.getLogger().info(`Incoming request  a: ${request.a} b: ${request.b}`);
  return response;
});
await rcl.spin(node);
