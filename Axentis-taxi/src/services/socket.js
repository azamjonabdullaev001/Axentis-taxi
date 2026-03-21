import { WS_BASE } from '../config';

class SocketService {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.reconnectTimer = null;
    this.isConnected = false;
  }

  connect(userID) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.userID = userID;
    this.ws = new WebSocket(`${WS_BASE}?user_id=${userID}`);

    this.ws.onopen = () => {
      this.isConnected = true;
      clearTimeout(this.reconnectTimer);
      console.log('WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const handler = this.listeners[data.type];
        if (handler) handler(data);
      } catch (e) {}
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.reconnectTimer = setTimeout(() => {
        if (this.userID) this.connect(this.userID);
      }, 3000);
    };

    this.ws.onerror = (error) => {
      console.log('WebSocket error:', error.message);
    };
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  on(type, handler) {
    this.listeners[type] = handler;
  }

  off(type) {
    delete this.listeners[type];
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    this.userID = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export default new SocketService();
