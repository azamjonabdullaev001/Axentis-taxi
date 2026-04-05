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
  DriverModel? _driver;
  bool _loading = true;
  String? _error;

  UserModel? get user => _user;
  DriverModel? get driver => _driver;
  bool get loading => _loading;
  String? get error => _error;
  bool get isLoggedIn => _user != null;

  AuthProvider(this._api, this._socket) {
    _initFromStorage();
  }

  Future<void> _initFromStorage() async {
    final token = await _storage.read(key: 'auth_token');
    final userId = await _storage.read(key: 'user_id');
    if (token != null && userId != null) {
      _api.setToken(token);
      try {
        final profile = await _api.getProfile();
        _user = profile['user'] as UserModel;
        if (profile['driver'] != null) {
          _driver = profile['driver'] as DriverModel;
        }
        _socket.connect(userId);
      } catch (_) {
        await _storage.deleteAll();
      }
    }
    _loading = false;
    notifyListeners();
  }

  Future<void> login(String phone, String password) async {
    _error = null;
    notifyListeners();
    try {
      final result = await _api.login(phone, password);
      final token = result['token'] as String;
      final userId = result['user_id'] as String;
      final role = result['role'] as String;
      if (role != 'driver') {
        _error = 'Этот аккаунт не является водительским';
        notifyListeners();
        return;
      }
      await _storage.write(key: 'auth_token', value: token);
      await _storage.write(key: 'user_id', value: userId);
      _api.setToken(token);
      final profile = await _api.getProfile();
      _user = profile['user'] as UserModel;
      if (profile['driver'] != null) {
        _driver = profile['driver'] as DriverModel;
      }
      _socket.connect(userId);
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<void> register(Map<String, dynamic> data) async {
    _error = null;
    notifyListeners();
    try {
      final result = await _api.registerDriver(data);
      final token = result['token'] as String;
      final userId = result['user_id'] as String;
      await _storage.write(key: 'auth_token', value: token);
      await _storage.write(key: 'user_id', value: userId);
      _api.setToken(token);
      final profile = await _api.getProfile();
      _user = profile['user'] as UserModel;
      if (profile['driver'] != null) {
        _driver = profile['driver'] as DriverModel;
      }
      _socket.connect(userId);
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<void> logout() async {
    _socket.disconnect();
    await _storage.deleteAll();
    _api.clearToken();
    _user = null;
    _driver = null;
    notifyListeners();
  }

  Future<void> refreshProfile() async {
    try {
      final profile = await _api.getProfile();
      _user = profile['user'] as UserModel;
      if (profile['driver'] != null) {
        _driver = profile['driver'] as DriverModel;
      }
      notifyListeners();
    } catch (_) {}
  }

  void updateUser(UserModel updated) {
    _user = updated;
    notifyListeners();
  }
}
