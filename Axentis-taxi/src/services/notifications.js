import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function initializeNotifications() {
  const permissions = await Notifications.getPermissionsAsync();
  let currentStatus = permissions.status;

  if (currentStatus !== 'granted') {
    const request = await Notifications.requestPermissionsAsync();
    currentStatus = request.status;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('orders', {
      name: 'Order updates',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    });
  }

  return currentStatus === 'granted';
}

/**
 * Get the Expo push token for this device.
 * The backend stores this token and uses it to send push notifications
 * via the Expo managed push pipeline → FCM (Android) / APNs (iOS).
 * Returns null in simulators or when permission is denied.
 */
export async function getExpoPushToken() {
  try {
    const { data } = await Notifications.getExpoPushTokenAsync();
    return data;
  } catch {
    return null;
  }
}
