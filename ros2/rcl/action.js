// 动作：耗时长、可取消、有进度反馈的任务。
// 中间件里没有“动作”这个概念，它是用 3 个服务 + 2 个话题拼出来的：
//   <名字>/_action/send_goal    服务：提交目标，服务端决定接不接
//   <名字>/_action/cancel_goal  服务：请求取消
//   <名字>/_action/get_result   服务：等任务结束后取结果
//   <名字>/_action/feedback     话题：执行中的进度
//   <名字>/_action/status       话题：所有目标的状态
import crypto from 'node:crypto';
import { getAction, createMessage } from '../rosidl/idl.js';
import { now } from './logging.js';

export const GoalStatus = { UNKNOWN: 0, ACCEPTED: 1, EXECUTING: 2, CANCELING: 3, SUCCEEDED: 4, CANCELED: 5, ABORTED: 6 };
const STATUS_QOS = { reliability: 'reliable', durability: 'transient_local', depth: 1 };
const hex = uuid => Buffer.from(uuid).toString('hex');

class ServerGoalHandle {
  constructor(server, uuid, goal) {
    this.server = server; this.uuid = uuid; this.goalId = hex(uuid);
    this.request = goal;             // 客户端发来的目标
    this.stamp = now(); this.status = GoalStatus.EXECUTING; this.result = null;
    this.done = new Promise(resolve => { this._resolve = resolve; });
  }
  get isCancelRequested() { return this.status === GoalStatus.CANCELING; }
  get isActive() { return this.status <= GoalStatus.CANCELING; }
  publishFeedback(feedback) { this.server.feedback.publish({ goal_id: { uuid: this.uuid }, feedback }); }
  succeed() { this._finish(GoalStatus.SUCCEEDED); }
  abort() { this._finish(GoalStatus.ABORTED); }
  canceled() { this._finish(GoalStatus.CANCELED); }
  _finish(status) { if (this.isActive) { this.status = status; this.server._publishStatus(); } }
  info() { return { goal_id: { uuid: this.uuid }, stamp: this.stamp }; }
}

export class ActionServer {
  /**
   * @param execute async (goalHandle) => result。里面调用 goalHandle.succeed() / abort() / canceled() 标记结局
   * @param opts { goalCallback(goal) → 是否接受, cancelCallback(goalHandle) → 是否同意取消 }
   */
  constructor(node, type, name, execute, opts = {}) {
    const A = this.action = getAction(type);
    this.node = node; this.execute = execute; this.opts = opts;
    this.goals = new Map();
    const base = `${name}/_action`;
    const o = { callbackGroup: node.createCallbackGroup('reentrant') };   // 等结果的请求不能挡住别的回调
    this.feedback = node.createPublisher(A.FeedbackMessage, `${base}/feedback`);
    this.status = node.createPublisher('action_msgs/msg/GoalStatusArray', `${base}/status`, STATUS_QOS);

    node.createService(A.SendGoal, `${base}/send_goal`, async req => {
      const id = hex(req.goal_id.uuid);
      if (this.goals.has(id) || !(await (opts.goalCallback?.(req.goal) ?? true))) return { accepted: false };
      const gh = new ServerGoalHandle(this, req.goal_id.uuid, req.goal);
      this.goals.set(id, gh);
      this._publishStatus();
      setImmediate(() => this._run(gh));
      return { accepted: true, stamp: gh.stamp };
    }, o);

    node.createService('action_msgs/srv/CancelGoal', `${base}/cancel_goal`, req => {
      const id = hex(req.goal_info.goal_id.uuid), all = /^0+$/.test(id);
      if (!all && !this.goals.has(id)) return { return_code: 2 };
      const targets = [...this.goals.values()].filter(g => all || g.goalId === id);
      if (!all && !targets[0].isActive) return { return_code: 3 };
      const canceling = targets.filter(g => g.status === GoalStatus.EXECUTING && (opts.cancelCallback?.(g) ?? true));
      for (const g of canceling) g.status = GoalStatus.CANCELING;
      this._publishStatus();
      return { return_code: canceling.length || all ? 0 : 1, goals_canceling: canceling.map(g => g.info()) };
    }, o);

    node.createService(A.GetResult, `${base}/get_result`, async req => {
      const gh = this.goals.get(hex(req.goal_id.uuid));
      if (!gh) return { status: GoalStatus.UNKNOWN };
      await gh.done;
      return { status: gh.status, result: gh.result };
    }, o);
  }

  async _run(gh) {
    try {
      gh.result = await this.execute(gh);
      if (gh.isActive) {
        this.node.logger.warn('execute 回调结束时没有标记目标的结局，按失败处理');
        gh.abort();
      }
    } catch (err) {
      this.node.logger.error(`执行目标时出错：${err?.stack || err}`);
      gh.abort();
    }
    gh.result ??= createMessage(this.action.Result);
    gh._resolve();
    setTimeout(() => this.goals.delete(gh.goalId), 60_000).unref?.();   // 结果保留一分钟
  }

  _publishStatus() {
    this.status.publish({ status_list: [...this.goals.values()].map(g => ({ goal_info: g.info(), status: g.status })) });
  }
}

export class ActionClient {
  constructor(node, type, name) {
    const A = this.action = getAction(type), base = `${name}/_action`;
    this.node = node;
    this.onFeedback = new Map();     // 目标 id → 反馈回调
    this.sendGoalClient = node.createClient(A.SendGoal, `${base}/send_goal`);
    this.cancelClient = node.createClient('action_msgs/srv/CancelGoal', `${base}/cancel_goal`);
    this.resultClient = node.createClient(A.GetResult, `${base}/get_result`);
    node.createSubscription(A.FeedbackMessage, `${base}/feedback`,
      m => this.onFeedback.get(hex(m.goal_id.uuid))?.(m.feedback),
      { callbackGroup: node.createCallbackGroup('reentrant') });
  }

  isReady() { return this.sendGoalClient.isReady() && this.cancelClient.isReady() && this.resultClient.isReady(); }
  async waitForServer(timeoutMs = Infinity) {
    const end = Date.now() + timeoutMs;
    while (!this.isReady()) {
      if (Date.now() >= end || !this.node.context.ok) return false;
      await new Promise(r => setTimeout(r, 20));
    }
    return true;
  }

  /**
   * 提交目标。返回的句柄：{ accepted, goalId, getResult(), cancel() }
   * @param opts { feedback: 进度回调 }（收反馈需要节点在 spin）
   */
  async sendGoal(goal, opts = {}) {
    const uuid = new Uint8Array(crypto.randomBytes(16)), id = hex(uuid), goal_id = { uuid };
    if (opts.feedback) this.onFeedback.set(id, opts.feedback);
    const res = await this.sendGoalClient.call({ goal_id, goal });
    if (!res.accepted) this.onFeedback.delete(id);
    return {
      accepted: res.accepted, goalId: id, stamp: res.stamp,
      /** 等任务结束：{ status, result } */
      getResult: async () => {
        const r = await this.resultClient.call({ goal_id });
        this.onFeedback.delete(id);
        return r;
      },
      cancel: () => this.cancelClient.call({ goal_info: { goal_id } }),
    };
  }
}
