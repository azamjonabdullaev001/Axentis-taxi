import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ThemeProvider extends ChangeNotifier {
  bool _isDark = false; // Passengers default to light
  String _lang = 'ru';

  bool get isDark => _isDark;
  String get lang => _lang;
  ThemeMode get themeMode => _isDark ? ThemeMode.dark : ThemeMode.light;

  ThemeProvider() {
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    _isDark = prefs.getBool('dark_mode') ?? false;
    _lang = prefs.getString('language') ?? 'ru';
    notifyListeners();
  }

  Future<void> setDark(bool v) async {
    _isDark = v;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('dark_mode', v);
  }

  Future<void> setLanguage(String l) async {
    _lang = l;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('language', l);
  }

  Color get primary => const Color(0xFFFFCC00);
  Color get background => _isDark ? const Color(0xFF1A1A1A) : Colors.white;
  Color get card => _isDark ? const Color(0xFF2A2A2A) : const Color(0xFFF5F5F5);
  Color get textPrimary => _isDark ? Colors.white : const Color(0xFF1A1A1A);
  Color get textSecondary => _isDark ? const Color(0xFFAAAAAA) : const Color(0xFF666666);
  Color get border => _isDark ? const Color(0xFF3A3A3A) : const Color(0xFFE0E0E0);
  Color get error => _isDark ? const Color(0xFFEF5350) : const Color(0xFFE53935);
  Color get success => _isDark ? const Color(0xFF66BB6A) : const Color(0xFF43A047);
}
