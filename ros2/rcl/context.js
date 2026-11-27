// 上下文：一次 init 到 shutdown 之间的全部状态。一个上下文对应中间件里的一个参与者。
import { loadRmw } from '../rmw/index.js';
import { parseRosArgs } from './names.js';
import { Executor } from './executor.js';

let current = null;
export const getDefaultContext = () => {
  if (!current?.ok) throw new Error('还没有初始化：先 await rcl.init()');
  return current;
};
export const setDefaultContext = c => { current = c; };

export class Context {
  /**
   * @param argv 命令行参数（含 --ros-args …）
   * @param options { domainId, localhostOnly, lossRate }
   */
  async init(argv = process.argv.slice(2), options = {}) {
    const env = process.env;
    this.args = parseRosArgs(argv);
    this.domainId = options.domainId ?? Number(env.ROS_DOMAIN_ID || 0);
    const impl = await loadRmw();
    this.rmw = await impl.init({
      domainId: this.domainId,
      localhostOnly: options.localhostOnly ?? env.ROS_LOCALHOST_ONLY === '1',
      staticPeers: (env.ROS_STATIC_PEERS || '').split(/[;,]/).filter(Boolean),
      lossRate: options.lossRate,
    });
    this.rmw.onIncompatibleQos(({ local, remote, policy }) => {
      const topic = local.topic.replace(/^r[tqr]/, '');
      console.error(`[WARN] [rmw]: 话题 '${topic}' 上发现了 QoS 不兼容的${remote.kind === 'w' ? '发布者' : '订阅者'}（${policy}），双方不会通信`);
    });
    this.executor = new Executor();
    this.nodes = new Set();
    this.ok = true;
    this.done = new Promise(resolve => { this._resolve = resolve; });
    return this;
  }

  async shutdown() {
    if (!this.ok) return;
    this.ok = false;
    for (const n of [...this.nodes]) n.destroy();
    await this.rmw.shutdown();
    this._resolve();
  }
}
