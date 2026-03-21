import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Alert, Image, Animated, ScrollView,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { authAPI, orderAPI } from '../services/api';
import socket from '../services/socket';
import { t } from '../i18n';
import { initializeNotifications, getExpoPushToken } from '../services/notifications';

const CAR_ICON    = require('../../assets/car-photo.png');
const PICKUP_ICON = require('../../assets/location-pin.png');
const DEST_ICON   = require('../../assets/finish-flag.png');
const USER_ICON   = require('../../assets/user-location.png');

// Обратное геокодирование: улица + номер дома + город (без районов)
async function reverseGeocode(coords) {
  // 1. Nominatim zoom=18
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?lat=${coords.latitude}&lon=${coords.longitude}` +
      `&format=json&addressdetails=1&zoom=18&accept-language=ru`;
    const res = await fetch(url, { headers: { 'User-Agent': 'AxentisTaxi/1.0' } });
    const json = await res.json();
    if (json.address) {
      const a = json.address;
      const road = a.road || a.pedestrian || a.footway || a.path || a.residential || a.neighbourhood;
      const number = a.house_number;
      // Только город/посёлок — без county/district/state
      const city = a.city || a.town || a.village;
      if (road) return [road, number, city].filter(Boolean).join(', ');
      if (city) return city;
    }
  } catch {}
  // 2. Fallback: expo-location (Google данные на Android)
  try {
    const results = await Location.reverseGeocodeAsync(coords);
    if (results?.length > 0) {
      const r = results[0];
      const city = r.city || r.subregion;
      const street = r.street || r.name;
      if (street) return [street, r.streetNumber, city].filter(Boolean).join(', ');
      if (city) return city;
    }
  } catch {}
  return `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
}

