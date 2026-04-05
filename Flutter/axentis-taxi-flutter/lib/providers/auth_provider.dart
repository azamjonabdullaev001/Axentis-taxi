import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../models/models.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';

class AuthProvider extends ChangeNotifier {
  final ApiService _api;
  final SocketService _socket;
  static const _storage = FlutterSecureStorage();

  UserModel? _user;
  bool _loading = true;

  UserModel? get user => _user;
  bool get loading => _loading;
  bool get isLoggedIn => _user != null;

  AuthProvider(this._api, this._socket) {
    _init();
  }

  Future<void> _init() async {
    final token = await _storage.read(key: 'auth_token');
    final userId = await _storage.read(key: 'user_id');
    if (token != null && userId != null) {
      _api.setToken(token);
      try {
        _user = await _api.getProfile();
        _socket.connect(userId);
      } catch (_) {
        await _storage.deleteAll();
      }
    }
    _loading = false;
    notifyListeners();
  }

  Future<void> login(String phone, String password) async {
    final result = await _api.login(phone, password);
    final token = result['token'] as String;
    final userId = result['user_id'] as String;
    final role = result['role'] as String;
    if (role != 'passenger') throw 'Этот аккаунт не является пассажирским';
    await _storage.write(key: 'auth_token', value: token);
    await _storage.write(key: 'user_id', value: userId);
    _api.setToken(token);
    _user = await _api.getProfile();
    _socket.connect(userId);
    notifyListeners();
  }

  Future<void> register(Map<String, dynamic> data) async {
    final result = await _api.registerPassenger(data);
    final token = result['token'] as String;
    final userId = result['user_id'] as String;
    await _storage.write(key: 'auth_token', value: token);
    await _storage.write(key: 'user_id', value: userId);
    _api.setToken(token);
    _user = await _api.getProfile();
    _socket.connect(userId);
    notifyListeners();
  }

  Future<void> logout() async {
    _socket.disconnect();
    await _storage.deleteAll();
    _api.clearToken();
    _user = null;
    notifyListeners();
  }

  Future<void> refreshProfile() async {
    try {
      _user = await _api.getProfile();
      notifyListeners();
    } catch (_) {}
  }

  void updateUser(UserModel updated) {
    _user = updated;
    notifyListeners();
  }
}
