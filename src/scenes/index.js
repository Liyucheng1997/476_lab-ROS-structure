import arch from './architecture.js';
import comm from './comm.js';
import build from './build.js';
import code from './code.js';
import internals from './internals.js';

const [overview, ros1Arch, ros2Arch] = arch;
const [ros1Topic, ros2Disc, patterns] = comm;

/** 「实机运行」不是一张静态图：终端、数据包和 3D 画面都来自浏览器里真实运行的 ros2/ 代码（见 src/lab/） */
const lab = {
  id: 'lab', nav: '终端与实时通信', lab: true,
  title: '实机运行：终端、数据包、启动过程',
  subtitle: '下面的终端跑的是 ros2/ 目录里的真实代码，画面上每个小点都是一个真实的数据包',
};

export const sections = [
  { title: '实机运行', scenes: [lab] },
  { title: '架构', scenes: [overview, ros1Arch, ros2Arch] },
  { title: '通信', scenes: [patterns, ros1Topic, ros2Disc] },
  { title: '编译', scenes: [...build] },
  { title: '代码结构', scenes: [...code, internals.libs] },
  { title: '实现原理', scenes: [internals.executor, internals.rosidl] },
];
