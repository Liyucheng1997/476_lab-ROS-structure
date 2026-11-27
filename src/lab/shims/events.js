// node:events 的替身
export class EventEmitter {
  on(ev, fn) { ((this._ev ??= {})[ev] ??= []).push(fn); return this; }
  once(ev, fn) {
    const g = (...a) => { this.off(ev, g); fn(...a); };
    g.orig = fn;
    return this.on(ev, g);
  }
  off(ev, fn) {
    const l = this._ev?.[ev];
    if (l) this._ev[ev] = l.filter(x => x !== fn && x.orig !== fn);
    return this;
  }
  removeListener(ev, fn) { return this.off(ev, fn); }
  removeAllListeners(ev) {
    if (this._ev) { if (ev) delete this._ev[ev]; else this._ev = {}; }
    return this;
  }
  listenerCount(ev) { return this._ev?.[ev]?.length ?? 0; }
  emit(ev, ...args) {
    const l = this._ev?.[ev];
    if (!l?.length) return false;
    for (const fn of [...l]) fn(...args);
    return true;
  }
}
export default EventEmitter;
