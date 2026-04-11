import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, Modal, Image, Vibration, Linking, Animated, PanResponder, FlatList,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { authAPI, driverAPI, friendsAPI } from '../services/api';
import { buildAvatarUrl } from '../services/api';
import socket from '../services/socket';
import { t } from '../i18n';
import {
  initializeNotifications,
  getExpoPushToken,
  startOrderAlarm,
  stopOrderAlarm,
} from '../services/notifications';
import { API_BASE } from '../config';

const CAR_ICON = require('../../assets/car-photo.png');
const FINISH_ICON = require('../../assets/icons8-finish-96.png');

// Обрезаем маршрут в ближайшей к пункту назначения точке (последний подход).
function clipRouteAtDestination(coords, dest) {
  if (!coords || coords.length < 2 || !dest) return coords;
  const d = (p) => (p.latitude - dest.latitude) ** 2 + (p.longitude - dest.longitude) ** 2;
  let minDist = Infinity;
  let clipIdx = coords.length - 1;
  for (let i = 0; i < coords.length; i++) {
    const dist = d(coords[i]);
    if (dist < minDist) { minDist = dist; clipIdx = i; }
  }
  const clipped = coords.slice(0, clipIdx + 1);
  return clipped.length >= 2 ? clipped : coords;
}

// Извлекаем полную геометрию маршрута (overview=full).
function extractRouteCoords(json, dest) {
  if (!json.routes?.[0]) return null;
  const route = json.routes[0];
  const distanceKm = route.distance / 1000;

  // overview geometry — single smooth polyline (overview=full)
  const overviewGeo = route.geometry;
  if (overviewGeo?.coordinates?.length >= 2) {
    const coords = overviewGeo.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
    return { coords: clipRouteAtDestination(coords, dest), distanceKm };
  }

  // Fallback: stitch step-level geometries
  const coords = [];
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      for (const [lng, lat] of step.geometry?.coordinates || []) {
        if (coords.length === 0 ||
            lat !== coords[coords.length - 1].latitude ||
            lng !== coords[coords.length - 1].longitude) {
          coords.push({ latitude: lat, longitude: lng });
        }
      }
    }
  }
  if (coords.length < 2) return null;
  return { coords: clipRouteAtDestination(coords, dest), distanceKm };
}

