import 'dart:io';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class NotificationService {
  static final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();

  static const AndroidNotificationChannel _channel = AndroidNotificationChannel(
    'orders',
    'Order Notifications',
    description: 'Incoming order notifications',
    importance: Importance.max,
    playSound: true,
    enableVibration: true,
    vibrationPattern: [0, 250, 250, 250],
    ledColor: Color(0xFFFFCC00),
  );

  Future<void> initialize() async {
    if (Platform.isAndroid) {
      await _localNotifications
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(_channel);
    }

    const initSettings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      iOS: DarwinInitializationSettings(
        requestAlertPermission: true,
        requestBadgePermission: true,
        requestSoundPermission: true,
      ),
    );
    await _localNotifications.initialize(initSettings);

    // FCM foreground handler
    FirebaseMessaging.onMessage.listen(_handleFcmMessage);
  }

  Future<String?> getPushToken() async {
    try {
      final settings = await FirebaseMessaging.instance.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        return null;
      }
      return await FirebaseMessaging.instance.getToken();
    } catch (_) {
      return null;
    }
  }

  void _handleFcmMessage(RemoteMessage message) {
    final notification = message.notification;
    if (notification != null) {
      _localNotifications.show(
        notification.hashCode,
        notification.title,
        notification.body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            _channel.id,
            _channel.name,
            channelDescription: _channel.description,
            importance: Importance.max,
            priority: Priority.high,
          ),
        ),
      );
    }
  }

  Future<void> showIncomingOrderNotification({
    required String pickup,
    required String? destination,
    required String price,
  }) async {
    final body = destination != null && destination.isNotEmpty
        ? '$pickup → $destination | $price сум'
        : pickup;

    await _localNotifications.show(
      1,
      'Новый заказ',
      body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _channel.id,
          _channel.name,
          channelDescription: _channel.description,
          importance: Importance.max,
          priority: Priority.high,
          vibrationPattern: [0, 250, 250, 250],
          color: const Color(0xFFFFCC00),
        ),
      ),
    );
  }
}
