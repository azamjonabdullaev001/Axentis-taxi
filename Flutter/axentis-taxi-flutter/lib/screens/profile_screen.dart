import 'dart:io';
import 'package:flutter/material.dart';
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
  List<HistoryOrder> _history = [];
  bool _historyLoading = false;
  bool _historyExpanded = false;
  bool _uploadingAvatar = false;

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  Future<void> _loadHistory() async {
    setState(() => _historyLoading = true);
    try {
      final api = context.read<ApiService>();
      final orders = await api.getOrderHistory();
      if (mounted) setState(() => _history = orders);
    } catch (_) {}
    if (mounted) setState(() => _historyLoading = false);
  }

  Future<void> _pickAvatar() async {
    final picker = ImagePicker();
    final img = await picker.pickImage(source: ImageSource.gallery, imageQuality: 80);
    if (img == null || !mounted) return;
    setState(() => _uploadingAvatar = true);
    try {
      final api = context.read<ApiService>();
      await api.uploadAvatar(File(img.path));
      await context.read<AuthProvider>().refreshProfile();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _uploadingAvatar = false);
    }
  }

  Future<void> _callSupport() async {
    final uri = Uri.parse('tel:+998712001122');
    if (await canLaunchUrl(uri)) launchUrl(uri);
  }

  Future<void> _confirmLogout(Translations t) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(t.t('logout')),
        content: Text(t.t('logoutConfirm')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(t.t('cancel'))),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: Text(t.t('logout')),
          ),
        ],
      ),
    );
    if (confirm == true && mounted) {
      await context.read<AuthProvider>().logout();
    }
  }

  Widget _buildAvatar(UserModel user, ThemeProvider theme) {
    final api = context.read<ApiService>();
    final avatarUrl = user.avatarUrl != null ? api.buildAvatarUrl(user.avatarUrl!) : null;

    return GestureDetector(
      onTap: _pickAvatar,
      child: Stack(
        children: [
          CircleAvatar(
            radius: 44,
            backgroundColor: theme.primary.withOpacity(0.3),
            backgroundImage: avatarUrl != null ? NetworkImage(avatarUrl) : null,
            child: _uploadingAvatar
                ? const CircularProgressIndicator()
                : avatarUrl == null
                    ? Text(
                        user.firstName.isNotEmpty ? user.firstName[0].toUpperCase() : '?',
                        style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
                      )
                    : null,
          ),
          Positioned(
            bottom: 0, right: 0,
            child: Container(
              width: 26, height: 26,
              decoration: BoxDecoration(color: theme.primary, shape: BoxShape.circle),
              child: const Icon(Icons.camera_alt, size: 14, color: Colors.black),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.watch<ThemeProvider>();
    final auth = context.watch<AuthProvider>();
    final t = Translations(theme.lang);
    final user = auth.user;

    if (user == null) {
      return Scaffold(
        body: Center(child: CircularProgressIndicator(color: theme.primary)),
      );
    }

    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        title: Text(t.t('profile')),
        backgroundColor: theme.card,
        foregroundColor: theme.textPrimary,
        elevation: 0,
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: () => context.read<AuthProvider>().refreshProfile()),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ── Avatar & Name ──────────────────────────────────────────────────
          Center(child: _buildAvatar(user, theme)),
          const SizedBox(height: 12),
          Center(
            child: Text(
              '${user.firstName} ${user.lastName}',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
          ),
          Center(
            child: Text(user.phone, style: TextStyle(color: theme.textSecondary)),
          ),
          const SizedBox(height: 24),

          // ── Appearance ─────────────────────────────────────────────────────
          _sectionTitle(t.t('appearance'), theme),
          _card(theme, [
            // Dark mode
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(children: [
                  Icon(Icons.dark_mode, color: theme.textSecondary),
                  const SizedBox(width: 12),
                  Text(t.t('darkMode')),
                ]),
                Switch(
                  value: theme.isDark,
                  onChanged: (v) => theme.setDark(v),
                  activeColor: theme.primary,
                ),
              ],
            ),
            const SizedBox(height: 4),
            // Language
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(children: [
                  Icon(Icons.language, color: theme.textSecondary),
                  const SizedBox(width: 12),
                  Text(t.t('language')),
                ]),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'ru', label: Text('RU')),
                    ButtonSegment(value: 'uz', label: Text('UZ')),
                  ],
                  selected: {theme.lang},
                  onSelectionChanged: (v) => theme.setLang(v.first),
                  style: ButtonStyle(
                    backgroundColor: WidgetStateProperty.resolveWith(
                      (s) => s.contains(WidgetState.selected) ? theme.primary : null,
                    ),
                  ),
                ),
              ],
            ),
          ]),
          const SizedBox(height: 16),

          // ── Privacy ────────────────────────────────────────────────────────
          _sectionTitle(t.t('privacy'), theme),
          _card(theme, [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Icon(Icons.location_on, color: theme.textSecondary),
                        const SizedBox(width: 12),
                        Text(t.t('shareLocation')),
                      ]),
                      Padding(
                        padding: const EdgeInsets.only(left: 36),
                        child: Text(t.t('shareLocationHint'),
                            style: TextStyle(fontSize: 11, color: theme.textSecondary)),
                      ),
                    ],
                  ),
                ),
                Switch(
                  value: user.shareLiveLocation,
                  onChanged: (v) async {
                    final api = context.read<ApiService>();
                    await api.updatePassengerLocationSharing(v);
                    await context.read<AuthProvider>().refreshProfile();
                  },
                  activeColor: theme.primary,
                ),
              ],
            ),
          ]),
          const SizedBox(height: 16),

          // ── Trip History ────────────────────────────────────────────────────
          _sectionTitle(t.t('tripHistory'), theme),
          _card(theme, [
            GestureDetector(
              onTap: () => setState(() => _historyExpanded = !_historyExpanded),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(children: [
                    Icon(Icons.history, color: theme.textSecondary),
                    const SizedBox(width: 12),
                    Text('${_history.length} ${t.t("trips")}'),
                  ]),
                  _historyLoading
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : Icon(_historyExpanded ? Icons.expand_less : Icons.expand_more),
                ],
              ),
            ),
            if (_historyExpanded) ...[
              const SizedBox(height: 8),
              if (_history.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Center(child: Text(t.t('noTrips'), style: TextStyle(color: theme.textSecondary))),
                )
              else
                ...(_history.take(20).map((order) => Column(
                  children: [
                    const Divider(height: 8),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Column(
                          children: [
                            Container(width: 8, height: 8, decoration: const BoxDecoration(color: Colors.green, shape: BoxShape.circle)),
                            Container(width: 2, height: 24, color: Colors.grey.withOpacity(0.4)),
                            Container(width: 8, height: 8, decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle)),
                          ],
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(order.pickupAddress, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)),
                              const SizedBox(height: 12),
                              Text(order.destAddress ?? t.t('freeRide'), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)),
                            ],
                          ),
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            if (order.totalPrice != null)
                              Text('${order.totalPrice!.toStringAsFixed(0)} сум',
                                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                            Text(DateFormat('dd.MM.yy').format(order.createdAt),
                                style: TextStyle(color: theme.textSecondary, fontSize: 11)),
                          ],
                        ),
                      ],
                    ),
                  ],
                ))),
            ],
          ]),
          const SizedBox(height: 16),

          // ── Support ────────────────────────────────────────────────────────
          _sectionTitle(t.t('support'), theme),
          _card(theme, [
            InkWell(
              onTap: _callSupport,
              borderRadius: BorderRadius.circular(12),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    Icon(Icons.phone, color: Colors.green),
                    const SizedBox(width: 12),
                    Text('+998 71 200-11-22', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold)),
                    const Spacer(),
                    const Icon(Icons.chevron_right),
                  ],
                ),
              ),
            ),
          ]),
          const SizedBox(height: 16),

          // ── Logout ─────────────────────────────────────────────────────────
          ElevatedButton.icon(
            icon: const Icon(Icons.logout),
            label: Text(t.t('logout')),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.red.withOpacity(0.12),
              foregroundColor: Colors.red,
              elevation: 0,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            onPressed: () => _confirmLogout(t),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _sectionTitle(String text, ThemeProvider theme) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6, left: 4),
      child: Text(text.toUpperCase(),
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: theme.textSecondary, letterSpacing: 1)),
    );
  }

  Widget _card(ThemeProvider theme, List<Widget> children) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.card,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.06), blurRadius: 8, offset: const Offset(0, 2))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    );
  }
}
