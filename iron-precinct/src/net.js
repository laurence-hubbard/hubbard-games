// Browser side of the two-player connection (see server.py for the protocol).

export const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

export class Net {
  constructor() {
    this.handlers = {};
    this.slot = 0;
    this.ws = null;
  }

  /** Resolves once the socket is open; rejects if it can't connect. */
  connect(url = wsUrl()) {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(url));
      let opened = false;
      ws.onopen = () => { opened = true; resolve(); };
      ws.onerror = () => { if (!opened) reject(new Error('Could not reach the game server')); };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.t === 'welcome') this.slot = msg.slot;
        this.emit(msg.t, msg);
      };
      ws.onclose = () => this.emit('close', {});
    });
  }

  on(t, fn) { (this.handlers[t] ||= []).push(fn); }
  emit(t, msg) { for (const fn of this.handlers[t] || []) fn(msg); }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() { this.ws?.close(); }
}
