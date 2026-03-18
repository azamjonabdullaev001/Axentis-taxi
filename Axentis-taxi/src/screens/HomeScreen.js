import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Dimensions, Animated,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { orderAPI } from '../services/api';
import socket from '../services/socket';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from '../i18n';

const { height } = Dimensions.get('window');

const ORDER_STATUS = {
  IDLE: 'idle',
  SEARCHING: 'searching',
  ACCEPTED: 'accepted',
  ARRIVED: 'arrived',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
};

// Status colors for route line: going to pickup = blue, in progress = green
const ROUTE_COLORS = {
  accepted: '#2196F3',
  arrived: '#FF9800',
  in_progress: '#4CAF50',
};

export default function HomeScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [lang, setLang] = useState('ru');

  const mapRef = useRef(null);
  const [region, setRegion] = useState({
    latitude: 41.2995, longitude: 69.2401,
    latitudeDelta: 0.05, longitudeDelta: 0.05,
  });

  const [userLocation, setUserLocation] = useState(null);
  const [pickupCoords, setPickupCoords] = useState(null);
  const [destCoords, setDestCoords] = useState(null);
  const [pickupText, setPickupText] = useState('');
  const [destText, setDestText] = useState('');
  const [selectingFor, setSelectingFor] = useState(null); // 'pickup' | 'dest'

  const [orderID, setOrderID] = useState(null);
  const [orderStatus, setOrderStatus] = useState(ORDER_STATUS.IDLE);
  const [estimatedPrice, setEstimatedPrice] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [driverInfo, setDriverInfo] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);

  const sheetAnim = useRef(new Animated.Value(0)).current;
  const panelRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserLocation(coords);
      setPickupCoords(coords);
      setPickupText('Ваше местоположение');
      setRegion({ ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 });
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('language').then((l) => { if (l) setLang(l); });
  }, []);

  useEffect(() => {
    const userID = user?.id;
    if (!userID) return;

    socket.on('order_accepted', (data) => {
      setOrderStatus(ORDER_STATUS.ACCEPTED);
      setDriverInfo(data.driver || null);
      showPanel();
    });
    socket.on('driver_arrived', () => {
      setOrderStatus(ORDER_STATUS.ARRIVED);
    });
    socket.on('trip_started', (data) => {
      setOrderStatus(ORDER_STATUS.IN_PROGRESS);
    });
    socket.on('trip_completed', (data) => {
      setOrderStatus(ORDER_STATUS.COMPLETED);
      Alert.alert('Поездка завершена!', `Итого: ${data.total_price?.toLocaleString()} сум`, [
        { text: 'OK', onPress: resetOrder },
      ]);
    });
    socket.on('driver_location', (data) => {
      setDriverLocation({ latitude: data.lat, longitude: data.lng });
      if (pickupCoords) {
        setRouteCoords([
          { latitude: data.lat, longitude: data.lng },
          orderStatus === ORDER_STATUS.IN_PROGRESS ? destCoords : pickupCoords,
        ].filter(Boolean));
      }
    });
    socket.on('no_drivers', () => {
      setOrderStatus(ORDER_STATUS.IDLE);
      Alert.alert('Нет водителей', t(lang, 'noDriversFound'));
    });
    socket.on('order_cancelled', () => {
      Alert.alert('Заказ отменён', 'Водитель отменил заказ');
      resetOrder();
    });

    return () => {
      ['order_accepted','driver_arrived','trip_started','trip_completed',
       'driver_location','no_drivers','order_cancelled'].forEach(socket.off.bind(socket));
    };
  }, [user, pickupCoords, destCoords, orderStatus, lang]);

  function showPanel() {
    Animated.spring(sheetAnim, { toValue: 1, useNativeDriver: true }).start();
  }

  function resetOrder() {
    setOrderID(null);
    setOrderStatus(ORDER_STATUS.IDLE);
    setEstimatedPrice(null);
    setDriverLocation(null);
    setDriverInfo(null);
    setRouteCoords([]);
    setDestCoords(null);
    setDestText('');
  }

  function handleMapPress(e) {
    if (!selectingFor) return;
    const coords = e.nativeEvent.coordinate;
    if (selectingFor === 'pickup') {
      setPickupCoords(coords);
      setPickupText(`${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`);
    } else {
      setDestCoords(coords);
      setDestText(`${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`);
    }
    setSelectingFor(null);
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
      Alert.alert(t(lang,'error'), 'Укажите точку отправления и назначения');
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
      Alert.alert(t(lang,'error'), e.response?.data?.error || 'Ошибка создания заказа');
    }
  }

  async function handleCancel() {
    if (!orderID) { resetOrder(); return; }
    try {
      await orderAPI.cancelOrder(orderID);
    } catch {}
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
        onPress={handleMapPress}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {pickupCoords && (
          <Marker coordinate={pickupCoords} title="Откуда">
            <View style={s.markerPickup}><Text style={s.markerText}>A</Text></View>
          </Marker>
        )}
        {destCoords && (
          <Marker coordinate={destCoords} title="Куда">
            <View style={s.markerDest}><Text style={s.markerText}>B</Text></View>
          </Marker>
        )}
        {driverLocation && (
          <Marker coordinate={driverLocation} title="Водитель">
            <Text style={{ fontSize: 28 }}>🚖</Text>
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

      {/* My location button */}
      <TouchableOpacity style={s.locationBtn} onPress={() => {
        if (userLocation) {
          mapRef.current?.animateToRegion({ ...userLocation, latitudeDelta: 0.02, longitudeDelta: 0.02 });
        }
      }}>
        <Text style={{ fontSize: 22 }}>📍</Text>
      </TouchableOpacity>

      {/* Bottom panel */}
      {orderStatus === ORDER_STATUS.IDLE && (
        <View style={[s.panel, { backgroundColor: colors.background }]}>
          <Text style={[s.panelTitle, { color: colors.text }]}>{t(lang,'whereToGo')}</Text>

          <TouchableOpacity style={[s.locationInput, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => setSelectingFor('pickup')}>
            <Text style={s.dotA}>•</Text>
            <Text style={[s.locationText, { color: pickupText ? colors.text : colors.textSecondary }]}>
              {pickupText || t(lang,'from')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.locationInput, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => setSelectingFor('dest')}>
            <Text style={s.dotB}>■</Text>
            <Text style={[s.locationText, { color: destText ? colors.text : colors.textSecondary }]}>
              {destText || t(lang,'to')}
            </Text>
          </TouchableOpacity>

          {destCoords && (
            <Text style={[s.priceHint, { color: colors.textSecondary }]}>
              ~{Math.round(calcDistanceKm(pickupCoords, destCoords) * 2000 + 2000).toLocaleString()} {t(lang,'sum')}
            </Text>
          )}

          <TouchableOpacity
            style={[s.orderBtn, { backgroundColor: colors.primary, opacity: destCoords ? 1 : 0.5 }]}
            onPress={handleOrder}
            disabled={!destCoords}
          >
            <Text style={s.orderBtnText}>{t(lang,'orderTaxi')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {orderStatus === ORDER_STATUS.SEARCHING && (
        <View style={[s.panel, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[s.statusText, { color: colors.text }]}>{t(lang,'searching')}</Text>
          <TouchableOpacity style={[s.cancelBtn, { borderColor: colors.border }]} onPress={handleCancel}>
            <Text style={{ color: colors.error }}>{t(lang,'cancel')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {(orderStatus === ORDER_STATUS.ACCEPTED || orderStatus === ORDER_STATUS.ARRIVED) && (
        <View style={[s.panel, { backgroundColor: colors.background }]}>
          <Text style={[s.statusText, { color: colors.text }]}>
            {orderStatus === ORDER_STATUS.ACCEPTED ? t(lang,'driverFound') : t(lang,'driverArrived')}
          </Text>
          {driverInfo && (
            <View style={[s.driverCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={s.driverCardRow}>
                <Text style={s.driverCardIcon}>🚖</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[s.driverName, { color: colors.text }]}>
                    {driverInfo.first_name} {driverInfo.last_name}
                  </Text>
                  <Text style={[s.driverDetail, { color: colors.textSecondary }]}>
                    📱 {driverInfo.phone}
                  </Text>
                  <Text style={[s.driverDetail, { color: colors.primary, fontWeight: '700' }]}>
                    🚗 {driverInfo.car_number}
                  </Text>
                </View>
              </View>
            </View>
          )}
          <Text style={[s.priceText, { color: colors.primary }]}>
            {estimatedPrice?.toLocaleString()} {t(lang,'sum')}
          </Text>
          <TouchableOpacity style={[s.cancelBtn, { borderColor: colors.border }]} onPress={handleCancel}>
            <Text style={{ color: colors.error }}>{t(lang,'cancel')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {orderStatus === ORDER_STATUS.IN_PROGRESS && (
        <View style={[s.panel, { backgroundColor: colors.background }]}>
          <Text style={[s.statusText, { color: colors.text }]}>{t(lang,'tripInProgress')}</Text>
          {driverInfo && (
            <View style={[s.driverCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={s.driverCardRow}>
                <Text style={s.driverCardIcon}>🚖</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[s.driverName, { color: colors.text }]}>
                    {driverInfo.first_name} {driverInfo.last_name}
                  </Text>
                  <Text style={[s.driverDetail, { color: colors.primary, fontWeight: '700' }]}>
                    🚗 {driverInfo.car_number}
                  </Text>
                </View>
              </View>
            </View>
          )}
          <View style={s.progressBar}>
            <View style={[s.progressFill, { backgroundColor: colors.primary }]} />
          </View>
          <Text style={[s.priceText, { color: colors.primary }]}>
            {estimatedPrice?.toLocaleString()} {t(lang,'sum')}
          </Text>
        </View>
      )}

      {selectingFor && (
        <View style={s.selectHint}>
          <Text style={s.selectHintText}>
            {selectingFor === 'pickup' ? '📍 Нажмите на карту для выбора точки отправления' : '🎯 Нажмите на карту для выбора цели'}
          </Text>
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
      position: 'absolute', top: 100, right: 16,
      backgroundColor: colors.background, borderRadius: 12,
      padding: 10, elevation: 4, shadowOpacity: 0.2, shadowRadius: 4,
    },
    panel: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 20, paddingBottom: 36,
      elevation: 12, shadowOpacity: 0.15, shadowRadius: 8,
    },
    panelTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
    locationInput: {
      flexDirection: 'row', alignItems: 'center', borderWidth: 1,
      borderRadius: 12, padding: 14, marginBottom: 10,
    },
    locationText: { flex: 1, fontSize: 15 },
    dotA: { fontSize: 20, color: '#43A047', marginRight: 10 },
    dotB: { fontSize: 14, color: '#E53935', marginRight: 10 },
    priceHint: { textAlign: 'center', marginBottom: 12, fontSize: 15 },
    orderBtn: { borderRadius: 14, padding: 16, alignItems: 'center' },
    orderBtnText: { fontWeight: '800', fontSize: 16, color: '#000' },
    statusText: { textAlign: 'center', fontSize: 17, fontWeight: '600', marginVertical: 12 },
    cancelBtn: { borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 8 },
    priceText: { textAlign: 'center', fontSize: 22, fontWeight: '800', marginBottom: 8 },
    progressBar: { height: 6, backgroundColor: colors.border, borderRadius: 3, marginVertical: 12 },
    progressFill: { height: 6, width: '60%', borderRadius: 3 },
    selectHint: {
      position: 'absolute', top: 60, left: 16, right: 16,
      backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 12, padding: 12,
    },
    selectHintText: { color: '#fff', textAlign: 'center', fontSize: 14 },
    markerPickup: {
      backgroundColor: '#43A047', borderRadius: 8, padding: 6,
      borderWidth: 2, borderColor: '#fff',
    },
    markerDest: {
      backgroundColor: '#E53935', borderRadius: 8, padding: 6,
      borderWidth: 2, borderColor: '#fff',
    },
    markerText: { color: '#fff', fontWeight: '800', fontSize: 13 },
    driverCard: {
      borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12,
    },
    driverCardRow: { flexDirection: 'row', alignItems: 'center' },
    driverCardIcon: { fontSize: 32, marginRight: 12 },
    driverName: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
    driverDetail: { fontSize: 13, marginTop: 2 },
  });
}
