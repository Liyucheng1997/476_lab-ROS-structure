// 一个 Web Worker 就是一个进程。它运行的是 ros2/ 目录里原封不动的代码，
// 入口和真机上一样：ros2/cli/ros2.js，命令行参数从 process.argv 里读。
import { rt, boot } from './runtime.js';

self.onmessage = async ({ data: m }) => {
  if (m.type !== 'start') return rt.dispatch(m);
  boot(m);
  try {
    await import('../../ros2/cli/ros2.js');
  } catch (err) {
    console.error(err?.stack || String(err));
    process.exit(1);
  }
  rt.mainDone = true;
  rt.checkIdle();
};
