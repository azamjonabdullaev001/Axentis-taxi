import { Platform, Vibration } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

/* ── Repeating alarm state ── */
let alarmIntervalId = null;
let notificationHandlerSet = false;

function ensureNotificationHandler() {
  if (notificationHandlerSet) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    notificationHandlerSet = true;
  } catch (e) {
    console.warn('[notifications] setNotificationHandler failed:', e);
  }
}

ensureNotificationHandler();

export async function initializeNotifications() {
  const permissions = await Notifications.getPermissionsAsync();
  let currentStatus = permissions.status;

  if (currentStatus !== 'granted') {
    const request = await Notifications.requestPermissionsAsync();
    currentStatus = request.status;
  }

  if (Platform.OS === 'android') {
    // Use 'order_bell_v2' — a NEW channel id so Android always creates it fresh
    // (Android ignores sound/importance changes on existing channels)
    await Notifications.setNotificationChannelAsync('order_bell_v2', {
      name: 'Incoming orders',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 300, 200, 300],
      lightColor: '#FFCC00',
      sound: 'default',
      enableVibrate: true,
    });
  }



  // Retry handler setup after permissions & channel are ready
  ensureNotificationHandler();

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
      title: '🚕 Новый заказ!',
      body: `${order?.pickup_address || 'Точка подачи'}${order?.destination_address ? ' → ' + order.destination_address : ''}`,
      sound: 'default',
      channelId: 'order_bell_v2',
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    trigger: null,
  });
}

/**
 * Start the incoming-order alarm:
 * - Plays an in-app bell sound (expo-av)
 * - Fires EXACTLY ONE system notification (sound + banner)
 * - Starts a vibration loop (repeating until stopOrderAlarm)
 * All of this together gives a pleasant, non-spammy ringtone effect.
 */
export function startOrderAlarm(order) {
  ensureNotificationHandler();

  // Stop any previous alarm cleanly first
  stopOrderAlarm();

  // Sound is provided by the notification itself (shouldPlaySound: true + sound: 'default')

  // 2. ONE notification — provides system sound + banner on locked screen
  showIncomingOrderNotification(order).catch((e) =>
    console.warn('[notifications] alarm notification failed:', e),
  );

  // 3. Repeating vibration pattern: 300ms buzz, 500ms pause, loops
  Vibration.vibrate([0, 300, 500], true);
}

/**
 * Stop the order alarm (vibration + sound loop).
 */
export function stopOrderAlarm() {
  Vibration.cancel();
  clearInterval(alarmIntervalId);
  alarmIntervalId = null;

}