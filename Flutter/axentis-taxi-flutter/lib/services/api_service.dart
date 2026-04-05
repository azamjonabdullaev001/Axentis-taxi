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
        if (_token != null) options.headers['Authorization'] = 'Bearer $_token';
        handler.next(options);
      },
      onError: (error, handler) {
        if (error.response?.statusCode == 401) _token = null;
        handler.next(error);
      },
    ));
  }

  void setToken(String t) => _token = t;
  void clearToken() => _token = null;

  String _err(DioException e) {
    if (e.response?.data is Map) {
      return (e.response!.data as Map)['error'] as String? ?? e.message ?? 'Error';
    }
    if (e.type == DioExceptionType.connectionError || e.type == DioExceptionType.unknown) {
      return 'Нет подключения к серверу';
    }
    return e.message ?? 'Ошибка сети';
  }

  // ─── Auth ────────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> registerPassenger(Map<String, dynamic> data) async {
    try {
      final r = await _dio.post('/auth/register/passenger', data: data);
      return r.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _err(e);
    }
  }

  Future<Map<String, dynamic>> login(String phone, String password) async {
    try {
      final r = await _dio.post('/auth/login', data: {'phone': phone, 'password': password});
      return r.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _err(e);
    }
  }

  Future<UserModel> getProfile() async {
    try {
      final r = await _dio.get('/profile');
      return UserModel.fromJson((r.data as Map<String, dynamic>)['user'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw _err(e);
    }
  }

  Future<void> updateProfile(Map<String, dynamic> data) async {
    try {
      await _dio.put('/profile', data: data);
    } on DioException catch (e) {
      throw _err(e);
    }
  }

  Future<String> uploadAvatar(String filePath) async {
    try {
      final formData = FormData.fromMap({
        'avatar': await MultipartFile.fromFile(filePath, filename: 'avatar.jpg'),
      });
      final r = await _dio.post('/upload/avatar', data: formData);
      return (r.data as Map<String, dynamic>)['avatar_url'] as String;
    } on DioException catch (e) {
      throw _err(e);
    }
  }

  Future<void> savePushToken(String pushToken) async {
    try {
      await _dio.put('/push-token', data: {'push_token': pushToken});
    } on DioException catch (e) {
      throw _err(e);
    }
  }

  // ─── Pricing ─────────────────────────────────────────────────────────────

  Future<PricingSettings> getPricingSettings() async {
    try {
      final r = await _dio.get('/pricing/settings');
      return PricingSettings.fromJson(r.data as Map<String, dynamic>);
    } on DioException catch (_) {
      return const PricingSettings();
    }
  }

  // ─── Orders ──────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> createOrder(Map<String, dynamic> data) async {
    try {
      final r = await _dio.post('/orders', data: data);
      return r.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _err(e);
    }
  }

  Future<Map<String, dynamic>> getOrder(String id) async {
    try {
      final r = await _dio.get('/orders/$id');
      return r.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _err(e);
    }
  }

  Future<void> cancelOrder(String id) async {
    try {
      await _dio.post('/orders/$id/cancel');
    } on DioException catch (e) {
      throw _err(e);
    }
  }

  Future<void> rateDriver(String orderId, int rating) async {
    try {
      await _dio.post('/orders/$orderId/rate', data: {'rating': rating});
    } on DioException catch (e) {
      throw _err(e);
    }
  }

  Future<void> updateOrderDistance(String orderId, double drivenKm) async {
    try {
      await _dio.put('/orders/$orderId/distance', data: {'driven_km': drivenKm});
    } on DioException catch (_) {}
  }

  Future<List<HistoryOrder>> getOrderHistory() async {
    try {
      final r = await _dio.get('/orders/history');
      final list = (r.data as Map<String, dynamic>)['orders'] as List? ?? [];
      return list.map((e) => HistoryOrder.fromJson(e as Map<String, dynamic>)).toList();
    } on DioException catch (e) {
      throw _err(e);
    }
  }

  // ─── Drivers & Passenger Location ────────────────────────────────────────

  Future<List<AvailableDriver>> getAvailableDrivers() async {
    try {
      final r = await _dio.get('/drivers/locations');
      final list = (r.data as Map<String, dynamic>)['drivers'] as List? ?? [];
      return list.map((e) => AvailableDriver.fromJson(e as Map<String, dynamic>)).toList();
    } on DioException catch (_) {
      return [];
    }
  }

  Future<void> updatePassengerLocation(double lat, double lng, {double? heading}) async {
    try {
      await _dio.put('/passenger/location', data: {
        'lat': lat,
        'lng': lng,
        if (heading != null) 'heading': heading,
      });
    } on DioException catch (_) {}
  }

  Future<void> updatePassengerLocationSharing(bool share) async {
    try {
      await _dio.put('/passenger/location-sharing', data: {'share_live_location': share});
    } on DioException catch (e) {
      throw _err(e);
    }
  }

  String buildAvatarUrl(String? path) {
    if (path == null || path.isEmpty) return '';
    if (path.startsWith('http')) return path;
    return '${AppConfig.uploadsBase}$path';
  }
}
