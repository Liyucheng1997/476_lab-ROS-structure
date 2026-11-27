// 网页里的终端：一个很小的 shell，ros2 命令交给内核去启动进程。
const KEYS = { ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D', Enter: '\r' };
const HELP = `这里运行的是仓库 ros2/ 目录里的真实代码，每条 ros2 命令都是一个独立进程。
  ros2 run demo_nodes talker          运行节点（ros2 pkg executables 看全部）
  ros2 topic list | echo | pub | hz   话题
  ros2 service list | call            服务
  ros2 param list | get | set         参数
  ros2 action list | send_goal        动作
  ros2 node list | info               节点
  ros2 launch demo_nodes/talker_listener.launch.js
  ros2 --help                         完整用法
内置命令：clear 清屏   ps 进程表   kill <进程号>   export ROS_DOMAIN_ID=5   env
按键：Ctrl+C 结束前台进程   ↑ ↓ 翻历史命令`;

/** 把一行命令拆成参数，支持单引号和双引号 */
export function split(line) {
  const out = [];
  for (const m of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export class Terminal {
  constructor(kernel, n, { onFocus, onClose }) {
    this.kernel = kernel; this.n = n; this.fg = null;
    this.env = {}; this.history = []; this.hi = 0;
    const el = this.el = document.createElement('div');
    el.className = 'term';
    el.innerHTML = `
      <div class="term-head">
        <span class="term-title">终端 ${n}</span><span class="term-cmd"></span>
        <button class="term-stop" type="button" hidden title="相当于按 Ctrl+C">停止</button>
        <button class="term-x" type="button" aria-label="关闭终端">×</button>
      </div>
      <div class="term-out" tabindex="0"></div>
      <label class="term-line"><span class="ps">$</span><input spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="输入命令，help 看帮助" aria-label="终端 ${n} 命令输入"></label>`;
    this.out = el.querySelector('.term-out');
    this.input = el.querySelector('input');
    this.line = el.querySelector('.term-line');
    this.stopBtn = el.querySelector('.term-stop');
    this.cmdEl = el.querySelector('.term-cmd');

    el.addEventListener('focusin', () => onFocus(this));
    el.addEventListener('pointerdown', () => onFocus(this));
    this.out.addEventListener('click', () => { if (!this.fg && !getSelection().toString()) this.input.focus(); });
    this.stopBtn.onclick = () => this.interrupt();
    el.querySelector('.term-x').onclick = () => { this.interrupt(); onClose(this); };
    this.input.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { const v = this.input.value; this.input.value = ''; this.exec(v); }
      else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        this.hi = Math.max(0, Math.min(this.history.length, this.hi + (ev.key === 'ArrowUp' ? -1 : 1)));
        this.input.value = this.history[this.hi] ?? '';
      } else if (ev.key === 'c' && ev.ctrlKey && !getSelection().toString()) { this.write(`$ ${this.input.value}^C`, 'cmd'); this.input.value = ''; }
    });
    // 前台有进程时，键盘输入发给它（Ctrl+C 变成信号）
    this.out.addEventListener('keydown', ev => {
      if (!this.fg) return;
      ev.stopPropagation();
      if (ev.key === 'c' && ev.ctrlKey) { ev.preventDefault(); return this.interrupt(); }
      if (!this.fg.raw) return;
      const seq = KEYS[ev.key] ?? (ev.key.length === 1 ? ev.key : null);
      if (seq) { ev.preventDefault(); kernel.stdin(this.fg.pid, seq); }
    });

    kernel.on('out', (proc, stream, text) => { if (proc.tty === this) this.write(text, stream === 'stderr' ? 'err' : ''); });
    kernel.on('exit', proc => { if (proc === this.fg) this._done(); });
  }

  write(text, cls = '') {
    const stick = this.out.scrollHeight - this.out.scrollTop - this.out.clientHeight < 30;
    for (const l of String(text).split('\n')) {
      const d = document.createElement('div');
      d.className = cls || (/^\[(WARN)\]/.test(l) ? 'warn' : /^\[(ERROR|FATAL)\]/.test(l) ? 'err' : '');
      d.textContent = l || ' ';
      this.out.appendChild(d);
    }
    while (this.out.childElementCount > 400) this.out.firstChild.remove();
    if (stick) this.out.scrollTop = this.out.scrollHeight;
  }

  interrupt() {
    if (!this.fg) return;
    this.write('^C', 'cmd');
    this.kernel.kill(this.fg.pid);
  }

  /** 执行一行命令。前台有进程在跑时，先把它停掉 */
  async exec(line) {
    line = line.trim();
    if (this.fg) { this.interrupt(); await new Promise(r => { const t = setInterval(() => { if (!this.fg) { clearInterval(t); r(); } }, 30); }); }
    this.write(`$ ${line}`, 'cmd');
    this.out.scrollTop = this.out.scrollHeight;
    if (!line) return;
    if (this.history.at(-1) !== line) this.history.push(line);
    this.hi = this.history.length;
    let args = split(line);
    if (args[0] === 'node' && /ros2\.js$/.test(args[1] || '')) args = ['ros2', ...args.slice(2)];
    const [cmd, ...rest] = args;
    if (cmd === 'ros2') return this._spawn(rest, line);
    if (cmd === 'help') return this.write(HELP);
    if (cmd === 'clear') return this.out.replaceChildren();
    if (cmd === 'env') return this.write(Object.entries({ ROS_DOMAIN_ID: '0', RMW_IMPLEMENTATION: 'rmw_minidds', ...this.env }).map(([k, v]) => `${k}=${v}`).join('\n'));
    if (cmd === 'export' && /^\w+=/.test(rest[0] || '')) {
      const i = rest[0].indexOf('=');
      this.env[rest[0].slice(0, i)] = rest[0].slice(i + 1);
      return;
    }
    if (cmd === 'ps') {
      const list = this.kernel.alive();
      return this.write(list.length ? ['进程号  命令', ...list.map(p => `${String(p.pid).padStart(5)}   ${p.cmd}`)].join('\n') : '没有正在运行的进程');
    }
    if (cmd === 'kill') return this.kernel.kill(Number(rest[0]));
    this.write(`${cmd}: 找不到命令。这个终端只认识 ros2 和几个内置命令，输入 help 看看。`, 'err');
  }

  _spawn(args, line) {
    this.fg = this.kernel.spawn(['node', '/ros2/cli/ros2.js', ...args], { env: { ...this.env }, tty: this });
    this.line.hidden = true; this.stopBtn.hidden = false;
    this.cmdEl.textContent = line;
    this.el.classList.add('busy');
    if (this.el.contains(document.activeElement)) this.out.focus();
  }

  _done() {
    const hadFocus = this.el.contains(document.activeElement);
    this.fg = null;
    this.line.hidden = false; this.stopBtn.hidden = true;
    this.cmdEl.textContent = '';
    this.el.classList.remove('busy');
    this.out.scrollTop = this.out.scrollHeight;
    if (hadFocus) this.input.focus();
  }
}
