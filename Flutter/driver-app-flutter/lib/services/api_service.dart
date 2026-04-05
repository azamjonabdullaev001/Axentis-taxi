import 'dart:io';
import 'package:dio/dio.dart';
import '../config/config.dart';
import '../models/models.dart';

class ApiService {
  late final Dio _dio;
  String? _token;

  ApiService() {
    _dio = Dio(BaseOptions(
      baseUrl: AppConfig.apiBase,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
    ));

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        if (_token != null) {
          options.headers['Authorization'] = 'Bearer $_token';
        }
        handler.next(options);
      },
      onError: (error, handler) {
        if (error.response?.statusCode == 401) {
          _token = null;
        }
        handler.next(error);
      },
    ));
  }

  void setToken(String token) => _token = token;
  void clearToken() => _token = null;

  String _errorMessage(DioException e) {
    if (e.response?.data is Map) {
      return (e.response!.data as Map)['error'] as String? ?? e.message ?? 'Error';
    }
    if (e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.unknown) {
      return 'Нет подключения к серверу';
    }
    return e.message ?? 'Ошибка сети';
  }

  // ─── Auth ────────────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> registerDriver(Map<String, dynamic> data) async {
    try {
      final resp = await _dio.post('/auth/register/driver', data: data);
      return resp.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _errorMessage(e);
    }
  }

  Future<Map<String, dynamic>> login(String phone, String password) async {
    try {
      final resp = await _dio.post('/auth/login', data: {'phone': phone, 'password': password});
      return resp.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _errorMessage(e);
    }
  }

  Future<Map<String, dynamic>> getProfile() async {
    try {
      final resp = await _dio.get('/profile');
      final data = resp.data as Map<String, dynamic>;
      final user = UserModel.fromJson(data['user'] as Map<String, dynamic>);
      DriverModel? driver;
      if (data['driver'] != null) {
        driver = DriverModel.fromJson(data['driver'] as Map<String, dynamic>);
      }
      return {'user': user, 'driver': driver};
    } on DioException catch (e) {
      throw _errorMessage(e);
    }
  }

  Future<void> updateProfile(Map<String, dynamic> data) async {
    try {
      await _dio.put('/profile', data: data);
    } on DioException catch (e) {
      throw _errorMessage(e);
    }
  }

  Future<String> uploadAvatar(String filePath) async {
    try {
      final formData = FormData.fromMap({
        'avatar': await MultipartFile.fromFile(filePath, filename: 'avatar.jpg'),
      });
      final resp = await _dio.post('/upload/avatar', data: formData);
      return (resp.data as Map<String, dynamic>)['avatar_url'] as String;
    } on DioException catch (e) {
      throw _errorMessage(e);
    }
  }

  Future<void> savePushToken(String pushToken) async {
    try {
      await _dio.put('/push-token', data: {'push_token': pushToken});
    } on DioException catch (e) {
      throw _errorMessage(e);
    }
  }

  // ─── Driver Actions ───────────────────────────────────────────────────────────

  Future<void> updateLocation(double lat, double lng, {double? heading}) async {
    try {
      await _dio.put('/driver/location', data: {
        'lat': lat,
        'lng': lng,
        if (heading != null) 'heading': heading,
      });
    } on DioException catch (_) {}
  }

  Future<void> updateAvailability(bool available) async {
    try {
      await _dio.put('/driver/availability', data: {'available': available});
    } on DioException catch (e) {
      throw _errorMessage(e);
    }
  }

  Future<Map<String, dynamic>> acceptOrder(String orderId) async {
    try {
      final resp = await _dio.post('/orders/$orderId/accept');
      return resp.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _errorMessage(e);
    }
  }

  Future<void> declineOrder(String orderId) async {
    try {
      await _dio.post('/orders/$orderId/decline');
    } on DioException catch (_) {}
  }

  Future<void> arrivedAtPickup(String orderId) async {
    try {
      await _dio.post('/orders/$orderId/arrived');
    } on DioException catch (e) {
      throw _errorMessage(e);
    }
  }

  Future<void> startTrip(String orderId) async {
    try {
      await _dio.post('/orders/$orderId/start');
    } on DioException catch (e) {
      throw _errorMessage(e);
    }
  }

  Future<Map<String, dynamic>> completeTrip(String orderId) async {
    try {
      final resp = await _dio.post('/orders/$orderId/complete');
      return resp.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _errorMessage(e);
    }
  }

  Future<void> updateOrderDistance(String orderId, double drivenKm) async {
    try {
      await _dio.put('/orders/$orderId/distance', data: {'driven_km': drivenKm});
    } on DioException catch (_) {}
  }

  Future<List<HistoryOrder>> getOrderHistory() async {
    try {
      final resp = await _dio.get('/orders/history');
      final list = (resp.data as Map<String, dynamic>)['orders'] as List? ?? [];
      return list.map((e) => HistoryOrder.fromJson(e as Map<String, dynamic>)).toList();
    } on DioException catch (e) {
      throw _errorMessage(e);
    }
  }

  Future<Map<String, dynamic>> getDriverRatings() async {
    try {
      final resp = await _dio.get('/driver/ratings');
      return resp.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _errorMessage(e);
    }
  }

  Future<Map<String, dynamic>> applyReferral(
      String referralCode, String benefitType) async {
    try {
      final resp = await _dio.post('/referral/apply',
          data: {'referral_code': referralCode, 'benefit_type': benefitType});
      return resp.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _errorMessage(e);
    }
  }

  String buildAvatarUrl(String? path) {
    if (path == null || path.isEmpty) return '';
    if (path.startsWith('http')) return path;
    return '${AppConfig.uploadsBase}$path';
  }
}
