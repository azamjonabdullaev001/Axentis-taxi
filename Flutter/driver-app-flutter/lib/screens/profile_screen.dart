import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../l10n/translations.dart';
import '../models/models.dart';
import '../providers/auth_provider.dart';
import '../providers/theme_provider.dart';
import '../services/api_service.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool _ratingLoading = true;
  double _avgRating = 0;
  int _ratingCount = 0;
  List<HistoryOrder> _history = [];
  bool _historyLoading = false;
  bool _historyShown = false;

  // Referral
  String _referralInput = '';
  String _benefitType = 'commission';
  bool _referralLoading = false;

  @override
  void initState() {
    super.initState();
    _loadRatings();
  }

  Future<void> _loadRatings() async {
    final api = context.read<ApiService>();
    try {
      final data = await api.getDriverRatings();
      setState(() {
        _avgRating = (data['average_rating'] as num?)?.toDouble() ?? 0;
        _ratingCount = data['rating_count'] as int? ?? 0;
        _ratingLoading = false;
      });
    } catch (_) {
      setState(() => _ratingLoading = false);
    }
  }

  Future<void> _loadHistory() async {
    setState(() => _historyLoading = true);
    final api = context.read<ApiService>();
    try {
      final orders = await api.getOrderHistory();
      setState(() {
        _history = orders;
        _historyLoading = false;
        _historyShown = true;
      });
    } catch (e) {
      setState(() => _historyLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    }
  }

  Future<void> _uploadAvatar() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery, imageQuality: 80);
    if (file == null) return;
    final api = context.read<ApiService>();
    try {
      final url = await api.uploadAvatar(file.path);
      if (mounted) {
        context.read<AuthProvider>().updateUser(
              context.read<AuthProvider>().user!.copyWith(avatarUrl: url),
            );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _applyReferral() async {
    if (_referralInput.length != 7) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Введите 7-значный код')),
      );
      return;
    }
    setState(() => _referralLoading = true);
    final api = context.read<ApiService>();
    try {
      await api.applyReferral(_referralInput, _benefitType);
      await context.read<AuthProvider>().refreshProfile();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Реферал успешно применён!')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red),
        );
      }
    } finally {
      setState(() => _referralLoading = false);
    }
  }

  Future<void> _logout() async {
    final t = Translations(context.read<ThemeProvider>().lang);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(t.t('logout')),
        content: Text(t.t('logoutConfirm')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(t.t('cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(t.t('logout'), style: const TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) {
      await context.read<AuthProvider>().logout();
      if (mounted) context.go('/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.watch<ThemeProvider>();
    final auth = context.watch<AuthProvider>();
    final t = Translations(theme.lang);
    final user = auth.user;
    final driver = auth.driver;
    final api = context.read<ApiService>();

    return Scaffold(
      appBar: AppBar(title: Text(t.t('profile'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Avatar + name
          Center(
            child: Column(
              children: [
                GestureDetector(
                  onTap: _uploadAvatar,
                  child: Stack(
                    children: [
                      CircleAvatar(
                        radius: 48,
                        backgroundColor: theme.card,
                        backgroundImage: user?.avatarUrl != null
                            ? NetworkImage(api.buildAvatarUrl(user!.avatarUrl))
                            : null,
                        child: user?.avatarUrl == null
                            ? Text(
                                user?.firstName.isNotEmpty == true
                                    ? user!.firstName[0].toUpperCase()
                                    : '?',
                                style: TextStyle(fontSize: 32, color: theme.primary),
                              )
                            : null,
                      ),
                      Positioned(
                        bottom: 0,
                        right: 0,
                        child: Container(
                          padding: const EdgeInsets.all(4),
                          decoration: BoxDecoration(
                            color: theme.primary,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.camera_alt, size: 14, color: Colors.black),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '${user?.firstName ?? ''} ${user?.lastName ?? ''}',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                Text(user?.phone ?? '', style: TextStyle(color: theme.textSecondary)),
                if (driver != null) ...[
                  const SizedBox(height: 4),
                  Text(driver.carNumber,
                      style: TextStyle(color: theme.textSecondary, fontSize: 13)),
                ],
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Rating + Balance
          Row(
            children: [
              Expanded(
                child: _infoCard(
                  icon: Icons.star,
                  color: Colors.amber,
                  label: t.t('rating'),
                  value: _ratingLoading
                      ? '...'
                      : '${_avgRating.toStringAsFixed(1)} (${_ratingCount})',
                  theme: theme,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _infoCard(
                  icon: Icons.account_balance_wallet,
                  color: Colors.green,
                  label: t.t('balance'),
                  value: driver != null
                      ? '${driver.balance.toStringAsFixed(0)} сум'
                      : '0 сум',
                  theme: theme,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Settings section
          _sectionTitle('Настройки', theme),
          Card(
            color: theme.card,
            child: Column(
              children: [
                SwitchListTile(
                  title: Text(t.t('darkMode')),
                  value: theme.isDark,
                  activeColor: theme.primary,
                  onChanged: theme.setDark,
                ),
                const Divider(height: 1),
                ListTile(
                  title: Text(t.t('language')),
                  trailing: SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(value: 'ru', label: Text('RU')),
                      ButtonSegment(value: 'uz', label: Text('UZ')),
                    ],
                    selected: {theme.lang},
                    onSelectionChanged: (s) => theme.setLanguage(s.first),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Trip History
          _sectionTitle(t.t('tripHistory'), theme),
          Card(
            color: theme.card,
            child: Column(
              children: [
                ListTile(
                  title: Text(t.t('tripHistory')),
                  trailing: _historyLoading
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator())
                      : Icon(
                          _historyShown ? Icons.expand_less : Icons.expand_more,
                        ),
                  onTap: _historyShown ? () => setState(() => _historyShown = false) : _loadHistory,
                ),
                if (_historyShown)
                  ..._history.isEmpty
                      ? [
                          const Padding(
                            padding: EdgeInsets.all(16),
                            child: Text('Нет завершённых поездок'),
                          )
                        ]
                      : _history.map((order) => _historyTile(order, theme)),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Referral section
          if (driver != null) ...[
            _sectionTitle(t.t('referral'), theme),
            Card(
              color: theme.card,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(t.t('yourCode'),
                        style: TextStyle(color: theme.textSecondary, fontSize: 12)),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Expanded(
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
                            decoration: BoxDecoration(
                              color: theme.background,
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: theme.primary, width: 2),
                            ),
                            child: Text(
                              driver.referralCode ?? '-',
                              style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                                color: theme.primary,
                                letterSpacing: 4,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton(
                          icon: const Icon(Icons.copy),
                          onPressed: () {
                            Clipboard.setData(ClipboardData(text: driver.referralCode ?? ''));
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text(t.t('codeCopied'))),
                            );
                          },
                        ),
                      ],
                    ),
                    if (driver.referredBy != null) ...[
                      const SizedBox(height: 8),
                      Text('${t.t("referredBy")}: ${driver.referredBy}',
                          style: TextStyle(color: theme.textSecondary, fontSize: 12)),
                    ],
                    if (driver.referralBenefitType != null) ...[
                      const SizedBox(height: 4),
                      Text('${t.t("benefitActive")}: ${driver.referralBenefitType}',
                          style: TextStyle(color: theme.success, fontWeight: FontWeight.bold)),
                    ],
                    if (driver.referredBy == null) ...[
                      const SizedBox(height: 16),
                      const Divider(),
                      const SizedBox(height: 8),
                      TextField(
                        decoration: InputDecoration(
                          labelText: t.t('enterFriendCode'),
                          prefixIcon: const Icon(Icons.card_giftcard),
                        ),
                        keyboardType: TextInputType.number,
                        maxLength: 7,
                        onChanged: (v) => _referralInput = v,
                      ),
                      const SizedBox(height: 8),
                      Text(t.t('chooseBenefit'),
                          style: TextStyle(color: theme.textSecondary, fontSize: 12)),
                      const SizedBox(height: 8),
                      SegmentedButton<String>(
                        segments: [
                          ButtonSegment(
                            value: 'commission',
                            label: Text(t.t('commission'), style: const TextStyle(fontSize: 11)),
                          ),
                          ButtonSegment(
                            value: 'bonus',
                            label: Text(t.t('bonus'), style: const TextStyle(fontSize: 11)),
                          ),
                        ],
                        selected: {_benefitType},
                        onSelectionChanged: (s) => setState(() => _benefitType = s.first),
                      ),
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: _referralLoading ? null : _applyReferral,
                          child: _referralLoading
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black),
                                )
                              : Text(t.t('applyReferral')),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Support & Logout
          _sectionTitle('', theme),
          Card(
            color: theme.card,
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.support_agent, color: Colors.blue),
                  title: Text(t.t('support')),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => launchUrl(Uri.parse('tel:+998712001122')),
                ),
                const Divider(height: 1),
                ListTile(
                  leading: Icon(Icons.logout, color: theme.error),
                  title: Text(t.t('logout'), style: TextStyle(color: theme.error)),
                  onTap: _logout,
                ),
              ],
            ),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _sectionTitle(String title, ThemeProvider theme) {
    if (title.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        title,
        style: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.bold,
          color: theme.textSecondary,
          letterSpacing: 0.5,
        ),
      ),
    );
  }

  Widget _infoCard({
    required IconData icon,
    required Color color,
    required String label,
    required String value,
    required ThemeProvider theme,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.card,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: TextStyle(fontSize: 11, color: theme.textSecondary)),
              Text(value, style: const TextStyle(fontWeight: FontWeight.bold)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _historyTile(HistoryOrder order, ThemeProvider theme) {
    final statusColor = {
      'completed': Colors.green,
      'cancelled': Colors.red,
      'searching': Colors.orange,
      'accepted': Colors.blue,
      'arrived': Colors.orange,
      'in_progress': Colors.green,
    }[order.status] ?? theme.textSecondary;

    final fmt = DateFormat('dd.MM.yyyy HH:mm');
    return ListTile(
      isThreeLine: true,
      title: Text(order.pickupAddress, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (order.destAddress != null)
            Text('→ ${order.destAddress}', maxLines: 1, overflow: TextOverflow.ellipsis,
                style: TextStyle(color: theme.textSecondary, fontSize: 12)),
          Row(
            children: [
              if (order.distanceKm != null)
                Text('${order.distanceKm!.toStringAsFixed(1)} км  ',
                    style: TextStyle(color: theme.textSecondary, fontSize: 11)),
              if (order.totalPrice != null)
                Text('${order.totalPrice!.toStringAsFixed(0)} сум',
                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
              const Spacer(),
              Text(fmt.format(order.createdAt.toLocal()),
                  style: TextStyle(color: theme.textSecondary, fontSize: 11)),
            ],
          ),
        ],
      ),
      trailing: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: statusColor.withOpacity(0.15),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(order.status, style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.bold)),
      ),
    );
  }
}
