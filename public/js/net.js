/** WebSocket client with auto-reconnect. Server messages are re-emitted as events named by `t`. */
export class Net extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.retry = 0;
    this.stopped = false;
  }

  connect(join) {
    this.join = join;
    this.open();
  }

  open() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ t: 'join', ...this.join }));
      this.emit('status', 'online');
    };
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg && typeof msg.t === 'string') this.emit(msg.t, msg);
    };
    ws.onclose = (event) => {
      this.emit('status', 'offline');
      // 4001 = bad credentials, 4002 = joined elsewhere: don't fight over the session.
      if (this.stopped || event.code === 4001 || event.code === 4002) return;
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.open(), delay);
    };
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.stopped = true;
    this.ws?.close();
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  on(type, fn) {
    this.addEventListener(type, (event) => fn(event.detail));
  }
}
