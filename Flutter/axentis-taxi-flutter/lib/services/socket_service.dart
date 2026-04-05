import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../config/config.dart';

typedef WsHandler = void Function(Map<String, dynamic> msg);

class SocketService {
  WebSocketChannel? _channel;
  String? _userId;
  Timer? _pingTimer;
  Timer? _reconnectTimer;
  bool _shouldReconnect = true;
  bool _connected = false;

  final Map<String, WsHandler> _listeners = {};
  VoidCallback? onReconnect;

  bool get isConnected => _connected;

  void connect(String userId) {
    _userId = userId;
    _shouldReconnect = true;
    _doConnect();
  }

  void _doConnect() {
    if (_userId == null) return;
    try {
      final uri = Uri.parse('${AppConfig.wsBase}?user_id=$_userId');
      _channel = WebSocketChannel.connect(uri);
      _connected = true;

      _channel!.stream.listen(
        (data) {
          if (data is String) {
            try {
              final msg = jsonDecode(data) as Map<String, dynamic>;
              final type = msg['type'] as String?;
              if (type == 'pong') return;
              if (type != null && _listeners.containsKey(type)) {
                _listeners[type]!(msg);
              }
            } catch (_) {}
          }
        },
        onDone: () {
          _connected = false;
          _pingTimer?.cancel();
          if (_shouldReconnect) {
            _reconnectTimer = Timer(const Duration(seconds: 3), () {
              _doConnect();
              onReconnect?.call();
            });
          }
        },
        onError: (_) {
          _connected = false;
          _pingTimer?.cancel();
          if (_shouldReconnect) {
            _reconnectTimer = Timer(const Duration(seconds: 3), _doConnect);
          }
        },
        cancelOnError: true,
      );

      _pingTimer?.cancel();
      _pingTimer = Timer.periodic(const Duration(seconds: 20), (_) {
        send({'type': 'ping'});
      });
    } catch (_) {
      _connected = false;
      if (_shouldReconnect) {
        _reconnectTimer = Timer(const Duration(seconds: 3), _doConnect);
      }
    }
  }

  void send(Map<String, dynamic> data) {
    if (_connected && _channel != null) {
      try {
        _channel!.sink.add(jsonEncode(data));
      } catch (_) {}
    }
  }

  void on(String type, WsHandler handler) => _listeners[type] = handler;
  void off(String type) => _listeners.remove(type);

  void disconnect() {
    _shouldReconnect = false;
    _pingTimer?.cancel();
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _channel = null;
    _connected = false;
    _listeners.clear();
  }
}
