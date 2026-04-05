class UserModel {
  final String id;
  final String firstName;
  final String lastName;
  final String phone;
  final String role;
  final String? avatarUrl;
  final bool darkMode;
  final String language;
  final bool shareLiveLocation;

  const UserModel({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.phone,
    required this.role,
    this.avatarUrl,
    this.darkMode = false,
    this.language = 'ru',
    this.shareLiveLocation = true,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) => UserModel(
        id: json['id'] as String,
        firstName: json['first_name'] as String? ?? '',
        lastName: json['last_name'] as String? ?? '',
        phone: json['phone'] as String? ?? '',
        role: json['role'] as String? ?? 'passenger',
        avatarUrl: json['avatar_url'] as String?,
        darkMode: json['dark_mode'] as bool? ?? false,
        language: json['language'] as String? ?? 'ru',
        shareLiveLocation: json['share_live_location'] as bool? ?? true,
      );

  UserModel copyWith({String? firstName, String? lastName, String? avatarUrl, bool? darkMode, String? language, bool? shareLiveLocation}) =>
      UserModel(
        id: id,
        firstName: firstName ?? this.firstName,
        lastName: lastName ?? this.lastName,
        phone: phone,
        role: role,
        avatarUrl: avatarUrl ?? this.avatarUrl,
        darkMode: darkMode ?? this.darkMode,
        language: language ?? this.language,
        shareLiveLocation: shareLiveLocation ?? this.shareLiveLocation,
      );
}

class OrderModel {
  final String id;
  final String status;
  final double pickupLat;
  final double pickupLng;
  final String pickupAddress;
  final double? destLat;
  final double? destLng;
  final String? destAddress;
  final double? distanceKm;
  final double? totalPrice;
  final double? lockedPricePerKm;
  final double surgeMultiplier;
  final String tripType;

  const OrderModel({
    required this.id,
    required this.status,
    required this.pickupLat,
    required this.pickupLng,
    required this.pickupAddress,
    this.destLat,
    this.destLng,
    this.destAddress,
    this.distanceKm,
    this.totalPrice,
    this.lockedPricePerKm,
    this.surgeMultiplier = 1.0,
    this.tripType = 'standard',
  });

  factory OrderModel.fromJson(Map<String, dynamic> json) => OrderModel(
        id: json['id'] as String,
        status: json['status'] as String? ?? 'searching',
        pickupLat: (json['pickup_lat'] as num).toDouble(),
        pickupLng: (json['pickup_lng'] as num).toDouble(),
        pickupAddress: json['pickup_address'] as String? ?? '',
        destLat: (json['destination_lat'] as num?)?.toDouble(),
        destLng: (json['destination_lng'] as num?)?.toDouble(),
        destAddress: json['destination_address'] as String?,
        distanceKm: (json['distance_km'] as num?)?.toDouble(),
        totalPrice: (json['total_price'] as num?)?.toDouble(),
        lockedPricePerKm: (json['locked_price_per_km'] as num?)?.toDouble(),
        surgeMultiplier: (json['surge_multiplier'] as num?)?.toDouble() ?? 1.0,
        tripType: json['trip_type'] as String? ?? 'standard',
      );
}

class DriverInfo {
  final String id;
  final String firstName;
  final String lastName;
  final String phone;
  final String? carNumber;
  final double averageRating;
  final String? avatarUrl;
  final double? lat;
  final double? lng;
  final double? heading;

  const DriverInfo({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.phone,
    this.carNumber,
    this.averageRating = 0,
    this.avatarUrl,
    this.lat,
    this.lng,
    this.heading,
  });

  factory DriverInfo.fromJson(Map<String, dynamic> json) => DriverInfo(
        id: json['id'] as String? ?? '',
        firstName: json['first_name'] as String? ?? '',
        lastName: json['last_name'] as String? ?? '',
        phone: json['phone'] as String? ?? '',
        carNumber: json['car_number'] as String?,
        averageRating: (json['average_rating'] as num?)?.toDouble() ?? 0,
        avatarUrl: json['avatar_url'] as String?,
        lat: (json['current_lat'] as num?)?.toDouble(),
        lng: (json['current_lng'] as num?)?.toDouble(),
        heading: (json['current_heading'] as num?)?.toDouble(),
      );
}

class PricingSettings {
  final double pricePerKm;
  final double pricePerMinuteWait;
  final int freeWaitMinutes;
  final double serviceFee;
  final double surgeMultiplier;
  final double royalPricePerKm;

  const PricingSettings({
    this.pricePerKm = 2000,
    this.pricePerMinuteWait = 500,
    this.freeWaitMinutes = 2,
    this.serviceFee = 2000,
    this.surgeMultiplier = 1.0,
    this.royalPricePerKm = 3000,
  });

  factory PricingSettings.fromJson(Map<String, dynamic> json) => PricingSettings(
        pricePerKm: (json['price_per_km'] as num?)?.toDouble() ?? 2000,
        pricePerMinuteWait: (json['price_per_minute_wait'] as num?)?.toDouble() ?? 500,
        freeWaitMinutes: json['free_wait_minutes'] as int? ?? 2,
        serviceFee: (json['service_fee'] as num?)?.toDouble() ?? 2000,
        surgeMultiplier: (json['surge_multiplier'] as num?)?.toDouble() ?? 1.0,
        royalPricePerKm: (json['royal_price_per_km'] as num?)?.toDouble() ?? 3000,
      );

  double calcPrice(double distanceKm) {
    final distanceM = distanceKm * 1000;
    final roundedKm = (distanceM / 100).ceil() * 100 / 1000;
    final distCost = roundedKm * pricePerKm;
    final total = (serviceFee + distCost * surgeMultiplier) / 200;
    return total.ceil() * 200;
  }
}

class HistoryOrder {
  final String id;
  final String status;
  final String pickupAddress;
  final String? destAddress;
  final double? distanceKm;
  final double? totalPrice;
  final DateTime createdAt;

  const HistoryOrder({
    required this.id,
    required this.status,
    required this.pickupAddress,
    this.destAddress,
    this.distanceKm,
    this.totalPrice,
    required this.createdAt,
  });

  factory HistoryOrder.fromJson(Map<String, dynamic> json) => HistoryOrder(
        id: json['id'] as String,
        status: json['status'] as String? ?? '',
        pickupAddress: json['pickup_address'] as String? ?? '',
        destAddress: json['destination_address'] as String?,
        distanceKm: (json['distance_km'] as num?)?.toDouble(),
        totalPrice: (json['total_price'] as num?)?.toDouble(),
        createdAt:
            DateTime.tryParse(json['created_at'] as String? ?? '') ?? DateTime.now(),
      );
}

class AvailableDriver {
  final String id;
  final String userId;
  final double lat;
  final double lng;
  final String firstName;
  final double averageRating;

  const AvailableDriver({
    required this.id,
    required this.userId,
    required this.lat,
    required this.lng,
    required this.firstName,
    required this.averageRating,
  });

  factory AvailableDriver.fromJson(Map<String, dynamic> json) => AvailableDriver(
        id: json['id'] as String? ?? '',
        userId: json['user_id'] as String? ?? '',
        lat: (json['current_lat'] as num?)?.toDouble() ?? 0,
        lng: (json['current_lng'] as num?)?.toDouble() ?? 0,
        firstName: json['first_name'] as String? ?? '',
        averageRating: (json['average_rating'] as num?)?.toDouble() ?? 0,
      );
}
