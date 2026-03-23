import { WS_BASE } from '../config';

class SocketService {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.userID = null;
  }

  connect(userID) {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.userID = userID;
    this.ws = new WebSocket(`${WS_BASE}?user_id=${userID}`);
    this.ws.onopen = () => {
      clearTimeout(this.reconnectTimer);
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 20000);
    };
    this.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'pong') return;
        const h = this.listeners[data.type];
        if (h) h(data);
      } catch {}
    };
    this.ws.onclose = () => {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.reconnectTimer = setTimeout(() => {
        if (this.userID) this.connect(this.userID);
      }, 3000);
    };
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  on(type, handler) { this.listeners[type] = handler; }
  off(type) { delete this.listeners[type]; }
  disconnect() {
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.userID = null;
    this.ws?.close();
    this.ws = null;
  }
}
export default new SocketService();
