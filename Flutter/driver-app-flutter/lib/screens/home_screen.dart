import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_compass/flutter_compass.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import '../l10n/translations.dart';
import '../models/models.dart';
import '../providers/auth_provider.dart';
import '../providers/theme_provider.dart';
import '../services/api_service.dart';
import '../services/notification_service.dart';
import '../services/socket_service.dart';

enum DriverStatus { offline, available, incoming, accepted, arrived, inProgress }

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with TickerProviderStateMixin {
  // ─── Status ────────────────────────────────────────────────────────────────
  DriverStatus _status = DriverStatus.offline;
  bool _isOnline = false;

  // ─── GPS "refs" (write without setState, read in display timer) ─────────
  double _latRef = 41.2995;
  double _lngRef = 69.2401;
  double _headingRef = 0;
  double _smoothHeading = 0; // exponentially smoothed

  // ─── Displayed position (updated by 20ms timer → 50fps) ────────────────
  LatLng _displayPos = const LatLng(41.2995, 69.2401);
  double _displayHeading = 0;

  // ─── Order ──────────────────────────────────────────────────────────────
  Map<String, dynamic>? _currentOrder;
  LatLng? _pickupPoint;
  LatLng? _destPoint;
  LatLng? _passengerLivePoint;

  // ─── Route ──────────────────────────────────────────────────────────────
  List<LatLng> _routePoints = [];
  LatLng? _lastRouteFetchPos;

  // ─── Wait timer ─────────────────────────────────────────────────────────
  DateTime? _waitStartTime;
  int _waitSeconds = 0;
  bool _waitIsBillable = false;
  Timer? _waitTimer;

  // ─── Countdown (incoming order, 10s) ────────────────────────────────────
  int _countdownSeconds = 10;
  Timer? _countdownTimer;

  // ─── Distance metering (inProgress) ─────────────────────────────────────
  double _drivenKm = 0;
  LatLng? _lastMeteringPoint;
  Timer? _distanceUpdateTimer;

  // ─── Trip completion ─────────────────────────────────────────────────────
  Map<String, dynamic>? _completionData;

  // ─── Map ─────────────────────────────────────────────────────────────────
  final MapController _mapController = MapController();
  bool _isNavMode = false;
  bool _mapReady = false;

  // ─── Timers & subscriptions ──────────────────────────────────────────────
  StreamSubscription<Position>? _locationSub;
  StreamSubscription<CompassEvent>? _compassSub;
  late AnimationController _displayTicker;
  Timer? _broadcastTimer;

  @override
  void initState() {
    super.initState();
    _displayTicker = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 20),
    )..addListener(_onDisplayTick);
    _displayTicker.repeat();
    _initLocation();
    WidgetsBinding.instance.addPostFrameCallback((_) => _initSocket());
  }

  @override
  void dispose() {
    _displayTicker.dispose();
    _locationSub?.cancel();
    _compassSub?.cancel();
    _waitTimer?.cancel();
    _countdownTimer?.cancel();
    _distanceUpdateTimer?.cancel();
    _broadcastTimer?.cancel();
    final socket = context.read<SocketService>();
    socket.off('new_order');
    socket.off('order_cancelled');
    socket.off('passenger_location');
    socket.off('passenger_location_hidden');
    super.dispose();
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  void _initSocket() {
    final socket = context.read<SocketService>();
    socket.on('new_order', _onNewOrder);
    socket.on('order_cancelled', _onOrderCancelled);
    socket.on('passenger_location', _onPassengerLocation);
    socket.on('passenger_location_hidden', _onPassengerLocationHidden);
  }

  Future<void> _initLocation() async {
    LocationPermission perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    if (perm == LocationPermission.deniedForever) return;

    final pos = await Geolocator.getCurrentPosition();
    _latRef = pos.latitude;
    _lngRef = pos.longitude;

    _compassSub = FlutterCompass.events?.listen((event) {
      if (event.heading == null) return;
      // Low-pass filter alpha=0.4
      _headingRef = _headingRef + 0.4 * (_normalizeAngle(event.heading! - _headingRef));
    });

    _startLocationStream();
    _startBroadcast();
  }

  void _startLocationStream() {
    _locationSub?.cancel();
    final accuracy = (_status == DriverStatus.accepted ||
            _status == DriverStatus.arrived ||
            _status == DriverStatus.inProgress)
        ? LocationAccuracy.bestForNavigation
        : LocationAccuracy.balanced;
    final interval = (_status == DriverStatus.accepted ||
            _status == DriverStatus.arrived ||
            _status == DriverStatus.inProgress)
        ? 100
        : 5000;
    final distance = (_status == DriverStatus.accepted ||
            _status == DriverStatus.arrived ||
            _status == DriverStatus.inProgress)
        ? 1
        : 10;

    _locationSub = Geolocator.getPositionStream(
      locationSettings: LocationSettings(
        accuracy: accuracy,
        distanceFilter: distance,
        timeLimit: Duration(milliseconds: interval),
      ),
    ).listen(_onPositionUpdate);
  }

  void _startBroadcast() {
    _broadcastTimer?.cancel();
    _broadcastTimer = Timer.periodic(const Duration(milliseconds: 500), (_) {
      if (_isOnline) {
        context.read<SocketService>().send({
          'type': 'location_update',
          'lat': _latRef,
          'lng': _lngRef,
          'heading': _headingRef,
        });
      }
    });
  }

  // ─── GPS & Compass ────────────────────────────────────────────────────────

  void _onPositionUpdate(Position pos) {
    _latRef = pos.latitude;
    _lngRef = pos.longitude;
    if (pos.speed > 0.5) {
      _headingRef = pos.heading;
    }

    // Distance metering
    if (_status == DriverStatus.inProgress) {
      final current = LatLng(_latRef, _lngRef);
      if (_lastMeteringPoint != null) {
        final delta = _haversine(_lastMeteringPoint!, current);
        if (delta > 5) {
          // Only accumulate segments >5m
          _drivenKm += delta / 1000;
          _lastMeteringPoint = current;
        }
      } else {
        _lastMeteringPoint = current;
      }
    }

    // Re-fetch route if moved >30m
    if (_routePoints.isNotEmpty &&
        _lastRouteFetchPos != null &&
        (_status == DriverStatus.accepted || _status == DriverStatus.inProgress)) {
      final dist = _haversine(_lastRouteFetchPos!, LatLng(_latRef, _lngRef));
      if (dist > 30) {
        final target = _status == DriverStatus.accepted || _status == DriverStatus.arrived
            ? _pickupPoint
            : _destPoint;
        if (target != null) {
          _fetchRoute(LatLng(_latRef, _lngRef), target);
        }
      }
    }
  }

  void _onDisplayTick() {
    if (!mounted) return;
    // Exponential smoothing for heading (alpha=0.35)
    final diff = _normalizeAngle(_headingRef - _smoothHeading);
    _smoothHeading += 0.35 * diff;

    setState(() {
      _displayPos = LatLng(_latRef, _lngRef);
      _displayHeading = _smoothHeading;
    });

    // Nav mode: rotate map
    if (_isNavMode && _mapReady && _isOnline) {
      try {
        _mapController.moveAndRotate(_displayPos, _mapController.camera.zoom, -_smoothHeading);
      } catch (_) {}
    }
  }

  double _normalizeAngle(double angle) {
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    return angle;
  }

  double _haversine(LatLng a, LatLng b) {
    const R = 6371000.0;
    final dLat = (b.latitude - a.latitude) * math.pi / 180;
    final dLng = (b.longitude - a.longitude) * math.pi / 180;
    final sinDLat = math.sin(dLat / 2);
    final sinDLng = math.sin(dLng / 2);
    final x = sinDLat * sinDLat +
        math.cos(a.latitude * math.pi / 180) *
            math.cos(b.latitude * math.pi / 180) *
            sinDLng *
            sinDLng;
    return 2 * R * math.asin(math.sqrt(x));
  }

  // ─── WebSocket handlers ───────────────────────────────────────────────────

  void _onNewOrder(Map<String, dynamic> msg) {
    final order = msg['order'] as Map<String, dynamic>?;
    if (order == null || !mounted) return;
    final notifications = context.read<NotificationService>();
    notifications.showIncomingOrderNotification(
      pickup: order['pickup_address'] as String? ?? '',
      destination: order['destination_address'] as String?,
      price: '${order['total_price'] ?? ''}',
    );
    setState(() {
      _currentOrder = order;
      _status = DriverStatus.incoming;
      _countdownSeconds = 10;
    });
    _startCountdown();
  }

  void _onOrderCancelled(Map<String, dynamic> msg) {
    if (!mounted) return;
    _resetToAvailable();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Заказ отменён пассажиром')),
      );
    }
  }

  void _onPassengerLocation(Map<String, dynamic> msg) {
    final lat = (msg['lat'] as num?)?.toDouble();
    final lng = (msg['lng'] as num?)?.toDouble();
    if (lat == null || lng == null) return;
    setState(() => _passengerLivePoint = LatLng(lat, lng));
    // If arrived & passenger moved, refresh route to passenger
    if (_status == DriverStatus.accepted && _pickupPoint != null) {
      _fetchRoute(LatLng(_latRef, _lngRef), LatLng(lat, lng));
    }
  }

  void _onPassengerLocationHidden(Map<String, dynamic> msg) {
    setState(() => _passengerLivePoint = null);
    if (_status == DriverStatus.accepted && _pickupPoint != null) {
      _fetchRoute(LatLng(_latRef, _lngRef), _pickupPoint!);
    }
  }

  // ─── Order actions ────────────────────────────────────────────────────────

  void _startCountdown() {
    _countdownTimer?.cancel();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _countdownSeconds--);
      if (_countdownSeconds <= 0) {
        _declineOrder();
      }
    });
  }

  Future<void> _acceptOrder() async {
    final api = context.read<ApiService>();
    final orderId = _currentOrder!['id'] as String;
    _countdownTimer?.cancel();
    try {
      await api.acceptOrder(orderId);
      final pickup = LatLng(
        (_currentOrder!['pickup_lat'] as num).toDouble(),
        (_currentOrder!['pickup_lng'] as num).toDouble(),
      );
      LatLng? dest;
      if (_currentOrder!['destination_lat'] != null) {
        dest = LatLng(
          (_currentOrder!['destination_lat'] as num).toDouble(),
          (_currentOrder!['destination_lng'] as num).toDouble(),
        );
      }
      setState(() {
        _status = DriverStatus.accepted;
        _pickupPoint = pickup;
        _destPoint = dest;
        _passengerLivePoint = null;
      });
      _startLocationStream();
      _fetchRoute(LatLng(_latRef, _lngRef), pickup);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _declineOrder() async {
    _countdownTimer?.cancel();
    final api = context.read<ApiService>();
    final orderId = _currentOrder!['id'] as String;
    await api.declineOrder(orderId);
    _resetToAvailable();
  }

  Future<void> _arrivedAtPickup() async {
    final api = context.read<ApiService>();
    final orderId = _currentOrder!['id'] as String;
    try {
      await api.arrivedAtPickup(orderId);
      setState(() {
        _status = DriverStatus.arrived;
        _waitStartTime = DateTime.now();
        _waitSeconds = 0;
        _waitIsBillable = false;
      });
      _startWaitTimer();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _startTrip() async {
    final api = context.read<ApiService>();
    final orderId = _currentOrder!['id'] as String;
    try {
      await api.startTrip(orderId);
      _waitTimer?.cancel();
      setState(() {
        _status = DriverStatus.inProgress;
        _drivenKm = 0;
        _lastMeteringPoint = null;
      });
      if (_destPoint != null) {
        _fetchRoute(LatLng(_latRef, _lngRef), _destPoint!);
      }
      _startDistanceUpdateTimer();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _completeTrip() async {
    final api = context.read<ApiService>();
    final orderId = _currentOrder!['id'] as String;
    try {
      final result = await api.completeTrip(orderId);
      _distanceUpdateTimer?.cancel();
      setState(() {
        _completionData = result;
        _routePoints = [];
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red),
        );
      }
    }
  }

  void _resetToAvailable() {
    _waitTimer?.cancel();
    _countdownTimer?.cancel();
    _distanceUpdateTimer?.cancel();
    setState(() {
      _status = DriverStatus.available;
      _currentOrder = null;
      _pickupPoint = null;
      _destPoint = null;
      _passengerLivePoint = null;
      _routePoints = [];
      _completionData = null;
      _waitSeconds = 0;
      _drivenKm = 0;
      _lastMeteringPoint = null;
    });
  }

  // ─── Wait timer ───────────────────────────────────────────────────────────

  void _startWaitTimer() {
    _waitTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      final elapsed = DateTime.now().difference(_waitStartTime!).inSeconds;
      setState(() {
        _waitSeconds = elapsed;
        _waitIsBillable = elapsed > 120; // 2 free minutes
      });
    });
  }

  String _formatWaitTime() {
    final mins = (_waitSeconds ~/ 60).toString().padLeft(2, '0');
    final secs = (_waitSeconds % 60).toString().padLeft(2, '0');
    return '$mins:$secs';
  }

  int get _billableMinutes => _waitSeconds > 120 ? (_waitSeconds - 120) ~/ 60 : 0;
  int get _waitFee => _billableMinutes * 500;

  // ─── Distance update timer ────────────────────────────────────────────────

  void _startDistanceUpdateTimer() {
    _distanceUpdateTimer?.cancel();
    _distanceUpdateTimer = Timer.periodic(const Duration(seconds: 5), (_) async {
      if (_status == DriverStatus.inProgress && _currentOrder != null) {
        final api = context.read<ApiService>();
        await api.updateOrderDistance(_currentOrder!['id'] as String, _drivenKm);
      }
    });
  }

  // ─── Online toggle ────────────────────────────────────────────────────────

  Future<void> _toggleOnline() async {
    final api = context.read<ApiService>();
    final newVal = !_isOnline;
    try {
      await api.updateAvailability(newVal);
      setState(() {
        _isOnline = newVal;
        _status = newVal ? DriverStatus.available : DriverStatus.offline;
      });
      if (newVal) _startLocationStream();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red),
        );
      }
    }
  }

  // ─── OSRM Routing ─────────────────────────────────────────────────────────

  Future<void> _fetchRoute(LatLng from, LatLng to) async {
    _lastRouteFetchPos = from;
    try {
      final url = Uri.parse(
        'http://router.project-osrm.org/route/v1/driving/'
        '${from.longitude},${from.latitude};${to.longitude},${to.latitude}'
        '?overview=full&geometries=geojson&steps=true',
      );
      final resp = await http.get(url).timeout(const Duration(seconds: 6));
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body) as Map<String, dynamic>;
        final routes = data['routes'] as List?;
        if (routes != null && routes.isNotEmpty) {
          final coords = (routes[0]['geometry']['coordinates'] as List)
              .map((c) => LatLng(
                    (c[1] as num).toDouble(),
                    (c[0] as num).toDouble(),
                  ))
              .toList();
          if (mounted) setState(() => _routePoints = coords);
          return;
        }
      }
    } catch (_) {}
    // Fallback: straight line
    if (mounted) setState(() => _routePoints = [from, to]);
  }

  // ─── Route color ──────────────────────────────────────────────────────────

  Color get _routeColor {
    switch (_status) {
      case DriverStatus.accepted:
        return const Color(0xFF2196F3); // blue
      case DriverStatus.arrived:
        return const Color(0xFFF97316); // orange
      case DriverStatus.inProgress:
        return const Color(0xFF22C55E); // green
      default:
        return const Color(0xFF2196F3);
    }
  }

  // ─── Build ────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final theme = context.watch<ThemeProvider>();
    final t = Translations(theme.lang);

    return Scaffold(
      body: Stack(
        children: [
          // Map
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: _displayPos,
              initialZoom: 15,
              onMapReady: () => setState(() => _mapReady = true),
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.axentis.driverapp',
              ),
              if (_routePoints.length >= 2)
                PolylineLayer(
                  polylines: [
                    Polyline(
                      points: _routePoints,
                      color: _routeColor,
                      strokeWidth: 5,
                      strokeCap: StrokeCap.round,
                      strokeJoin: StrokeJoin.round,
                    ),
                  ],
                ),
              MarkerLayer(markers: _buildMarkers()),
            ],
          ),

          // Top: Status bar
          Positioned(
            top: MediaQuery.of(context).padding.top + 8,
            left: 16,
            right: 16,
            child: _buildStatusBar(t, theme),
          ),

          // Nav mode & find-me buttons
          Positioned(
            bottom: 200,
            right: 16,
            child: Column(
              children: [
                _mapButton(
                  icon: _isNavMode ? Icons.navigation : Icons.explore,
                  onTap: () => setState(() => _isNavMode = !_isNavMode),
                  active: _isNavMode,
                  theme: theme,
                ),
                const SizedBox(height: 8),
                _mapButton(
                  icon: Icons.my_location,
                  onTap: () {
                    if (_mapReady) {
                      _mapController.move(_displayPos, 15);
                    }
                  },
                  theme: theme,
                ),
              ],
            ),
          ),

          // Bottom status panel
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: _buildBottomPanel(t, theme),
          ),

          // Incoming order overlay
          if (_status == DriverStatus.incoming && _currentOrder != null)
            _buildIncomingOverlay(t, theme),

          // Trip completion overlay
          if (_completionData != null)
            _buildCompletionOverlay(t, theme),
        ],
      ),
    );
  }

  List<Marker> _buildMarkers() {
    final markers = <Marker>[];

    // Driver car marker (rotated)
    markers.add(Marker(
      point: _displayPos,
      width: 40,
      height: 40,
      child: Transform.rotate(
        angle: _isNavMode ? 0 : _displayHeading * math.pi / 180,
        child: Container(
          decoration: BoxDecoration(
            color: const Color(0xFFFFCC00),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 2),
            boxShadow: [
              BoxShadow(color: Colors.black26, blurRadius: 4, spreadRadius: 1),
            ],
          ),
          child: const Icon(Icons.navigation, color: Colors.black, size: 20),
        ),
      ),
    ));

    // Pickup marker (A)
    if (_pickupPoint != null) {
      markers.add(Marker(
        point: _pickupPoint!,
        width: 36,
        height: 36,
        child: Container(
          decoration: BoxDecoration(
            color: Colors.blue,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 2),
          ),
          child: const Center(
            child: Text('A', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ),
      ));
    }

    // Destination marker
    if (_destPoint != null) {
      markers.add(Marker(
        point: _destPoint!,
        width: 36,
        height: 36,
        child: Container(
          decoration: BoxDecoration(
            color: Colors.red,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 2),
          ),
          child: const Center(child: Text('🏁', style: TextStyle(fontSize: 16))),
        ),
      ));
    }

    // Live passenger position
    if (_passengerLivePoint != null) {
      markers.add(Marker(
        point: _passengerLivePoint!,
        width: 36,
        height: 36,
        child: Container(
          decoration: BoxDecoration(
            color: Colors.purple,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 2),
          ),
          child: const Center(child: Text('🧍', style: TextStyle(fontSize: 16))),
        ),
      ));
    }

    return markers;
  }

  Widget _buildStatusBar(Translations t, ThemeProvider theme) {
    String label;
    Color color;
    switch (_status) {
      case DriverStatus.offline:
        label = t.t('offline');
        color = theme.textSecondary;
        break;
      case DriverStatus.available:
        label = t.t('waitingForOrders');
        color = theme.success;
        break;
      case DriverStatus.incoming:
        label = t.t('newOrder');
        color = theme.primary;
        break;
      case DriverStatus.accepted:
        label = t.t('goingToPassenger');
        color = Colors.blue;
        break;
      case DriverStatus.arrived:
        label = t.t('waitingForPassenger');
        color = Colors.orange;
        break;
      case DriverStatus.inProgress:
        label = t.t('passengerOnboard');
        color = theme.success;
        break;
    }

    return Row(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: theme.card.withOpacity(0.95),
            borderRadius: BorderRadius.circular(20),
            boxShadow: [BoxShadow(color: Colors.black26, blurRadius: 8)],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
              const SizedBox(width: 6),
              Text(label, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 13)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildBottomPanel(Translations t, ThemeProvider theme) {
    return Container(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).padding.bottom + 16),
      decoration: BoxDecoration(
        color: theme.card,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        boxShadow: [BoxShadow(color: Colors.black26, blurRadius: 12)],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Online toggle
          if (_status == DriverStatus.offline || _status == DriverStatus.available)
            SwitchListTile(
              title: Text(
                _isOnline ? t.t('online') : t.t('offline'),
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
              subtitle: _isOnline ? Text(t.t('waitingForOrders')) : null,
              value: _isOnline,
              activeColor: theme.primary,
              onChanged: (_) => _toggleOnline(),
            ),

          // Wait timer (arrived state)
          if (_status == DriverStatus.arrived)
            _buildWaitPanel(t, theme),

          // Arrived button (accepted state)
          if (_status == DriverStatus.accepted)
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                icon: const Icon(Icons.place),
                label: Text(t.t('arrivedAtPickup')),
                onPressed: _arrivedAtPickup,
              ),
            ),

          // Start trip button (arrived state, after wait)
          if (_status == DriverStatus.arrived)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  icon: const Icon(Icons.play_arrow),
                  label: Text(t.t('startTrip')),
                  onPressed: _startTrip,
                ),
              ),
            ),

          // Complete trip (inProgress)
          if (_status == DriverStatus.inProgress)
            Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(t.t('distance'), style: TextStyle(color: theme.textSecondary)),
                    Text('${_drivenKm.toStringAsFixed(2)} ${t.t('km')}',
                        style: const TextStyle(fontWeight: FontWeight.bold)),
                  ],
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    icon: const Icon(Icons.stop),
                    label: Text(t.t('completeTrip')),
                    onPressed: _completeTrip,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: theme.success,
                      foregroundColor: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _buildWaitPanel(Translations t, ThemeProvider theme) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _waitIsBillable ? theme.error.withOpacity(0.15) : theme.success.withOpacity(0.15),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _waitIsBillable ? t.t('billingStarted') : t.t('freeTime'),
                style: TextStyle(
                  color: _waitIsBillable ? theme.error : theme.success,
                  fontWeight: FontWeight.bold,
                ),
              ),
              if (_waitIsBillable)
                Text('$_waitFee ${t.t('ratePerMin')}',
                    style: TextStyle(color: theme.error, fontSize: 12)),
            ],
          ),
          Text(
            _formatWaitTime(),
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: _waitIsBillable ? theme.error : theme.success,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildIncomingOverlay(Translations t, ThemeProvider theme) {
    final order = _currentOrder!;
    final price = order['total_price'];
    final tripType = order['trip_type'] as String? ?? 'standard';
    final pickupAddr = order['pickup_address'] as String? ?? '';
    final destAddr = order['destination_address'] as String?;
    final distKm = (order['distance_km'] as num?)?.toDouble();
    final lockedPpk = (order['locked_price_per_km'] as num?)?.toDouble();
    final passengerPhone = order['passenger_phone'] as String?;

    return Container(
      color: Colors.black54,
      child: Center(
        child: Container(
          margin: const EdgeInsets.all(24),
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: theme.card,
            borderRadius: BorderRadius.circular(20),
            boxShadow: [BoxShadow(color: Colors.black38, blurRadius: 20)],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(t.t('newOrder'),
                      style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: theme.primary)),
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: theme.primary,
                      shape: BoxShape.circle,
                    ),
                    child: Text(
                      '$_countdownSeconds',
                      style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.black),
                    ),
                  ),
                ],
              ),
              const Divider(height: 20),
              _orderRow(Icons.location_on, t.t('pickup'), pickupAddr, theme),
              if (destAddr != null && destAddr.isNotEmpty)
                _orderRow(Icons.flag, t.t('destination'), destAddr, theme),
              if (distKm != null)
                _orderRow(Icons.straighten, t.t('distance'), '${distKm.toStringAsFixed(1)} km', theme),
              if (price != null)
                _orderRow(Icons.payments, t.t('price'), '${price.toString()} сум', theme),
              if (tripType == 'free')
                _orderRow(Icons.speed, t.t('price'), t.t('free'), theme),
              if (lockedPpk != null)
                _orderRow(Icons.monetization_on, t.t('pricePerKm'), '${lockedPpk.toStringAsFixed(0)} сум/км', theme),
              if (passengerPhone != null)
                _orderRow(Icons.phone, 'Телефон', passengerPhone, theme),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _declineOrder,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: theme.error,
                        side: BorderSide(color: theme.error),
                        minimumSize: const Size(0, 48),
                      ),
                      child: Text(t.t('decline')),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: _acceptOrder,
                      style: ElevatedButton.styleFrom(minimumSize: const Size(0, 48)),
                      child: Text(t.t('accept')),
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

  Widget _orderRow(IconData icon, String label, String value, ThemeProvider theme) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: theme.textSecondary),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: TextStyle(fontSize: 11, color: theme.textSecondary)),
                Text(value, style: TextStyle(color: theme.textPrimary, fontWeight: FontWeight.w500)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCompletionOverlay(Translations t, ThemeProvider theme) {
    final price = _completionData!['total_price'];
    return Container(
      color: Colors.black54,
      child: Center(
        child: Container(
          margin: const EdgeInsets.all(24),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: theme.card,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.check_circle, size: 64, color: theme.success),
              const SizedBox(height: 12),
              Text(t.t('tripCompleted'),
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
              if (price != null) ...[
                const SizedBox(height: 8),
                Text('${t.t('totalPrice')}: $price сум',
                    style: TextStyle(fontSize: 18, color: theme.primary, fontWeight: FontWeight.bold)),
              ],
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: () {
                  setState(() => _completionData = null);
                  _resetToAvailable();
                },
                child: Text(t.t('close')),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _mapButton({
    required IconData icon,
    required VoidCallback onTap,
    required ThemeProvider theme,
    bool active = false,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          color: active ? theme.primary : theme.card,
          shape: BoxShape.circle,
          boxShadow: [BoxShadow(color: Colors.black26, blurRadius: 6)],
        ),
        child: Icon(icon, color: active ? Colors.black : theme.textPrimary, size: 20),
      ),
    );
  }
}
