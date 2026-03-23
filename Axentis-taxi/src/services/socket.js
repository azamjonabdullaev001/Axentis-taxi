import { WS_BASE } from '../config';

class SocketService {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.isConnected = false;
    this.onReconnect = null;
  }

  connect(userID) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.userID = userID;
    this.ws = new WebSocket(`${WS_BASE}?user_id=${userID}`);

    this.ws.onopen = () => {
      this.isConnected = true;
      clearTimeout(this.reconnectTimer);
      // Send a keepalive ping every 20s so the server never closes the connection
      // (server read-deadline is 60s; ping resets it on each message)
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        this.send({ type: 'ping' });
      }, 20000);
      if (this.onReconnect) this.onReconnect();
      console.log('WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') return; // ignore server pong replies
        const handler = this.listeners[data.type];
        if (handler) handler(data);
      } catch (e) {}
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      clearInterval(this.pingTimer);
      this.pingTimer = null;
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
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.userID = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export default new SocketService();
