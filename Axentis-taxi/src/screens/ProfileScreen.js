import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Image, Switch, Alert, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { authAPI, orderAPI } from '../services/api';
import { buildAvatarUrl } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from '../config';
import { t } from '../i18n';

const SUPPORT_PHONE = '+998712001122';

const STATUS_COLORS = {
  searching: '#FF9800',
  accepted: '#2196F3',
  arrived: '#FF5722',
  in_progress: '#4CAF50',
  completed: '#9E9E9E',
  cancelled: '#F44336',
};
const STATUS_LABELS = {
  searching: 'Поиск',
  accepted: 'Принят',
  arrived: 'Прибыл',
  in_progress: 'В пути',
  completed: 'Завершён',
  cancelled: 'Отменён',
};
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ProfileScreen() {
  const { colors, isDark, toggleTheme, lang, setLang } = useTheme();
  const { user, logout, updateUser } = useAuth();
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();
  const [sharingLocation, setSharingLocation] = useState(user?.share_live_location !== false);
  const [orders, setOrders] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    setSharingLocation(user?.share_live_location !== false);
  }, [user?.share_live_location]);

  useEffect(() => {
    (async () => {
      setLoadingHistory(true);
      try {
        const { data } = await orderAPI.getHistory();
        setOrders(data.orders || []);
      } catch {}
      setLoadingHistory(false);
    })();
  }, []);

  async function handleToggleLocationSharing(value) {
    setSharingLocation(value);
    try {
      await orderAPI.updatePassengerLocationSharing(value);
      await updateUser({ ...user, share_live_location: value });
    } catch {
      setSharingLocation(!value);
      Alert.alert(t(lang, 'error'), t(lang, 'updateError'));
    }
  }

  function handleLanguageChange(newLang) {
    setLang(newLang);  // ThemeContext сохраняет в AsyncStorage
    setLangModalVisible(false);
  }

  async function handlePickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert(t(lang, 'noGallery')); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) {
      setLoading(true);
      try {
        const asset = result.assets[0];
        const token = await AsyncStorage.getItem('auth_token');
        const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase();
        const formData = new FormData();
        formData.append('file', {
          uri: asset.uri,
          type: asset.mimeType || 'image/jpeg',
          name: `avatar.${ext}`,
        });
        const res = await fetch(`${API_BASE}/upload/avatar`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        // Re-fetch profile from server to get the persisted avatar URL
        try {
          const profile = await authAPI.getProfile();
          await updateUser(profile.data.user);
        } catch {
          await updateUser({ ...user, avatar_url: data.url });
        }
      } catch {
        Alert.alert(t(lang, 'error'), t(lang, 'updateError'));
      } finally {
        setLoading(false);
      }
    }
  }

  async function handleLogout() {
    Alert.alert(t(lang,'logoutTitle'), t(lang,'logoutConfirm'), [
      { text: t(lang,'cancelBtn'), style: 'cancel' },
      { text: t(lang,'logout'), style: 'destructive', onPress: logout },
    ]);
  }

  const s = makeStyles(colors);

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: Math.max(insets.top, 12), paddingBottom: 40 + insets.bottom }]}>
      {/* Avatar */}
      <View style={s.avatarSection}>
        <TouchableOpacity onPress={handlePickImage} style={s.avatarWrap}>
          {user?.avatar_url
            ? <Image source={{ uri: buildAvatarUrl(user.avatar_url) }} style={s.avatar} />
            : <View style={[s.avatar, s.avatarPlaceholder]}>
                <Text style={s.avatarInitial}>
                  {(user?.first_name?.[0] || '?').toUpperCase()}
                </Text>
              </View>
          }
          <View style={[s.editBadge, { backgroundColor: colors.primary }]}>
            <Text style={{ fontSize: 12 }}>✏️</Text>
          </View>
        </TouchableOpacity>
        {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />}
        <Text style={[s.name, { color: colors.text }]}>
          {user?.first_name} {user?.last_name}
        </Text>
        <Text style={[s.phone, { color: colors.textSecondary }]}>{user?.phone}</Text>
      </View>

      {/* Settings */}
      <View style={[s.section, { backgroundColor: colors.card }]}>
        <Row label={t(lang,'darkMode')} colors={colors}>
          <Switch
            value={isDark} onValueChange={toggleTheme}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </Row>

        <TouchableOpacity style={s.row} onPress={() => setLangModalVisible(true)}>
          <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang,'language')}</Text>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>
            {lang === 'ru' ? '🇷🇺 Русский' : "🇺🇿 O'zbek"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.row} onPress={() => Alert.alert(t(lang,'support'), SUPPORT_PHONE)}>
          <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang,'support')}</Text>
          <Text style={{ color: colors.textSecondary }}>📞</Text>
        </TouchableOpacity>

        <Row label={t(lang, 'shareLocation')} colors={colors}>
          <Switch
            value={sharingLocation}
            onValueChange={handleToggleLocationSharing}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </Row>
      </View>

      {/* Trip history — opens in full-screen modal */}
      <View style={[s.section, { backgroundColor: colors.card, marginBottom: 20 }]}>
        <TouchableOpacity style={s.row} onPress={() => setHistoryModalVisible(true)}>
          <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang, 'tripHistory')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {loadingHistory
              ? <ActivityIndicator size="small" color={colors.textSecondary} />
              : <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{orders.length}</Text>}
            <Text style={{ color: colors.textSecondary, fontSize: 18 }}>›</Text>
          </View>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={[s.logoutBtn, { borderColor: colors.error }]} onPress={handleLogout}>
        <Text style={{ color: colors.error, fontWeight: '700', fontSize: 15 }}>{t(lang,'logout')}</Text>
      </TouchableOpacity>

      {/* History modal — full screen */}
      <Modal visible={historyModalVisible} animationType="slide" onRequestClose={() => setHistoryModalVisible(false)}>
        <SafeAreaView style={[{ flex: 1, backgroundColor: colors.background }]} edges={['top']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <TouchableOpacity onPress={() => setHistoryModalVisible(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>← {t(lang, 'back')}</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center', marginRight: 40 }}>
              {t(lang, 'tripHistory')}
            </Text>
          </View>
          {loadingHistory
            ? <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />
            : <FlatList
                data={orders}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                ListEmptyComponent={
                  <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 40 }}>
                    {t(lang, 'uz') === 'uz' ? "Sayohatlar yo'q" : lang === 'uz' ? "Sayohatlar yo'q" : 'Нет поездок'}
                  </Text>
                }
                renderItem={({ item: order }) => (
                  <View style={[s.historyCard, { backgroundColor: colors.card }]}>
                    <View style={s.orderCardHeader}>
                      <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[order.status] || '#9E9E9E' }]}>
                        <Text style={s.statusBadgeText}>{STATUS_LABELS[order.status] || order.status}</Text>
                      </View>
                      <Text style={[s.orderDate, { color: colors.textSecondary }]}>{formatDate(order.created_at)}</Text>
                    </View>
                    <View style={s.orderRoute}>
                      <Text style={{ fontSize: 10, color: '#43A047', marginRight: 6 }}>●</Text>
                      <Text style={[s.orderAddr, { color: colors.text }]} numberOfLines={1}>{order.pickup_address || '—'}</Text>
                    </View>
                    <View style={s.orderRoute}>
                      <Text style={{ fontSize: 10, color: '#E53935', marginRight: 6 }}>■</Text>
                      <Text style={[s.orderAddr, { color: colors.text }]} numberOfLines={1}>{order.destination_address || '—'}</Text>
                    </View>
                    {order.car_number ? (
                      <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 4 }}>🚗 {order.car_number}</Text>
                    ) : null}
                    {order.total_price != null && (
                      <Text style={[s.orderPrice, { color: colors.primary }]}>
                        {parseFloat(order.total_price).toLocaleString()} {t(lang, 'sum')}
                      </Text>
                    )}
                  </View>
                )}
              />
          }
        </SafeAreaView>
      </Modal>

      {/* Language modal */}
      <Modal visible={langModalVisible} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { backgroundColor: colors.background }]}>
            <Text style={[s.modalTitle, { color: colors.text }]}>{t(lang,'selectLanguage')}</Text>
            {[
              { code: 'ru', label: '🇷🇺 Русский' },
              { code: 'uz', label: "🇺🇿 O'zbek" },
            ].map((item) => (
              <TouchableOpacity key={item.code} style={s.langOption}
                onPress={() => handleLanguageChange(item.code)}>
                <Text style={[s.langLabel, { color: colors.text }]}>{item.label}</Text>
                {lang === item.code && <Text style={{ color: colors.primary }}>✓</Text>}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.closeBtn} onPress={() => setLangModalVisible(false)}>
              <Text style={{ color: colors.textSecondary }}>{t(lang,'close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, colors, children }) {
  return (
    <View style={rowStyles.row}>
      <Text style={[rowStyles.label, { color: colors.text }]}>{label}</Text>
      {children}
    </View>
  );
}
const rowStyles = StyleSheet.create({
  row: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical: 14, paddingHorizontal: 16 },
  label: { fontSize: 15 },
});

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, paddingBottom: 40 },
    avatarSection: { alignItems: 'center', marginBottom: 28 },
    avatarWrap: { position: 'relative', marginBottom: 12 },
    avatar: { width: 96, height: 96, borderRadius: 48 },
    avatarPlaceholder: { backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
    avatarInitial: { fontSize: 36, fontWeight: '800', color: '#000' },
    editBadge: { position: 'absolute', bottom: 0, right: 0, borderRadius: 10, padding: 4 },
    name: { fontSize: 20, fontWeight: '700' },
    phone: { fontSize: 15, marginTop: 4 },
    section: { borderRadius: 16, marginBottom: 20, overflow: 'hidden' },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
    rowLabel: { fontSize: 15 },
    logoutBtn: {
      borderWidth: 1.5, borderRadius: 14, padding: 14,
      alignItems: 'center',
    },
    sectionHeader: { fontSize: 15, fontWeight: '700', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
    emptyText: { textAlign: 'center', padding: 16, fontSize: 14 },
    orderCard: { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
    historyCard: { borderRadius: 14, padding: 14, marginBottom: 12 },
    orderCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    statusBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    orderDate: { fontSize: 12 },
    orderRoute: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    orderAddr: { flex: 1, fontSize: 13 },
    orderPrice: { fontSize: 14, fontWeight: '700', marginTop: 6 },
    modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
    modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 20 },
    langOption: { flexDirection: 'row', justifyContent: 'space-between', padding: 14 },
    langLabel: { fontSize: 16 },
    closeBtn: { alignItems: 'center', marginTop: 16, padding: 12 },
  });
}
