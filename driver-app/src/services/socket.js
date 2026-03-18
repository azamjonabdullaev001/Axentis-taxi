import { WS_BASE } from '../config';

class SocketService {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.reconnectTimer = null;
    this.userID = null;
  }

  connect(userID) {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.userID = userID;
    this.ws = new WebSocket(`${WS_BASE}?user_id=${userID}`);
    this.ws.onopen = () => { clearTimeout(this.reconnectTimer); };
    this.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const h = this.listeners[data.type];
        if (h) h(data);
      } catch {}
    };
    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => {
        if (this.userID) this.connect(this.userID);
      }, 3000);
    };
  }

  on(type, handler) { this.listeners[type] = handler; }
  off(type) { delete this.listeners[type]; }
  disconnect() {
    clearTimeout(this.reconnectTimer);
    this.userID = null;
    this.ws?.close();
    this.ws = null;
  }
}
export default new SocketService();
