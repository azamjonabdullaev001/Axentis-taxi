import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../l10n/translations.dart';
import '../providers/auth_provider.dart';
import '../providers/theme_provider.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});
  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _firstNameCtrl = TextEditingController();
  final _lastNameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController(text: '+998');
  final _passCtrl = TextEditingController();
  final _confirmCtrl = TextEditingController();
  final _carNumCtrl = TextEditingController();
  final _pinflCtrl = TextEditingController();
  final _referralCtrl = TextEditingController();
  String? _selectedRegion;
  bool _obscure = true;
  bool _loading = false;

  static const Map<String, String> _regions = {
    '01': "Toshkent shahar",
    '10': "Toshkent viloyati",
    '20': "Sirdaryo viloyati",
    '25': "Jizzax viloyati",
    '30': "Samarqand viloyati",
    '40': "Farg'ona viloyati",
    '50': "Namangan viloyati",
    '60': "Andijon viloyati",
    '70': "Qashqadaryo viloyati",
    '75': "Surxondaryo viloyati",
    '80': "Buxoro viloyati",
    '85': "Navoiy viloyati",
    '90': "Xorazm viloyati",
    '95': "Qoraqalpog'iston",
  };

  @override
  void dispose() {
    _firstNameCtrl.dispose();
    _lastNameCtrl.dispose();
    _phoneCtrl.dispose();
    _passCtrl.dispose();
    _confirmCtrl.dispose();
    _carNumCtrl.dispose();
    _pinflCtrl.dispose();
    _referralCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);
    final fullCarNumber = '${_selectedRegion!}${_carNumCtrl.text.trim().toUpperCase()}';
    try {
      await context.read<AuthProvider>().register({
        'first_name': _firstNameCtrl.text.trim(),
        'last_name': _lastNameCtrl.text.trim(),
        'phone': _phoneCtrl.text.trim(),
        'password': _passCtrl.text,
        'car_number': fullCarNumber,
        'pinfl': _pinflCtrl.text.trim(),
        if (_referralCtrl.text.isNotEmpty) 'referred_by': _referralCtrl.text.trim(),
      });
      if (mounted) context.go('/');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.watch<ThemeProvider>();
    final t = Translations(theme.lang);

    return Scaffold(
      appBar: AppBar(title: Text(t.t('register'))),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              children: [
                _field(_firstNameCtrl, t.t('firstName'), Icons.person),
                const SizedBox(height: 12),
                _field(_lastNameCtrl, t.t('lastName'), Icons.person_outline),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _phoneCtrl,
                  keyboardType: TextInputType.phone,
                  decoration: InputDecoration(
                    labelText: t.t('phone'),
                    prefixIcon: const Icon(Icons.phone),
                  ),
                  validator: (v) =>
                      RegExp(r'^\+998\d{9}$').hasMatch(v?.trim() ?? '')
                          ? null
                          : t.t('invalidPhone'),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _passCtrl,
                  obscureText: _obscure,
                  decoration: InputDecoration(
                    labelText: t.t('password'),
                    prefixIcon: const Icon(Icons.lock),
                    suffixIcon: IconButton(
                      icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                  ),
                  validator: (v) =>
                      (v?.length ?? 0) < 8 ? t.t('passwordShort') : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _confirmCtrl,
                  obscureText: _obscure,
                  decoration: InputDecoration(
                    labelText: t.t('confirmPassword'),
                    prefixIcon: const Icon(Icons.lock_outline),
                  ),
                  validator: (v) =>
                      v != _passCtrl.text ? t.t('passwordsMismatch') : null,
                ),
                const SizedBox(height: 12),
                // Region dropdown
                DropdownButtonFormField<String>(
                  value: _selectedRegion,
                  decoration: InputDecoration(
                    labelText: t.t('carRegion'),
                    prefixIcon: const Icon(Icons.location_city),
                  ),
                  dropdownColor: theme.card,
                  items: _regions.entries
                      .map((e) => DropdownMenuItem(
                            value: e.key,
                            child: Text('${e.key} — ${e.value}'),
                          ))
                      .toList(),
                  onChanged: (v) => setState(() => _selectedRegion = v),
                  validator: (v) => v == null ? t.t('selectRegion') : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _carNumCtrl,
                  textCapitalization: TextCapitalization.characters,
                  decoration: InputDecoration(
                    labelText: t.t('carNumber'),
                    prefixIcon: const Icon(Icons.directions_car),
                    hintText: 'A123BC',
                  ),
                  validator: (v) {
                    final s = v?.trim() ?? '';
                    if (!RegExp(r'^[A-Za-z0-9]{4,6}$').hasMatch(s)) {
                      return t.t('invalidCarNumber');
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _pinflCtrl,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                    labelText: t.t('pinfl'),
                    prefixIcon: const Icon(Icons.badge),
                  ),
                  validator: (v) =>
                      RegExp(r'^\d{14}$').hasMatch(v?.trim() ?? '')
                          ? null
                          : t.t('invalidPinfl'),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _referralCtrl,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                    labelText: t.t('referralCode'),
                    prefixIcon: const Icon(Icons.card_giftcard),
                  ),
                ),
                const SizedBox(height: 32),
                ElevatedButton(
                  onPressed: _loading ? null : _submit,
                  child: _loading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black),
                        )
                      : Text(t.t('registerBtn'),
                          style: const TextStyle(fontWeight: FontWeight.bold)),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(t.t('haveAccount'),
                        style: TextStyle(color: theme.textSecondary)),
                    const SizedBox(width: 4),
                    GestureDetector(
                      onTap: () => context.go('/login'),
                      child: Text(
                        t.t('login'),
                        style: TextStyle(
                          color: theme.primary,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _field(TextEditingController ctrl, String label, IconData icon) {
    return TextFormField(
      controller: ctrl,
      decoration: InputDecoration(labelText: label, prefixIcon: Icon(icon)),
      validator: (v) => (v?.trim().isEmpty ?? true) ? '$label обязательно' : null,
    );
  }
}