// Маршрут по реальным дорогам (OSRM)
// Возвращает { coords, distanceKm }
async function fetchRoadRoute(pickup, dest) {
  const lng1 = pickup.longitude, lat1 = pickup.latitude;
  const lng2 = dest.longitude,   lat2 = dest.latitude;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const url = `${API_BASE}/route?pickup_lat=${lat1}&pickup_lng=${lng1}&dest_lat=${lat2}&dest_lng=${lng2}`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const result = extractRouteCoords(await res.json(), dest);
      if (result) return result;
    }
  } catch { clearTimeout(timer); }

  // Fallback: публичный OSRM
  const c2 = new AbortController();
  const t2 = setTimeout(() => c2.abort(), 6000);
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson&steps=true&continue_straight=true`;
    const res = await fetch(url, { signal: c2.signal });
    clearTimeout(t2);
    const result = extractRouteCoords(await res.json(), dest);
    if (result) return result;
  } catch { clearTimeout(t2); }

  return { coords: [pickup, dest], distanceKm: 0 };
}

const DRIVER_STATUS = {
  OFFLINE: 'offline',
  AVAILABLE: 'available',
  INCOMING: 'incoming',       // New order notification
  ACCEPTED: 'accepted',       // Going to pickup (blue route)
  ARRIVED: 'arrived',         // At pickup, waiting (orange)
  IN_PROGRESS: 'in_progress', // Passenger aboard (green route)
};

// Location accuracy & interval per driver state
const LOCATION_CFG = {
  idle:   { accuracy: Location.Accuracy.Balanced, timeInterval: 5000,  distanceInterval: 0 },
  active: { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 20,  distanceInterval: 0 },
};

const ROUTE_COLORS = {
  accepted:    '#2196F3',   // Blue: going to pickup
  arrived:     '#FF9800',   // Orange: waiting at pickup
  in_progress: '#4CAF50',   // Green: trip underway
};

function distanceMeters(a, b) {
  if (!a || !b) return 0;
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export default function HomeScreen() {
  const { colors, lang } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  const mapRef = useRef(null);
  const locationSubscriptionRef = useRef(null);
  const compassSubscriptionRef = useRef(null);
  const locationBroadcastTimerRef = useRef(null);
  const displayTimerRef = useRef(null);           // 10ms display refresh, decoupled from sensors
  const lastBroadcastDataRef = useRef({ lat: null, lng: null, heading: 0 });
  const locationRef = useRef(null);               // raw GPS coords — updated at sensor speed (no re-render)
  const headingRef = useRef(0);                   // raw heading — updated at sensor speed (no re-render)
  const prevCameraRef = useRef({ lat: null, lng: null, heading: -1 }); // last camera pos to skip redundant calls
  const driverStatusRef = useRef(DRIVER_STATUS.OFFLINE);
  const navModeRef = useRef(false);               // nav mode on/off, used inside GPS callback (no stale closure)
  const [driverStatus, setDriverStatus] = useState(DRIVER_STATUS.OFFLINE);
  const [location, setLocation] = useState(null);
  const [region, setRegion] = useState({
    latitude: 41.2995, longitude: 69.2401,
    latitudeDelta: 0.03, longitudeDelta: 0.03,
  });

  // Navigation mode: map rotates, car icon stays fixed pointing up on screen
  const [navMode, setNavMode] = useState(false);
  // Bottom panel height tracked for proper Find Me button positioning
  const [driverPanelHeight, setDriverPanelHeight] = useState(130);

  // Active order state
  const [activeOrder, setActiveOrder] = useState(null);
  // heading: compass/GPS direction in degrees (0 = north, clockwise)
  const [heading, setHeading] = useState(0);
  // passengerLiveLocation: real-time GPS received from socket (null = sharing off / pre-accept)
  // Falls back to order.pickup_lat/lng for routing when null
  const [passengerLiveLocation, setPassengerLiveLocation] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const routeTargetRef = useRef(null); // last fetched target to avoid redundant OSRM calls
  const routeOriginRef = useRef(null); // last route start point used for OSRM
  const lastRouteFetchAtRef = useRef(0);

  // Wait timer (free 2 min, then 500 sum/min)
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [waitTimerActive, setWaitTimerActive] = useState(false);
  const waitIntervalRef = useRef(null);
  const waitFeeAnim = useRef(new Animated.Value(0)).current;

  // Swipe-to-accept/decline refs
  const swipeX = useRef(new Animated.Value(0)).current;
  const acceptFnRef = useRef(null);
  const declineFnRef = useRef(null);
  const swipePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, { dx }) => {
        swipeX.setValue(Math.max(-140, Math.min(140, dx)));
      },
      onPanResponderRelease: (_, { dx }) => {
        if (dx > 85) {
          Animated.timing(swipeX, { toValue: 160, duration: 180, useNativeDriver: false }).start(() => {
            swipeX.setValue(0);
            acceptFnRef.current?.();
          });
        } else if (dx < -85) {
          Animated.timing(swipeX, { toValue: -160, duration: 180, useNativeDriver: false }).start(() => {
            swipeX.setValue(0);
            declineFnRef.current?.();
          });
        } else {
          Animated.spring(swipeX, { toValue: 0, useNativeDriver: false }).start();
        }
      },
    })
  ).current;

  // Incoming order modal
  const [incomingOrder, setIncomingOrder] = useState(null);
  const [acceptCountdown, setAcceptCountdown] = useState(10);
  const countdownRef = useRef(null);

  // Trip completion bottom-sheet popup
  const [completionModal, setCompletionModal] = useState(null);
  // Prevents double-tap on async action buttons
  const [isProcessing, setIsProcessing] = useState(false);

  // Transfer order to friend
  const [showTransferPicker, setShowTransferPicker] = useState(false);
  const [transferFriends, setTransferFriends] = useState([]);
  const [transferring, setTransferring] = useState(false);

  // Queued (pending) orders
  const [queuedOrders, setQueuedOrders] = useState([]);
  const [showQueuedPanel, setShowQueuedPanel] = useState(false);

  // 100m metering: accumulate driven distance and calculate running price
  const [meteredKm, setMeteredKm] = useState(0);
  const meteredKmRef = useRef(0);
  const prevMeterPosRef = useRef(null);
  const meteredPricePerKm = useRef(0);
  const meteredSurge = useRef(1);

  useEffect(() => {
    driverStatusRef.current = driverStatus;
  }, [driverStatus]);

  useEffect(() => {
    navModeRef.current = navMode;
  }, [navMode]);

  // ── Mount: permissions, initial GPS, push token — then AUTO GO ONLINE ───────
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const c = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        locationRef.current = c;
        setLocation(c);
        setRegion((r) => ({ ...r, ...c }));
      }
      // Automatically go online as soon as the screen loads
      try {
        // Send initial location to server BEFORE going online
        // so the matching query can find this driver immediately
        if (locationRef.current) {
          await driverAPI.updateLocation(
            locationRef.current.latitude,
            locationRef.current.longitude,
            0,
          ).catch(() => {});
        }
        await driverAPI.updateAvailability(true);
        setDriverStatus(DRIVER_STATUS.AVAILABLE);
      } catch (err) {
        const msg = err?.response?.data?.error;
        if (msg && msg.includes('not approved')) {
          Alert.alert(
            t(lang, 'registrationPending') || 'Регистрация на рассмотрении',
            t(lang, 'waitForApproval') || 'Ваша регистрация ещё не подтверждена администратором. Пожалуйста, дождитесь одобрения.',
          );
        }
      }
    })();

    (async () => {
      try {
        const granted = await initializeNotifications();
        if (granted) {
          const token = await getExpoPushToken();
          if (token) authAPI.savePushToken(token).catch(() => {});
        }
      } catch {}
    })();

    return () => {
      stopOrderAlarm();
      locationSubscriptionRef.current?.remove?.();
      compassSubscriptionRef.current?.remove?.();
      clearInterval(locationBroadcastTimerRef.current);
      clearInterval(displayTimerRef.current);
      clearInterval(waitIntervalRef.current);
      clearInterval(countdownRef.current);
    };
  }, []);

  // ── Adaptive location + compass strategy ────────────────────────────────────
  //
  //  KEY DESIGN: sensors write only to REFS (no re-renders).
  //  A 50ms display timer reads refs → calls setState → React renders at ~20fps.
  //  This decouples 100x/sec sensor callbacks from the render cycle, eliminating
  //  the jitter / lag that occurred when setState was called on every callback.
  //
  //  OFFLINE     → no tracking
  //  AVAILABLE   → Balanced GPS, 5s/10m  (idle idle presence)
  //  ACCEPTED / ARRIVED / IN_PROGRESS
  //              → BestForNavigation GPS, 100ms/1m
  //              + independent compass IIFE (not nested, starts immediately)
  //              + 10ms WS broadcast interval (reads refs, zero re-renders)
  useEffect(() => {
    // ── Synchronous cleanup ───────────────────────────────────────────────────
    locationSubscriptionRef.current?.remove?.();
    locationSubscriptionRef.current = null;
    compassSubscriptionRef.current?.remove?.();
    compassSubscriptionRef.current = null;
    clearInterval(locationBroadcastTimerRef.current);
    clearInterval(displayTimerRef.current);
    locationBroadcastTimerRef.current = null;
    displayTimerRef.current = null;

    if (driverStatus === DRIVER_STATUS.OFFLINE) return;

    const isActiveOrder = [
      DRIVER_STATUS.ACCEPTED, DRIVER_STATUS.ARRIVED, DRIVER_STATUS.IN_PROGRESS,
    ].includes(driverStatus);
    const cfg = isActiveOrder ? LOCATION_CFG.active : LOCATION_CFG.idle;
    let dead = false; // shared flag for all async branches

    // ── 1. 10ms WS broadcast — reads refs, zero React re-renders ─────────────
    if (isActiveOrder) {
      locationBroadcastTimerRef.current = setInterval(() => {
        const { lat, lng, heading: h } = lastBroadcastDataRef.current;
        if (lat !== null && driverStatusRef.current !== DRIVER_STATUS.OFFLINE) {
          socket.send({ type: 'location_update', lat, lng, heading: h });
        }
      }, 10);
    }

    // ── 2. 10ms display timer — syncs refs → React state + SINGLE camera update ──
    // All animateCamera calls go through here to prevent competing animations (flicker).
    displayTimerRef.current = setInterval(() => {
      const loc = locationRef.current;
      const h = headingRef.current;
      if (loc) {
        setLocation((prev) => {
          if (!prev) return { ...loc };
          // Exponential smoothing (alpha=0.15) — car slides smoothly to GPS target
          const ALPHA = 0.15;
          const lat = prev.latitude  + (loc.latitude  - prev.latitude)  * ALPHA;
          const lng = prev.longitude + (loc.longitude - prev.longitude) * ALPHA;
          if (Math.abs(lat - prev.latitude) < 1e-10 && Math.abs(lng - prev.longitude) < 1e-10) return prev;
          return { latitude: lat, longitude: lng };
        });

        // One authoritative camera call per tick — eliminates competing animation flicker.
        // Skip if position/heading haven't changed meaningfully.
        const prev = prevCameraRef.current;
        const latD = Math.abs(loc.latitude - (prev.lat ?? loc.latitude));
        const lngD = Math.abs(loc.longitude - (prev.lng ?? loc.longitude));
        const hdD  = Math.abs(h - prev.heading);
        if (latD > 1e-8 || lngD > 1e-8 || hdD > 0.3) {
          prevCameraRef.current = { lat: loc.latitude, lng: loc.longitude, heading: h };
          if (navModeRef.current) {
            // Nav mode: map rotates with heading, car icon appears pointing up
            mapRef.current?.animateCamera(
              { center: loc, heading: h, pitch: 0 },
              { duration: 150 },
            );
          } else {
            // North-up mode: map stays fixed, car icon rotates via rotation prop
            mapRef.current?.animateCamera(
              { center: loc, heading: 0, pitch: 0 },
              { duration: 150 },
            );
          }
        }
      }
      setHeading(h);
    }, 10);

    // ── 3. GPS subscription ─────────────────────────────────────────────────────
    (async () => {
      try {
      const gpsSub = await Location.watchPositionAsync(cfg, (loc) => {
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        // Write to ref — display timer picks it up, no re-render here
        locationRef.current = coords;
        lastBroadcastDataRef.current.lat = coords.latitude;
        lastBroadcastDataRef.current.lng = coords.longitude;

        // Camera is driven exclusively by the 10ms display timer to avoid competing animations.

        // GPS heading valid only while moving (speed > 0.5 m/s)
        const gpsH = loc.coords.heading;
        if (typeof gpsH === 'number' && gpsH >= 0 && (loc.coords.speed ?? 0) > 0.5) {
          headingRef.current = gpsH;
          lastBroadcastDataRef.current.heading = gpsH;
        }

        // 100m metering: accumulate distance during IN_PROGRESS
        if (driverStatusRef.current === DRIVER_STATUS.IN_PROGRESS) {
          if (prevMeterPosRef.current) {
            const R = 6371;
            const dLat2 = ((coords.latitude - prevMeterPosRef.current.latitude) * Math.PI) / 180;
            const dLon2 = ((coords.longitude - prevMeterPosRef.current.longitude) * Math.PI) / 180;
            const a2 = Math.sin(dLat2 / 2) ** 2 +
              Math.cos(prevMeterPosRef.current.latitude * Math.PI / 180) *
              Math.cos(coords.latitude * Math.PI / 180) *
              Math.sin(dLon2 / 2) ** 2;
            const segmentKm = R * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2));
            // Only accumulate if segment > 5m (filter GPS jitter)
            if (segmentKm > 0.005) {
              meteredKmRef.current += segmentKm;
              setMeteredKm(meteredKmRef.current);
              prevMeterPosRef.current = coords;
            }
          } else {
            prevMeterPosRef.current = coords;
          }
        }

        if (driverStatusRef.current !== DRIVER_STATUS.OFFLINE) {
          driverAPI.updateLocation(
            coords.latitude,
            coords.longitude,
            lastBroadcastDataRef.current.heading,
          ).catch(() => {});
        }
      });

      if (dead) gpsSub.remove();
      else locationSubscriptionRef.current = gpsSub;
      } catch {}
    })();

    // ── 4. Compass — active for ALL online states, not just active orders ───────────
    (async () => {
      try {
        const compassSub = await Location.watchHeadingAsync((data) => {
          const raw = data.trueHeading >= 0 ? data.trueHeading : data.magHeading;
          if (raw < 0) return;
          // Low-pass filter alpha=0.15: smooth response, kills sensor jitter
          const prev = headingRef.current;
          let diff = raw - prev;
          if (diff > 180) diff -= 360;
          if (diff < -180) diff += 360;
          const h = (prev + diff * 0.15 + 360) % 360;
          headingRef.current = h;
          lastBroadcastDataRef.current.heading = h;
          // Camera update is handled exclusively by the 10ms display timer.
          // DO NOT call animateCamera here — it would compete with the timer and cause flicker.
        });
        if (dead) compassSub.remove();
        else compassSubscriptionRef.current = compassSub;
      } catch {
        // Magnetometer unavailable — GPS heading used instead
      }
    })();

    return () => {
      dead = true;
      clearInterval(locationBroadcastTimerRef.current);
      clearInterval(displayTimerRef.current);
      locationBroadcastTimerRef.current = null;
      displayTimerRef.current = null;
      locationSubscriptionRef.current?.remove?.();
      locationSubscriptionRef.current = null;
      compassSubscriptionRef.current?.remove?.();
      compassSubscriptionRef.current = null;
    };
  }, [driverStatus]);

  useEffect(() => {
    socket.on('new_order', (data) => {
      setIncomingOrder(data.order);
      // Allow incoming orders even during active trips — they'll be queued on accept
      if (driverStatusRef.current !== DRIVER_STATUS.ACCEPTED &&
          driverStatusRef.current !== DRIVER_STATUS.ARRIVED &&
          driverStatusRef.current !== DRIVER_STATUS.IN_PROGRESS) {
        setDriverStatus(DRIVER_STATUS.INCOMING);
      }
      startCountdown(data.order);
      startOrderAlarm(data.order);
      // Pre-load friends list for possible transfer
      friendsAPI.getFriends().then(({ data: d }) => setTransferFriends(d.friends || [])).catch(() => {});
    });
    socket.on('order_cancelled', () => {
      Alert.alert(t(lang,'orderCancelled'), t(lang,'orderCancelledByPassenger'));
      // Only reset if no active order running
      if (driverStatusRef.current === DRIVER_STATUS.INCOMING) {
        resetToAvailable();
      }
    });
    socket.on('order_transferred', () => {
      // Our transfer succeeded — dismiss incoming order modal
      clearInterval(countdownRef.current);
      stopOrderAlarm();
      setIncomingOrder(null);
      setShowTransferPicker(false);
      if (driverStatusRef.current === DRIVER_STATUS.INCOMING) {
        resetToAvailable();
      }
    });
    socket.on('queued_order_activated', (data) => {
      // A queued order is now active (previous trip completed server-side)
      // Set it as the active order
      setQueuedOrders(prev => prev.filter(o => o.id !== data.order_id));
      setActiveOrder(data.order);
      setPassengerLiveLocation(null);
      setDriverStatus(DRIVER_STATUS.ACCEPTED);
      meteredKmRef.current = 0;
      setMeteredKm(0);
      prevMeterPosRef.current = null;
      if (data.order?.pickup_lat && data.order?.order_type !== 'call') {
        mapRef.current?.animateToRegion({
          latitude: data.order.pickup_lat,
          longitude: data.order.pickup_lng,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        });
      }
    });
    socket.on('passenger_location', (data) => {
      setPassengerLiveLocation({ latitude: data.lat, longitude: data.lng });
    });
    socket.on('passenger_location_hidden', () => {
      // Driver fallback: clear live pin; route will snap back to static pickup coords
      setPassengerLiveLocation(null);
    });
    socket.on('destination_reached', (data) => {
      // Server detected driver is within 100m of destination — prompt to complete
      if (driverStatusRef.current === DRIVER_STATUS.IN_PROGRESS) {
        Alert.alert(
          'Вы прибыли',
          'Вы находитесь вблизи места назначения. Завершить поездку?',
          [
            { text: 'Ещё нет', style: 'cancel' },
            { text: 'Завершить', onPress: () => handleCompleteTrip() },
          ],
        );
      }
    });

    return () => {
      socket.off('new_order');
      socket.off('order_cancelled');
      socket.off('order_transferred');
      socket.off('queued_order_activated');
      socket.off('passenger_location');
      socket.off('passenger_location_hidden');
      socket.off('destination_reached');
    };
  }, [activeOrder, lang]);

  useEffect(() => {
    if (!location || !activeOrder) return;

    // Call orders: no route to pickup (driver finds passenger by phone/address info)
    if (activeOrder.order_type === 'call' && driverStatus !== DRIVER_STATUS.IN_PROGRESS) {
      setRouteCoords([]);
      return;
    }

    let dest;
    if (driverStatus === DRIVER_STATUS.IN_PROGRESS) {
      // Free mode / call orders have no destination — skip routing
      if (activeOrder.trip_type === 'free' || activeOrder.order_type === 'call') {
        setRouteCoords([]);
        return;
      }
      dest = { latitude: activeOrder.destination_lat, longitude: activeOrder.destination_lng };
    } else if (driverStatus === DRIVER_STATUS.ACCEPTED || driverStatus === DRIVER_STATUS.ARRIVED) {
      dest = passengerLiveLocation || {
        latitude: activeOrder.pickup_lat,
        longitude: activeOrder.pickup_lng,
      };
    } else {
      return;
    }

    const now = Date.now();
    const prevTarget = routeTargetRef.current;
    const prevOrigin = routeOriginRef.current;
    const targetMoved = distanceMeters(dest, prevTarget) >= 30;
    const originMoved = distanceMeters(location, prevOrigin) >= 20;

    // Rebuild route not only when destination changes, but also when driver deviates from old path.
    if (prevTarget && prevOrigin && !targetMoved && !originMoved) return;
    if (now-lastRouteFetchAtRef.current < 2500) return;

    routeTargetRef.current = dest;
    routeOriginRef.current = location;
    lastRouteFetchAtRef.current = now;

    // Fetch road route; fall back to straight line if offline/slow
    fetchRoadRoute(location, dest).then(({ coords }) => {
      setRouteCoords(coords);
    }).catch(() => {
      setRouteCoords([location, dest]);
    });
  }, [activeOrder, driverStatus, location, passengerLiveLocation]);

  function startCountdown(order) {
    setAcceptCountdown(20);
    clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setAcceptCountdown((n) => {
        if (n <= 1) {
          clearInterval(countdownRef.current);
          stopOrderAlarm();
          setIncomingOrder(null);
          // Don't reset if we have an active order
          if (!activeOrder) {
            resetToAvailable();
          }
          return 0;
        }
        return n - 1;
      });
    }, 1000);
  }

  async function toggleOnline(val) {
    await driverAPI.updateAvailability(val);
    setDriverStatus(val ? DRIVER_STATUS.AVAILABLE : DRIVER_STATUS.OFFLINE);
  }

  function goToMyLocation() {
    const loc = locationRef.current;
    if (loc) {
      mapRef.current?.animateCamera({ center: loc, zoom: 17 }, { duration: 500 });
    }
  }

  async function handleAcceptOrder() {
    if (!incomingOrder || isProcessing) return;
    stopOrderAlarm();
    Vibration.vibrate(60);
    setIsProcessing(true);
    clearInterval(countdownRef.current);

    const hadActiveOrder = activeOrder != null;

    try {
      const { data } = await driverAPI.acceptOrder(incomingOrder.id);
      const isQueued = data.queued || hadActiveOrder;

      if (isQueued) {
        // Order accepted as queued — add to pending list, don't change active order
        setQueuedOrders(prev => [...prev, {
          ...incomingOrder,
          id: incomingOrder.id,
        }]);
        setIncomingOrder(null);
        // Restore driver status to what it was before the incoming order
        if (hadActiveOrder) {
          // Don't change status, keep the active trip state
        }
      } else {
        // For free-mode or call orders, wipe destination coords so no marker/route is ever drawn
        const orderToStore = (incomingOrder.trip_type === 'free' || incomingOrder.order_type === 'call')
          ? { ...incomingOrder, destination_lat: null, destination_lng: null, destination_address: '' }
          : incomingOrder;
        setActiveOrder(orderToStore);
        setIncomingOrder(null);
        setPassengerLiveLocation(null);
        setDriverStatus(DRIVER_STATUS.ACCEPTED);
        meteredPricePerKm.current = incomingOrder.locked_price_per_km || 3000;
        meteredSurge.current = incomingOrder.surge_multiplier || 1;
        if (incomingOrder.order_type !== 'call') {
          mapRef.current?.animateToRegion({
            latitude: incomingOrder.pickup_lat,
            longitude: incomingOrder.pickup_lng,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          });
        }
        if (incomingOrder.order_type === 'call') {
          setRouteCoords([]);
        }
      }
    } catch (e) {
      Alert.alert(t(lang,'error'), t(lang,'orderBusy'));
      setIncomingOrder(null);
      if (!hadActiveOrder) {
        resetToAvailable();
      }
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleDeclineOrder() {
    stopOrderAlarm();
    clearInterval(countdownRef.current);
    setIncomingOrder(null);
    // Only reset to available if there's no active order running
    if (!activeOrder) {
      resetToAvailable();
    }
  }

  async function handleTransferToFriend(friendDriverID) {
    if (!incomingOrder || transferring) return;
    setTransferring(true);
    try {
      await friendsAPI.transferOrder(incomingOrder.id, friendDriverID);
      // order_transferred WS event will clear the modal; handle optimistically too
      clearInterval(countdownRef.current);
      stopOrderAlarm();
      setIncomingOrder(null);
      setShowTransferPicker(false);
      resetToAvailable();
    } catch (e) {
      Alert.alert(t(lang, 'error'), e?.response?.data?.error || 'Ошибка');
    } finally {
      setTransferring(false);
    }
  }

  async function handleArrived() {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await driverAPI.arrivedAtPickup(activeOrder.id);
      setDriverStatus(DRIVER_STATUS.ARRIVED);
      startWaitTimer();
    } catch (e) {
      Alert.alert(t(lang,'error'), e.message);
    } finally {
      setIsProcessing(false);
    }
  }

  function startWaitTimer() {
    setWaitSeconds(0);
    setWaitTimerActive(true);
    clearInterval(waitIntervalRef.current);
    waitIntervalRef.current = setInterval(() => {
      setWaitSeconds((s) => s + 1);
    }, 1000);
  }

  function stopWaitTimer() {
    clearInterval(waitIntervalRef.current);
    setWaitTimerActive(false);
  }

  async function handleStartTrip() {
    if (isProcessing) return;
    setIsProcessing(true);
    stopWaitTimer();
    try {
      const { data } = await driverAPI.startTrip(activeOrder.id);
      setDriverStatus(DRIVER_STATUS.IN_PROGRESS);
      // Reset metering for the trip
      meteredKmRef.current = 0;
      setMeteredKm(0);
      prevMeterPosRef.current = null;
      if (location && activeOrder.trip_type !== 'free') {
        const dest = { latitude: activeOrder.destination_lat, longitude: activeOrder.destination_lng };
        routeTargetRef.current = null; // force re-fetch for new destination segment
        fetchRoadRoute(location, dest).then(({ coords }) => {
          setRouteCoords(coords);
        }).catch(() => {
          setRouteCoords([location, dest]);
        });
      } else {
        setRouteCoords([]);
      }
    } catch (e) {
      Alert.alert(t(lang,'error'), e.message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleCompleteTrip() {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      // Send metered distance to server before completing
      if (meteredKmRef.current > 0) {
        await driverAPI.updateOrderDistance(activeOrder.id, meteredKmRef.current).catch(() => {});
      }
      const { data } = await driverAPI.completeTrip(activeOrder.id);
      // Use server-calculated price directly (already rounded on backend)
      const finalPrice = data.total_price || 0;
      setRouteCoords([]);
      routeTargetRef.current = null;
      routeOriginRef.current = null;
      lastRouteFetchAtRef.current = 0;
      // Remove the completed order from queued if present
      setQueuedOrders(prev => prev.filter(o => o.id !== activeOrder.id));
      setCompletionModal({ price: finalPrice });
    } catch (e) {
      Alert.alert(t(lang,'error'), e.message);
    } finally {
      setIsProcessing(false);
    }
  }

  function resetToAvailable() {
    setActiveOrder(null);
    setPassengerLiveLocation(null);
    setRouteCoords([]);
    routeTargetRef.current = null;
    routeOriginRef.current = null;
    lastRouteFetchAtRef.current = 0;
    setDriverStatus(DRIVER_STATUS.AVAILABLE);
    stopWaitTimer();
    setWaitSeconds(0);
    meteredKmRef.current = 0;
    setMeteredKm(0);
    prevMeterPosRef.current = null;
    meteredPricePerKm.current = 0;
    meteredSurge.current = 1;
    setQueuedOrders([]);
  }

  // Wait fee calculation
  const freeSeconds = 2 * 60;
  const billableSeconds = Math.max(0, waitSeconds - freeSeconds);
  const waitFee = Math.floor((billableSeconds / 60) * 500);
  const waitMin = Math.floor(waitSeconds / 60);
  const waitSec = waitSeconds % 60;

  const routeColor = ROUTE_COLORS[driverStatus] || '#2196F3';
  const isOnline = driverStatus !== DRIVER_STATUS.OFFLINE;

  // Keep swipe refs pointing to latest handlers (PanResponder is created once)
  acceptFnRef.current = handleAcceptOrder;
  declineFnRef.current = handleDeclineOrder;

  const s = makeStyles(colors);

  return (
    <View style={s.container}>
      <MapView
        ref={mapRef}
        style={s.map}
        provider={PROVIDER_GOOGLE}
        region={region}
        showsUserLocation={false}
        showsMyLocationButton={false}
      >
        {/* Driver's own car icon:
             Nav mode ON  → flat=true, rotation=heading: map rotates (animateCamera heading)
                            so heading direction is at top of screen → icon appears pointing UP
             Nav mode OFF → flat=true, rotation=heading: map stays north-up, icon rotates
                            on map surface to show direction of travel */}
        {location && (
          <Marker
            coordinate={location}
            anchor={{ x: 0.5, y: 0.5 }}
            flat={true}
            rotation={heading % 360}
          >
            <Image source={CAR_ICON} style={s.carIcon} resizeMode="contain" />
          </Marker>
        )}
        {activeOrder && driverStatus !== DRIVER_STATUS.IN_PROGRESS && activeOrder.order_type !== 'call' && (
          <Marker
            coordinate={{ latitude: activeOrder.pickup_lat, longitude: activeOrder.pickup_lng }}
            title="Точка подачи"
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={s.pickupMarker}><Text style={s.markerText}>A</Text></View>
          </Marker>
        )}
        {/* Live passenger marker — only when passenger is actively sharing GPS */}
        {passengerLiveLocation && driverStatus !== DRIVER_STATUS.IN_PROGRESS && (
          <Marker
            coordinate={passengerLiveLocation}
            title="Пассажир (live)"
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={s.livePassengerOuter}>
              <View style={s.livePassengerInner}>
                <Text style={{ fontSize: 20 }}>🧍</Text>
              </View>
            </View>
          </Marker>
        )}
        {activeOrder && activeOrder.trip_type !== 'free' && activeOrder.destination_lat && activeOrder.destination_lng && (
          <Marker
            coordinate={{ latitude: activeOrder.destination_lat, longitude: activeOrder.destination_lng }}
            title="Цель"
            anchor={{ x: 0.5, y: 1 }}>
            <Image source={FINISH_ICON} style={{ width: 40, height: 40 }} resizeMode="contain" />
          </Marker>
        )}
        {routeCoords.length >= 2 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={routeColor}
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
        )}
        {/* Пунктир: позиция водителя → начало дороги (первая миля, GPS drift) */}
        {routeCoords.length >= 2 && location && (() => {
          const firstPt = routeCoords[0];
          const dist = Math.abs(firstPt.latitude - location.latitude) +
                       Math.abs(firstPt.longitude - location.longitude);
          if (dist < 0.00005) return null;
          return (
            <Polyline
              coordinates={[location, firstPt]}
              strokeColor={routeColor}
              strokeWidth={4}
              lineDashPattern={[10, 8]}
              geodesic
              lineCap="round"
              lineJoin="round"
            />
          );
        })()}
        {/* Пунктир: конец дороги → точка назначения (последняя миля) */}
        {routeCoords.length >= 2 && activeOrder && activeOrder.trip_type !== 'free' &&
         activeOrder.destination_lat && activeOrder.destination_lng &&
         driverStatus === DRIVER_STATUS.IN_PROGRESS && (() => {
          const dest = { latitude: activeOrder.destination_lat, longitude: activeOrder.destination_lng };
          const lastPt = routeCoords[routeCoords.length - 1];
          const dist = Math.abs(lastPt.latitude - dest.latitude) +
                       Math.abs(lastPt.longitude - dest.longitude);
          if (dist < 0.00005) return null;
          return (
            <Polyline
              coordinates={[lastPt, dest]}
              strokeColor={routeColor}
              strokeWidth={4}
              lineDashPattern={[10, 8]}
              geodesic
              lineCap="round"
              lineJoin="round"
            />
          );
        })()}
      </MapView>

      {/* Find Me button — floats above bottom panel, right side */}
      {isOnline && (
        <TouchableOpacity
          style={[s.findMeBtn, { bottom: driverPanelHeight + 12 }]}
          onPress={goToMyLocation}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 22 }}>📌</Text>
        </TouchableOpacity>
      )}

      {/* Navigation mode toggle — above Find Me button */}
      {isOnline && (
        <TouchableOpacity
          style={[s.navModeBtn, {
            backgroundColor: navMode ? '#FFCC00' : '#1F2937',
            bottom: driverPanelHeight + 64,
          }]}
          onPress={() => {
            const next = !navMode;
            setNavMode(next);
            prevCameraRef.current = { lat: null, lng: null, heading: -1 }; // force camera update on mode switch
            if (!next && location) {
              // Switching back to free mode: reset map bearing to north
              mapRef.current?.animateCamera({ center: location, heading: 0, pitch: 0 }, { duration: 400 });
            }
          }}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 20 }}>🧭</Text>
        </TouchableOpacity>
      )}

      {/* Bottom action panel */}
      <View
        style={s.bottomPanel}
        onLayout={(e) => setDriverPanelHeight(e.nativeEvent.layout.height)}
      >
        <View style={s.handleWrap}>
          <View style={s.handle} />
        </View>

        {/* ── OFFLINE ─────────────────────────────────────── */}
        {driverStatus === DRIVER_STATUS.OFFLINE && (
          <View style={s.panelSection}>
            <View style={s.statusRow}>
              <View style={[s.statusDot, { backgroundColor: '#888' }]} />
              <Text style={s.statusTitle}>{t(lang,'youOffline')}</Text>
            </View>
            <Text style={s.statusSub}>{t(lang,'enableOnline')}</Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => toggleOnline(true)}>
              <Text style={s.primaryBtnText}>{t(lang,'goOnline')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── AVAILABLE ────────────────────────────────────── */}
        {driverStatus === DRIVER_STATUS.AVAILABLE && (
          <View style={s.panelSection}>
            <View style={s.statusRow}>
              <View style={[s.statusDot, { backgroundColor: '#22C55E' }]} />
              <Text style={s.statusTitle}>{t(lang,'youOnline')}</Text>
            </View>
            <Text style={s.statusSub}>{t(lang,'searchingClients')}{'\n'}{t(lang,'keepAppOpen')}</Text>
            <TouchableOpacity style={s.offlineBtn} onPress={() => toggleOnline(false)}>
              <Text style={s.offlineBtnText}>{t(lang,'goOffline')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── ACCEPTED ─────────────────────────────────────── */}
        {driverStatus === DRIVER_STATUS.ACCEPTED && activeOrder && (
          <View style={s.panelSection}>
            <View style={s.panelHeaderRow}>
              <Text style={s.panelHeaderIcon}>🚗</Text>
              <Text style={s.panelHeaderTitle}>{t(lang,'goingToPassenger')}</Text>
            </View>

            {/* Passenger card */}
            <View style={s.passengerCard}>
              <View style={s.avatarCircle}>
                <Text style={s.avatarText}>
                  {(activeOrder.passenger_name || activeOrder.passenger_phone || '?')[0].toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.passengerName} numberOfLines={1}>
                  {activeOrder.passenger_name || t(lang,'passenger')}
                </Text>
                <Text style={s.passengerPhone}>{activeOrder.passenger_phone || ''}</Text>
              </View>
            </View>

            {/* Addresses */}
            <View style={s.addrRow}>
              <View style={[s.addrBadge, { backgroundColor: '#22C55E' }]}><Text style={s.addrBadgeText}>A</Text></View>
              <Text style={s.addrText} numberOfLines={2}>
                {activeOrder.pickup_address || `${activeOrder.pickup_lat?.toFixed(4)}, ${activeOrder.pickup_lng?.toFixed(4)}`}
              </Text>
            </View>
            {activeOrder.additional_info ? (
              <View style={s.addrRow}>
                <View style={[s.addrBadge, { backgroundColor: '#FF9800' }]}><Text style={s.addrBadgeText}>📌</Text></View>
                <Text style={[s.addrText, { fontStyle: 'italic' }]} numberOfLines={2}>{activeOrder.additional_info}</Text>
              </View>
            ) : null}
            {activeOrder.trip_type !== 'free' && activeOrder.destination_address ? (
              <View style={s.addrRow}>
                <View style={[s.addrBadge, { backgroundColor: '#EF4444' }]}><Text style={s.addrBadgeText}>B</Text></View>
                <Text style={s.addrText} numberOfLines={1}>{activeOrder.destination_address}</Text>
              </View>
            ) : null}

            <View style={s.twoButtonRow}>
              <TouchableOpacity
                style={s.outlineBtn}
                onPress={() => activeOrder.passenger_phone && Linking.openURL(`tel:${activeOrder.passenger_phone}`)}
              >
                <Text style={s.outlineBtnText}>📞  {t(lang,'callBtn')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.primaryBtn, { flex: 1, marginTop: 0, opacity: isProcessing ? 0.6 : 1 }]}
                onPress={handleArrived}
                disabled={isProcessing}
              >
                <Text style={s.primaryBtnText}>{t(lang,'arrivedAtPickup')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── ARRIVED ──────────────────────────────────────── */}
        {driverStatus === DRIVER_STATUS.ARRIVED && (
          <View style={s.panelSection}>
            <View style={s.waitingHeader}>
              <Text style={s.waitingHeaderText}>{t(lang,'waitingClient')}</Text>
            </View>
            <View style={s.timerBigRow}>
              <Text style={[s.timerBig, { color: waitSeconds < freeSeconds ? '#22C55E' : '#EF4444' }]}>
                {String(waitMin).padStart(2, '0')}:{String(waitSec).padStart(2, '0')}
              </Text>
              <Text style={s.timerStatus}>
                {waitSeconds < freeSeconds
                  ? `${t(lang,'freeWaitLabel')} • ${t(lang,'remaining')} ${String(Math.floor((freeSeconds - waitSeconds) / 60)).padStart(2,'0')}:${String((freeSeconds - waitSeconds) % 60).padStart(2,'0')}`
                  : `+${waitFee.toLocaleString()} ${t(lang,'sum')}`}
              </Text>
            </View>

            <View style={s.iconBtnRow}>
              <TouchableOpacity
                style={s.iconBtn}
                onPress={() => activeOrder?.passenger_phone && Linking.openURL(`tel:${activeOrder.passenger_phone}`)}
              >
                <Text style={s.iconBtnEmoji}>📞</Text>
                <Text style={s.iconBtnLabel}>{t(lang,'callBtn')}</Text>
              </TouchableOpacity>
              <View style={s.iconBtnDivider} />
              <TouchableOpacity style={s.iconBtn}>
                <Text style={s.iconBtnEmoji}>💬</Text>
                <Text style={s.iconBtnLabel}>{t(lang,'chat')}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[s.primaryBtn, { opacity: isProcessing ? 0.6 : 1 }]}
              onPress={handleStartTrip}
              disabled={isProcessing}
            >
              <Text style={s.primaryBtnText}>{t(lang,'startTrip')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── IN PROGRESS ──────────────────────────────────── */}
        {driverStatus === DRIVER_STATUS.IN_PROGRESS && activeOrder && (
          <View style={s.panelSection}>
            <View style={s.panelHeaderRow}>
              <Text style={s.panelHeaderIcon}>🛣</Text>
              <Text style={s.panelHeaderTitle}>{t(lang,'inTrip')}</Text>
            </View>

            <View style={s.tripInfoRow}>
              <Text style={s.tripPrice}>
                {(activeOrder.trip_type === 'free' || activeOrder.order_type === 'call'
                  ? (() => {
                      const sf = activeOrder.service_fee || 2000;
                      const rate = meteredPricePerKm.current || 3000;
                      const surge = meteredSurge.current || 1;
                      const m = meteredKm * 1000;
                      const rKm = m < 1 ? 0 : (Math.ceil(m / 100) * 100) / 1000;
                      return Math.ceil((sf + rKm * rate * surge) / 100) * 100;
                    })()
                  : activeOrder.estimated_price || 0
                ).toLocaleString()} {t(lang,'sum')}
              </Text>
              <View style={s.tripDistBox}>
                <Text style={s.tripDistLabel}>{t(lang,'remaining')}:</Text>
                <Text style={s.tripDistValue}>
                  {(activeOrder.trip_type === 'free' || activeOrder.order_type === 'call'
                    ? meteredKm
                    : activeOrder.distance_km || 0
                  ).toFixed(1)} {t(lang,'km')}
                </Text>
                <Text style={s.tripDistLabel}>
                  ~{Math.max(1, Math.round((activeOrder.distance_km || meteredKm || 1) / 0.4))} {t(lang,'min')}
                </Text>
              </View>
            </View>

            {activeOrder.destination_address ? (
              <View style={s.addrRow}>
                <View style={[s.addrBadge, { backgroundColor: '#EF4444' }]}><Text style={s.addrBadgeText}>B</Text></View>
                <Text style={s.addrText} numberOfLines={1}>{activeOrder.destination_address}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[s.completeBtn, { opacity: isProcessing ? 0.6 : 1 }]}
              onPress={handleCompleteTrip}
              disabled={isProcessing}
            >
              <Text style={s.primaryBtnText}>{t(lang,'completeTrip')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Queued orders badge — shown when driver has pending orders */}
      {queuedOrders.length > 0 && !incomingOrder && (
        <TouchableOpacity
          style={[s.queuedBadgeBtn, { bottom: driverPanelHeight + 12, left: 16 }]}
          onPress={() => setShowQueuedPanel(true)}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 14, color: '#000', fontWeight: '800' }}>
            📋 {queuedOrders.length} {t(lang, 'pendingOrders')}
          </Text>
        </TouchableOpacity>
      )}

      {/* Incoming order modal — slides up from bottom, map stays visible */}
      <Modal visible={!!incomingOrder} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.orderModal}>
            {/* Countdown circle */}
            <View style={s.timerCircle}>
              <Text style={s.timerCount}>{acceptCountdown}</Text>
            </View>

            {incomingOrder && (
              <>
                {/* Title row */}
                <Text style={s.newOrderTitle}>🚕 {t(lang,'newOrder')}</Text>

                {/* Price + distance */}
                {incomingOrder.trip_type !== 'free' && (
                  <View style={s.priceLine}>
                    <Text style={s.orderPriceLarge}>
                      {(incomingOrder.estimated_price || 0).toLocaleString()} {t(lang,'sum')}
                    </Text>
                    <Text style={s.orderDistBadge}>
                      {(incomingOrder.distance_km || 0).toFixed(1)} {t(lang,'km')}
                    </Text>
                  </View>
                )}

                {/* Phone row */}
                <TouchableOpacity
                  style={s.phoneRow}
                  onPress={() => incomingOrder.passenger_phone && Linking.openURL(`tel:${incomingOrder.passenger_phone}`)}
                >
                  <Text style={s.phoneRowEmoji}>📱</Text>
                  <Text style={s.phoneRowText}>{incomingOrder.passenger_phone || '—'}</Text>
                </TouchableOpacity>

                {/* Address A */}
                <View style={s.addrRow}>
                  <View style={[s.addrBadge, { backgroundColor: '#22C55E' }]}><Text style={s.addrBadgeText}>A</Text></View>
                  <Text style={s.addrTextModal} numberOfLines={2}>
                    {incomingOrder.pickup_address || t(lang, 'from')}
                  </Text>
                </View>

                {/* Additional info / landmark */}
                {incomingOrder.additional_info ? (
                  <View style={s.addrRow}>
                    <View style={[s.addrBadge, { backgroundColor: '#FF9800' }]}><Text style={s.addrBadgeText}>📌</Text></View>
                    <Text style={[s.addrTextModal, { fontStyle: 'italic' }]} numberOfLines={2}>
                      {incomingOrder.additional_info}
                    </Text>
                  </View>
                ) : null}

                {/* Address B */}
                {incomingOrder.trip_type !== 'free' && incomingOrder.destination_address ? (
                  <View style={s.addrRow}>
                    <View style={[s.addrBadge, { backgroundColor: '#EF4444' }]}><Text style={s.addrBadgeText}>B</Text></View>
                    <Text style={s.addrTextModal} numberOfLines={2}>{incomingOrder.destination_address}</Text>
                  </View>
                ) : incomingOrder.trip_type === 'free' ? (
                  <View style={s.addrRow}>
                    <View style={[s.addrBadge, { backgroundColor: '#6B7280' }]}><Text style={s.addrBadgeText}>B</Text></View>
                    <Text style={s.addrTextModal}>{t(lang,'byMeter')}</Text>
                  </View>
                ) : null}

                {/* Call badge */}
                {incomingOrder.order_type === 'call' && (
                  <View style={s.callBadge}><Text style={s.callBadgeText}>📞 {t(lang,'callOrder')}</Text></View>
                )}

                {/* Transfer to friend button (only shown if driver has friends) */}
                {transferFriends.length > 0 && (
                  <TouchableOpacity
                    style={s.transferBtn}
                    onPress={() => setShowTransferPicker(true)}
                  >
                    <Text style={s.transferBtnText}>👥 {t(lang, 'transferOrder')}</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {/* ── Swipe to accept / decline ── */}
            <View style={s.swipeWrap}>
              <Animated.View
                style={[s.swipeTrack, {
                  backgroundColor: swipeX.interpolate({
                    inputRange: [-140, 0, 140],
                    outputRange: ['rgba(239,68,68,0.25)', 'rgba(55,65,81,0.6)', 'rgba(34,197,94,0.25)'],
                  }),
                }]}
              >
                <Text style={s.swipeLabelLeft}>✕  {t(lang,'decline')}</Text>
                <Animated.View
                  style={[s.swipeKnob, { transform: [{ translateX: swipeX }] }]}
                  {...swipePan.panHandlers}
                >
                  <Text style={{ fontSize: 22 }}>⇌</Text>
                </Animated.View>
                <Text style={s.swipeLabelRight}>{t(lang,'accept')}  ✓</Text>
              </Animated.View>
              <Text style={s.swipeSubLabel}>{t(lang,'swipeHint')}</Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* Friend picker modal for order transfer */}
      <Modal visible={showTransferPicker} transparent animationType="slide" onRequestClose={() => setShowTransferPicker(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.orderModal, { paddingBottom: 24 }]}>
            <Text style={s.newOrderTitle}>👥 {t(lang, 'selectFriend')}</Text>
            {transferFriends.length === 0 ? (
              <Text style={{ color: '#9CA3AF', textAlign: 'center', marginVertical: 16 }}>{t(lang, 'noFriends')}</Text>
            ) : (
              transferFriends.map((f) => (
                <TouchableOpacity
                  key={f.friendship_id}
                  style={[s.transferFriendRow, { opacity: transferring ? 0.5 : 1 }]}
                  disabled={transferring}
                  onPress={() => handleTransferToFriend(f.driver_id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{f.first_name} {f.last_name}</Text>
                    <Text style={{ color: '#9CA3AF', fontSize: 13 }}>{f.phone} · 🚗 {f.car_number}</Text>
                  </View>
                  {transferring
                    ? <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#FFCC00' }} />
                    : <Text style={{ color: '#FFCC00', fontSize: 18 }}>→</Text>}
                </TouchableOpacity>
              ))
            )}
            <TouchableOpacity
              style={{ marginTop: 12, alignItems: 'center', padding: 10 }}
              onPress={() => setShowTransferPicker(false)}
            >
              <Text style={{ color: '#9CA3AF', fontSize: 14 }}>{t(lang, 'cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Queued orders modal */}
      <Modal visible={showQueuedPanel} transparent animationType="slide" onRequestClose={() => setShowQueuedPanel(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.orderModal, { paddingBottom: 24, maxHeight: '70%' }]}>
            <Text style={s.newOrderTitle}>📋 {t(lang, 'pendingOrders')}</Text>
            {queuedOrders.length === 0 ? (
              <Text style={{ color: '#9CA3AF', textAlign: 'center', marginVertical: 16 }}>{t(lang, 'noPendingOrders')}</Text>
            ) : (
              <FlatList
                data={queuedOrders}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <View style={{ backgroundColor: '#1F2937', borderRadius: 14, padding: 14, marginBottom: 10 }}>
                    {/* Pickup address */}
                    <View style={s.addrRow}>
                      <View style={[s.addrBadge, { backgroundColor: '#22C55E' }]}><Text style={s.addrBadgeText}>A</Text></View>
                      <Text style={s.addrTextModal} numberOfLines={2}>
                        {item.pickup_address || `${item.pickup_lat?.toFixed(4)}, ${item.pickup_lng?.toFixed(4)}`}
                      </Text>
                    </View>
                    {/* Additional info */}
                    {item.additional_info ? (
                      <View style={s.addrRow}>
                        <View style={[s.addrBadge, { backgroundColor: '#FF9800' }]}><Text style={s.addrBadgeText}>📌</Text></View>
                        <Text style={[s.addrTextModal, { fontStyle: 'italic' }]} numberOfLines={2}>{item.additional_info}</Text>
                      </View>
                    ) : null}
                    {/* Destination */}
                    {item.trip_type !== 'free' && item.destination_address ? (
                      <View style={s.addrRow}>
                        <View style={[s.addrBadge, { backgroundColor: '#EF4444' }]}><Text style={s.addrBadgeText}>B</Text></View>
                        <Text style={s.addrTextModal} numberOfLines={2}>{item.destination_address}</Text>
                      </View>
                    ) : item.trip_type === 'free' ? (
                      <View style={s.addrRow}>
                        <View style={[s.addrBadge, { backgroundColor: '#6B7280' }]}><Text style={s.addrBadgeText}>B</Text></View>
                        <Text style={s.addrTextModal}>{t(lang,'byMeter')}</Text>
                      </View>
                    ) : null}
                    {/* Passenger info */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 }}>
                      <Text style={{ color: '#9CA3AF', fontSize: 13 }}>📱 {item.passenger_phone || '—'}</Text>
                      <Text style={{ color: '#9CA3AF', fontSize: 13 }}>👤 {item.passenger_name || ''}</Text>
                    </View>
                    {/* Price */}
                    {item.trip_type !== 'free' && item.estimated_price ? (
                      <Text style={{ color: '#FFCC00', fontSize: 16, fontWeight: '800', marginTop: 6 }}>
                        {(item.estimated_price || 0).toLocaleString()} {t(lang,'sum')}
                      </Text>
                    ) : null}
                  </View>
                )}
              />
            )}
            <TouchableOpacity
              style={{ marginTop: 8, alignItems: 'center', padding: 10 }}
              onPress={() => setShowQueuedPanel(false)}
            >
              <Text style={{ color: '#9CA3AF', fontSize: 14 }}>{t(lang, 'close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Trip completion — bottom sheet (no dark overlay, map stays visible) */}
      {!!completionModal && (
        <View style={s.bottomPanel}>
          <View style={s.handleWrap}>
            <View style={s.handle} />
          </View>
          <View style={s.panelSection}>
            <Text style={s.completionTrophy}>🏆</Text>
            <Text style={s.completionTitle}>{t(lang,'tripCompleted')}</Text>
            <Text style={s.completionPrice}>
              {t(lang,'total')}: {(completionModal?.price ?? 0).toLocaleString()} {t(lang,'sum')}
            </Text>
            <Text style={s.completionSub}>🎉 {t(lang,'greatWork')}</Text>
            <TouchableOpacity
              style={[s.primaryBtn, { marginTop: 16 }]}
              onPress={() => { setCompletionModal(null); resetToAvailable(); }}
            >
              <Text style={s.primaryBtnText}>{t(lang,'findNextOrder')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors) {
  const DARK = '#000000';
  const CARD = '#111827';
  const BORDER = '#1F2937';

  return StyleSheet.create({
    container: { flex: 1 },
    map: { flex: 1 },
    carIcon: { width: 24, height: 38 },

    // ── Floating map buttons ─────────────────────────────────────
    findMeBtn: {
      position: 'absolute', right: 16,
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: '#1F2937',
      justifyContent: 'center', alignItems: 'center',
      elevation: 6,
      shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6,
    },
    navModeBtn: {
      position: 'absolute', right: 16,
      width: 44, height: 44, borderRadius: 22,
      justifyContent: 'center', alignItems: 'center',
      elevation: 6,
      shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6,
    },

    // ── Top status bar ───────────────────────────────────────────
    statusBar: {
      position: 'absolute', top: 0, left: 0, right: 0,
      flexDirection: 'row', alignItems: 'center', padding: 16,
      borderRadius: 18, marginHorizontal: 12,
      backgroundColor: DARK,
      elevation: 4, shadowOpacity: 0.15, shadowRadius: 4,
    },
    statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
    statusText: { fontSize: 15, fontWeight: '600' },

    // ── Bottom panel shell ───────────────────────────────────────
    bottomPanel: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: DARK,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      paddingBottom: 32,
      elevation: 16,
      shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12,
    },
    handleWrap: { alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
    handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: BORDER },

    panelSection: { paddingHorizontal: 20, paddingBottom: 4, paddingTop: 8 },

    // ── Status (online/offline) ──────────────────────────────────
    statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    statusTitle: { fontSize: 18, fontWeight: '800', color: '#F9FAFB' },
    statusSub: { fontSize: 14, color: '#9CA3AF', marginBottom: 14, lineHeight: 20 },

    primaryBtn: {
      backgroundColor: '#FFCC00',
      borderRadius: 14, paddingVertical: 15,
      alignItems: 'center', marginTop: 8,
    },
    primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#111' },

    offlineBtn: {
      borderRadius: 14, paddingVertical: 14,
      alignItems: 'center', marginTop: 8,
      borderWidth: 1.5, borderColor: '#EF4444',
    },
    offlineBtnText: { fontSize: 16, fontWeight: '700', color: '#EF4444' },

    completeBtn: {
      backgroundColor: '#22C55E',
      borderRadius: 14, paddingVertical: 15,
      alignItems: 'center', marginTop: 8,
    },

    // ── ACCEPTED panel ───────────────────────────────────────────
    panelHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    panelHeaderIcon: { fontSize: 22, marginRight: 8 },
    panelHeaderTitle: { fontSize: 17, fontWeight: '800', color: '#F9FAFB' },

    passengerCard: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: CARD, borderRadius: 14, padding: 12, marginBottom: 12,
    },
    avatarCircle: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: '#FFCC00', justifyContent: 'center', alignItems: 'center', marginRight: 12,
    },
    avatarText: { fontSize: 18, fontWeight: '900', color: '#111' },
    passengerName: { fontSize: 15, fontWeight: '700', color: '#F9FAFB' },
    passengerPhone: { fontSize: 13, color: '#9CA3AF', marginTop: 2 },

    addrRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
    addrBadge: {
      width: 22, height: 22, borderRadius: 11,
      justifyContent: 'center', alignItems: 'center', marginRight: 10, marginTop: 1,
    },
    addrBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },
    addrText: { flex: 1, fontSize: 14, color: '#D1D5DB', lineHeight: 20 },

    twoButtonRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
    outlineBtn: {
      flex: 1, borderWidth: 1.5, borderColor: '#9CA3AF',
      borderRadius: 14, paddingVertical: 13, alignItems: 'center',
    },
    outlineBtnText: { fontSize: 15, fontWeight: '700', color: '#D1D5DB' },

    // ── ARRIVED panel ────────────────────────────────────────────
    waitingHeader: {
      backgroundColor: '#F97316', borderRadius: 12,
      paddingVertical: 8, paddingHorizontal: 14, alignSelf: 'center', marginBottom: 14,
    },
    waitingHeaderText: { fontSize: 15, fontWeight: '800', color: '#fff' },
    timerBigRow: { alignItems: 'center', marginBottom: 12 },
    timerBig: { fontSize: 56, fontWeight: '900', letterSpacing: -1 },
    timerStatus: { fontSize: 14, color: '#9CA3AF', marginTop: 2 },

    iconBtnRow: {
      flexDirection: 'row', backgroundColor: CARD,
      borderRadius: 14, marginBottom: 14, overflow: 'hidden',
    },
    iconBtn: { flex: 1, alignItems: 'center', paddingVertical: 14 },
    iconBtnEmoji: { fontSize: 24 },
    iconBtnLabel: { fontSize: 12, color: '#9CA3AF', marginTop: 4 },
    iconBtnDivider: { width: 1, backgroundColor: BORDER, marginVertical: 10 },

    // ── IN_PROGRESS panel ────────────────────────────────────────
    tripInfoRow: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginBottom: 12,
    },
    tripPrice: { fontSize: 28, fontWeight: '900', color: '#FFCC00' },
    tripDistBox: { alignItems: 'flex-end' },
    tripDistLabel: { fontSize: 12, color: '#9CA3AF' },
    tripDistValue: { fontSize: 15, fontWeight: '700', color: '#F9FAFB' },

    // ── Completion panel ─────────────────────────────────────────
    completionTrophy: { fontSize: 52, textAlign: 'center', marginBottom: 8 },
    completionTitle: { fontSize: 20, fontWeight: '900', color: '#F9FAFB', textAlign: 'center' },
    completionPrice: { fontSize: 26, fontWeight: '800', color: '#FFCC00', textAlign: 'center', marginTop: 8 },
    completionSub: { fontSize: 15, color: '#9CA3AF', textAlign: 'center', marginTop: 6 },

    // ── Map markers ──────────────────────────────────────────────
    destMarker: { backgroundColor: '#E53935', borderRadius: 8, padding: 6, borderWidth: 2, borderColor: '#fff' },
    destMarkerText: { color: '#fff', fontWeight: '800', fontSize: 13 },
    pickupMarker: { backgroundColor: '#2196F3', borderRadius: 8, padding: 6, borderWidth: 2, borderColor: '#fff' },
    markerText: { color: '#fff', fontWeight: '800', fontSize: 13 },
    livePassengerOuter: {
      width: 52, height: 52, borderRadius: 26,
      backgroundColor: 'rgba(76, 175, 80, 0.18)',
      borderWidth: 2, borderColor: '#4CAF50',
      justifyContent: 'center', alignItems: 'center',
    },
    livePassengerInner: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: 'rgba(76, 175, 80, 0.35)',
      justifyContent: 'center', alignItems: 'center',
    },

    // ── Incoming order modal ─────────────────────────────────────
    modalOverlay: { flex: 1, justifyContent: 'flex-end' },  // no dim — map stays visible

    // ── Queued orders badge button ───────────────────────────────
    queuedBadgeBtn: {
      position: 'absolute',
      backgroundColor: '#FFCC00',
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      elevation: 6,
      shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6,
    },

    orderModal: {
      backgroundColor: '#000000',
      borderTopLeftRadius: 28, borderTopRightRadius: 28,
      padding: 24, paddingBottom: 36, alignItems: 'center',
      borderTopWidth: 1, borderTopColor: '#1F2937',
    },
    timerCircle: {
      width: 68, height: 68, borderRadius: 34,
      borderWidth: 3, borderColor: '#FFCC00',
      justifyContent: 'center', alignItems: 'center', marginBottom: 12,
    },
    timerCount: { fontSize: 28, fontWeight: '900', color: '#FFCC00' },
    newOrderTitle: { fontSize: 22, fontWeight: '900', color: '#FFCC00', marginBottom: 10 },

    priceLine: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
    orderPriceLarge: { fontSize: 32, fontWeight: '900', color: '#F9FAFB' },
    orderDistBadge: {
      backgroundColor: CARD, borderRadius: 20,
      paddingHorizontal: 10, paddingVertical: 4,
      fontSize: 14, fontWeight: '700', color: '#9CA3AF',
    },

    phoneRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
    phoneRowEmoji: { fontSize: 18 },
    phoneRowText: { fontSize: 15, fontWeight: '600', color: '#D1D5DB' },

    addrTextModal: { flex: 1, fontSize: 14, color: '#D1D5DB', lineHeight: 20 },

    callBadge: {
      backgroundColor: '#1E3A5F', borderRadius: 20,
      paddingHorizontal: 14, paddingVertical: 5, marginTop: 8, marginBottom: 4,
    },
    callBadgeText: { fontSize: 13, fontWeight: '700', color: '#60A5FA' },

    transferBtn: {
      marginTop: 10, borderWidth: 1, borderColor: '#374151', borderRadius: 12,
      paddingVertical: 9, paddingHorizontal: 16, alignItems: 'center',
    },
    transferBtnText: { color: '#9CA3AF', fontSize: 13, fontWeight: '600' },

    transferFriendRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: '#1F2937', borderRadius: 12, padding: 14, marginBottom: 8,
    },

    // ── Swipe control ────────────────────────────────────────────
    swipeWrap: { width: '100%', alignItems: 'center', marginTop: 18 },
    swipeTrack: {
      width: '100%', height: 60, borderRadius: 30,
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', paddingHorizontal: 16,
      borderWidth: 1, borderColor: '#374151', overflow: 'hidden',
    },
    swipeLabelLeft: { fontSize: 13, fontWeight: '700', color: '#EF4444' },
    swipeLabelRight: { fontSize: 13, fontWeight: '700', color: '#22C55E' },
    swipeKnob: {
      width: 52, height: 52, borderRadius: 26,
      backgroundColor: '#FFCC00',
      justifyContent: 'center', alignItems: 'center',
      elevation: 4,
      shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4,
    },
    swipeSubLabel: { fontSize: 12, color: '#6B7280', marginTop: 8 },
  });
}
