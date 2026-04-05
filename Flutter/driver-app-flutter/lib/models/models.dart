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
    this.darkMode = true,
    this.language = 'ru',
    this.shareLiveLocation = true,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) => UserModel(
        id: json['id'] as String,
        firstName: json['first_name'] as String? ?? '',
        lastName: json['last_name'] as String? ?? '',
        phone: json['phone'] as String? ?? '',
        role: json['role'] as String? ?? 'driver',
        avatarUrl: json['avatar_url'] as String?,
        darkMode: json['dark_mode'] as bool? ?? true,
        language: json['language'] as String? ?? 'ru',
        shareLiveLocation: json['share_live_location'] as bool? ?? true,
      );

  UserModel copyWith({
    String? firstName,
    String? lastName,
    String? avatarUrl,
    bool? darkMode,
    String? language,
  }) =>
      UserModel(
        id: id,
        firstName: firstName ?? this.firstName,
        lastName: lastName ?? this.lastName,
        phone: phone,
        role: role,
        avatarUrl: avatarUrl ?? this.avatarUrl,
        darkMode: darkMode ?? this.darkMode,
        language: language ?? this.language,
        shareLiveLocation: shareLiveLocation,
      );
}

class DriverModel {
  final String id;
  final String userId;
  final String carNumber;
  final bool isAvailable;
  final double averageRating;
  final int ratingCount;
  final String? referralCode;
  final String? referredBy;
  final String? referralBenefitType;
  final double balance;

  const DriverModel({
    required this.id,
    required this.userId,
    required this.carNumber,
    this.isAvailable = false,
    this.averageRating = 0,
    this.ratingCount = 0,
    this.referralCode,
    this.referredBy,
    this.referralBenefitType,
    this.balance = 0,
  });

  factory DriverModel.fromJson(Map<String, dynamic> json) => DriverModel(
        id: json['id'] as String? ?? '',
        userId: json['user_id'] as String? ?? '',
        carNumber: json['car_number'] as String? ?? '',
        isAvailable: json['is_available'] as bool? ?? false,
        averageRating:
            (json['average_rating'] as num?)?.toDouble() ?? 0.0,
        ratingCount: json['rating_count'] as int? ?? 0,
        referralCode: json['referral_code'] as String?,
        referredBy: json['referred_by'] as String?,
        referralBenefitType: json['referral_benefit_type'] as String?,
        balance: (json['balance'] as num?)?.toDouble() ?? 0.0,
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
  final String? passengerPhone;
  final String? additionalInfo;
  final PassengerInfo? passenger;

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
    this.passengerPhone,
    this.additionalInfo,
    this.passenger,
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
        passengerPhone: json['passenger_phone'] as String?,
        additionalInfo: json['additional_info'] as String?,
        passenger: json['passenger'] != null
            ? PassengerInfo.fromJson(json['passenger'] as Map<String, dynamic>)
            : null,
      );
}

class PassengerInfo {
  final String id;
  final String firstName;
  final String lastName;
  final String phone;
  final String? avatarUrl;

  const PassengerInfo({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.phone,
    this.avatarUrl,
  });

  factory PassengerInfo.fromJson(Map<String, dynamic> json) => PassengerInfo(
        id: json['id'] as String? ?? '',
        firstName: json['first_name'] as String? ?? '',
        lastName: json['last_name'] as String? ?? '',
        phone: json['phone'] as String? ?? '',
        avatarUrl: json['avatar_url'] as String?,
      );
}

class RatingModel {
  final String id;
  final int rating;
  final String? passengerName;
  final DateTime createdAt;

  const RatingModel({
    required this.id,
    required this.rating,
    this.passengerName,
    required this.createdAt,
  });

  factory RatingModel.fromJson(Map<String, dynamic> json) => RatingModel(
        id: json['id'] as String,
        rating: json['rating'] as int,
        passengerName: json['passenger_name'] as String?,
        createdAt: DateTime.tryParse(json['created_at'] as String? ?? '') ??
            DateTime.now(),
      );
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
