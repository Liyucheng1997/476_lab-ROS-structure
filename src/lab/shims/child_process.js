// node:child_process 的替身：ros2 launch 用它拉起子进程。
import { EventEmitter } from './events.js';
import { rt } from '../runtime.js';

const kids = new Map();
let nextId = 1;

rt.on('child', m => {
  const c = kids.get(m.id);
  if (!c) return;
  if (m.op === 'pid') { c.pid = m.pid; c.emit('spawn'); }
  else if (m.op === 'out') c[m.stream].emit('data', m.text + '\n');
  else if (m.op === 'exit') { kids.delete(m.id); c.emit('exit', m.code); rt.release(); }
});

export function spawn(cmd, args) {
  const c = new EventEmitter(), id = nextId++;
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
  c.kill = () => rt.post({ type: 'killchild', id });
  kids.set(id, c);
  rt.hold();
  rt.post({ type: 'spawn', id, argv: ['node', ...args] });
  return c;
}
export default { spawn };
