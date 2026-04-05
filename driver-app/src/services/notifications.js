import { Platform, Vibration } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

/* ── Repeating alarm state ── */
let alarmIntervalId = null;

// In Expo Go, setNotificationHandler may throw — wrap to prevent module crash
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch {}

export async function initializeNotifications() {
  const permissions = await Notifications.getPermissionsAsync();
  let currentStatus = permissions.status;

  if (currentStatus !== 'granted') {
    const request = await Notifications.requestPermissionsAsync();
    currentStatus = request.status;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('orders', {
      name: 'Incoming orders',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FFCC00',
      sound: 'default',
    });
  }

  return currentStatus === 'granted';
}

/**
 * Obtain the Expo push token (ExponentPushToken[...]) for this device.
 * This token is used by the backend to deliver push notifications via
 * the Expo managed push pipeline → FCM (Android) / APNs (iOS).
 * Returns null in simulators or when permission is denied.
 */
export async function getExpoPushToken() {
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return data;
  } catch {
    return null;
  }
}

export async function showIncomingOrderNotification(order) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Новый заказ',
      body: `${order?.pickup_address || 'Точка подачи'} -> ${order?.destination_address || 'Точка назначения'}`,
      sound: 'default',
      channelId: 'orders',
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    trigger: null,
  });
}

/**
 * Start a repeating alarm: vibration loop + notification sound every 2 seconds.
 * Call stopOrderAlarm() when the driver accepts, declines, or the countdown expires.
 */
export function startOrderAlarm(order) {
  // Haptic: 400ms on, 300ms off — repeating until stopOrderAlarm()
  Vibration.vibrate([0, 400, 300], true);

  // Fire first notification immediately (sound)
  showIncomingOrderNotification(order).catch(() => {});

  // Re-fire notification sound every 2 seconds
  clearInterval(alarmIntervalId);
  alarmIntervalId = setInterval(() => {
    Notifications.scheduleNotificationAsync({
      content: {
        title: '🚕 Новый заказ!',
        body: order?.pickup_address || 'Нажмите чтобы принять',
        sound: 'default',
        channelId: 'orders',
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: null,
    }).catch(() => {});
  }, 2000);
}

/**
 * Stop the repeating order alarm (vibration + notification loop).
 */
export function stopOrderAlarm() {
  Vibration.cancel();
  clearInterval(alarmIntervalId);
  alarmIntervalId = null;
}