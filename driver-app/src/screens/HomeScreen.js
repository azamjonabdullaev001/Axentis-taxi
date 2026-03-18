import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Switch,
  Alert, Animated, Modal,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { driverAPI } from '../services/api';
import socket from '../services/socket';
import { t } from '../i18n';

const DRIVER_STATUS = {
  OFFLINE: 'offline',
  AVAILABLE: 'available',
  INCOMING: 'incoming',       // New order notification
  ACCEPTED: 'accepted',       // Going to pickup (blue route)
  ARRIVED: 'arrived',         // At pickup, waiting (orange)
  IN_PROGRESS: 'in_progress', // Passenger aboard (green route)
};

const ROUTE_COLORS = {
  accepted: '#2196F3',   // Blue: going to pickup
  arrived: '#FF9800',    // Orange: waiting at pickup
  in_progress: '#4CAF50', // Green: trip underway
};

export default function HomeScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [lang] = useState('ru');

  const mapRef = useRef(null);
  const [driverStatus, setDriverStatus] = useState(DRIVER_STATUS.OFFLINE);
  const [location, setLocation] = useState(null);
  const [region, setRegion] = useState({
    latitude: 41.2995, longitude: 69.2401,
    latitudeDelta: 0.03, longitudeDelta: 0.03,
  });

  // Active order state
  const [activeOrder, setActiveOrder] = useState(null);
  const [passengerLocation, setPassengerLocation] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);

  // Wait timer (free 2 min, then 500 sum/min)
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [waitTimerActive, setWaitTimerActive] = useState(false);
  const waitIntervalRef = useRef(null);
  const waitFeeAnim = useRef(new Animated.Value(0)).current;

  // Incoming order modal
  const [incomingOrder, setIncomingOrder] = useState(null);
  const [acceptCountdown, setAcceptCountdown] = useState(10);
  const countdownRef = useRef(null);

  useEffect(() => {
    setupLocation();
  }, []);

  useEffect(() => {
    socket.on('new_order', (data) => {
      setIncomingOrder(data.order);
      setDriverStatus(DRIVER_STATUS.INCOMING);
      startCountdown(data.order);
    });
    socket.on('order_cancelled', () => {
      Alert.alert('Заказ отменён', 'Пассажир отменил заказ');
      resetToAvailable();
    });
    return () => {
      socket.off('new_order');
      socket.off('order_cancelled');
    };
  }, []);

  function startCountdown(order) {
    setAcceptCountdown(10);
    clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setAcceptCountdown((n) => {
        if (n <= 1) {
          clearInterval(countdownRef.current);
          setIncomingOrder(null);
          resetToAvailable();
          return 0;
        }
        return n - 1;
      });
    }, 1000);
  }

  async function setupLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 10 },
      (loc) => {
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setLocation(coords);
        setRegion((r) => ({ ...r, ...coords }));
        if (driverStatus !== DRIVER_STATUS.OFFLINE) {
          driverAPI.updateLocation(coords.latitude, coords.longitude).catch(() => {});
        }
        if (activeOrder) {
          const target = driverStatus === DRIVER_STATUS.IN_PROGRESS
            ? { latitude: activeOrder.destination_lat, longitude: activeOrder.destination_lng }
            : { latitude: activeOrder.pickup_lat, longitude: activeOrder.pickup_lng };
          setRouteCoords([coords, target]);
        }
      }
    );
  }

  async function toggleOnline(val) {
    await driverAPI.updateAvailability(val);
    setDriverStatus(val ? DRIVER_STATUS.AVAILABLE : DRIVER_STATUS.OFFLINE);
  }

  async function handleAcceptOrder() {
    if (!incomingOrder) return;
    clearInterval(countdownRef.current);
    try {
      await driverAPI.acceptOrder(incomingOrder.id);
      setActiveOrder(incomingOrder);
      setIncomingOrder(null);
      setDriverStatus(DRIVER_STATUS.ACCEPTED);
      setPassengerLocation({
        latitude: incomingOrder.pickup_lat,
        longitude: incomingOrder.pickup_lng,
      });
      if (location) {
        setRouteCoords([
          location,
          { latitude: incomingOrder.pickup_lat, longitude: incomingOrder.pickup_lng },
        ]);
      }
      mapRef.current?.animateToRegion({
        latitude: incomingOrder.pickup_lat,
        longitude: incomingOrder.pickup_lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
    } catch (e) {
      Alert.alert(t(lang,'error'), 'Заказ уже занят');
      setIncomingOrder(null);
      resetToAvailable();
    }
  }

  async function handleDeclineOrder() {
    clearInterval(countdownRef.current);
    setIncomingOrder(null);
    resetToAvailable();
  }

  async function handleArrived() {
    try {
      await driverAPI.arrivedAtPickup(activeOrder.id);
      setDriverStatus(DRIVER_STATUS.ARRIVED);
      startWaitTimer();
    } catch (e) {
      Alert.alert(t(lang,'error'), e.message);
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
    stopWaitTimer();
    try {
      const { data } = await driverAPI.startTrip(activeOrder.id);
      setDriverStatus(DRIVER_STATUS.IN_PROGRESS);
      if (location) {
        setRouteCoords([
          location,
          { latitude: activeOrder.destination_lat, longitude: activeOrder.destination_lng },
        ]);
      }
    } catch (e) {
      Alert.alert(t(lang,'error'), e.message);
    }
  }

  async function handleCompleteTrip() {
    try {
      const { data } = await driverAPI.completeTrip(activeOrder.id);
      Alert.alert('Поездка завершена!',
        `Итого: ${data.total_price?.toLocaleString()} сум\nОжидание: ${data.waiting_fee?.toLocaleString()} сум`,
        [{ text: 'OK', onPress: resetToAvailable }]
      );
    } catch (e) {
      Alert.alert(t(lang,'error'), e.message);
    }
  }

  function resetToAvailable() {
    setActiveOrder(null);
    setPassengerLocation(null);
    setRouteCoords([]);
    setDriverStatus(DRIVER_STATUS.AVAILABLE);
    stopWaitTimer();
    setWaitSeconds(0);
  }

  // Wait fee calculation
  const freeSeconds = 2 * 60;
  const billableSeconds = Math.max(0, waitSeconds - freeSeconds);
  const waitFee = Math.floor((billableSeconds / 60) * 500);
  const waitMin = Math.floor(waitSeconds / 60);
  const waitSec = waitSeconds % 60;

  const routeColor = ROUTE_COLORS[driverStatus] || '#2196F3';
  const isOnline = driverStatus !== DRIVER_STATUS.OFFLINE;

  const s = makeStyles(colors);

  return (
    <View style={s.container}>
      <MapView
        ref={mapRef}
        style={s.map}
        provider={PROVIDER_GOOGLE}
        region={region}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {passengerLocation && driverStatus === DRIVER_STATUS.ACCEPTED && (
          <Marker coordinate={passengerLocation} title="Пассажир">
            <Text style={{ fontSize: 28 }}>🧍</Text>
          </Marker>
        )}
        {activeOrder && (
          <Marker
            coordinate={{ latitude: activeOrder.destination_lat, longitude: activeOrder.destination_lng }}
            title="Цель">
            <View style={s.destMarker}><Text style={s.destMarkerText}>B</Text></View>
          </Marker>
        )}
        {routeCoords.length >= 2 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={routeColor}
            strokeWidth={5}
            lineDashPattern={driverStatus === DRIVER_STATUS.ACCEPTED ? [8, 4] : undefined}
          />
        )}
      </MapView>

      {/* Top status bar */}
      <View style={[s.statusBar, { backgroundColor: colors.background }]}>
        <View style={[s.statusDot, { backgroundColor: isOnline ? colors.success : colors.textSecondary }]} />
        <Text style={[s.statusText, { color: colors.text }]}>
          {isOnline ? t(lang,'online') : t(lang,'offline')}
        </Text>
        <Switch
          style={{ marginLeft: 'auto' }}
          value={isOnline}
          onValueChange={toggleOnline}
          trackColor={{ true: colors.primary, false: colors.border }}
          disabled={!!activeOrder}
        />
      </View>

      {/* Bottom action panel */}
      <View style={[s.bottomPanel, { backgroundColor: colors.background }]}>
        {driverStatus === DRIVER_STATUS.OFFLINE && (
          <Text style={[s.offlineMsg, { color: colors.textSecondary }]}>
            Включите режим онлайн, чтобы принимать заказы
          </Text>
        )}

        {driverStatus === DRIVER_STATUS.AVAILABLE && (
          <Text style={[s.readyMsg, { color: colors.success }]}>
            ✅ Ожидание заказов...
          </Text>
        )}

        {driverStatus === DRIVER_STATUS.ACCEPTED && activeOrder && (
          <View>
            <Text style={[s.actionTitle, { color: colors.text }]}>Едем за пассажиром</Text>
            <Text style={[s.addressText, { color: colors.textSecondary }]}>
              📍 {activeOrder.pickup_address || `${activeOrder.pickup_lat?.toFixed(4)}, ${activeOrder.pickup_lng?.toFixed(4)}`}
            </Text>
            <Text style={[s.addressText, { color: colors.textSecondary }]}>
              🎯 {activeOrder.destination_address || `${activeOrder.destination_lat?.toFixed(4)}, ${activeOrder.destination_lng?.toFixed(4)}`}
            </Text>
            <Text style={[s.priceText, { color: colors.primary }]}>
              ~{activeOrder.estimated_price?.toLocaleString() || '—'} сум
            </Text>
            <TouchableOpacity style={[s.actionBtn, { backgroundColor: colors.primary }]} onPress={handleArrived}>
              <Text style={s.actionBtnText}>{t(lang,'arrivedAtPickup')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {driverStatus === DRIVER_STATUS.ARRIVED && (
          <View>
            <Text style={[s.actionTitle, { color: colors.text }]}>Ожидание пассажира</Text>
            <View style={s.timerRow}>
              <Text style={{ fontSize: 36, fontWeight: '800', color: waitSeconds < freeSeconds ? colors.success : colors.error }}>
                {String(waitMin).padStart(2,'0')}:{String(waitSec).padStart(2,'0')}
              </Text>
              <View>
                <Text style={[s.timerLabel, { color: colors.textSecondary }]}>
                  {waitSeconds < freeSeconds ? `Бесплатно (${freeSeconds - waitSeconds}с)` : `+${waitFee.toLocaleString()} сум`}
                </Text>
              </View>
            </View>
            <TouchableOpacity style={[s.actionBtn, { backgroundColor: colors.primary }]} onPress={handleStartTrip}>
              <Text style={s.actionBtnText}>{t(lang,'startTrip')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {driverStatus === DRIVER_STATUS.IN_PROGRESS && activeOrder && (
          <View>
            <Text style={[s.actionTitle, { color: colors.text }]}>Поездка в процессе</Text>
            <Text style={[s.addressText, { color: colors.textSecondary }]}>
              🎯 {activeOrder.destination_address || `${activeOrder.destination_lat?.toFixed(4)}, ${activeOrder.destination_lng?.toFixed(4)}`}
            </Text>
            <TouchableOpacity style={[s.actionBtn, { backgroundColor: colors.success }]} onPress={handleCompleteTrip}>
              <Text style={s.actionBtnText}>{t(lang,'completeTrip')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Incoming order modal */}
      <Modal visible={!!incomingOrder} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.orderModal, { backgroundColor: colors.background }]}>
            <View style={s.timerCircle}>
              <Text style={[s.timerCount, { color: colors.primary }]}>{acceptCountdown}</Text>
            </View>
            <Text style={[s.newOrderTitle, { color: colors.text }]}>{t(lang,'newOrder')}</Text>
            {incomingOrder && (
              <>
                <Text style={[s.orderDetail, { color: colors.textSecondary }]}>
                  📍 {incomingOrder.pickup_address || 'Откуда'}
                </Text>
                <Text style={[s.orderDetail, { color: colors.textSecondary }]}>
                  🎯 {incomingOrder.destination_address || 'Куда'}
                </Text>
                <Text style={[s.orderPrice, { color: colors.primary }]}>
                  {incomingOrder.estimated_price?.toLocaleString() || '—'} сум
                </Text>
                <Text style={[s.orderDist, { color: colors.textSecondary }]}>
                  {incomingOrder.distance_km?.toFixed(1)} {t(lang,'km')}
                </Text>
              </>
            )}
            <View style={s.orderBtns}>
              <TouchableOpacity style={[s.declineBtn, { borderColor: colors.error }]} onPress={handleDeclineOrder}>
                <Text style={{ color: colors.error, fontWeight: '700', fontSize: 15 }}>{t(lang,'decline')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.acceptBtn, { backgroundColor: colors.primary }]} onPress={handleAcceptOrder}>
                <Text style={{ color: '#000', fontWeight: '800', fontSize: 15 }}>{t(lang,'accept')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1 },
    map: { flex: 1 },
    statusBar: {
      position: 'absolute', top: 0, left: 0, right: 0,
      flexDirection: 'row', alignItems: 'center', padding: 16,
      elevation: 4, shadowOpacity: 0.15, shadowRadius: 4,
    },
    statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
    statusText: { fontSize: 15, fontWeight: '600' },
    bottomPanel: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 20, paddingBottom: 36,
      elevation: 12, shadowOpacity: 0.15, shadowRadius: 8,
    },
    offlineMsg: { textAlign: 'center', fontSize: 15, padding: 16 },
    readyMsg: { textAlign: 'center', fontSize: 16, fontWeight: '600', padding: 16 },
    actionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
    addressText: { fontSize: 14, marginBottom: 4 },
    priceText: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginVertical: 8 },
    actionBtn: { borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 12 },
    actionBtnText: { fontWeight: '800', fontSize: 16, color: '#000' },
    timerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginVertical: 8 },
    timerLabel: { fontSize: 13, textAlign: 'center' },
    destMarker: { backgroundColor: '#E53935', borderRadius: 8, padding: 6, borderWidth: 2, borderColor: '#fff' },
    destMarkerText: { color: '#fff', fontWeight: '800', fontSize: 13 },
    // Modal
    modalOverlay: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 20 },
    orderModal: { borderRadius: 24, padding: 24, alignItems: 'center' },
    timerCircle: {
      width: 64, height: 64, borderRadius: 32,
      borderWidth: 3, borderColor: colors.primary,
      justifyContent: 'center', alignItems: 'center', marginBottom: 12,
    },
    timerCount: { fontSize: 26, fontWeight: '800' },
    newOrderTitle: { fontSize: 20, fontWeight: '800', marginBottom: 12 },
    orderDetail: { fontSize: 14, marginBottom: 4, textAlign: 'center' },
    orderPrice: { fontSize: 26, fontWeight: '800', marginVertical: 8 },
    orderDist: { fontSize: 14, marginBottom: 16 },
    orderBtns: { flexDirection: 'row', gap: 12, marginTop: 4 },
    declineBtn: { flex: 1, borderWidth: 1.5, borderRadius: 14, padding: 14, alignItems: 'center' },
    acceptBtn: { flex: 1, borderRadius: 14, padding: 14, alignItems: 'center' },
  });
}
