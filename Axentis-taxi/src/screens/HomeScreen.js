import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Alert, Image,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { authAPI, orderAPI } from '../services/api';
import socket from '../services/socket';
import { t } from '../i18n';
import { initializeNotifications, getExpoPushToken } from '../services/notifications';

const CAR_ICON = require('../../assets/car-photo.png');

// Обратное геокодирование: координаты → название улицы/района
async function reverseGeocode(coords) {
  try {
    const results = await Location.reverseGeocodeAsync(coords);
    if (results?.length > 0) {
      const r = results[0];
      const parts = [r.name, r.street, r.district, r.city].filter(Boolean);
      if (parts.length > 0) return parts.slice(0, 2).join(', ');
    }
  } catch {}
  return `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
}

// Расчёт цены: 2000 сум за заказ + 200 сум за каждые 100м (ceil)
function calcPrice(distanceKm) {
  const blocks = Math.ceil(distanceKm * 10);
  return 2000 + Math.max(blocks, 1) * 200;
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
  const [availableDrivers, setAvailableDrivers] = useState([]);
  const [recentTrips, setRecentTrips] = useState([]);

  // Keep sharingLocationRef in sync with profile changes
  useEffect(() => {
    sharingLocationRef.current = user?.share_live_location !== false;
  }, [user?.share_live_location]);

  // Вычисляем высоту панели для позиционирования GPS-кнопки
  const PANEL_HEIGHT = 190;

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
      // Сразу входим в режим выбора точки отправления
      setMapMode('pickup');
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
          .slice(0, 3);
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
      // После выбора «Отсюда» автоматически переходим к выбору «Куда»
      setMapMode('dest');
      reverseGeocode(coords).then((label) => setPickupText(label));
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

  function resetPickupToGPS() {
    pickupLockedRef.current = false;
    if (userLocation) {
      setPickupCoords(userLocation);
      setPickupText(t(lang, 'yourLocation'));
    }
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
        showsUserLocation
        showsMyLocationButton={false}
      >
        {/* Available drivers while idle — car icon rotated by heading (+180° because front of PNG faces down) */}
        {orderStatus === ORDER_STATUS.IDLE && availableDrivers.map((driver) => (
          <Marker
            key={driver.user_id}
            coordinate={{ latitude: driver.lat, longitude: driver.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={((driver.heading ?? 0) + 180) % 360}
          >
            <Image source={CAR_ICON} style={s.carIcon} resizeMode="contain" />
          </Marker>
        ))}

        {/* Пин отправления — простая иконка, без надписи A */}
        {pickupCoords && !mapMode && (
          <Marker coordinate={pickupCoords} anchor={{ x: 0.5, y: 1 }}>
            <Text style={{ fontSize: 30, lineHeight: 32 }}>📍</Text>
          </Marker>
        )}
        {/* Пин назначения — чистый пин без уродливого квадрата B */}
        {destCoords && !mapMode && (
          <Marker coordinate={destCoords} anchor={{ x: 0.5, y: 1 }}>
            <Text style={{ fontSize: 30, lineHeight: 32 }}>🚩</Text>
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
            rotation={((driverDisplayLocation.heading ?? 0) + 180) % 360}
          >
            <Image source={CAR_ICON} style={s.carIcon} resizeMode="contain" />
          </Marker>
        )}
        {routeCoords.length >= 2 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={routeColor}
            strokeWidth={4}
            lineDashPattern={orderStatus === ORDER_STATUS.ACCEPTED ? [8, 4] : undefined}
          />
        )}
      </MapView>

      {/* Center crosshair during map selection */}
      {mapMode && (
        <View style={s.centerPinContainer} pointerEvents="none">
          <View style={s.centerPinShadow} />
          <Text style={s.centerPinIcon}>{mapMode === 'pickup' ? '📍' : '🎯'}</Text>
        </View>
      )}

      {/* GPS кнопка — чуть выше панели, справа */}
      <TouchableOpacity
        style={[
          s.locationBtn,
          { bottom: tabBarHeight + PANEL_HEIGHT + 12, right: 16 },
        ]}
        onPress={() => {
          if (userLocation) {
            pickupLockedRef.current = false;
            setPickupCoords(userLocation);
            setPickupText('Ваше местоположение');
            mapRef.current?.animateToRegion({ ...userLocation, latitudeDelta: 0.02, longitudeDelta: 0.02 });
          }
        }}
      >
        <Text style={{ fontSize: 22 }}>📍</Text>
      </TouchableOpacity>

      {/* ── IDLE panel ── */}
      {orderStatus === ORDER_STATUS.IDLE && !mapMode && (
        <View style={[s.panel, { backgroundColor: colors.background, bottom: 0, paddingBottom: 16 }]}>
          <View style={s.handleWrap}>
            <View style={[s.handle, { backgroundColor: colors.border }]} />
          </View>

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
                <Text style={{ fontSize: 18 }}>🗺️</Text>
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
                <Text style={{ fontSize: 18 }}>🗺️</Text>
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

          {/* Recent trips quick-select */}
          {recentTrips.length > 0 && (
            <View style={[s.historySection, { borderTopColor: colors.border }]}>
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
                  }}
                >
                  <Text style={{ fontSize: 14, marginRight: 10, color: colors.textSecondary }}>🕐</Text>
                  <Text style={[s.historyText, { color: colors.text }]} numberOfLines={1}>
                    {trip.destination_address || t(lang, 'to')}
                  </Text>
                  {trip.total_price ? (
                    <Text style={[s.historyMeta, { color: colors.textSecondary }]}>
                      {parseFloat(trip.total_price).toLocaleString()} {t(lang, 'sum')}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
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
    handleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 8 },
    handle: { width: 44, height: 4, borderRadius: 2 },

    // Input card
    inputCard: { borderWidth: 1, borderRadius: 14, overflow: 'hidden', marginBottom: 10 },
    inputRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13 },
    inputConnector: { height: 1, marginLeft: 36, marginRight: 14 },
    dotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#43A047', marginRight: 12 },
    dotRed: { width: 10, height: 10, borderRadius: 3, backgroundColor: '#E53935', marginRight: 12 },
    inputText: { flex: 1, fontSize: 15 },
    inputIconBtn: { paddingLeft: 10, padding: 4 },

    // Order section
    orderSection: { marginBottom: 6 },
    priceHint: { textAlign: 'center', marginBottom: 8, fontSize: 14 },
    orderBtn: { borderRadius: 14, padding: 14, alignItems: 'center' },
    orderBtnText: { fontWeight: '800', fontSize: 16, color: '#000' },

    // Recent trips
    historySection: { borderTopWidth: 1, marginTop: 8, paddingTop: 6 },
    historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
    historyText: { flex: 1, fontSize: 14 },
    historyMeta: { fontSize: 12, marginLeft: 8 },

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

    // Map markers
    markerPickup: { backgroundColor: '#43A047', borderRadius: 8, padding: 6, borderWidth: 2, borderColor: '#fff' },
    markerDest: { backgroundColor: '#E53935', borderRadius: 8, padding: 6, borderWidth: 2, borderColor: '#fff' },
    markerText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  });
}
