// 执行器：决定“哪个回调什么时候跑”。
// 订阅收到消息、定时器到点、服务收到请求时都只是把自己标记为“有活干”，
// 真正调用回调的是执行器。所以不 spin，回调就不会执行——和 ROS 2 一样。

/**
 * 回调组。
 *   互斥（默认）：组内的回调一个跑完（包括 async 回调 await 完）才跑下一个；
 *   可重入：组内的回调可以交错执行。
 */
export class CallbackGroup {
  constructor(exclusive = true) { this.exclusive = exclusive; this.busy = false; }
}

export class Executor {
  constructor() { this.nodes = new Set(); this.scheduled = false; }

  addNode(node) { this.nodes.add(node); node._executor = this; this.wake(); }
  removeNode(node) { this.nodes.delete(node); if (node._executor === this) node._executor = null; }

  /** 有实体就绪时调用：安排一轮调度（同一轮事件循环里多次调用只安排一次） */
  wake() {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => this._run());
  }

  /** 一轮调度：每个就绪的实体各执行一个回调，轮流来，谁也不会饿死 */
  _run() {
    this.scheduled = false;
    let more = false;
    for (const node of this.nodes) for (const e of node.entities) {
      if (!e.hasWork()) continue;
      const g = e.group;
      if (g.exclusive && g.busy) continue;     // 等这个组里正在跑的回调结束，结束时会再 wake
      let r;
      try { r = e.execute(); } catch (err) { report(node, err); }
      if (r && typeof r.then === 'function') {
        if (g.exclusive) g.busy = true;
        r.catch(err => report(node, err)).finally(() => { g.busy = false; this.wake(); });
      }
      if (e.hasWork()) more = true;
    }
    if (more) this.wake();
  }
}

const report = (node, err) => node.logger.error(`回调里抛出了异常：${err?.stack || err}`);
