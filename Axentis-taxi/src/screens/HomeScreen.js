import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Alert, Image, Animated, ScrollView, PanResponder, Vibration,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { authAPI, orderAPI, quizAPI } from '../services/api';
import { buildAvatarUrl } from '../services/api';
import socket from '../services/socket';
import { t } from '../i18n';
import { initializeNotifications, getExpoPushToken } from '../services/notifications';
import PuzzleGame from '../components/PuzzleGame';

const CAR_ICON    = require('../../assets/car-photo.png');
const PICKUP_ICON = require('../../assets/location-pin.png');
const USER_ICON   = require('../../assets/user-location.png');

// Обратное геокодирование: улица + номер дома + город (без районов)
async function reverseGeocode(coords) {
  // 1. Nominatim zoom=18 (с таймаутом 6 сек)
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    const url =
      `https://nominatim.openstreetmap.org/reverse?lat=${coords.latitude}&lon=${coords.longitude}` +
      `&format=json&addressdetails=1&zoom=18&accept-language=ru`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'AxentisTaxiApp/1.0' },
    });
    clearTimeout(tid);
    if (res.ok) {
      const json = await res.json();
      if (json?.address) {
        const a = json.address;
        const road = a.road || a.pedestrian || a.footway || a.path || a.residential || a.neighbourhood;
        const number = a.house_number;
        const city = a.city || a.town || a.village || a.hamlet;
        if (road) return [road, number, city].filter(Boolean).join(', ');
        if (city) return city;
        if (json.display_name) {
          return json.display_name.split(',').slice(0, 2).map(s => s.trim()).join(', ');
        }
      }
    }
  } catch {}
  // 2. Fallback: expo-location
  try {
    const results = await Location.reverseGeocodeAsync(coords);
    if (results?.length > 0) {
      const r = results[0];
      const street = r.street || r.name;
      const city = r.city || r.district || r.subregion;
      if (street) return [street, r.streetNumber, city].filter(Boolean).join(', ');
      if (city) return city;
    }
  } catch {}
  return `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
}

// Маршрут по реальным дорогам: два OSRM источника с актуальным покрытием ЦА
// Использует steps=true для точной геометрии на каждом повороте (не упрощённый overview).
// Возвращает { coords, distanceKm }.
async function fetchRoadRoute(pickup, dest) {
  const lng1 = pickup.longitude, lat1 = pickup.latitude;
  const lng2 = dest.longitude,   lat2 = dest.latitude;

  // Извлекаем координаты из пошаговой геометрии (не overview — она упрощена и режет углы).
  function extractStepCoords(json) {
    if (!json.routes?.[0]) return null;
    const distanceKm = json.routes[0].distance / 1000;
    const coords = [];
    for (const leg of json.routes[0].legs) {
      for (const step of leg.steps) {
        for (const [lng, lat] of step.geometry.coordinates) {
          // Дедупликация смежных одинаковых точек (стыки шагов)
          if (coords.length === 0 ||
              lat !== coords[coords.length - 1].latitude ||
              lng !== coords[coords.length - 1].longitude) {
            coords.push({ latitude: lat, longitude: lng });
          }
        }
      }
    }
    if (coords.length < 2) return null;
    return { coords, distanceKm };
  }

  // 1. router.project-osrm.org — глобальное покрытие, быстрый ответ
  const c1 = new AbortController();
  const t1 = setTimeout(() => c1.abort(), 6000);
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson&steps=true&annotations=true`;
    const res = await fetch(url, { signal: c1.signal });
    clearTimeout(t1);
    const json = await res.json();
    const result = extractStepCoords(json);
    if (result) return result;
  } catch { clearTimeout(t1); }

  // 3. Last resort: straight line
  const dLat = ((dest.latitude - pickup.latitude) * Math.PI) / 180;
  const dLon = ((dest.longitude - pickup.longitude) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(pickup.latitude * Math.PI / 180) * Math.cos(dest.latitude * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const straight = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return { coords: [pickup, dest], distanceKm: straight };
}

// Маркер с PNG иконкой: tracksViewChanges=true до загрузки изображения, затем false.
// forceTrack=true принудительно оставляет tracksViewChanges=true — требуется для маркеров,
// у которых меняется rotation/coordinate после загрузки (например, иконка машины водителя).
function PinMarker({ coordinate, source, size = 40, anchor = { x: 0.5, y: 1 }, zIndex, flat, rotation, forceTrack = false, onLongPress }) {
  const [trackChanges, setTrackChanges] = React.useState(true);
  const prevLatRef = React.useRef(coordinate?.latitude);
  const prevLngRef = React.useRef(coordinate?.longitude);

  // Re-enable tracking when coordinate changes externally (e.g. history selection)
  // so the marker actually moves to the new position on the map.
  React.useEffect(() => {
    if (!coordinate) return;
    const { latitude, longitude } = coordinate;
    if (latitude !== prevLatRef.current || longitude !== prevLngRef.current) {
      prevLatRef.current = latitude;
      prevLngRef.current = longitude;
      setTrackChanges(true);
      const t = setTimeout(() => setTrackChanges(false), 600);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinate?.latitude, coordinate?.longitude]);

  return (
    <Marker
      coordinate={coordinate}
      anchor={anchor}
      zIndex={zIndex}
      flat={flat}
      rotation={rotation}
      tracksViewChanges={forceTrack || trackChanges}
      onLongPress={onLongPress}
    >
      <Image
        source={source}
        style={{ width: size, height: size }}
        resizeMode="contain"
        onLoad={() => setTrackChanges(false)}
        fadeDuration={0}
      />
    </Marker>
  );
}

// Center pin with bouncing animation + ground shadow during map selection
function BouncingCenterPin({ source }) {
  const bounce = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: -6, duration: 500, useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [bounce]);
  const shadowOpacity = bounce.interpolate({
    inputRange: [-6, 0],
    outputRange: [0.06, 0.2],
    extrapolate: 'clamp',
  });
  const shadowScaleX = bounce.interpolate({
    inputRange: [-6, 0],
    outputRange: [0.5, 1],
    extrapolate: 'clamp',
  });
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }} pointerEvents="none">
      <View style={{ alignItems: 'center', transform: [{ translateY: -18 }] }}>
        <Animated.Image
          source={source}
          style={{ width: 48, height: 48, transform: [{ translateY: bounce }] }}
          resizeMode="contain"
        />
        <Animated.View
          style={{
            width: 18, height: 5, borderRadius: 9,
            backgroundColor: '#000',
            marginTop: 2,
            opacity: shadowOpacity,
            transform: [{ scaleX: shadowScaleX }],
          }}
        />
      </View>
    </View>
  );
}

const ORDER_STATUS = {
  IDLE: 'idle',
  SEARCHING: 'searching',
  ACCEPTED: 'accepted',
  ARRIVED: 'arrived',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
};

const ROUTE_COLORS = {
  accepted: '#2196F3',
  arrived: '#FF9800',
  in_progress: '#4CAF50',
};

const LOCATION_CFG = {
  idle:   { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 20 },
  active: { accuracy: Location.Accuracy.High,     timeInterval: 67,    distanceInterval: 1  },
};