// Маршрут по реальным дорогам: два OSRM источника с актуальным покрытием ЦА
async function fetchRoadRoute(pickup, dest) {
  const lng1 = pickup.longitude, lat1 = pickup.latitude;
  const lng2 = dest.longitude,   lat2 = dest.latitude;

  // 1. routing.openstreetmap.de — актуальные данные OSM, лучшее покрытие
  const c1 = new AbortController();
  const t1 = setTimeout(() => c1.abort(), 10000);
  try {
    const url = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: c1.signal });
    clearTimeout(t1);
    const json = await res.json();
    if (json.routes?.[0]?.geometry?.coordinates?.length > 1) {
      return json.routes[0].geometry.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
    }
  } catch { clearTimeout(t1); }

  // 2. Fallback: router.project-osrm.org
  const c2 = new AbortController();
  const t2 = setTimeout(() => c2.abort(), 10000);
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: c2.signal });
    clearTimeout(t2);
    const json = await res.json();
    if (json.routes?.[0]?.geometry?.coordinates?.length > 1) {
      return json.routes[0].geometry.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
    }
  } catch { clearTimeout(t2); }

  return [pickup, dest];
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
  active: { accuracy: Location.Accuracy.High,     timeInterval: 200,   distanceInterval: 2  },
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
  const [driverDisplayLocation, setDriverDisplayLocation] = useState(null);
  const [driverInfo, setDriverInfo] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  // tracksViewChanges=true пока иконки не загрузились, затем false — без мигания
  const [iconsReady, setIconsReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setIconsReady(true), 800);
    return () => clearTimeout(t);
  }, []);
  const [routePreviewCoords, setRoutePreviewCoords] = useState([]);
  const [availableDrivers, setAvailableDrivers] = useState([]);
  const [recentTrips, setRecentTrips] = useState([]);
  const [panelHeight, setPanelHeight] = useState(190);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [dashPhase, setDashPhase] = useState(0);
  const [pricingSettings, setPricingSettings] = useState({ service_fee: 2000, price_per_km: 2000, surge_multiplier: 1.0 });

  // Анимация пунктира "последней мили
  useEffect(() => {
    const timer = setInterval(() => {
      setDashPhase((prev) => (prev + 1.5) % 22);
    }, 40);
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
    const base = Number(pricingSettings.service_fee) || 2000;
    const perKm = Number(pricingSettings.price_per_km) || 2000;
    const surge = Number(pricingSettings.surge_multiplier) || 1;
    // Сервисный сбор + км × цена_за_км × коэффициент
    // Округление ВВЕРХ до ближайших 200 сум (минимальная денежная единица в Узбекистане)
    const raw = (base + distanceKm * perKm) * surge;
    return Math.ceil(raw / 200) * 200;
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
    fetchRoadRoute(pickupCoords, destCoords).then((coords) => {
      if (!cancelled) setRoutePreviewCoords(coords);
    });
    return () => { cancelled = true; };
  }, [pickupCoords, destCoords]);

  // ── Mount: permissions, GPS, push token, recent trips ────────────────────
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserLocation(coords);
      setPickupCoords(coords);
      setPickupText(t(lang, 'yourLocation'));
      setRegion({ ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 });
      // Фоновое геокодирование текущей позиции
      reverseGeocode(coords).then((label) => setPickupText(label));
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

    (async () => {
      try {
        const { data } = await orderAPI.getHistory();
        const completed = (data.orders || [])
          .filter((o) => o.status === 'completed')
          .slice(0, 10);
        setRecentTrips(completed);
      } catch {}
    })();

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
        if (!pickupLockedRef.current) {
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
  // Receives updates at 10ms from WS; lerps display to target every 16ms (60fps)
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
      const lerp = (a, b) => a + (b - a) * 0.25;
      const next = {
        latitude: lerp(display.latitude, target.latitude),
        longitude: lerp(display.longitude, target.longitude),
        heading: target.heading,
      };
      driverDisplayRef.current = next;
      setDriverDisplayLocation({ ...next });
    }, 16);

    return () => clearInterval(smoothTimerRef.current);
  }, [orderStatus]);

  useEffect(() => { orderStatusRef.current = orderStatus; }, [orderStatus]);
  useEffect(() => { orderIDRef.current = orderID; }, [orderID]);

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

  // Socket events
  useEffect(() => {
    if (!user?.id) return;

    socket.on('order_accepted', (data) => {
      setOrderStatus(ORDER_STATUS.ACCEPTED);
      setDriverInfo(data.driver || null);
    });
    socket.on('driver_arrived', () => { setOrderStatus(ORDER_STATUS.ARRIVED); });
    socket.on('trip_started', () => { setOrderStatus(ORDER_STATUS.IN_PROGRESS); });
    socket.on('trip_completed', (data) => {
      setOrderStatus(ORDER_STATUS.COMPLETED);
      Alert.alert(t(lang,'tripCompleted'), `${t(lang,'total')}: ${data.total_price?.toLocaleString()} ${t(lang,'sum')}`, [
        { text: 'OK', onPress: resetOrder },
      ]);
    });
    socket.on('driver_location', (data) => {
      const pos = { latitude: data.lat, longitude: data.lng, heading: data.heading ?? 0 };
      driverTargetRef.current = pos;
      setDriverLocation(pos);
      setRouteCoords([
        { latitude: data.lat, longitude: data.lng },
        orderStatusRef.current === ORDER_STATUS.IN_PROGRESS ? destCoords : pickupCoords,
      ].filter(Boolean));
    });
    socket.on('no_drivers', () => {
      setOrderStatus(ORDER_STATUS.IDLE);
      Alert.alert(t(lang, 'noDriversTitle'), t(lang, 'noDriversFound'));
    });
    socket.on('order_cancelled', () => {
      Alert.alert(t(lang,'orderCancelled'), t(lang,'orderCancelledByDriver'));
      resetOrder();
    });

    return () => {
      ['order_accepted','driver_arrived','trip_started','trip_completed',
       'driver_location','no_drivers','order_cancelled'].forEach(socket.off.bind(socket));
    };
  }, [user, pickupCoords, destCoords, lang]);

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
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        use = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setUserLocation(use);
      } catch { return; }
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
    if (!pickupCoords || !destCoords) {
      Alert.alert(t(lang, 'error'), t(lang, 'selectDestHint'));
      return;
    }
    setOrderStatus(ORDER_STATUS.SEARCHING);
    const distKm = calcDistanceKm(pickupCoords, destCoords);
    try {
      const { data } = await orderAPI.createOrder({
        pickup_lat: pickupCoords.latitude,
        pickup_lng: pickupCoords.longitude,
        pickup_address: pickupText,
        destination_lat: destCoords.latitude,
        destination_lng: destCoords.longitude,
        destination_address: destText,
        distance_km: distKm,
      });
      setOrderID(data.order_id);
      setEstimatedPrice(data.total_price);
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
        {/* Позиция пользователя — острый конец значка указывает на точку */}
        {userLocation && (
          <Marker coordinate={userLocation} anchor={{ x: 0.5, y: 0.85 }} zIndex={10} tracksViewChanges={!iconsReady}>
            <Image source={USER_ICON} style={{ width: 36, height: 36 }} resizeMode="contain" />
          </Marker>
        )}

        {/* Available drivers while idle — car icon rotated by heading (+180° because front of PNG faces down) */}
        {orderStatus === ORDER_STATUS.IDLE && availableDrivers.map((driver) => (
          <Marker
            key={driver.user_id}
            coordinate={{ latitude: driver.lat, longitude: driver.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            tracksViewChanges={!iconsReady}
            rotation={((driver.heading ?? 0) + 180) % 360}
          >
            <Image source={CAR_ICON} style={s.carIcon} resizeMode="contain" />
          </Marker>
        ))}

        {/* Пин отправления */}
        {pickupCoords && !mapMode && (
          <Marker coordinate={pickupCoords} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={!iconsReady}>
            <Image source={PICKUP_ICON} style={{ width: 40, height: 40 }} resizeMode="contain" />
          </Marker>
        )}
        {/* Пин назначения */}
        {destCoords && !mapMode && (
          <Marker coordinate={destCoords} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={!iconsReady}>
            <Image source={DEST_ICON} style={{ width: 40, height: 40 }} resizeMode="contain" />
          </Marker>
        )}

        {/* Active driver car - smoothly interpolated from 10ms WS updates (+180° because front of PNG faces down) */}
        {driverDisplayLocation && (
          <Marker
            coordinate={{
              latitude: driverDisplayLocation.latitude,
              longitude: driverDisplayLocation.longitude,
            }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            tracksViewChanges={!iconsReady}
            rotation={((driverDisplayLocation.heading ?? 0) + 180) % 360}
          >
            <Image source={CAR_ICON} style={s.carIcon} resizeMode="contain" />
          </Marker>
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

        {/* Последняя миля: анимированный пунктир от конца дороги до финишного пина */}
        {routePreviewCoords.length >= 2 && destCoords && !mapMode && (() => {
          const lastPt = routePreviewCoords[routePreviewCoords.length - 1];
          const dist = Math.abs(lastPt.latitude - destCoords.latitude) +
                       Math.abs(lastPt.longitude - destCoords.longitude);
          if (dist < 0.00005) return null;
          // Адаптивный размер точек: визуально ~10px при любом зуме
          const dot  = Math.round(Math.max(5,  Math.min(40, 10 / (region.latitudeDelta * 100))));
          const gap  = Math.round(dot * 1.6);
          return (
            <Polyline
              coordinates={[lastPt, destCoords]}
              strokeColor="#FFCC00"
              strokeWidth={4}
              lineDashPattern={[dot, gap]}
              lineDashPhase={dashPhase}
              geodesic
            />
          );
        })()}

        {/* Маршрут водителя: driver → pickup / destination */}
        {routeCoords.length >= 2 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={routeColor}
            strokeWidth={5}
            geodesic
            lineCap="round"
            lineJoin="round"
            lineDashPattern={orderStatus === ORDER_STATUS.ACCEPTED ? [8, 4] : undefined}
          />
        )}
      </MapView>

      {/* Center crosshair during map selection — PNG иконка, острый кончик в центре экрана */}
      {mapMode && (
        <View style={s.centerPinContainer} pointerEvents="none">
          <Image
            source={mapMode === 'pickup' ? PICKUP_ICON : DEST_ICON}
            style={{ width: 48, height: 48, marginTop: -24 }}
            resizeMode="contain"
          />

        </View>
      )}



      {/* ── IDLE panel ── */}
      {orderStatus === ORDER_STATUS.IDLE && !mapMode && (
        <View
          style={[s.panel, { backgroundColor: colors.background, bottom: 0, paddingBottom: 16 }]}
          onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
        >
          <TouchableOpacity style={s.handleWrap} onPress={togglePanel} activeOpacity={0.7}>
            <View style={[s.handle, { backgroundColor: colors.border }]} />
            <Ionicons
              name={panelExpanded ? 'chevron-down' : 'chevron-up'}
              size={16}
              color={colors.textSecondary}
              style={{ marginTop: 2 }}
            />
          </TouchableOpacity>

          {/* Кнопка «Моё местоположение» — над полями ввода, внутри панели */}
          <TouchableOpacity
            style={s.gpsLocateRow}
            onPress={handleLocateMe}
            activeOpacity={0.8}
          >
            <Ionicons name="locate" size={16} color={colors.primary} />
            <Text style={[s.gpsLocateText, { color: colors.primary }]}>Моё местоположение</Text>
          </TouchableOpacity>

          {/* Route input card */}
          <View style={[s.inputCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
            {/* Pickup row — тап входит в режим выбора на карте */}
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

            <View style={[s.inputConnector, { backgroundColor: colors.border }]} />

            {/* Destination row */}
            <View style={s.inputRow}>
              <View style={s.dotRed} />
              <TextInput
                style={[s.inputText, { color: colors.text, flex: 1 }]}
                placeholder={t(lang, 'to')}
                placeholderTextColor={colors.textSecondary}
                value={destText}
                onChangeText={(text) => {
                  setDestText(text);
                  if (!text) setDestCoords(null);
                }}
              />
              <TouchableOpacity style={s.inputIconBtn} onPress={() => enterMapMode('dest')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="map-outline" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Price + order button */}
          {destCoords && (
            <View style={s.orderSection}>
              <Text style={[s.priceHint, { color: colors.textSecondary }]}>
                ~{calcPrice(calcDistanceKm(pickupCoords, destCoords)).toLocaleString()} {t(lang, 'sum')}
              </Text>
              <TouchableOpacity style={[s.orderBtn, { backgroundColor: colors.primary }]} onPress={handleOrder}>
                <Text style={s.orderBtnText}>{t(lang, 'orderTaxi')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Recent trips — свайп-панель с историей */}
          {recentTrips.length > 0 && (
            <Animated.View style={{ maxHeight: historyPanelHeight, overflow: 'hidden' }}>
              <View style={[s.historySection, { borderTopColor: colors.border }]}>
                <Text style={[s.historySectionTitle, { color: colors.textSecondary }]}>Недавние поездки</Text>
                <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                  {recentTrips.map((trip) => (
                    <TouchableOpacity
                      key={trip.id}
                      style={s.historyRow}
                      onPress={() => {
                        if (trip.destination_address) setDestText(trip.destination_address);
                        if (trip.destination_lat && trip.destination_lng) {
                          const coords = { latitude: Number(trip.destination_lat), longitude: Number(trip.destination_lng) };
                          setDestCoords(coords);
                          mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 });
                        } else {
                          enterMapMode('dest');
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
                            Из: {trip.pickup_address}
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
        </View>
      )}

      {/* ── Map selection confirm bar ── */}
      {orderStatus === ORDER_STATUS.IDLE && mapMode && (
        <View style={[s.mapModeBar, { backgroundColor: colors.background, bottom: 0, paddingBottom: 16 }]}>
          {/* Заголовок текущего режима */}
          <Text style={[s.mapModeLabel, { color: colors.textSecondary }]}>
            {mapMode === 'pickup' ? t(lang,'selectPickupPoint') : t(lang,'selectDestination')}
          </Text>
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
                <Image source={CAR_ICON} style={s.driverCardCarIcon} resizeMode="contain" />
                <View style={{ flex: 1 }}>
                  <Text style={[s.driverName, { color: colors.text }]}>{driverInfo.first_name} {driverInfo.last_name}</Text>
                  <Text style={[s.driverDetail, { color: colors.textSecondary }]}>📱 {driverInfo.phone}</Text>
                  <Text style={[s.driverDetail, { color: colors.primary, fontWeight: '700' }]}>🚗 {driverInfo.car_number}</Text>
                </View>
              </View>
            </View>
          )}
          <Text style={[s.priceText, { color: colors.primary }]}>{estimatedPrice?.toLocaleString()} {t(lang, 'sum')}</Text>
          <TouchableOpacity style={[s.cancelBtn, { borderColor: colors.border }]} onPress={handleCancel}>
            <Text style={{ color: colors.error }}>{t(lang, 'cancel')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── IN_PROGRESS panel ── */}
      {orderStatus === ORDER_STATUS.IN_PROGRESS && (
        <View style={[s.panel, { backgroundColor: colors.background, bottom: 0, paddingBottom: 16 }]}>
          <View style={s.handleWrap}><View style={[s.handle, { backgroundColor: colors.border }]} /></View>
          <Text style={[s.statusText, { color: colors.text }]}>{t(lang, 'tripInProgress')}</Text>
          {driverInfo && (
            <View style={[s.driverCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={s.driverCardRow}>
                <Image source={CAR_ICON} style={s.driverCardCarIcon} resizeMode="contain" />
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
          <Text style={[s.priceText, { color: colors.primary }]}>{estimatedPrice?.toLocaleString()} {t(lang, 'sum')}</Text>
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

    // GPS locate button inside panel
    gpsLocateRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 8, marginBottom: 6, gap: 8,
    },
    gpsLocateText: { fontSize: 14, fontWeight: '600' },

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
  });
}
