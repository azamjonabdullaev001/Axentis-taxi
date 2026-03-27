import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

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