export default function HomeScreen() {
  const { colors, lang } = useTheme();
  const { user, updateUser } = useAuth();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  const mapRef = useRef(null);
  const locationSubscriptionRef = useRef(null);
  const orderStatusRef = useRef(ORDER_STATUS.IDLE);
  const orderIDRef = useRef(null);
  const sharingLocationRef = useRef(user?.share_live_location !== false);
  const pickupLockedRef = useRef(false);
  const mapModeRef = useRef(null);

  const [region, setRegion] = useState({
    latitude: 41.2995, longitude: 69.2401,
    latitudeDelta: 0.05, longitudeDelta: 0.05,
  });

  // Map selection mode: null | 'pickup' | 'dest'
  const [mapMode, setMapMode] = useState(null);
  // Address label typed while in dest map mode
  const [destInputText, setDestInputText] = useState('');

  const [userLocation, setUserLocation] = useState(null);
  const [pickupCoords, setPickupCoords] = useState(null);
  const [pickupText, setPickupText] = useState('');
  const [destCoords, setDestCoords] = useState(null);
  const [destText, setDestText] = useState('');

  const [orderID, setOrderID] = useState(null);
  const [orderStatus, setOrderStatus] = useState(ORDER_STATUS.IDLE);
  const [estimatedPrice, setEstimatedPrice] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  // Smooth interpolation: display position lerps toward received target at 60fps
  const driverTargetRef = useRef(null);
  const driverDisplayRef = useRef(null);
  const smoothTimerRef = useRef(null);
  const routeDriverTargetRef = useRef(null); // last driver pos used for OSRM fetch (30m throttle)
  const lastDriverLocSetRef = useRef(0); // throttle setDriverLocation for OSRM (max every 2s)
  const [driverDisplayLocation, setDriverDisplayLocation] = useState(null);
  const [driverInfo, setDriverInfo] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [routePreviewCoords, setRoutePreviewCoords] = useState([]);
  const [roadDistanceKm, setRoadDistanceKm] = useState(null); // accurate road distance from OSRM
  const [availableDrivers, setAvailableDrivers] = useState([]);
  const [recentTrips, setRecentTrips] = useState([]);
  const recentTripsRef = useRef([]); // ref so PanResponder closure can read it
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const panelCollapsedRef = useRef(false);
  const panelExpandedRef = useRef(false);
  // translateY-based: 0 = fully visible, positive = slid down off-screen (collapsed)
  const panelTranslateY    = useRef(new Animated.Value(0)).current;
  const panelFullHeightRef = useRef(300);  // total panel height (updated by onLayout)
  const panelHandleHeightRef = useRef(48); // handle bar height only
  const PANEL_PEEK_HEIGHT = 42;            // minimum visible height when collapsed (handle + small peek)
  const dragStartYRef      = useRef(0);
  const historyDragStartRef = useRef(0);   // history panel height at gesture start
  const [dashPhase, setDashPhase] = useState(0);
  const [pricingSettings, setPricingSettings] = useState({ service_fee: 2000, price_per_km: 2000, surge_multiplier: 1.0 });
  const [tariffType, setTariffType] = useState('standard'); // 'standard' | 'free'
  const [freeRideKm, setFreeRideKm] = useState(0);
  const freeRideKmRef = useRef(0);
  const prevFreeDriverPosRef = useRef(null);
  const tariffTypeRef = useRef('standard');
  const [lockedPricePerKm, setLockedPricePerKm] = useState(0);
  const lockedPricePerKmRef = useRef(0);

  // Rating modal — shown after trip_completed
  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [completedOrderId, setCompletedOrderId] = useState(null);
  const [completedPrice, setCompletedPrice] = useState(null);
  const [selectedRating, setSelectedRating] = useState(0);

  // Пазл — показывается во время поездки, когда открыта полная панель с данными водителя
  const [puzzleStarted, setPuzzleStarted] = useState(false);

  // Анимация пунктира "последней мили" — точки плавно текут от пина к дороге
  useEffect(() => {
    const timer = setInterval(() => {
      setDashPhase((prev) => (prev + 2) % 18);
    }, 50);
    return () => clearInterval(timer);
  }, []);

  // Настройки цен с сервера — обновляются каждые 30 секунд
  useEffect(() => {
    async function loadPricing() {
      try {
        const { data } = await orderAPI.getPricingSettings();
        setPricingSettings({
          service_fee: Number(data.service_fee) || 2000,
          price_per_km: Number(data.price_per_km) || 2000,
          surge_multiplier: Number(data.surge_multiplier) || 1.0,
        });
      } catch {}
    }
    loadPricing();
    const pricingInterval = setInterval(loadPricing, 30000);
    return () => clearInterval(pricingInterval);
  }, []);



  const historyPanelHeight = useRef(new Animated.Value(0)).current;

  function calcPrice(distanceKm) {
    const serviceFee = Number(pricingSettings.service_fee) || 2000;
    const perKm = Number(pricingSettings.price_per_km) || 2000;
    const surge = Number(pricingSettings.surge_multiplier) || 1;
    // Round distance UP to nearest 100m
    const meters = distanceKm * 1000;
    const roundedKm = (meters < 1 ? 100 : Math.ceil(meters / 100) * 100) / 1000;
    // Сервисный сбор фиксированный, surge только на километраж
    const distCost = roundedKm * perKm;
    return Math.ceil((serviceFee + distCost * surge) / 200) * 200;
  }

  function togglePanel() {
    const next = !panelExpanded;
    setPanelExpanded(next);
    Animated.spring(historyPanelHeight, {
      toValue: next ? 280 : 0,
      useNativeDriver: false,
      tension: 60,
      friction: 12,
    }).start();
  }

  // Keep sharingLocationRef in sync with profile changes
  useEffect(() => {
    sharingLocationRef.current = user?.share_live_location !== false;
  }, [user?.share_live_location]);

  // ── Маршрут по дорогам: pickup → destination (OSRM) ──────────────────────
  useEffect(() => {
    if (!pickupCoords || !destCoords) {
      setRoutePreviewCoords([]);
      return;
    }
    let cancelled = false;
    fetchRoadRoute(pickupCoords, destCoords).then(({ coords, distanceKm }) => {
      if (!cancelled) {
        setRoutePreviewCoords(coords);
        setRoadDistanceKm(distanceKm);
      }
    });
    return () => { cancelled = true; };
  }, [pickupCoords, destCoords]);

  // ── Mount: permissions, GPS, push token, recent trips ────────────────────
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        // Instant: use cached position for immediate map centering (no GPS warm-up delay)
        try {
          const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
          if (lastKnown) {
            const c = { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude };
            setUserLocation(c);
            setRegion({ ...c, latitudeDelta: 0.02, longitudeDelta: 0.02 });
          }
        } catch {}
        // Background: get accurate current fix
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then((loc) => {
          const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setUserLocation(coords);
          setRegion({ ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 });
        }).catch(() => {});
      }
      // Always start in pickup selection mode — user confirms their location
      setMapMode('pickup');
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

    async function loadHistory() {
      try {
        const { data } = await orderAPI.getHistory();
        const completed = (data.orders || [])
          .filter((o) => o.status === 'completed')
          .slice(0, 10);
        setRecentTrips(completed);
        recentTripsRef.current = completed;
      } catch {}
    }
    loadHistory();

    return () => {
      locationSubscriptionRef.current?.remove?.();
      clearInterval(smoothTimerRef.current);
    };
  }, []);

  // ── Adaptive location tracking ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const isActive = [ORDER_STATUS.ACCEPTED, ORDER_STATUS.ARRIVED, ORDER_STATUS.IN_PROGRESS].includes(orderStatus);
    const cfg = isActive ? LOCATION_CFG.active : LOCATION_CFG.idle;

    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted' || cancelled) return;

      locationSubscriptionRef.current?.remove?.();
      locationSubscriptionRef.current = null;

      const sub = await Location.watchPositionAsync(cfg, (watchLoc) => {
        const nextCoords = {
          latitude: watchLoc.coords.latitude,
          longitude: watchLoc.coords.longitude,
        };
        setUserLocation(nextCoords);
        if (!pickupLockedRef.current && !mapModeRef.current) {
          setPickupCoords(nextCoords);
          setPickupText(t(lang, 'yourLocation'));
        }
        if (
          sharingLocationRef.current &&
          orderIDRef.current &&
          [ORDER_STATUS.ACCEPTED, ORDER_STATUS.ARRIVED, ORDER_STATUS.IN_PROGRESS].includes(orderStatusRef.current)
        ) {
          orderAPI.updatePassengerLocation(
            nextCoords.latitude, nextCoords.longitude,
            typeof watchLoc.coords.heading === 'number' ? watchLoc.coords.heading : null,
          ).catch(() => {});
        }
      });

      if (cancelled) sub.remove();
      else locationSubscriptionRef.current = sub;
    })();

    return () => { cancelled = true; };
  }, [orderStatus]);

  // ── Smooth driver marker interpolation at 60fps ───────────────────────────
  // Receives updates at 10ms from WS; lerps position+heading every 16ms (60fps).
  // Angular lerp uses shortest-path wrap to avoid spinning the wrong way (e.g. 350°→10°).
  useEffect(() => {
    clearInterval(smoothTimerRef.current);
    const isActive = [ORDER_STATUS.ACCEPTED, ORDER_STATUS.ARRIVED, ORDER_STATUS.IN_PROGRESS].includes(orderStatus);
    if (!isActive) return;

    smoothTimerRef.current = setInterval(() => {
      const target = driverTargetRef.current;
      const display = driverDisplayRef.current;
      if (!target) return;
      if (!display) {
        driverDisplayRef.current = { ...target };
        setDriverDisplayLocation({ ...target });
        return;
      }
      const lerp = (a, b, alpha) => a + (b - a) * alpha;
      // Shortest-path angular interpolation — prevents spinning the wrong direction
      const prevH = display.heading ?? 0;
      const targetH = target.heading ?? 0;
      let hDiff = ((targetH - prevH) % 360 + 540) % 360 - 180;
      const nextHeading = (prevH + hDiff * 0.6 + 360) % 360;
      const next = {
        latitude:  lerp(display.latitude,  target.latitude,  0.5),
        longitude: lerp(display.longitude, target.longitude, 0.5),
        heading:   nextHeading,
      };
      driverDisplayRef.current = next;
      setDriverDisplayLocation({ ...next });
    }, 30);

    return () => clearInterval(smoothTimerRef.current);
  }, [orderStatus]);

  // ── Road route for active order (driver → pickup or destination via OSRM) ──
  // Throttled: only refetches when driver moves more than ~30m.
  useEffect(() => {
    const isActive = [ORDER_STATUS.ACCEPTED, ORDER_STATUS.ARRIVED, ORDER_STATUS.IN_PROGRESS].includes(orderStatus);
    if (!isActive || !driverLocation) return;
    const dest = orderStatus === ORDER_STATUS.IN_PROGRESS ? destCoords : pickupCoords;
    if (!dest) return;
    const prev = routeDriverTargetRef.current;
    if (prev) {
      const dLat = Math.abs(driverLocation.latitude - prev.latitude);
      const dLng = Math.abs(driverLocation.longitude - prev.longitude);
      if (dLat < 0.00027 && dLng < 0.00027) return;
    }
    routeDriverTargetRef.current = { ...driverLocation };
    fetchRoadRoute(driverLocation, dest).then(({ coords }) => {
      setRouteCoords(coords);
    }).catch(() => {
      setRouteCoords([driverLocation, dest].filter(Boolean));
    });
  }, [driverLocation, orderStatus, pickupCoords, destCoords]);

  useEffect(() => { orderStatusRef.current = orderStatus; }, [orderStatus]);
  useEffect(() => { orderIDRef.current = orderID; }, [orderID]);
  useEffect(() => { tariffTypeRef.current = tariffType; }, [tariffType]);
  useEffect(() => { lockedPricePerKmRef.current = lockedPricePerKm; }, [lockedPricePerKm]);
  useEffect(() => { mapModeRef.current = mapMode; }, [mapMode]);
  useEffect(() => { panelCollapsedRef.current = panelCollapsed; }, [panelCollapsed]);
  useEffect(() => { panelExpandedRef.current = panelExpanded; }, [panelExpanded]);

  // Периодически сохраняем пройденные км на сервере (свободный тариф, каждые 5 сек)
  useEffect(() => {
    if (orderStatus !== ORDER_STATUS.IN_PROGRESS || tariffType !== 'free' || !orderID) return;
    const interval = setInterval(() => {
      if (freeRideKmRef.current > 0) {
        orderAPI.updateOrderDistance(orderID, freeRideKmRef.current).catch(() => {});
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [orderStatus, tariffType, orderID]);

  // Available drivers polling
  useEffect(() => {
    let disposed = false;
    async function fetchAvailableDrivers() {
      try {
        const { data } = await orderAPI.getAvailableDrivers();
        if (!disposed) setAvailableDrivers(data.drivers || []);
      } catch {
        if (!disposed) setAvailableDrivers([]);
      }
    }
    fetchAvailableDrivers();
    const timer = setInterval(fetchAvailableDrivers, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);

  // ── Critical socket events: registered once per login session ───────────
  // These MUST NOT be removed and re-added on every GPS update (pickupCoords change).
  // Separating them guarantees order_accepted / driver_arrived / trip_started / etc.
  // are never missed due to a brief cleanup gap in the wider useEffect below.
  useEffect(() => {
    if (!user?.id) return;

    socket.on('order_accepted', (data) => {
      setOrderStatus(ORDER_STATUS.ACCEPTED);
      setDriverInfo(data.driver || null);
    });
    socket.on('driver_arrived', () => { setOrderStatus(ORDER_STATUS.ARRIVED); });
    socket.on('trip_started', () => { setOrderStatus(ORDER_STATUS.IN_PROGRESS); });
    socket.on('no_drivers', () => {
      setOrderStatus(ORDER_STATUS.IDLE);
      Alert.alert(t(lang, 'noDriversTitle'), t(lang, 'noDriversFound'));
    });
    socket.on('order_cancelled', () => {
      Alert.alert(t(lang,'orderCancelled'), t(lang,'orderCancelledByDriver'));
      resetOrder();
    });

    // When socket reconnects while waiting for a driver, check if the order was
    // already accepted (network blip scenario)
    socket.onReconnect = () => {
      if (orderIDRef.current && orderStatusRef.current === ORDER_STATUS.SEARCHING) {
        orderAPI.getOrder(orderIDRef.current).then(({ data: od }) => {
          if (!od || orderStatusRef.current !== ORDER_STATUS.SEARCHING) return;
          if (['accepted','arrived','in_progress'].includes(od.status)) {
            setOrderStatus(
              od.status === 'in_progress' ? ORDER_STATUS.IN_PROGRESS
              : od.status === 'arrived'   ? ORDER_STATUS.ARRIVED
              : ORDER_STATUS.ACCEPTED
            );
            if (od.driver) setDriverInfo(od.driver);
          }
        }).catch(() => {});
      }
    };

    return () => {
      socket.off('order_accepted');
      socket.off('driver_arrived');
      socket.off('trip_started');
      socket.off('no_drivers');
      socket.off('order_cancelled');
      socket.onReconnect = null;
    };
  }, [user?.id]);

  // Socket events that reference destCoords / pickupCoords closures
  useEffect(() => {
    if (!user?.id) return;
    socket.on('trip_completed', (data) => {
      // Для свободного тарифа отправляем финальные км на сервер
      if (tariffTypeRef.current === 'free' && orderIDRef.current && freeRideKmRef.current > 0) {
        orderAPI.updateOrderDistance(orderIDRef.current, freeRideKmRef.current).catch(() => {});
      }
      // Use the server-calculated price to ensure driver and passenger see the same amount
      const finalPrice = Math.ceil((data.total_price || 0) / 200) * 200;
      setCompletedOrderId(orderIDRef.current);
      setCompletedPrice(finalPrice);
      setSelectedRating(0);
      setOrderStatus(ORDER_STATUS.COMPLETED);
      setRatingModalVisible(true);
    });
    socket.on('driver_location', (data) => {
      const pos = { latitude: data.lat, longitude: data.lng, heading: data.heading ?? 0 };
      driverTargetRef.current = pos;
      // Throttle state update to max once per 2s — only used for OSRM route refetch
      const now = Date.now();
      if (now - lastDriverLocSetRef.current > 2000) {
        lastDriverLocSetRef.current = now;
        setDriverLocation(pos);
      }
      // Для свободного тарифа накапливаем пройденные км во время поездки
      if (orderStatusRef.current === ORDER_STATUS.IN_PROGRESS && tariffTypeRef.current === 'free') {
        if (prevFreeDriverPosRef.current) {
          const R = 6371;
          const dLat = ((pos.latitude - prevFreeDriverPosRef.current.latitude) * Math.PI) / 180;
          const dLon = ((pos.longitude - prevFreeDriverPosRef.current.longitude) * Math.PI) / 180;
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(prevFreeDriverPosRef.current.latitude * Math.PI / 180) *
            Math.cos(pos.latitude * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
          freeRideKmRef.current += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          setFreeRideKm(freeRideKmRef.current);
        }
        prevFreeDriverPosRef.current = pos;
      }
      // Route line is updated by the separate OSRM useEffect (throttled to ~30m movement)
    });
    socket.on('no_drivers', () => {
      setOrderStatus(ORDER_STATUS.IDLE);
      Alert.alert(t(lang, 'noDriversTitle'), t(lang, 'noDriversFound'));
    });
    return () => {
      socket.off('trip_completed');
      socket.off('driver_location');
    };
  }, [user?.id, pickupCoords, destCoords, lang]);

  // ── Map selection helpers ─────────────────────────────────────────────────
  function enterMapMode(mode) {
    setMapMode(mode);
    if (mode === 'pickup' && userLocation) {
      mapRef.current?.animateToRegion({ ...userLocation, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    } else if (mode === 'dest' && destCoords) {
      mapRef.current?.animateToRegion({ ...destCoords, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    }
  }

  async function confirmMapSelection() {
    const coords = { latitude: region.latitude, longitude: region.longitude };
    if (mapMode === 'pickup') {
      pickupLockedRef.current = true;
      setPickupCoords(coords);
      setPickupText(t(lang, 'determiningAddress'));
      reverseGeocode(coords).then((label) => setPickupText(label));
      // Закрываем режим — финиш не сбрасывается
      setMapMode(null);
    } else if (mapMode === 'dest') {
      setDestCoords(coords);
      const typed = destInputText.trim();
      if (typed) {
        setDestText(typed);
      } else {
        setDestText(t(lang, 'determiningAddress'));
        reverseGeocode(coords).then((label) => setDestText(label));
      }
      setDestInputText('');
      setMapMode(null);
    }
  }

  function cancelMapMode() {
    setDestInputText('');
    // При отмене возвращаемся в idle (показываем панель с инпутами)
    setMapMode(null);
  }

  async function handleLocateMe() {
    let use = userLocation;
    if (!use) {
      // Try cached location first — instant, no GPS warm-up
      try {
        const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
        if (lastKnown) use = { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude };
      } catch {}
      // Fall back to fresh GPS fix
      if (!use) {
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          use = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        } catch { return; }
      }
      setUserLocation(use);
    }
    pickupLockedRef.current = false;
    setPickupCoords(use);
    setPickupText(t(lang, 'yourLocation'));
    mapRef.current?.animateToRegion({ ...use, latitudeDelta: 0.02, longitudeDelta: 0.02 });
  }

  function resetOrder() {
    setOrderID(null);
    setOrderStatus(ORDER_STATUS.IDLE);
    setEstimatedPrice(null);
    setDriverLocation(null);
    setDriverDisplayLocation(null);
    driverTargetRef.current = null;
    driverDisplayRef.current = null;
    setDriverInfo(null);
    setRouteCoords([]);
    setRoutePreviewCoords([]);
    setDestCoords(null);
    setDestText('');
    setDestInputText('');
    setMapMode(null);
    setRoadDistanceKm(null);
    freeRideKmRef.current = 0;
    setFreeRideKm(0);
    prevFreeDriverPosRef.current = null;
    setLockedPricePerKm(0);
    lockedPricePerKmRef.current = 0;
    setPuzzleStarted(false);
  }

  function calcDistanceKm(a, b) {
    if (!a || !b) return 0;
    const R = 6371;
    const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
    const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  async function handleOrder() {
    if (!pickupCoords) {
      Alert.alert(t(lang, 'error'), t(lang, 'selectDestHint'));
      return;
    }
    if (tariffType === 'standard' && !destCoords) {
      Alert.alert(t(lang, 'error'), t(lang, 'selectDestHint'));
      return;
    }
    Vibration.vibrate(50);
    setOrderStatus(ORDER_STATUS.SEARCHING);
    freeRideKmRef.current = 0;
    setFreeRideKm(0);
    prevFreeDriverPosRef.current = null;
    // Use road distance if available (more accurate), fall back to haversine straight-line
    const distKm = tariffType === 'standard'
      ? (roadDistanceKm ?? calcDistanceKm(pickupCoords, destCoords))
      : 0;
    try {
      const payload = {
        pickup_lat: pickupCoords.latitude,
        pickup_lng: pickupCoords.longitude,
        pickup_address: pickupText,
        distance_km: distKm,
        trip_type: tariffType,
      };
      if (tariffType === 'standard' && destCoords) {
        payload.destination_lat = destCoords.latitude;
        payload.destination_lng = destCoords.longitude;
        payload.destination_address = destText;
      }
      const { data } = await orderAPI.createOrder(payload);
      setOrderID(data.order_id);
      // Always round UP to nearest 200 on client side regardless of backend version
      setEstimatedPrice(Math.ceil((data.total_price || 0) / 200) * 200);
      const locked = data.locked_price_per_km || pricingSettings.price_per_km || 2000;
      setLockedPricePerKm(locked);
      lockedPricePerKmRef.current = locked;
    } catch (e) {
      setOrderStatus(ORDER_STATUS.IDLE);
      Alert.alert(t(lang, 'error'), e.response?.data?.error || 'Ошибка создания заказа');
    }
  }

  async function handleCancel() {
    if (!orderID) { resetOrder(); return; }
    try { await orderAPI.cancelOrder(orderID); } catch {}
    resetOrder();
  }

  const handlePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dy) > 6 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.2,

      onPanResponderGrant: () => {
        panelTranslateY.stopAnimation();
        historyPanelHeight.stopAnimation();
        dragStartYRef.current = panelTranslateY.__getValue();
        historyDragStartRef.current = historyPanelHeight.__getValue();
      },

      onPanResponderMove: (_, { dy }) => {
        if (panelExpandedRef.current) {
          // Stage 2: track history panel height 1:1 with finger (drag down = close)
          const next = Math.max(0, Math.min(280, historyDragStartRef.current - dy));
          historyPanelHeight.setValue(next);
          return;
        }
        // Stage 1: slide main panel up/down with finger
        const maxSlide = Math.max(0, panelFullHeightRef.current - PANEL_PEEK_HEIGHT);
        const next = Math.max(0, Math.min(maxSlide, dragStartYRef.current + dy));
        panelTranslateY.setValue(next);
      },

      onPanResponderRelease: (_, { dy, vy }) => {
        const isTap       = Math.abs(dy) < 10 && Math.abs(vy) < 0.2;
        const isSwipeDown = dy > 30  || vy > 0.3;
        const isSwipeUp   = dy < -30 || vy < -0.3;
        // Use PANEL_PEEK_HEIGHT to guarantee handle stays visible when collapsed
        const maxSlide    = Math.max(0, panelFullHeightRef.current - PANEL_PEEK_HEIGHT);

        // 2× faster springs: tension 280, friction 24
        const springTo = (toValue, onDone) => {
          Animated.spring(panelTranslateY, {
            toValue,
            useNativeDriver: true,
            tension: 280,
            friction: 24,
            overshootClamping: true,
          }).start(onDone);
        };

        // 2× faster history panel spring
        const springHistory = (toValue, onDone) => {
          Animated.spring(historyPanelHeight, {
            toValue,
            useNativeDriver: false,
            tension: 160,
            friction: 22,
            overshootClamping: true,
          }).start(onDone);
        };

        if (isTap) {
          if (panelCollapsedRef.current) {
            panelCollapsedRef.current = false;
            springTo(0, () => setPanelCollapsed(false));
          } else {
            const next = !panelExpandedRef.current;
            panelExpandedRef.current = next;
            setPanelExpanded(next);
            springHistory(next ? 280 : 0, next ? undefined : () => setPanelExpanded(false));
          }
          return;
        }

        // Stage 2: history panel is open — position-based snap
        if (panelExpandedRef.current) {
          const currentH = historyPanelHeight.__getValue();
          const shouldClose = isSwipeDown || currentH < 140;
          if (shouldClose) {
            panelExpandedRef.current = false;
            springHistory(0, () => setPanelExpanded(false));
            springTo(0);
          } else {
            springHistory(280);
          }
          return;
        }

        // Stage 1: main panel swipe
        if (isSwipeDown) {
          if (!panelCollapsedRef.current) {
            panelCollapsedRef.current = true;
            springTo(maxSlide, () => setPanelCollapsed(true));
          } else {
            springTo(maxSlide);
          }
        } else if (isSwipeUp) {
          if (panelCollapsedRef.current) {
            panelCollapsedRef.current = false;
            springTo(0, () => setPanelCollapsed(false));
          } else if (recentTripsRef.current.length > 0) {
            panelExpandedRef.current = true;
            springHistory(280, () => setPanelExpanded(true));
            springTo(0);
          } else {
            springTo(0);
          }
        } else {
          springTo(panelCollapsedRef.current ? maxSlide : 0);
        }
      },
    })
  ).current;

  const s = makeStyles(colors);
  const routeColor = ROUTE_COLORS[orderStatus] || '#2196F3';

  return (
    <View style={s.container}>
      <MapView
        ref={mapRef}
        style={s.map}
        provider={PROVIDER_GOOGLE}
        region={region}
        onRegionChangeComplete={setRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
      >
        {/* Позиция пользователя */}
        {userLocation && (
          <PinMarker coordinate={userLocation} source={USER_ICON} size={12} anchor={{ x: 0.5, y: 0.85 }} zIndex={10} />
        )}

        {/* Доступные водители в режиме IDLE */}
        {orderStatus === ORDER_STATUS.IDLE && availableDrivers.map((driver) => (
          <PinMarker
            key={driver.user_id}
            coordinate={{ latitude: driver.lat, longitude: driver.lng }}
            source={CAR_ICON}
            size={28}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={((driver.heading ?? 0) + 180) % 360}
          />
        ))}

        {/* Пин отправления — виден всегда если установлен (в т.ч. при выборе назначения) */}
        {pickupCoords && (!mapMode || mapMode === 'dest') && (
          <PinMarker coordinate={pickupCoords} source={PICKUP_ICON} size={40} anchor={{ x: 0.5, y: 1 }} onLongPress={() => enterMapMode('pickup')} />
        )}
        {/* Пин назначения — та же иконка что и старт для точности */}
        {destCoords && !mapMode && (
          <PinMarker coordinate={destCoords} source={PICKUP_ICON} size={40} anchor={{ x: 0.5, y: 1 }} onLongPress={() => enterMapMode('dest')} />
        )}

        {/* Машина активного водителя — плавно интерполируется из WS обновлений.
             forceTrack={true} обязателен: без него tracksViewChanges=false кэширует
             нативный маркер и rotation перестаёт обновляться после загрузки иконки. */}
        {driverDisplayLocation && (
          <PinMarker
            coordinate={{ latitude: driverDisplayLocation.latitude, longitude: driverDisplayLocation.longitude }}
            source={CAR_ICON}
            size={28}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={((driverDisplayLocation.heading ?? 0) + 180) % 360}
            forceTrack
          />
        )}
        {/* Маршрут по дорогам — сплошная жёлтая линия */}
        {routePreviewCoords.length >= 2 && !mapMode && (
          <Polyline
            coordinates={routePreviewCoords}
            strokeColor="#FFCC00"
            strokeWidth={5}
            geodesic
            lineCap="round"
            lineJoin="round"
          />
        )}

        {/* Первая миля: пунктир от пина отправления до начала дороги (если точка вне улицы) */}
        {routePreviewCoords.length >= 2 && pickupCoords && !mapMode && (() => {
          const firstPt = routePreviewCoords[0];
          const dist = Math.abs(firstPt.latitude - pickupCoords.latitude) +
                       Math.abs(firstPt.longitude - pickupCoords.longitude);
          if (dist < 0.00005) return null;
          return (
            <Polyline
              key={`pickup-dash-${dashPhase}`}
              coordinates={[pickupCoords, firstPt]}
              strokeColor="#FFCC00"
              strokeWidth={4}
              lineDashPattern={[10, 8]}
              lineDashPhase={dashPhase}
              geodesic
              lineCap="round"
              lineJoin="round"
            />
          );
        })()}

        {/* Последняя миля: пунктир от конца дороги до финишного пина (если точка вне улицы) */}
        {routePreviewCoords.length >= 2 && destCoords && !mapMode && (() => {
          const lastPt = routePreviewCoords[routePreviewCoords.length - 1];
          const dist = Math.abs(lastPt.latitude - destCoords.latitude) +
                       Math.abs(lastPt.longitude - destCoords.longitude);
          if (dist < 0.00005) return null;
          return (
            <Polyline
              key={`dest-dash-${dashPhase}`}
              coordinates={[lastPt, destCoords]}
              strokeColor="#FFCC00"
              strokeWidth={4}
              lineDashPattern={[10, 8]}
              lineDashPhase={dashPhase}
              geodesic
              lineCap="round"
              lineJoin="round"
            />
          );
        })()}

        {/* Маршрут эктивного водителя: driver → pickup / destination */}
        {routeCoords.length >= 2 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={routeColor}
            strokeWidth={5}
            geodesic
            lineCap="round"
            lineJoin="round"
          />
        )}
      </MapView>

      {/* Center crosshair during map selection — PNG иконка с анимацией покачивания */}
      {mapMode && <BouncingCenterPin source={PICKUP_ICON} />}



      {/* ── IDLE panel ── */}
      {orderStatus === ORDER_STATUS.IDLE && !mapMode && (
        <Animated.View
          style={[s.panel, {
            backgroundColor: colors.background,
            bottom: 0,
            paddingBottom: 16,
            overflow: 'visible',
            transform: [{ translateY: panelTranslateY }],
          }]}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            panelFullHeightRef.current = h;
          }}
        >
          {/* GPS navigate button — inside panel so it moves 1:1 with drag */}
          <TouchableOpacity
            style={[s.floatingGpsBtn, { backgroundColor: colors.card, position: 'absolute', top: -56, right: 14 }]}
            onPress={async () => {
              let loc = userLocation;
              if (!loc) {
                try {
                  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                  loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
                  setUserLocation(loc);
                } catch { return; }
              }
              mapRef.current?.animateToRegion({ ...loc, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="navigate" size={22} color={colors.primary} />
          </TouchableOpacity>
          <View
            {...handlePanResponder.panHandlers}
            style={s.handleWrap}
            onLayout={(e) => { panelHandleHeightRef.current = e.nativeEvent.layout.height; }}
          >
            <View style={[s.handle, { backgroundColor: colors.border }]} />
            <Ionicons
              name={panelCollapsed ? 'chevron-up' : panelExpanded ? 'chevron-down' : 'chevron-up'}
              size={16}
              color={colors.textSecondary}
              style={{ marginTop: 2 }}
            />
          </View>

          {/* GPS кнопка + цена справа */}
          <View style={s.gpsLocatePriceRow}>
            <TouchableOpacity style={s.gpsLocateBtn} onPress={handleLocateMe} activeOpacity={0.8}>
              <Ionicons name="locate" size={16} color={colors.primary} />
              <Text style={[s.gpsLocateText, { color: colors.primary }]}>{t(lang, 'myLocation')}</Text>
            </TouchableOpacity>
            <Text style={[s.priceInline, { color: colors.primary }]}>
              {t(lang, 'happyTrip')}
            </Text>
          </View>

          {/* Выбор тарифа */}
          <View style={s.tariffRow}>
            <TouchableOpacity
              style={[s.tariffBtn, { borderColor: colors.border, backgroundColor: tariffType === 'standard' ? colors.primary : colors.card }]}
              onPress={() => setTariffType('standard')}
              activeOpacity={0.8}
            >
              <Ionicons name="car-outline" size={15} color={tariffType === 'standard' ? '#000' : colors.textSecondary} />
              <Text style={[s.tariffBtnText, { color: tariffType === 'standard' ? '#000' : colors.text }]}>{t(lang, 'standard')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.tariffBtn, { borderColor: colors.border, backgroundColor: tariffType === 'free' ? colors.primary : colors.card }]}
              onPress={() => setTariffType('free')}
              activeOpacity={0.8}
            >
              <Ionicons name="timer-outline" size={15} color={tariffType === 'free' ? '#000' : colors.textSecondary} />
              <Text style={[s.tariffBtnText, { color: tariffType === 'free' ? '#000' : colors.text }]}>{t(lang, 'free')}</Text>
            </TouchableOpacity>
          </View>

          {/* Route input card */}
          <View style={[s.inputCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
            {/* Pickup row */}
            <TouchableOpacity style={s.inputRow} onPress={() => enterMapMode('pickup')} activeOpacity={0.8}>
              <View style={s.dotGreen} />
              <Text
                style={[s.inputText, { color: pickupText ? colors.text : colors.textSecondary }]}
                numberOfLines={1}
              >
                {pickupText || t(lang, 'from')}
              </Text>
              <TouchableOpacity style={s.inputIconBtn} onPress={() => enterMapMode('pickup')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="map-outline" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </TouchableOpacity>

            {/* Destination row — только для стандартного тарифа */}
            {tariffType === 'standard' && (
              <>
                <View style={[s.inputConnector, { backgroundColor: colors.border }]} />
                <TouchableOpacity style={s.inputRow} onPress={() => enterMapMode('dest')} activeOpacity={0.8}>
                  <View style={s.dotRed} />
                  <Text
                    style={[s.inputText, { color: destText ? colors.text : colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {destText || t(lang, 'to')}
                  </Text>
                  <Ionicons name="map-outline" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Price display for standard tariff */}
          {tariffType === 'standard' && destCoords && roadDistanceKm != null && (
            <View style={{ alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>
                {calcPrice(roadDistanceKm).toLocaleString()} {t(lang, 'sum')}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                {roadDistanceKm.toFixed(1)} {t(lang, 'km')}
              </Text>
            </View>
          )}



          {/* Кнопка заказа */}
          {((tariffType === 'standard' && destCoords) || (tariffType === 'free' && pickupCoords)) && (
            <View style={s.orderSection}>
              <TouchableOpacity style={[s.orderBtn, { backgroundColor: colors.primary }]} onPress={handleOrder}>
                <Text style={s.orderBtnText}>
                  {tariffType === 'free' ? t(lang, 'callFree') : t(lang, 'orderTaxi')}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Recent trips — свайп-панель с историей */}
          {!panelCollapsed && recentTrips.length > 0 && (
            <Animated.View style={{ maxHeight: historyPanelHeight, overflow: 'hidden' }}>
              <View style={[s.historySection, { borderTopColor: colors.border }]}>
                <Text style={[s.historySectionTitle, { color: colors.textSecondary }]}>{t(lang, 'recentTrips')}</Text>
                <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                  {recentTrips.map((trip) => (
                    <TouchableOpacity
                      key={trip.id}
                      style={s.historyRow}
                      onPress={() => {
                        // Restore destination
                        if (trip.destination_address) setDestText(trip.destination_address);
                        if (trip.destination_lat && trip.destination_lng) {
                          setDestCoords({ latitude: Number(trip.destination_lat), longitude: Number(trip.destination_lng) });
                        } else {
                          enterMapMode('dest');
                        }
                        // Restore pickup (start) — это исправление: старт тоже должен обновляться
                        if (trip.pickup_address) setPickupText(trip.pickup_address);
                        if (trip.pickup_lat && trip.pickup_lng) {
                          const pickup = { latitude: Number(trip.pickup_lat), longitude: Number(trip.pickup_lng) };
                          setPickupCoords(pickup);
                          pickupLockedRef.current = true;
                        }
                        // Zoom map to show full route
                        if (trip.pickup_lat && trip.pickup_lng && trip.destination_lat && trip.destination_lng) {
                          const midLat = (Number(trip.pickup_lat) + Number(trip.destination_lat)) / 2;
                          const midLng = (Number(trip.pickup_lng) + Number(trip.destination_lng)) / 2;
                          const latD = Math.abs(Number(trip.pickup_lat) - Number(trip.destination_lat)) * 1.6 + 0.02;
                          const lngD = Math.abs(Number(trip.pickup_lng) - Number(trip.destination_lng)) * 1.6 + 0.02;
                          mapRef.current?.animateToRegion({ latitude: midLat, longitude: midLng, latitudeDelta: latD, longitudeDelta: lngD });
                        } else if (trip.destination_lat && trip.destination_lng) {
                          mapRef.current?.animateToRegion({ latitude: Number(trip.destination_lat), longitude: Number(trip.destination_lng), latitudeDelta: 0.02, longitudeDelta: 0.02 });
                        }
                        togglePanel();
                      }}
                    >
                      <View style={s.historyIconWrap}>
                        <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.historyText, { color: colors.text }]} numberOfLines={1}>
                          {trip.destination_address || t(lang, 'to')}
                        </Text>
                        {trip.pickup_address ? (
                          <Text style={[s.historySubText, { color: colors.textSecondary }]} numberOfLines={1}>
                            {t(lang, 'fromLabel')}: {trip.pickup_address}
                          </Text>
                        ) : null}
                      </View>
                      {trip.total_price ? (
                        <Text style={[s.historyMeta, { color: colors.primary }]}>
                          {parseFloat(trip.total_price).toLocaleString()} {t(lang, 'sum')}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </Animated.View>
          )}
        </Animated.View>
      )}

      {/* ── Map selection confirm bar ── */}
      {orderStatus === ORDER_STATUS.IDLE && mapMode && (
        <View style={[s.mapModeBar, { backgroundColor: colors.background, bottom: 0, paddingBottom: 16 }]}>
          {/* GPS navigate button — always visible during map selection */}
          <TouchableOpacity
            style={[s.floatingGpsBtn, { backgroundColor: colors.card, position: 'absolute', top: -56, right: 14 }]}
            onPress={async () => {
              let loc = userLocation;
              if (!loc) {
                try {
                  const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
                  if (lastKnown) loc = { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude };
                } catch {}
              }
              if (!loc) return;
              mapRef.current?.animateToRegion({ ...loc, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="navigate" size={22} color={colors.primary} />
          </TouchableOpacity>
          {/* Заголовок текущего режима */}
          <Text style={[s.mapModeLabel, { color: colors.textSecondary }]}>
            {mapMode === 'pickup' ? t(lang,'selectPickupPoint') : t(lang,'selectDestination')}
          </Text>
          {/* Locate me button — in pickup and dest mode */}
          {(mapMode === 'pickup' || mapMode === 'dest') && (
            <TouchableOpacity style={s.gpsLocateBtn} onPress={handleLocateMe} activeOpacity={0.8}>
              <Ionicons name="locate" size={16} color={colors.primary} />
              <Text style={[s.gpsLocateText, { color: colors.primary }]}>{t(lang, 'myLocation')}</Text>
            </TouchableOpacity>
          )}
          {mapMode === 'dest' && (
            <TextInput
              style={[s.mapInputText, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder={t(lang,'optionalName')}
              placeholderTextColor={colors.textSecondary}
              value={destInputText}
              onChangeText={setDestInputText}
            />
          )}
          <View style={s.mapModeBtns}>
            <TouchableOpacity style={[s.cancelMapBtn, { borderColor: colors.border }]} onPress={cancelMapMode}>
              <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>{t(lang,'back')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.confirmMapBtn, { backgroundColor: colors.primary }]} onPress={confirmMapSelection}>
              <Text style={{ color: '#000', fontWeight: '800', fontSize: 15 }}>
                {mapMode === 'pickup' ? t(lang,'fromHere') : t(lang,'toHere')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── SEARCHING panel ── */}
      {orderStatus === ORDER_STATUS.SEARCHING && (
        <View style={[s.panel, { backgroundColor: colors.background, bottom: 0, paddingBottom: 16 }]}>
          <View style={s.handleWrap}><View style={[s.handle, { backgroundColor: colors.border }]} /></View>
          <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: 8 }} />
          <Text style={[s.statusText, { color: colors.text }]}>{t(lang, 'searching')}</Text>
          <TouchableOpacity style={[s.cancelBtn, { borderColor: colors.border }]} onPress={handleCancel}>
            <Text style={{ color: colors.error }}>{t(lang, 'cancel')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── ACCEPTED / ARRIVED panel ── */}
      {(orderStatus === ORDER_STATUS.ACCEPTED || orderStatus === ORDER_STATUS.ARRIVED) && (
        <View style={[s.panel, { backgroundColor: colors.background, bottom: 0, paddingBottom: 16 }]}>
          <View style={s.handleWrap}><View style={[s.handle, { backgroundColor: colors.border }]} /></View>
          <Text style={[s.statusText, { color: colors.text }]}>
            {orderStatus === ORDER_STATUS.ACCEPTED ? t(lang, 'driverFound') : t(lang, 'driverArrived')}
          </Text>
          {driverInfo && (
            <View style={[s.driverCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={s.driverCardRow}>
                {driverInfo.avatar_url ? (
                  <Image source={{ uri: buildAvatarUrl(driverInfo.avatar_url) }} style={s.driverAvatar} />
                ) : (
                  <Image source={CAR_ICON} style={s.driverCardCarIcon} resizeMode="contain" />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[s.driverName, { color: colors.text }]}>{driverInfo.first_name} {driverInfo.last_name}</Text>
                  <Text style={[s.driverDetail, { color: colors.textSecondary }]}>📱 {driverInfo.phone}</Text>
                  <Text style={[s.driverDetail, { color: colors.primary, fontWeight: '700' }]}>🚗 {driverInfo.car_number}</Text>
                  {driverInfo.average_rating > 0 && (
                    <Text style={{ color: '#FFC107', fontSize: 13, marginTop: 2 }}>
                      {'★'.repeat(Math.round(driverInfo.average_rating))}{'☆'.repeat(5 - Math.round(driverInfo.average_rating))}
                      {'  '}
                      <Text style={{ color: colors.textSecondary }}>{Number(driverInfo.average_rating).toFixed(1)} ({driverInfo.rating_count})</Text>
                    </Text>
                  )}
                </View>
              </View>
            </View>
          )}
          {estimatedPrice != null && (
            <Text style={[s.priceText, { color: colors.primary }]}>
              {estimatedPrice.toLocaleString()} {t(lang, 'sum')}
            </Text>
          )}
          <TouchableOpacity style={[s.cancelBtn, { borderColor: colors.border }]} onPress={handleCancel}>
            <Text style={{ color: colors.error }}>{t(lang, 'cancel')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── IN_PROGRESS panel ── */}
      {orderStatus === ORDER_STATUS.IN_PROGRESS && (
        <View style={[s.panel, { backgroundColor: colors.background, bottom: 0, paddingBottom: 16, maxHeight: puzzleStarted ? '100%' : undefined }]}>
          <View style={s.handleWrap}><View style={[s.handle, { backgroundColor: colors.border }]} /></View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={[s.statusText, { color: colors.text }]}>{t(lang, 'tripInProgress')}</Text>
          {driverInfo && (
            <View style={[s.driverCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={s.driverCardRow}>
                {driverInfo.avatar_url ? (
                  <Image source={{ uri: buildAvatarUrl(driverInfo.avatar_url) }} style={s.driverAvatar} />
                ) : (
                  <Image source={CAR_ICON} style={s.driverCardCarIcon} resizeMode="contain" />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[s.driverName, { color: colors.text }]}>{driverInfo.first_name} {driverInfo.last_name}</Text>
                  <Text style={[s.driverDetail, { color: colors.primary, fontWeight: '700' }]}>🚗 {driverInfo.car_number}</Text>
                </View>
              </View>
            </View>
          )}
          <View style={s.progressBar}>
            <View style={[s.progressFill, { backgroundColor: colors.primary }]} />
          </View>
          {tariffType === 'free' ? (
            <View style={{ alignItems: 'center', marginTop: 8 }}>
              <Text style={[s.priceText, { color: colors.primary }]}>
                {(() => {
                  const sf = Number(pricingSettings.service_fee) || 2000;
                  const ppk = lockedPricePerKm || Number(pricingSettings.price_per_km) || 2000;
                  const surge = Number(pricingSettings.surge_multiplier) || 1;
                  const meters = freeRideKm * 1000;
                  const roundedKm = (meters < 1 ? 100 : Math.ceil(meters / 100) * 100) / 1000;
                  return Math.ceil((sf + roundedKm * ppk * surge) / 100) * 100;
                })().toLocaleString()} {t(lang, 'sum')}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
                {freeRideKm.toFixed(1)} {t(lang, 'km')}
              </Text>
            </View>
          ) : estimatedPrice != null ? (
            <Text style={[s.priceText, { color: colors.primary }]}>
              {estimatedPrice.toLocaleString()} {t(lang, 'sum')}
            </Text>
          ) : null}

          {/* ── Puzzle game — показывается только когда водитель взял заказ (полная панель) ── */}
          {driverInfo && (
            <PuzzleGame
              colors={colors}
              user={user}
              onScoreSubmit={(scoreData) => {
                quizAPI.submitScore(scoreData).catch(() => {});
              }}
            />
          )}
          </ScrollView>
        </View>
      )}

      {/* ── Rating modal — slides up from bottom after trip completion ── */}
      {ratingModalVisible && (
        <View style={[s.ratingModal, { backgroundColor: colors.background, position: 'absolute', left: 0, right: 0, bottom: 0 }]}>
          <Text style={[s.ratingTitle, { color: colors.text }]}>{t(lang, 'thankYou')}</Text>
          {completedPrice != null && (
            <Text style={[s.ratingPrice, { color: colors.primary }]}>
              {t(lang, 'total')}: {completedPrice.toLocaleString()} {t(lang,'sum')}
            </Text>
          )}
          <Text style={[s.ratingSubtitle, { color: colors.textSecondary }]}>
            {t(lang, 'rateDriver')}
          </Text>
          <View style={s.starsRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity key={star} onPress={() => setSelectedRating(star)} activeOpacity={0.7} style={s.starBtn}>
                <Text style={[s.starIcon, { color: star <= selectedRating ? '#FFC107' : colors.border }]}>★</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.ratingActions}>
            <TouchableOpacity
              style={[s.ratingSkipBtn, { borderColor: colors.border }]}
              onPress={async () => { setRatingModalVisible(false); resetOrder(); try { const { data } = await orderAPI.getHistory(); const t2 = (data.orders||[]).filter(o=>o.status==='completed').slice(0,10); setRecentTrips(t2); recentTripsRef.current = t2; } catch {} }}
            >
              <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>{t(lang, 'skip')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.ratingSubmitBtn, { backgroundColor: selectedRating > 0 ? colors.primary : colors.border }]}
              disabled={selectedRating === 0}
              onPress={async () => {
                if (completedOrderId && selectedRating > 0) {
                  try {
                    await orderAPI.rateDriver(completedOrderId, selectedRating);
                  } catch (e) {
                    Alert.alert(t(lang, 'error'), e.response?.data?.error || 'Rating failed');
                  }
                }
                setRatingModalVisible(false);
                resetOrder();
                try { const { data } = await orderAPI.getHistory(); const t2 = (data.orders||[]).filter(o=>o.status==='completed').slice(0,10); setRecentTrips(t2); recentTripsRef.current = t2; } catch {}
              }}
            >
              <Text style={{ color: '#000', fontWeight: '800' }}>{t(lang, 'send')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1 },
    map: { flex: 1 },

    locationBtn: {
      position: 'absolute',
      backgroundColor: colors.background, borderRadius: 24,
      padding: 10, elevation: 6, shadowOpacity: 0.25, shadowRadius: 6, shadowColor: '#000',
    },

    // Center crosshair
    centerPinContainer: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      justifyContent: 'center', alignItems: 'center',
    },
    centerPinShadow: {
      position: 'absolute',
      width: 16, height: 4, borderRadius: 8,
      backgroundColor: 'rgba(0,0,0,0.25)',
      marginTop: 40,
    },
    centerPinIcon: { fontSize: 40, lineHeight: 42 },

    // Bottom panels
    panel: {
      position: 'absolute', left: 0, right: 0,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      paddingHorizontal: 16, paddingTop: 0,
      elevation: 14, shadowOpacity: 0.15, shadowRadius: 8, shadowColor: '#000',
    },
    handleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
    handle: { width: 44, height: 4, borderRadius: 2 },

    // Input card
    inputCard: { borderWidth: 1, borderRadius: 14, overflow: 'hidden', marginBottom: 10 },
    inputRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13 },
    inputConnector: { height: 1, marginLeft: 36, marginRight: 14 },
    dotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#43A047', marginRight: 12 },
    dotRed: { width: 10, height: 10, borderRadius: 3, backgroundColor: '#E53935', marginRight: 12 },
    inputText: { flex: 1, fontSize: 15 },
    inputIconBtn: { paddingLeft: 10, padding: 4 },

    // GPS кнопка + цена в одной строке
    gpsLocatePriceRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 6, marginBottom: 6,
    },
    gpsLocateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    gpsLocateText: { fontSize: 14, fontWeight: '600' },
    priceInline: { fontSize: 14, fontWeight: '700' },

    // Floating GPS button
    floatingGpsBtn: {
      position: 'absolute', right: 14, width: 44, height: 44,
      borderRadius: 22, alignItems: 'center', justifyContent: 'center',
      elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25, shadowRadius: 3,
    },

    // Выбор тарифа
    tariffRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    tariffBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 5, paddingVertical: 9, borderRadius: 12, borderWidth: 1,
    },
    tariffBtnText: { fontSize: 13, fontWeight: '700' },

    // Order section
    orderSection: { marginBottom: 6 },
    priceHint: { textAlign: 'center', marginBottom: 8, fontSize: 14 },
    orderBtn: { borderRadius: 14, padding: 14, alignItems: 'center' },
    orderBtnText: { fontWeight: '800', fontSize: 16, color: '#000' },


    // Recent trips
    historySection: { borderTopWidth: 1, marginTop: 8, paddingTop: 6 },
    historySectionTitle: { fontSize: 12, fontWeight: '600', marginLeft: 4, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
    historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
    historyIconWrap: { width: 30, alignItems: 'center' },
    historyText: { flex: 1, fontSize: 14, fontWeight: '500' },
    historySubText: { fontSize: 12, marginTop: 1 },
    historyMeta: { fontSize: 13, fontWeight: '700', marginLeft: 8 },

    // Map selection confirm bar
    mapModeBar: {
      position: 'absolute', left: 0, right: 0,
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16,
      elevation: 14, shadowOpacity: 0.15, shadowRadius: 8, shadowColor: '#000',
    },
    mapModeLabel: { fontSize: 12, textAlign: 'center', marginBottom: 10 },
    mapInputText: {
      borderWidth: 1, borderRadius: 10, padding: 10,
      fontSize: 14, marginBottom: 10,
    },
    mapModeBtns: { flexDirection: 'row', gap: 10 },
    cancelMapBtn: { flex: 1, borderWidth: 1.5, borderRadius: 14, padding: 13, alignItems: 'center' },
    confirmMapBtn: { flex: 2, borderRadius: 14, padding: 13, alignItems: 'center' },

    // Status panels
    statusText: { textAlign: 'center', fontSize: 17, fontWeight: '600', marginVertical: 8 },
    cancelBtn: { borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 8 },
    priceText: { textAlign: 'center', fontSize: 22, fontWeight: '800', marginBottom: 8 },
    progressBar: { height: 6, backgroundColor: colors.border, borderRadius: 3, marginVertical: 12 },
    progressFill: { height: 6, width: '60%', borderRadius: 3 },

    // Driver card
    driverCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
    driverCardRow: { flexDirection: 'row', alignItems: 'center' },
    driverCardIcon: { fontSize: 32, marginRight: 12 },
    driverCardCarIcon: { width: 40, height: 40, marginRight: 12 },
    driverAvatar: { width: 48, height: 48, borderRadius: 24, marginRight: 12 },
    carIcon: { width: 44, height: 44 },
    driverName: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
    driverDetail: { fontSize: 13, marginTop: 2 },

    // Teardrop map pin
    pinWrap: { alignItems: 'center' },
    pinHead: {
      width: 36, height: 36, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 5, shadowOffset: { width: 0, height: 3 },
      elevation: 8,
    },
    pinHeadDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.9)' },
    pinTail: {
      width: 0, height: 0,
      borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 14,
      borderLeftColor: 'transparent', borderRightColor: 'transparent',
    },
    // User location dot
    userDotOuter: {
      width: 22, height: 22, borderRadius: 11,
      backgroundColor: 'rgba(66,133,244,0.25)',
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderColor: 'rgba(66,133,244,0.4)',
    },
    userDotInner: {
      width: 13, height: 13, borderRadius: 6.5,
      backgroundColor: '#4285F4',
      borderWidth: 2, borderColor: '#fff',
      shadowColor: '#4285F4', shadowOpacity: 0.6, shadowRadius: 4, elevation: 5,
    },

    // Rating modal (bottom sheet)
    ratingModal: {
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 24, paddingBottom: 36,
      elevation: 20, shadowOpacity: 0.3, shadowRadius: 10, shadowColor: '#000',
      alignItems: 'center',
    },
    ratingTitle: { fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
    ratingPrice: { fontSize: 22, fontWeight: '900', marginBottom: 4 },
    ratingSubtitle: { fontSize: 14, marginBottom: 16, textAlign: 'center' },
    starsRow: { flexDirection: 'row', gap: 6, marginBottom: 24 },
    starBtn: { padding: 4 },
    starIcon: { fontSize: 42, lineHeight: 46 },
    ratingActions: { flexDirection: 'row', gap: 12, width: '100%', marginTop: 4 },
    ratingSkipBtn: {
      flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5,
      alignItems: 'center', justifyContent: 'center', minHeight: 48,
    },
    ratingSubmitBtn: {
      flex: 1, paddingVertical: 14, borderRadius: 14,
      alignItems: 'center', justifyContent: 'center', minHeight: 48,
    },


  });
}
