// 没有窗口的小乌龟仿真：一个 11×11 的场地，乌龟按速度指令移动。
//   订阅   /turtle1/cmd_vel            geometry_msgs/msg/Twist   速度指令，1 秒没有新指令就停下
//   发布   /turtle1/pose               turtlesim/msg/Pose        20 Hz
//   服务   /reset                      std_srvs/srv/Empty
//          /turtle1/teleport_absolute  turtlesim/srv/TeleportAbsolute
//   动作   /turtle1/rotate_absolute    turtlesim/action/RotateAbsolute
import * as rcl from '#rcljs';

await rcl.init();
const node = new rcl.Node('turtlesim');
const log = node.getLogger();
const SIZE = 11.088889, DT = 0.05;
const start = () => ({ x: SIZE / 2, y: SIZE / 2, theta: 0, linear_velocity: 0, angular_velocity: 0 });
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
let pose = start(), lastCmd = 0;

node.createSubscription('geometry_msgs/msg/Twist', 'turtle1/cmd_vel', msg => {
  pose.linear_velocity = msg.linear.x;
  pose.angular_velocity = msg.angular.z;
  lastCmd = Date.now();
}, 10);

const posePub = node.createPublisher('turtlesim/msg/Pose', 'turtle1/pose', 10);
node.createTimer(DT * 1000, () => {
  if (Date.now() - lastCmd > 1000) pose.linear_velocity = pose.angular_velocity = 0;
  pose.theta = wrap(pose.theta + pose.angular_velocity * DT);
  const x = pose.x + Math.cos(pose.theta) * pose.linear_velocity * DT;
  const y = pose.y + Math.sin(pose.theta) * pose.linear_velocity * DT;
  if (x < 0 || x > SIZE || y < 0 || y > SIZE) log.warn(`Oh no! I hit the wall! (Clamping from [x=${x.toFixed(6)}, y=${y.toFixed(6)}])`);
  pose.x = Math.min(SIZE, Math.max(0, x));
  pose.y = Math.min(SIZE, Math.max(0, y));
  posePub.publish(pose);
});

node.createService('std_srvs/srv/Empty', 'reset', () => {
  pose = start();
  log.info('Resetting turtlesim.');
});
node.createService('turtlesim/srv/TeleportAbsolute', 'turtle1/teleport_absolute', req => {
  Object.assign(pose, { x: req.x, y: req.y, theta: wrap(req.theta) });
  log.info(`Teleporting to x=${req.x}, y=${req.y}, theta=${req.theta}`);
});

new rcl.ActionServer(node, 'turtlesim/action/RotateAbsolute', 'turtle1/rotate_absolute', async goal => {
  const from = pose.theta;
  for (;;) {
    const remaining = wrap(goal.request.theta - pose.theta);
    if (goal.isCancelRequested) { goal.canceled(); return { delta: wrap(pose.theta - from) }; }
    if (Math.abs(remaining) < 0.02) break;
    pose.theta = wrap(pose.theta + Math.sign(remaining) * Math.min(Math.abs(remaining), 1.0 * DT));
    goal.publishFeedback({ remaining });
    await rcl.sleep(DT * 1000);
  }
  goal.succeed();
  log.info('Rotation goal completed successfully');
  return { delta: wrap(pose.theta - from) };
});

log.info(`Spawning turtle [turtle1] at x=[${pose.x.toFixed(6)}], y=[${pose.y.toFixed(6)}], theta=[0.000000]`);
await rcl.spin(node);
