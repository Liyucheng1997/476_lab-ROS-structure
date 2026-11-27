// 用方向键开乌龟：↑ ↓ 前进后退，← → 转向，q 退出。
import * as rcl from '#rcljs';

await rcl.init();
const node = new rcl.Node('teleop_turtle');
const pub = node.createPublisher('geometry_msgs/msg/Twist', 'turtle1/cmd_vel', 10);
rcl.spin(node);

const KEYS = { '\x1b[A': [2, 0], '\x1b[B': [-2, 0], '\x1b[D': [0, 2], '\x1b[C': [0, -2] };
if (!process.stdin.isTTY) {
  console.error('需要在真正的终端里运行（要读键盘）');
  process.exit(1);
}
console.log('Reading from keyboard\n---------------------------\n方向键移动乌龟，q 退出。');
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', async key => {
  if (key === 'q' || key === '\x03') {
    await rcl.shutdown();
    process.exit(0);
  }
  const k = KEYS[key];
  if (k) pub.publish({ linear: { x: k[0] }, angular: { z: k[1] } });
});
