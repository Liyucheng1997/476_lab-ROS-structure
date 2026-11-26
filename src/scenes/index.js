import arch from './architecture.js';
import comm from './comm.js';
import build from './build.js';
import code from './code.js';
import internals from './internals.js';

const [overview, ros1Arch, ros2Arch] = arch;
const [ros1Topic, ros2Disc, patterns] = comm;

export const sections = [
  { title: '架构', scenes: [overview, ros1Arch, ros2Arch] },
  { title: '通信', scenes: [patterns, ros1Topic, ros2Disc] },
  { title: '编译', scenes: [...build] },
  { title: '代码结构', scenes: [...code, internals.libs] },
  { title: '实现原理', scenes: [internals.executor, internals.rosidl] },
];
