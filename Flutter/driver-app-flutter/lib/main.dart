import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/auth_provider.dart';
import 'providers/theme_provider.dart';
import 'router/app_router.dart';
import 'services/api_service.dart';
import 'services/notification_service.dart';
import 'services/socket_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  final notificationService = NotificationService();
  await notificationService.initialize();
  runApp(AxentisTaxiDriverApp(notificationService: notificationService));
}

class AxentisTaxiDriverApp extends StatelessWidget {
  final NotificationService notificationService;
  const AxentisTaxiDriverApp({super.key, required this.notificationService});

  @override
  Widget build(BuildContext context) {
    final apiService = ApiService();
    final socketService = SocketService();

    return MultiProvider(
      providers: [
        Provider<ApiService>.value(value: apiService),
        Provider<SocketService>.value(value: socketService),
        Provider<NotificationService>.value(value: notificationService),
        ChangeNotifierProvider(
          create: (_) => AuthProvider(apiService, socketService),
        ),
        ChangeNotifierProvider(create: (_) => ThemeProvider()),
      ],
      child: Consumer<ThemeProvider>(
        builder: (context, theme, _) => MaterialApp.router(
          title: 'Axentis Driver',
          debugShowCheckedModeBanner: false,
          themeMode: theme.themeMode,
          theme: _buildTheme(theme, Brightness.light),
          darkTheme: _buildTheme(theme, Brightness.dark),
          routerConfig: appRouter,
        ),
      ),
    );
  }

  ThemeData _buildTheme(ThemeProvider theme, Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final bg = isDark ? const Color(0xFF1A1A1A) : Colors.white;
    final card = isDark ? const Color(0xFF2A2A2A) : const Color(0xFFF5F5F5);
    final text = isDark ? Colors.white : const Color(0xFF1A1A1A);
    const primary = Color(0xFFFFCC00);

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: ColorScheme(
        brightness: brightness,
        primary: primary,
        onPrimary: Colors.black,
        secondary: primary,
        onSecondary: Colors.black,
        error: isDark ? const Color(0xFFEF5350) : const Color(0xFFE53935),
        onError: Colors.white,
        background: bg,
        onBackground: text,
        surface: card,
        onSurface: text,
      ),
      scaffoldBackgroundColor: bg,
      cardColor: card,
      appBarTheme: AppBarTheme(
        backgroundColor: bg,
        foregroundColor: text,
        elevation: 0,
        titleTextStyle: TextStyle(color: text, fontSize: 18, fontWeight: FontWeight.bold),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: card,
        indicatorColor: primary.withOpacity(0.2),
        labelTextStyle: MaterialStateProperty.all(
          TextStyle(color: text, fontSize: 12),
        ),
        iconTheme: MaterialStateProperty.all(IconThemeData(color: text)),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: Colors.black,
          minimumSize: const Size(double.infinity, 50),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: card,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: isDark ? const Color(0xFF3A3A3A) : const Color(0xFFE0E0E0)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: isDark ? const Color(0xFF3A3A3A) : const Color(0xFFE0E0E0)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: primary),
        ),
        labelStyle: TextStyle(color: isDark ? const Color(0xFFAAAAAA) : const Color(0xFF666666)),
      ),
    );
  }
}
