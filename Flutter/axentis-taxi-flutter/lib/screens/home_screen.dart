import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_compass/flutter_compass.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import '../l10n/translations.dart';
import '../models/models.dart';
import '../providers/auth_provider.dart';
import '../providers/theme_provider.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';

enum OrderStatus { idle, searching, queued, accepted, arrived, inProgress, completed }
enum MapMode { none, pickup, destination }

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with TickerProviderStateMixin {
  // ─── Map & Location ──────────────────────────────────────────────────────
  final MapController _mapController = MapController();
  bool _mapReady = false;
  MapMode _mapMode = MapMode.pickup;
  LatLng _mapCenter = const LatLng(41.2995, 69.2401);
  bool _mapMoving = false;

  // User location
  double _userLat = 41.2995;
  double _userLng = 69.2401;

  // ─── Pickup & Destination ────────────────────────────────────────────────
  LatLng? _pickupCoords;
  String _pickupText = '';
  LatLng? _destCoords;
  String _destText = '';

  // ─── Order ──────────────────────────────────────────────────────────────
  OrderStatus _orderStatus = OrderStatus.idle;
  String? _orderId;
  double _estimatedPrice = 0;
  double _lockedPricePerKm = 0;
  bool _isFreeMode = false;
  double _freeRideKm = 0;
  LatLng? _lastFreePoint;

  // ─── Driver tracking ────────────────────────────────────────────────────────
  // "ref" values (no setState)
  double _driverLatRef = 0;
  double _driverLngRef = 0;
  double _driverHeadingRef = 0;
  double _driverSmoothHeading = 0;
  LatLng? _driverDisplayPos;
  DriverInfo? _driverInfo;

  // ─── Queued-order: driver finishing previous trip ─────────────────────────
  // When the driver accepted our order but still has a previous trip running,
  // we track their destination (prev_dest) and draw a consuming polyline.
  bool _isDriverQueued = false;
  LatLng? _prevDestCoords;       // destination of driver's current (prev) trip
  String _prevDestAddress = '';
  List<LatLng> _consumedRoutePoints = []; // trimmed route shown during queued state

  // ─── Route ──────────────────────────────────────────────────────────────
  List<LatLng> _routePoints = [];
  List<LatLng> _previewRoute = [];

  // ─── Pricing ────────────────────────────────────────────────────────────
  PricingSettings _pricing = const PricingSettings();

  // ─── Available drivers ───────────────────────────────────────────────────
  List<AvailableDriver> _availableDrivers = [];

  // ─── Recent trips ────────────────────────────────────────────────────────
  List<HistoryOrder> _recentTrips = [];
  bool _recentTripsExpanded = false;

  // ─── Location sharing ────────────────────────────────────────────────────
  bool _shareLiveLocation = true;

  // ─── Completion & Rating ─────────────────────────────────────────────────
  double? _finalPrice;
  int _selectedRating = 0;
  bool _showRatingModal = false;
  bool _showCompletion = false;
  bool _showDriverCard = true;

  // ─── Geocoding ──────────────────────────────────────────────────────────
  Timer? _geocodeDebounce;

  // ─── Timers & subscriptions ──────────────────────────────────────────────
  StreamSubscription<Position>? _locationSub;
  StreamSubscription<CompassEvent>? _compassSub;
  Timer? _driversPollTimer;
  Timer? _locationShareTimer;
  Timer? _distanceUpdateTimer;
  late AnimationController _displayTicker;
  late AnimationController _pinBounce;

  // ─── Reverse geocoding state ──────────────────────────────────────────────
  bool _geocoding = false;

  @override
  void initState() {
    super.initState();
    _displayTicker = AnimationController(vsync: this, duration: const Duration(milliseconds: 16))
      ..addListener(_onDisplayTick)
      ..repeat();
    _pinBounce = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
      lowerBound: 0.0,
      upperBound: 1.0,
    )..repeat(reverse: true);

    _loadPricing();
    _initLocation();
    _loadRecentTrips();
    _startDriversPolling();
    WidgetsBinding.instance.addPostFrameCallback((_) => _initSocket());
  }

  @override
  void dispose() {
    _displayTicker.dispose();
    _pinBounce.dispose();
    _locationSub?.cancel();
    _compassSub?.cancel();
    _driversPollTimer?.cancel();
    _locationShareTimer?.cancel();
    _distanceUpdateTimer?.cancel();
    _geocodeDebounce?.cancel();
    final socket = context.read<SocketService>();
    socket.off('order_accepted');
    socket.off('order_activated');
    socket.off('driver_arrived');
    socket.off('trip_started');
    socket.off('no_drivers');
    socket.off('order_cancelled');
    socket.off('trip_completed');
    socket.off('driver_location');
    super.dispose();
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  Future<void> _loadPricing() async {
    final api = context.read<ApiService>();
    final p = await api.getPricingSettings();
    if (mounted) setState(() => _pricing = p);
  }

  void _initSocket() {
    final socket = context.read<SocketService>();
    socket.onReconnect = _onSocketReconnect;
    socket.on('order_accepted', _onOrderAccepted);
    socket.on('order_activated', _onOrderActivated);
    socket.on('driver_arrived', _onDriverArrived);
    socket.on('trip_started', _onTripStarted);
    socket.on('no_drivers', _onNoDrivers);
    socket.on('order_cancelled', _onOrderCancelled);
    socket.on('trip_completed', _onTripCompleted);
    socket.on('driver_location', _onDriverLocation);
  }

  Future<void> _initLocation() async {
    LocationPermission perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    if (perm == LocationPermission.deniedForever) return;

    final pos = await Geolocator.getCurrentPosition();
    _userLat = pos.latitude;
    _userLng = pos.longitude;

    if (mounted && _mapReady) {
      _mapController.move(LatLng(_userLat, _userLng), 15);
    } else if (mounted) {
      setState(() => _mapCenter = LatLng(_userLat, _userLng));
    }

    _compassSub = FlutterCompass.events?.listen((e) {
      // not needed for passenger except during in_progress
    });

    _locationSub = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.balanced, distanceFilter: 10),
    ).listen(_onPositionUpdate);
  }

  void _onPositionUpdate(Position pos) {
    _userLat = pos.latitude;
    _userLng = pos.longitude;
    // Update pickup if in pickup mode and user hasn't moved map manually
    if (_mapMode == MapMode.pickup && !_mapMoving && _orderStatus == OrderStatus.idle) {
      if (mounted) {
        setState(() {
          _mapCenter = LatLng(_userLat, _userLng);
          _pickupCoords = LatLng(_userLat, _userLng);
        });
        if (_mapReady) {
          _mapController.move(_mapCenter, _mapController.camera.zoom);
        }
      }
    }
    // Free ride distance metering
    if (_orderStatus == OrderStatus.inProgress && _isFreeMode) {
      final current = LatLng(_userLat, _userLng);
      if (_lastFreePoint != null) {
        final delta = _haversine(_lastFreePoint!, current);
        if (delta > 5) {
          _freeRideKm += delta / 1000;
          _lastFreePoint = current;
        }
      } else {
        _lastFreePoint = current;
      }
    }
  }

  // ─── Display timer ────────────────────────────────────────────────────────

  void _onDisplayTick() {
    if (!mounted) return;
    if (_driverDisplayPos != null) {
      // Smooth heading interpolation (alpha=0.18)
      final diff = _normalizeAngle(_driverHeadingRef - _driverSmoothHeading);
      _driverSmoothHeading += 0.18 * diff;
      // Smooth position interpolation (lerp alpha=0.18)
      final targetPos = LatLng(_driverLatRef, _driverLngRef);
      final newLat = _driverDisplayPos!.latitude + 0.18 * (targetPos.latitude - _driverDisplayPos!.latitude);
      final newLng = _driverDisplayPos!.longitude + 0.18 * (targetPos.longitude - _driverDisplayPos!.longitude);
      setState(() {
        _driverDisplayPos = LatLng(newLat, newLng);
      });

      // Update consuming polyline for queued state
      if (_isDriverQueued && _routePoints.length >= 2) {
        _consumedRoutePoints = _trimRouteFromDriver(_driverDisplayPos!, _routePoints);
      }
    }
  }

  /// Returns the segment of [route] from the closest point to [driver] forward.
  /// This creates the "consumed" polyline effect as the driver moves.
  List<LatLng> _trimRouteFromDriver(LatLng driver, List<LatLng> route) {
    if (route.isEmpty) return [];
    double minDist = double.infinity;
    int closestIdx = 0;
    for (int i = 0; i < route.length; i++) {
      final d = _haversine(driver, route[i]);
      if (d < minDist) {
        minDist = d;
        closestIdx = i;
      }
    }
    final remaining = route.sublist(closestIdx);
    if (remaining.isEmpty) return [driver];
    return [driver, ...remaining];
  }

  double _normalizeAngle(double a) {
    while (a > 180) a -= 360;
    while (a < -180) a += 360;
    return a;
  }

  double _haversine(LatLng a, LatLng b) {
    const R = 6371000.0;
    final dLat = (b.latitude - a.latitude) * math.pi / 180;
    final dLng = (b.longitude - a.longitude) * math.pi / 180;
    final x = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(a.latitude * math.pi / 180) * math.cos(b.latitude * math.pi / 180) *
            math.sin(dLng / 2) * math.sin(dLng / 2);
    return 2 * R * math.asin(math.sqrt(x));
  }

  // ─── Drivers polling ─────────────────────────────────────────────────────

  void _startDriversPolling() {
    _driversPollTimer = Timer.periodic(const Duration(seconds: 5), (_) async {
      if (_orderStatus == OrderStatus.idle) {
        final api = context.read<ApiService>();
        final drivers = await api.getAvailableDrivers();
        if (mounted) setState(() => _availableDrivers = drivers);
      }
    });
  }

  // ─── WebSocket handlers ───────────────────────────────────────────────────

  void _onOrderAccepted(Map<String, dynamic> msg) {
    if (!mounted) return;
    final data = msg['data'] as Map<String, dynamic>? ?? msg;
    final driver = data['driver'] as Map<String, dynamic>?;
    final isQueued = data['queued'] == true;

    if (isQueued) {
      // Driver accepted our order but is still finishing a previous trip.
      // Show driver position and a route to the previous order's destination.
      final prevLat = (data['prev_dest_lat'] as num?)?.toDouble();
      final prevLng = (data['prev_dest_lng'] as num?)?.toDouble();
      final prevAddr = data['prev_dest_address'] as String? ?? '';

      setState(() {
        _orderStatus = OrderStatus.queued;
        _isDriverQueued = true;
        _driverInfo = driver != null ? DriverInfo.fromJson(driver) : null;
        _prevDestAddress = prevAddr;
        if (prevLat != null && prevLng != null) {
          _prevDestCoords = LatLng(prevLat, prevLng);
        }
        _showDriverCard = true;
        _consumedRoutePoints = [];
      });

      // Draw route from driver's current position to their previous order's destination
      if (_driverDisplayPos != null && _prevDestCoords != null) {
        _fetchRoute(_driverDisplayPos!, _prevDestCoords!).then((_) {
          setState(() => _consumedRoutePoints = List.from(_routePoints));
        });
      } else if (_prevDestCoords != null) {
        // If we don't yet have driver position, fetch straight line as fallback
        final approxDriverPos = LatLng(_driverLatRef != 0 ? _driverLatRef : _userLat,
            _driverLngRef != 0 ? _driverLngRef : _userLng);
        _fetchRoute(approxDriverPos, _prevDestCoords!).then((_) {
          setState(() => _consumedRoutePoints = List.from(_routePoints));
        });
      }
    } else {
      // Normal: driver accepted and is coming directly
      setState(() {
        _orderStatus = OrderStatus.accepted;
        _isDriverQueued = false;
        _driverInfo = driver != null ? DriverInfo.fromJson(driver) : null;
        if (_driverInfo?.lat != null && _driverInfo?.lng != null) {
          _driverLatRef = _driverInfo!.lat!;
          _driverLngRef = _driverInfo!.lng!;
          _driverDisplayPos = LatLng(_driverLatRef, _driverLngRef);
        }
        _showDriverCard = true;
      });
      if (_pickupCoords != null && _driverDisplayPos != null) {
        _fetchRoute(_driverDisplayPos!, _pickupCoords!);
      }
    }
  }

  // Called when driver finishes their previous trip — our queued order becomes active
  void _onOrderActivated(Map<String, dynamic> msg) {
    if (!mounted) return;
    setState(() {
      _orderStatus = OrderStatus.accepted;
      _isDriverQueued = false;
      _prevDestCoords = null;
      _consumedRoutePoints = [];
      _routePoints = [];
    });
    // Fetch fresh route from driver (now free) to our pickup
    if (_pickupCoords != null && _driverDisplayPos != null) {
      _fetchRoute(_driverDisplayPos!, _pickupCoords!);
    }
  }

  void _onDriverArrived(Map<String, dynamic> msg) {
    if (!mounted) return;
    setState(() => _orderStatus = OrderStatus.arrived);
    // Orange route
    if (_pickupCoords != null && _driverDisplayPos != null) {
      _fetchRoute(_driverDisplayPos!, _pickupCoords!);
    }
  }

  void _onTripStarted(Map<String, dynamic> msg) {
    if (!mounted) return;
    setState(() {
      _orderStatus = OrderStatus.inProgress;
      _freeRideKm = 0;
      _lastFreePoint = LatLng(_userLat, _userLng);
    });
    if (_isFreeMode) {
      _startFreeRideDistanceTimer();
    }
    if (_destCoords != null && _driverDisplayPos != null) {
      _fetchRoute(_driverDisplayPos!, _destCoords!);
    }
  }

  void _onNoDrivers(Map<String, dynamic> msg) {
    if (!mounted) return;
    setState(() => _orderStatus = OrderStatus.idle);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.read<Translations?>()?.t('noDriversFound') ?? 'Водители не найдены')),
    );
  }

  void _onOrderCancelled(Map<String, dynamic> msg) {
    if (!mounted) return;
    _resetToIdle();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.read<Translations?>()?.t('orderCancelled') ?? 'Заказ отменён')),
    );
  }

  void _onTripCompleted(Map<String, dynamic> msg) {
    if (!mounted) return;
    final price = (msg['total_price'] as num?)?.toDouble();
    _distanceUpdateTimer?.cancel();
    setState(() {
      _orderStatus = OrderStatus.completed;
      _finalPrice = price;
      _showCompletion = true;
      _routePoints = [];
    });
  }

  void _onDriverLocation(Map<String, dynamic> msg) {
    final lat = (msg['lat'] as num?)?.toDouble();
    final lng = (msg['lng'] as num?)?.toDouble();
    final heading = (msg['heading'] as num?)?.toDouble();
    if (lat == null || lng == null) return;
    _driverLatRef = lat;
    _driverLngRef = lng;
    if (heading != null) _driverHeadingRef = heading;
    // Initialize display position if missing
    if (_driverDisplayPos == null) {
      setState(() => _driverDisplayPos = LatLng(lat, lng));
      // If queued and route not yet fetched, fetch now
      if (_isDriverQueued && _routePoints.isEmpty && _prevDestCoords != null) {
        _fetchRoute(LatLng(lat, lng), _prevDestCoords!).then((_) {
          setState(() => _consumedRoutePoints = List.from(_routePoints));
        });
      }
    }
  }

  void _onSocketReconnect() async {
    if (_orderStatus != OrderStatus.searching && _orderId != null) {
      // Reconnect: check order status
      try {
        final api = context.read<ApiService>();
        final order = await api.getOrder(_orderId!);
        final status = (order['order'] as Map<String, dynamic>?)?['status'] as String? ?? '';
        if (mounted) {
          if (status == 'accepted') {
            final driver = (order['order'] as Map<String, dynamic>?)?['driver'];
            setState(() {
              _orderStatus = OrderStatus.accepted;
              _isDriverQueued = false;
              _driverInfo = driver != null ? DriverInfo.fromJson(driver as Map<String, dynamic>) : null;
            });
          } else if (status == 'queued') {
            setState(() => _orderStatus = OrderStatus.queued);
          }
        }
      } catch (_) {}
    }
  }

  // ─── Map interaction ──────────────────────────────────────────────────────

  void _onMapPositionChanged(MapCamera camera, bool hasGesture) {
    if (!hasGesture && !_mapMoving) return;
    setState(() {
      _mapCenter = camera.center;
      _mapMoving = true;
    });
    // Debounce geocoding
    _geocodeDebounce?.cancel();
    _geocodeDebounce = Timer(const Duration(milliseconds: 800), () {
      _reverseGeocode(camera.center);
      setState(() => _mapMoving = false);
    });
    // Update preview route
    if (_mapMode == MapMode.destination && _pickupCoords != null) {
      _fetchPreviewRouteDebounced(camera.center);
    }
  }

  Timer? _previewDebounce;
  void _fetchPreviewRouteDebounced(LatLng dest) {
    _previewDebounce?.cancel();
    _previewDebounce = Timer(const Duration(milliseconds: 500), () {
      if (_pickupCoords != null) {
        _fetchRoute(_pickupCoords!, dest, preview: true);
      }
    });
  }

  Future<void> _reverseGeocode(LatLng pos) async {
    setState(() => _geocoding = true);
    try {
      final url = Uri.parse(
        'https://nominatim.openstreetmap.org/reverse?format=json'
        '&lat=${pos.latitude}&lon=${pos.longitude}&accept-language=ru',
      );
      final resp = await http.get(url, headers: {'User-Agent': 'AxentisTaxiApp/1.0'})
          .timeout(const Duration(seconds: 6));
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body) as Map<String, dynamic>;
        final address = data['address'] as Map<String, dynamic>?;
        String result = '';
        if (address != null) {
          final road = address['road'] as String? ?? address['pedestrian'] as String? ?? '';
          final houseNum = address['house_number'] as String? ?? '';
          final city = address['city'] as String? ?? address['town'] as String? ?? address['village'] as String? ?? '';
          if (road.isNotEmpty) {
            result = houseNum.isNotEmpty ? '$road, $houseNum, $city' : '$road, $city';
          } else {
            result = city;
          }
        }
        if (result.isEmpty) result = '${pos.latitude.toStringAsFixed(4)}, ${pos.longitude.toStringAsFixed(4)}';
        if (mounted) {
          setState(() {
            if (_mapMode == MapMode.pickup) {
              _pickupText = result;
              _pickupCoords = pos;
            } else if (_mapMode == MapMode.destination) {
              _destText = result;
              _destCoords = pos;
            }
          });
        }
      }
    } catch (_) {
      if (mounted) {
        final label = '${pos.latitude.toStringAsFixed(4)}, ${pos.longitude.toStringAsFixed(4)}';
        setState(() {
          if (_mapMode == MapMode.pickup) {
            _pickupText = label;
            _pickupCoords = pos;
          } else {
            _destText = label;
            _destCoords = pos;
          }
        });
      }
    } finally {
      if (mounted) setState(() => _geocoding = false);
    }
  }

  void _confirmPickup() {
    if (_pickupCoords == null) return;
    setState(() => _mapMode = MapMode.destination);
  }

  void _confirmDestination() {
    if (_destCoords == null) return;
    setState(() => _mapMode = MapMode.none);
    _updateEstimatedPrice();
  }

  void _updateEstimatedPrice() {
    if (_pickupCoords == null || _destCoords == null) return;
    final distM = _haversine(_pickupCoords!, _destCoords!);
    final distKm = distM / 1000;
    final price = _pricing.calcPrice(distKm);
    setState(() => _estimatedPrice = price);
  }

  // ─── OSRM Routing ─────────────────────────────────────────────────────────

  Future<void> _fetchRoute(LatLng from, LatLng to, {bool preview = false}) async {
    try {
      final url = Uri.parse(
        'http://router.project-osrm.org/route/v1/driving/'
        '${from.longitude},${from.latitude};${to.longitude},${to.latitude}'
        '?overview=full&geometries=geojson',
      );
      final resp = await http.get(url).timeout(const Duration(seconds: 6));
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body) as Map<String, dynamic>;
        final routes = data['routes'] as List?;
        if (routes != null && routes.isNotEmpty) {
          final coords = (routes[0]['geometry']['coordinates'] as List)
              .map((c) => LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble()))
              .toList();
          if (mounted) {
            setState(() {
              if (preview) {
                _previewRoute = coords;
              } else {
                _routePoints = coords;
              }
            });
            return;
          }
        }
      }
    } catch (_) {}
    if (mounted) {
      setState(() {
        if (preview) {
          _previewRoute = [from, to];
        } else {
          _routePoints = [from, to];
        }
      });
    }
  }

  Color get _routeColor {
    switch (_orderStatus) {
      case OrderStatus.accepted:
        return const Color(0xFF2196F3);
      case OrderStatus.arrived:
        return const Color(0xFFF97316);
      case OrderStatus.inProgress:
        return const Color(0xFF22C55E);
      default:
        return Colors.grey;
    }
  }

  // ─── Order creation ───────────────────────────────────────────────────────

  Future<void> _createOrder() async {
    if (_pickupCoords == null) return;
    if (!_isFreeMode && _destCoords == null) return;

    final api = context.read<ApiService>();
    final distKm = _destCoords != null
        ? _haversine(_pickupCoords!, _destCoords!) / 1000
        : 0.0;

    setState(() => _orderStatus = OrderStatus.searching);

    try {
      final body = <String, dynamic>{
        'pickup_lat': _pickupCoords!.latitude,
        'pickup_lng': _pickupCoords!.longitude,
        'pickup_address': _pickupText,
        'trip_type': _isFreeMode ? 'free' : 'standard',
        'distance_km': distKm,
        if (!_isFreeMode && _destCoords != null) ...{
          'destination_lat': _destCoords!.latitude,
          'destination_lng': _destCoords!.longitude,
          'destination_address': _destText,
        },
      };
      final result = await api.createOrder(body);
      if (mounted) {
        setState(() {
          _orderId = result['order_id'] as String?;
          _lockedPricePerKm = (result['locked_price_per_km'] as num?)?.toDouble() ?? 0;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _orderStatus = OrderStatus.idle);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _cancelOrder() async {
    if (_orderId == null) return;
    final api = context.read<ApiService>();
    try {
      await api.cancelOrder(_orderId!);
    } catch (_) {}
    _resetToIdle();
  }

  void _resetToIdle() {
    _distanceUpdateTimer?.cancel();
    _locationShareTimer?.cancel();
    setState(() {
      _orderStatus = OrderStatus.idle;
      _mapMode = MapMode.pickup;
      _orderId = null;
      _driverInfo = null;
      _driverDisplayPos = null;
      _routePoints = [];
      _previewRoute = [];
      _finalPrice = null;
      _showCompletion = false;
      _showRatingModal = false;
      _selectedRating = 0;
      _freeRideKm = 0;
      _lastFreePoint = null;
      _isDriverQueued = false;
      _prevDestCoords = null;
      _prevDestAddress = '';
      _consumedRoutePoints = [];
    });
  }

  // ─── Location sharing ─────────────────────────────────────────────────────

  Future<void> _toggleLocationSharing(bool val) async {
    final api = context.read<ApiService>();
    await api.updatePassengerLocationSharing(val);
    setState(() => _shareLiveLocation = val);
    if (val && _orderStatus != OrderStatus.idle) {
      _startLocationSendTimer();
    } else {
      _locationShareTimer?.cancel();
    }
  }

  void _startLocationSendTimer() {
    _locationShareTimer?.cancel();
    _locationShareTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (_shareLiveLocation && _orderStatus != OrderStatus.idle) {
        context.read<SocketService>().send({
          'type': 'passenger_location',
          'lat': _userLat,
          'lng': _userLng,
        });
      }
    });
  }

  // ─── Free ride distance timer ─────────────────────────────────────────────

  void _startFreeRideDistanceTimer() {
    _distanceUpdateTimer?.cancel();
    _distanceUpdateTimer = Timer.periodic(const Duration(seconds: 5), (_) async {
      if (_orderId != null && _orderStatus == OrderStatus.inProgress) {
        final api = context.read<ApiService>();
        await api.updateOrderDistance(_orderId!, _freeRideKm);
      }
    });
  }

  // ─── Rating ──────────────────────────────────────────────────────────────

  Future<void> _submitRating() async {
    if (_selectedRating == 0 || _orderId == null) {
      _afterRating();
      return;
    }
    final api = context.read<ApiService>();
    try {
      await api.rateDriver(_orderId!, _selectedRating);
    } catch (_) {}
    _afterRating();
  }

  void _afterRating() {
    setState(() {
      _showRatingModal = false;
      _showCompletion = false;
    });
    _loadRecentTrips();
    Future.delayed(const Duration(milliseconds: 300), _resetToIdle);
  }

  // ─── Recent trips ─────────────────────────────────────────────────────────

  Future<void> _loadRecentTrips() async {
    final api = context.read<ApiService>();
    try {
      final orders = await api.getOrderHistory();
      if (mounted) setState(() => _recentTrips = orders.take(10).toList());
    } catch (_) {}
  }

  // ─── Build ────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final theme = context.watch<ThemeProvider>();
    final t = Translations(theme.lang);

    return Scaffold(
      body: Stack(
        children: [
          // MAP
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: _mapCenter,
              initialZoom: 15,
              onMapReady: () => setState(() {
                _mapReady = true;
                _mapController.move(LatLng(_userLat, _userLng), 15);
              }),
              onPositionChanged: _onMapPositionChanged,
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.axentis.taxiapp',
              ),
              // Preview route (before ordering)
              if (_previewRoute.length >= 2 && _orderStatus == OrderStatus.idle)
                PolylineLayer(polylines: [
                  Polyline(points: _previewRoute, color: Colors.grey.withOpacity(0.6), strokeWidth: 4),
                ]),
              // Consuming polyline while driver is finishing previous trip (queued state)
              if (_orderStatus == OrderStatus.queued && _consumedRoutePoints.length >= 2)
                PolylineLayer(polylines: [
                  Polyline(
                    points: _consumedRoutePoints,
                    color: Colors.orange,
                    strokeWidth: 5,
                    strokeCap: StrokeCap.round,
                    strokeJoin: StrokeJoin.round,
                  ),
                ]),
              // Active route (non-queued states)
              if (_routePoints.length >= 2 && _orderStatus != OrderStatus.queued)
                PolylineLayer(polylines: [
                  Polyline(points: _routePoints, color: _routeColor, strokeWidth: 5, strokeCap: StrokeCap.round, strokeJoin: StrokeJoin.round),
                ]),
              MarkerLayer(markers: _buildMarkers()),
            ],
          ),

          // CENTER PIN (pickup or destination selection)
          if (_mapMode != MapMode.none && _orderStatus == OrderStatus.idle)
            Center(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 40),
                child: AnimatedBuilder(
                  animation: _pinBounce,
                  builder: (_, __) => Transform.translate(
                    offset: Offset(0, -8 - _pinBounce.value * 8),
                    child: Icon(
                      Icons.location_pin,
                      size: 44,
                      color: _mapMode == MapMode.pickup ? theme.primary : Colors.redAccent,
                    ),
                  ),
                ),
              ),
            ),

          // Geocoding indicator
          if (_geocoding)
            Positioned(
              top: MediaQuery.of(context).padding.top + 60,
              left: 0,
              right: 0,
              child: const Center(child: CircularProgressIndicator()),
            ),

          // TOP ADDRESS BAR
          if (_orderStatus == OrderStatus.idle)
            Positioned(
              top: MediaQuery.of(context).padding.top + 8,
              left: 16,
              right: 16,
              child: _buildAddressBar(t, theme),
            ),

          // STATUS BADGE (when order placed)
          if (_orderStatus != OrderStatus.idle && !_showCompletion)
            Positioned(
              top: MediaQuery.of(context).padding.top + 8,
              left: 16,
              right: 16,
              child: _buildStatusBadge(t, theme),
            ),

          // FIND ME button
          Positioned(
            bottom: 240,
            right: 16,
            child: GestureDetector(
              onTap: () {
                if (_mapReady) {
                  _mapController.move(LatLng(_userLat, _userLng), _mapController.camera.zoom);
                }
              },
              child: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: theme.card,
                  shape: BoxShape.circle,
                  boxShadow: [const BoxShadow(color: Colors.black26, blurRadius: 6)],
                ),
                child: Icon(Icons.my_location, color: theme.primary, size: 22),
              ),
            ),
          ),

          // BOTTOM PANEL
          Positioned(
            bottom: 0, left: 0, right: 0,
            child: _buildBottomPanel(t, theme),
          ),

          // DRIVER INFO CARD
          if (_driverInfo != null && _showDriverCard &&
              (_orderStatus == OrderStatus.queued ||
               _orderStatus == OrderStatus.accepted ||
               _orderStatus == OrderStatus.arrived))
            Positioned(
              top: MediaQuery.of(context).padding.top + 60,
              left: 16, right: 16,
              child: _buildDriverCard(t, theme),
            ),

          // COMPLETION OVERLAY
          if (_showCompletion && !_showRatingModal)
            _buildCompletionOverlay(t, theme),

          // RATING MODAL
          if (_showRatingModal)
            _buildRatingModal(t, theme),
        ],
      ),
    );
  }

  List<Marker> _buildMarkers() {
    final markers = <Marker>[];

    // User position
    markers.add(Marker(
      point: LatLng(_userLat, _userLng),
      width: 20, height: 20,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.blue,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 2),
          boxShadow: [const BoxShadow(color: Colors.black26, blurRadius: 4)],
        ),
      ),
    ));

    // Pickup marker (when destination mode or order placed)
    if (_pickupCoords != null && _mapMode != MapMode.pickup && _orderStatus == OrderStatus.idle) {
      markers.add(Marker(
        point: _pickupCoords!,
        width: 36, height: 36,
        child: Container(
          decoration: BoxDecoration(
            color: Colors.green,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 2),
          ),
          child: const Center(child: Text('A', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
        ),
      ));
    }

    // During queued state: show driver's previous order destination (NOT the pickup for our trip)
    if (_orderStatus == OrderStatus.queued && _prevDestCoords != null) {
      markers.add(Marker(
        point: _prevDestCoords!,
        width: 36, height: 36,
        child: Container(
          decoration: BoxDecoration(
            color: Colors.orange,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 2),
          ),
          child: const Center(child: Text('🏁', style: TextStyle(fontSize: 16))),
        ),
      ));
    }

    // Destination marker (when idle & both set)
    if (_destCoords != null && _mapMode == MapMode.none && _orderStatus == OrderStatus.idle) {
      markers.add(Marker(
        point: _destCoords!,
        width: 36, height: 36,
        child: Container(
          decoration: BoxDecoration(
            color: Colors.red,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 2),
          ),
          child: const Center(child: Text('B', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
        ),
      ));
    }

    // Available drivers (idle only)
    if (_orderStatus == OrderStatus.idle) {
      for (final d in _availableDrivers) {
        markers.add(Marker(
          point: LatLng(d.lat, d.lng),
          width: 28, height: 28,
          child: Container(
            decoration: const BoxDecoration(color: Color(0xFFFFCC00), shape: BoxShape.circle),
            child: const Icon(Icons.directions_car, size: 16, color: Colors.black),
          ),
        ));
      }
    }

    // Driver marker (during active order)
    if (_driverDisplayPos != null && _orderStatus != OrderStatus.idle) {
      markers.add(Marker(
        point: _driverDisplayPos!,
        width: 44, height: 44,
        child: Transform.rotate(
          angle: _driverSmoothHeading * math.pi / 180,
          child: Container(
            decoration: BoxDecoration(
              color: const Color(0xFFFFCC00),
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 2),
            ),
            child: const Icon(Icons.navigation, color: Colors.black, size: 22),
          ),
        ),
      ));
    }

    return markers;
  }

  Widget _buildAddressBar(Translations t, ThemeProvider theme) {
    return Container(
      decoration: BoxDecoration(
        color: theme.card,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [const BoxShadow(color: Colors.black26, blurRadius: 8)],
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Pickup row
          Row(children: [
            const Icon(Icons.trip_origin, color: Colors.green, size: 16),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                _pickupText.isNotEmpty ? _pickupText : t.t('selectPickupPoint'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: _pickupText.isNotEmpty ? null : theme.textSecondary,
                  fontSize: 13,
                ),
              ),
            ),
            if (_mapMode == MapMode.pickup)
              TextButton(
                onPressed: _pickupCoords != null ? _confirmPickup : null,
                child: Text(t.t('confirm'), style: TextStyle(color: theme.primary)),
              ),
          ]),
          // Destination row
          if (_mapMode != MapMode.pickup) ...[
            Container(height: 1, color: theme.border, margin: const EdgeInsets.symmetric(vertical: 6, horizontal: 24)),
            Row(children: [
              Icon(Icons.location_pin, color: Colors.red, size: 16),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _destText.isNotEmpty ? _destText : t.t('selectDestination'),
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: _destText.isNotEmpty ? null : theme.textSecondary,
                    fontSize: 13,
                  ),
                ),
              ),
              if (_mapMode == MapMode.destination)
                TextButton(
                  onPressed: _destCoords != null ? _confirmDestination : null,
                  child: Text(t.t('confirm'), style: TextStyle(color: theme.primary)),
                ),
            ]),
          ],
        ],
      ),
    );
  }

  Widget _buildStatusBadge(Translations t, ThemeProvider theme) {
    final labels = {
      OrderStatus.searching:  t.t('searching'),
      OrderStatus.queued:     t.t('driverFoundQueued'),
      OrderStatus.accepted:   t.t('driverFound'),
      OrderStatus.arrived:    t.t('driverArrived'),
      OrderStatus.inProgress: t.t('tripInProgress'),
      OrderStatus.completed:  t.t('tripCompleted'),
    };
    final colors = {
      OrderStatus.searching:  Colors.orange,
      OrderStatus.queued:     Colors.orange,
      OrderStatus.accepted:   Colors.blue,
      OrderStatus.arrived:    Colors.orange,
      OrderStatus.inProgress: Colors.green,
      OrderStatus.completed:  Colors.green,
    };
    final label = labels[_orderStatus] ?? '';
    final color = colors[_orderStatus] ?? theme.textSecondary;

    // When queued: add sub-line showing driver's prev destination
    final subLabel = (_orderStatus == OrderStatus.queued && _prevDestAddress.isNotEmpty)
        ? _prevDestAddress
        : null;

    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: theme.card.withOpacity(0.95),
          borderRadius: BorderRadius.circular(20),
          boxShadow: [const BoxShadow(color: Colors.black26, blurRadius: 8)],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_orderStatus == OrderStatus.searching)
                  const SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2))
                else
                  Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                const SizedBox(width: 8),
                Text(label, style: TextStyle(color: color, fontWeight: FontWeight.bold)),
              ],
            ),
            if (subLabel != null) ...[
              const SizedBox(height: 4),
              Text(
                '→ $subLabel',
                style: TextStyle(color: theme.textSecondary, fontSize: 11),
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildBottomPanel(Translations t, ThemeProvider theme) {
    return Container(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).padding.bottom + 16),
      decoration: BoxDecoration(
        color: theme.card,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        boxShadow: [const BoxShadow(color: Colors.black26, blurRadius: 12)],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          Container(width: 40, height: 4, decoration: BoxDecoration(color: theme.border, borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: 12),

          if (_orderStatus == OrderStatus.idle && _mapMode == MapMode.none) ...[
            // Free mode toggle
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(t.t('free'), style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text(t.t('freeHint'), style: TextStyle(fontSize: 11, color: theme.textSecondary)),
                  ],
                ),
                Switch(value: _isFreeMode, onChanged: (v) => setState(() => _isFreeMode = v), activeColor: theme.primary),
              ],
            ),
            const SizedBox(height: 8),
            // Location sharing toggle
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t.t('shareLocation'), style: const TextStyle(fontSize: 13)),
                      Text(t.t('shareLocationHint'), style: TextStyle(fontSize: 11, color: theme.textSecondary)),
                    ],
                  ),
                ),
                Switch(value: _shareLiveLocation, onChanged: _toggleLocationSharing, activeColor: theme.primary),
              ],
            ),
            const SizedBox(height: 8),
            // Price estimate
            if (!_isFreeMode && _estimatedPrice > 0)
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(t.t('estimatedPrice'), style: TextStyle(color: theme.textSecondary)),
                  Text('${_estimatedPrice.toStringAsFixed(0)} сум',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: theme.primary)),
                ],
              ),
            if (!_isFreeMode && _estimatedPrice > 0 && _pricing.surgeMultiplier > 1)
              Text('${t.t("surge")}: x${_pricing.surgeMultiplier.toStringAsFixed(1)}',
                  style: TextStyle(color: Colors.orange, fontSize: 12)),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: _createOrder,
              child: Text(t.t('orderTaxi'), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
          ],

          // Searching state
          if (_orderStatus == OrderStatus.searching) ...[
            Text(t.t('searching'),
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 8),
            const LinearProgressIndicator(),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: _cancelOrder,
              style: OutlinedButton.styleFrom(foregroundColor: Colors.red, side: const BorderSide(color: Colors.red)),
              child: Text(t.t('cancelOrder')),
            ),
          ],

          // Active order (accepted/arrived/in_progress)
          if (_orderStatus == OrderStatus.accepted || _orderStatus == OrderStatus.arrived) ...[
            if (_driverInfo != null) ...[
              Row(
                children: [
                  const Icon(Icons.directions_car, size: 16),
                  const SizedBox(width: 6),
                  Text(_driverInfo!.carNumber ?? '', style: const TextStyle(fontWeight: FontWeight.bold)),
                  const Spacer(),
                  Row(children: [
                    const Icon(Icons.star, color: Colors.amber, size: 14),
                    const SizedBox(width: 2),
                    Text(_driverInfo!.averageRating.toStringAsFixed(1)),
                  ]),
                ],
              ),
              const SizedBox(height: 4),
            ],
            OutlinedButton.icon(
              icon: const Icon(Icons.cancel, size: 16),
              label: Text(t.t('cancelOrder')),
              style: OutlinedButton.styleFrom(foregroundColor: Colors.red, side: const BorderSide(color: Colors.red)),
              onPressed: _cancelOrder,
            ),
          ],

          if (_orderStatus == OrderStatus.inProgress) ...[
            if (_isFreeMode)
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(t.t('distance'), style: TextStyle(color: theme.textSecondary)),
                  Text('${_freeRideKm.toStringAsFixed(2)} ${t.t("km")}',
                      style: const TextStyle(fontWeight: FontWeight.bold)),
                ],
              ),
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.green.withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(t.t('tripInProgress'),
                  style: const TextStyle(color: Colors.green, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center),
            ),
          ],

          // Recent trips accordion
          if (_recentTrips.isNotEmpty && _orderStatus == OrderStatus.idle) ...[
            const SizedBox(height: 12),
            GestureDetector(
              onTap: () => setState(() => _recentTripsExpanded = !_recentTripsExpanded),
              child: Row(
                children: [
                  Text(t.t('recentTrips'), style: TextStyle(color: theme.textSecondary, fontSize: 13)),
                  const Spacer(),
                  Icon(_recentTripsExpanded ? Icons.expand_less : Icons.expand_more),
                ],
              ),
            ),
            if (_recentTripsExpanded)
              Container(
                constraints: const BoxConstraints(maxHeight: 200),
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: _recentTrips.length,
                  itemBuilder: (_, i) {
                    final order = _recentTrips[i];
                    return ListTile(
                      dense: true,
                      title: Text(order.pickupAddress, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
                      subtitle: order.destAddress != null
                          ? Text('→ ${order.destAddress}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11))
                          : null,
                      trailing: order.totalPrice != null
                          ? Text('${order.totalPrice!.toStringAsFixed(0)} сум', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12))
                          : null,
                    );
                  },
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _buildDriverCard(Translations t, ThemeProvider theme) {
    final d = _driverInfo!;
    return GestureDetector(
      onTap: () => setState(() => _showDriverCard = false),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: theme.card,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [const BoxShadow(color: Colors.black26, blurRadius: 8)],
        ),
        child: Row(
          children: [
            CircleAvatar(
              radius: 24,
              backgroundColor: theme.primary.withOpacity(0.3),
              child: Text(d.firstName.isNotEmpty ? d.firstName[0] : '?',
                  style: const TextStyle(fontWeight: FontWeight.bold)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${d.firstName} ${d.lastName}', style: const TextStyle(fontWeight: FontWeight.bold)),
                  Text(d.carNumber ?? '', style: TextStyle(color: theme.textSecondary, fontSize: 12)),
                  Row(children: [
                    const Icon(Icons.star, color: Colors.amber, size: 12),
                    const SizedBox(width: 2),
                    Text(d.averageRating.toStringAsFixed(1), style: const TextStyle(fontSize: 12)),
                  ]),
                ],
              ),
            ),
            IconButton(
              icon: const Icon(Icons.phone, color: Colors.green),
              onPressed: () {},
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
      ),
    );
  }

  Widget _buildCompletionOverlay(Translations t, ThemeProvider theme) {
    return Container(
      color: Colors.black54,
      child: Center(
        child: Container(
          margin: const EdgeInsets.all(24),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(color: theme.card, borderRadius: BorderRadius.circular(20)),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.check_circle, size: 64, color: theme.success),
              const SizedBox(height: 12),
              Text(t.t('tripCompleted'),
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
              if (_finalPrice != null) ...[
                const SizedBox(height: 8),
                Text('${t.t("totalPrice")}: ${_finalPrice!.toStringAsFixed(0)} сум',
                    style: TextStyle(fontSize: 20, color: theme.primary, fontWeight: FontWeight.bold)),
              ],
              const SizedBox(height: 8),
              Text('Спасибо, что выбрали нас!', style: TextStyle(color: theme.textSecondary)),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: () => setState(() => _showRatingModal = true),
                child: Text(t.t('rateDriver')),
              ),
              TextButton(
                onPressed: _afterRating,
                child: Text(t.t('skip'), style: TextStyle(color: theme.textSecondary)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRatingModal(Translations t, ThemeProvider theme) {
    return Container(
      color: Colors.black54,
      child: Center(
        child: Container(
          margin: const EdgeInsets.all(24),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(color: theme.card, borderRadius: BorderRadius.circular(20)),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(t.t('rateTitle'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(5, (i) {
                  return GestureDetector(
                    onTap: () => setState(() => _selectedRating = i + 1),
                    child: Icon(
                      i < _selectedRating ? Icons.star : Icons.star_border,
                      color: Colors.amber,
                      size: 40,
                    ),
                  );
                }),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _afterRating,
                      child: Text(t.t('skip')),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: _selectedRating > 0 ? _submitRating : null,
                      child: Text(t.t('send')),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
