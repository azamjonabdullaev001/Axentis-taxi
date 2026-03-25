import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Switch,
  Alert, Animated, Modal, Image,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { authAPI, driverAPI } from '../services/api';
import { buildAvatarUrl } from '../services/api';
import socket from '../services/socket';
import { t } from '../i18n';
import {
  initializeNotifications,
  getExpoPushToken,
  showIncomingOrderNotification,
} from '../services/notifications';

const CAR_ICON = require('../../assets/car-photo.png');

// Маршрут по реальным дорогам (OSRM, steps=true для точной геометрии)
// Возвращает { coords, distanceKm }
async function fetchRoadRoute(pickup, dest) {
  const lng1 = pickup.longitude, lat1 = pickup.latitude;
  const lng2 = dest.longitude,   lat2 = dest.latitude;

  function extractStepCoords(json) {
    if (!json.routes?.[0]) return null;
    const distanceKm = json.routes[0].distance / 1000;
    const coords = [];
    for (const leg of json.routes[0].legs) {
      for (const step of leg.steps) {
        for (const [lng, lat] of step.geometry.coordinates) {
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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const result = extractStepCoords(await res.json());
    if (result) return result;
  } catch { clearTimeout(timer); }

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

  // Wait timer (free 2 min, then 500 sum/min)
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [waitTimerActive, setWaitTimerActive] = useState(false);
  const waitIntervalRef = useRef(null);
  const waitFeeAnim = useRef(new Animated.Value(0)).current;

  // Incoming order modal
  const [incomingOrder, setIncomingOrder] = useState(null);
  const [acceptCountdown, setAcceptCountdown] = useState(10);
  const countdownRef = useRef(null);

  // 100m metering: accumulate driven distance and calculate running price
  const [meteredKm, setMeteredKm] = useState(0);
  const meteredKmRef = useRef(0);
  const prevMeterPosRef = useRef(null);
  const meteredPricePerKm = useRef(0);

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
        await driverAPI.updateAvailability(true);
        setDriverStatus(DRIVER_STATUS.AVAILABLE);
      } catch {}
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

    // ── 2. 20ms display timer — syncs refs → React state + SINGLE camera update ──
    // All animateCamera calls go through here to prevent competing animations (flicker).
    displayTimerRef.current = setInterval(() => {
      const loc = locationRef.current;
      const h = headingRef.current;
      if (loc) {
        setLocation((prev) => {
          if (!prev) return { ...loc };
          // Exponential smoothing (alpha=0.35) — car slides smoothly to GPS target
          const ALPHA = 0.35;
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
              { duration: 10 },
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
    }, 20);

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
          // Low-pass filter alpha=0.4: fast response, kills sensor jitter
          const prev = headingRef.current;
          let diff = raw - prev;
          if (diff > 180) diff -= 360;
          if (diff < -180) diff += 360;
          const h = (prev + diff * 0.4 + 360) % 360;
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
      setDriverStatus(DRIVER_STATUS.INCOMING);
      startCountdown(data.order);
      showIncomingOrderNotification(data.order).catch(() => {});
    });
    socket.on('order_cancelled', () => {
      Alert.alert(t(lang,'orderCancelled'), t(lang,'orderCancelledByPassenger'));
      resetToAvailable();
    });
    socket.on('passenger_location', (data) => {
      setPassengerLiveLocation({ latitude: data.lat, longitude: data.lng });
    });
    socket.on('passenger_location_hidden', () => {
      // Driver fallback: clear live pin; route will snap back to static pickup coords
      setPassengerLiveLocation(null);
    });

    return () => {
      socket.off('new_order');
      socket.off('order_cancelled');
      socket.off('passenger_location');
      socket.off('passenger_location_hidden');
    };
  }, [activeOrder, lang]);

  useEffect(() => {
    if (!location || !activeOrder) return;

    let dest;
    if (driverStatus === DRIVER_STATUS.IN_PROGRESS) {
      dest = { latitude: activeOrder.destination_lat, longitude: activeOrder.destination_lng };
    } else if (driverStatus === DRIVER_STATUS.ACCEPTED || driverStatus === DRIVER_STATUS.ARRIVED) {
      dest = passengerLiveLocation || {
        latitude: activeOrder.pickup_lat,
        longitude: activeOrder.pickup_lng,
      };
    } else {
      return;
    }

    // Skip re-fetch if target hasn't moved more than 30m
    const prev = routeTargetRef.current;
    if (prev) {
      const dLat = Math.abs(dest.latitude - prev.latitude);
      const dLng = Math.abs(dest.longitude - prev.longitude);
      if (dLat < 0.00027 && dLng < 0.00027) return; // ~30m threshold
    }
    routeTargetRef.current = dest;

    // Fetch road route; fall back to straight line if offline/slow
    fetchRoadRoute(location, dest).then(({ coords }) => {
      setRouteCoords(coords);
    }).catch(() => {
      setRouteCoords([location, dest]);
    });
  }, [activeOrder, driverStatus, location, passengerLiveLocation]);

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
    if (!incomingOrder) return;
    clearInterval(countdownRef.current);
    try {
      await driverAPI.acceptOrder(incomingOrder.id);
      setActiveOrder(incomingOrder);
      setIncomingOrder(null);
      setPassengerLiveLocation(null); // Will be populated by socket if passenger is sharing live location
      setDriverStatus(DRIVER_STATUS.ACCEPTED);
      // Store locked price per km for metering (sent from backend)
      meteredPricePerKm.current = incomingOrder.locked_price_per_km || 3000;
      mapRef.current?.animateToRegion({
        latitude: incomingOrder.pickup_lat,
        longitude: incomingOrder.pickup_lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
    } catch (e) {
      Alert.alert(t(lang,'error'), t(lang,'orderBusy'));
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
      // Reset metering for the trip
      meteredKmRef.current = 0;
      setMeteredKm(0);
      prevMeterPosRef.current = null;
      if (location) {
        const dest = { latitude: activeOrder.destination_lat, longitude: activeOrder.destination_lng };
        routeTargetRef.current = null; // force re-fetch for new destination segment
        fetchRoadRoute(location, dest).then(({ coords }) => {
          setRouteCoords(coords);
        }).catch(() => {
          setRouteCoords([location, dest]);
        });
      }
    } catch (e) {
      Alert.alert(t(lang,'error'), e.message);
    }
  }

  async function handleCompleteTrip() {
    try {
      // Send metered distance to server before completing
      if (meteredKmRef.current > 0) {
        await driverAPI.updateOrderDistance(activeOrder.id, meteredKmRef.current).catch(() => {});
      }
      const { data } = await driverAPI.completeTrip(activeOrder.id);
      const rounded = Math.ceil((data.total_price || 0) / 200) * 200;
      Alert.alert(t(lang,'tripCompleted'),
        `${t(lang,'total')}: ${rounded.toLocaleString()} ${t(lang,'sum')}`,
        [{ text: 'OK', onPress: resetToAvailable }]
      );
    } catch (e) {
      Alert.alert(t(lang,'error'), e.message);
    }
  }

  function resetToAvailable() {
    setActiveOrder(null);
    setPassengerLiveLocation(null);
    setRouteCoords([]);
    routeTargetRef.current = null;
    setDriverStatus(DRIVER_STATUS.AVAILABLE);
    stopWaitTimer();
    setWaitSeconds(0);
    meteredKmRef.current = 0;
    setMeteredKm(0);
    prevMeterPosRef.current = null;
    meteredPricePerKm.current = 0;
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
        {activeOrder && driverStatus !== DRIVER_STATUS.IN_PROGRESS && (
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
            lineCap="round"
            lineJoin="round"
          />
        )}
      </MapView>

      {/* Find Me button — floats above bottom panel, right side */}
      {isOnline && (
        <TouchableOpacity
          style={[s.findMeBtn, { backgroundColor: colors.background, bottom: driverPanelHeight + 12 }]}
          onPress={goToMyLocation}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 20 }}>📍</Text>
        </TouchableOpacity>
      )}

      {/* Navigation mode toggle — above Find Me button */}
      {isOnline && (
        <TouchableOpacity
          style={[s.navModeBtn, {
            backgroundColor: navMode ? colors.primary : colors.background,
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
      <View style={[s.bottomPanel, {
        backgroundColor: colors.background,
        bottom: 0,
        paddingBottom: 16,
      }]}
        onLayout={(e) => setDriverPanelHeight(e.nativeEvent.layout.height)}
      >
        {driverStatus === DRIVER_STATUS.OFFLINE && (
          <Text style={[s.offlineMsg, { color: colors.textSecondary }]}>
            {t(lang,'enableOnline')}
          </Text>
        )}

        {driverStatus === DRIVER_STATUS.AVAILABLE && (
          <Text style={[s.readyMsg, { color: colors.success }]}>
            {t(lang,'waitingForOrders')}
          </Text>
        )}

        {driverStatus === DRIVER_STATUS.ACCEPTED && activeOrder && (
          <View>
            <Text style={[s.actionTitle, { color: colors.text }]}>{t(lang,'goingToPassenger')}</Text>
            {activeOrder.passenger_phone ? (
              <Text style={[s.addressText, { color: colors.primary, fontWeight: '600' }]}>
                👤 {activeOrder.passenger_name || ''} &nbsp; 📱 {activeOrder.passenger_phone}
              </Text>
            ) : null}
            <Text style={[s.addressText, { color: colors.textSecondary }]}>
              📍 {activeOrder.pickup_address || `${activeOrder.pickup_lat?.toFixed(4)}, ${activeOrder.pickup_lng?.toFixed(4)}`}
            </Text>
            <Text style={[s.addressText, { color: colors.textSecondary }]}>
              🎯 {activeOrder.destination_address || `${activeOrder.destination_lat?.toFixed(4)}, ${activeOrder.destination_lng?.toFixed(4)}`}
            </Text>
            <Text style={[s.priceText, { color: colors.primary }]}>
              {t(lang,'happyTrip')}
            </Text>
            <TouchableOpacity style={[s.actionBtn, { backgroundColor: colors.primary }]} onPress={handleArrived}>
              <Text style={s.actionBtnText}>{t(lang,'arrivedAtPickup')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {driverStatus === DRIVER_STATUS.ARRIVED && (
          <View>
            <Text style={[s.actionTitle, { color: colors.text }]}>{t(lang,'waitingForPassenger')}</Text>
            <View style={s.timerRow}>
              <Text style={{ fontSize: 36, fontWeight: '800', color: waitSeconds < freeSeconds ? colors.success : colors.error }}>
                {String(waitMin).padStart(2,'0')}:{String(waitSec).padStart(2,'0')}
              </Text>
              <View>
                <Text style={[s.timerLabel, { color: colors.textSecondary }]}>
                  {waitSeconds < freeSeconds
                    ? `${t(lang,'freeWaitLabel')} (${freeSeconds - waitSeconds}${t(lang,'sec')})`
                    : `+${waitFee.toLocaleString()} ${t(lang,'sum')}`}
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
            <Text style={[s.actionTitle, { color: colors.text }]}>{t(lang,'passengerOnboard')}</Text>
            <Text style={[s.addressText, { color: colors.textSecondary }]}>
              🎯 {activeOrder.destination_address || `${activeOrder.destination_lat?.toFixed(4)}, ${activeOrder.destination_lng?.toFixed(4)}`}
            </Text>
            <Text style={[s.priceText, { color: colors.primary, fontSize: 28 }]}>
              {t(lang,'meterRunning')}: {(() => {
                const rate = meteredPricePerKm.current || 3000;
                const m = meteredKm * 1000;
                const rKm = m < 1 ? 0 : (Math.ceil(m / 100) * 100) / 1000;
                return Math.ceil(rKm * rate / 200) * 200;
              })().toLocaleString()} {t(lang,'sum')}
            </Text>
            <Text style={[s.addressText, { color: colors.textSecondary, textAlign: 'center' }]}>
              {meteredKm.toFixed(2)} {t(lang,'km')}
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
                {/* Passenger photo if available */}
                {incomingOrder.passenger_photo ? (
                  <Image
                    source={{ uri: buildAvatarUrl(incomingOrder.passenger_photo) }}
                    style={s.passengerPhoto}
                  />
                ) : (
                  <View style={[s.passengerPhotoPlaceholder, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={{ fontSize: 30 }}>👤</Text>
                  </View>
                )}
                <Text style={[s.passengerPhoneText, { color: colors.text }]}>
                  📱 {incomingOrder.passenger_phone}
                </Text>
                {incomingOrder.order_type === 'call' && (
                  <View style={s.callBadge}>
                    <Text style={s.callBadgeText}>📞 Звонковый заказ</Text>
                  </View>
                )}
                <Text style={[s.orderDetail, { color: colors.textSecondary }]}>
                  📍 {incomingOrder.pickup_address || t(lang,'from')}
                </Text>
                <Text style={[s.orderDetail, { color: colors.textSecondary }]}>
                  🎯 {incomingOrder.destination_address || t(lang,'to')}
                </Text>
                <Text style={[s.orderPrice, { color: colors.primary }]}>
                  {t(lang,'happyTrip')}
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
    carIcon: { width: 24, height: 38 },
    findMeBtn: {
      position: 'absolute',
      right: 16,
      width: 44, height: 44, borderRadius: 22,
      justifyContent: 'center', alignItems: 'center',
      elevation: 6, shadowOpacity: 0.2, shadowRadius: 6,
    },
    navModeBtn: {
      position: 'absolute',
      right: 16,
      width: 44, height: 44, borderRadius: 22,
      justifyContent: 'center', alignItems: 'center',
      elevation: 6, shadowOpacity: 0.2, shadowRadius: 6,
    },
    findMeBtnInner: {
      position: 'absolute', top: 14, right: 16,
      width: 40, height: 40, borderRadius: 20,
      justifyContent: 'center', alignItems: 'center',
      elevation: 3, shadowOpacity: 0.12, shadowRadius: 4,
    },
    statusBar: {
      position: 'absolute', top: 0, left: 0, right: 0,
      flexDirection: 'row', alignItems: 'center', padding: 16,
      borderRadius: 18,
      marginHorizontal: 12,
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
    pickupMarker: { backgroundColor: '#2196F3', borderRadius: 8, padding: 6, borderWidth: 2, borderColor: '#fff' },
    markerText: { color: '#fff', fontWeight: '800', fontSize: 13 },
    // Live passenger marker: pulsing green ring around person emoji
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
    passengerPhoto: {
      width: 80, height: 80, borderRadius: 40, marginBottom: 8,
      borderWidth: 2, borderColor: colors.primary,
    },
    passengerPhotoPlaceholder: {
      width: 80, height: 80, borderRadius: 40, marginBottom: 8,
      borderWidth: 2, alignItems: 'center', justifyContent: 'center',
    },
    passengerPhoneText: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
    callBadge: {
      backgroundColor: '#E3F2FD', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5,
      marginBottom: 10,
    },
    callBadgeText: { fontSize: 13, fontWeight: '700', color: '#1565C0' },
    orderDetail: { fontSize: 14, marginBottom: 4, textAlign: 'center' },
    orderPrice: { fontSize: 26, fontWeight: '800', marginVertical: 8 },
    orderDist: { fontSize: 14, marginBottom: 16 },
    orderBtns: { flexDirection: 'row', gap: 12, marginTop: 4 },
    declineBtn: { flex: 1, borderWidth: 1.5, borderRadius: 14, padding: 14, alignItems: 'center' },
    acceptBtn: { flex: 1, borderRadius: 14, padding: 14, alignItems: 'center' },
  });
}
