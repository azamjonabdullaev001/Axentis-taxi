import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Image, Switch, Alert, ActivityIndicator, Modal, FlatList,
  TextInput, Clipboard, Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { authAPI, driverAPI } from '../services/api';
import { buildAvatarUrl } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from '../config';
import { t } from '../i18n';

const SUPPORT_PHONE = '+998712001122';

export default function ProfileScreen() {
  const { colors, isDark, toggleTheme, lang, setLang } = useTheme();
  const { user, driver, logout, setUser } = useAuth();
  const [langModal, setLangModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();

  // Ratings
  const [ratingsData, setRatingsData] = useState({ ratings: [], average_rating: 5.0, rating_count: 0 });

  // Trip history
  const [orders, setOrders] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);

  // Referral
  const [referralExpanded, setReferralExpanded] = useState(false);
  const [referralInput, setReferralInput] = useState('');
  const [referralStep, setReferralStep] = useState('input'); // 'input' | 'choose'
  const [applyingReferral, setApplyingReferral] = useState(false);

  useEffect(() => {
    driverAPI.getDriverRatings().then(({ data }) => setRatingsData(data)).catch(() => {});
    loadHistory();
  }, []);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const { data } = await driverAPI.getHistory();
      setOrders(data.orders || []);
    } catch {}
    setLoadingHistory(false);
  }

  async function handlePickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
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
          setUser(profile.data.user);
        } catch {
          setUser({ ...user, avatar_url: data.url });
        }
      } finally {
        setLoading(false);
      }
    }
  }

  async function handleLogout() {
    Alert.alert(t(lang,'logoutTitle'), t(lang,'logoutConfirm'), [
      { text: t(lang,'cancel'), style: 'cancel' },
      { text: t(lang,'logout'), style: 'destructive', onPress: logout },
    ]);
  }

  const s = makeStyles(colors);
  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: Math.max(insets.top, 12), paddingBottom: 40 + insets.bottom }]}>
      <View style={s.avatarSection}>
        <TouchableOpacity onPress={handlePickImage} style={s.avatarWrap}>
          {user?.avatar_url
            ? <Image source={{ uri: buildAvatarUrl(user.avatar_url) }} style={s.avatar} />
            : <View style={[s.avatar, s.avatarPlaceholder]}>
                <Text style={s.avatarInitial}>{(user?.first_name?.[0] || '?').toUpperCase()}</Text>
              </View>}
          <View style={[s.editBadge, { backgroundColor: colors.primary }]}>
            <Text style={{ fontSize: 12 }}>✏️</Text>
          </View>
        </TouchableOpacity>
        {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />}
        <Text style={[s.name, { color: colors.text }]}>{user?.first_name} {user?.last_name}</Text>
        <Text style={[s.phone, { color: colors.textSecondary }]}>{user?.phone}</Text>
        {driver && (
          <View style={[s.carBadge, { backgroundColor: colors.card, borderColor: colors.primary }]}>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>🚗 {driver.car_number}</Text>
          </View>
        )}
      </View>

      {/* ── Referral code card (always visible) ── */}
      {driver?.referral_code ? (
        <View style={[s.referralCodeCard, { backgroundColor: colors.card, borderColor: colors.primary }]}>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 4 }}>🎁 Мой реферальный код</Text>
          <Text style={{ color: colors.primary, fontSize: 26, fontWeight: '900', letterSpacing: 6, textAlign: 'center', marginVertical: 6 }}>
            {driver.referral_code}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <TouchableOpacity
              style={[s.referralActionBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                Clipboard.setString(driver.referral_code);
                Alert.alert('Скопировано', `Код ${driver.referral_code} скопирован в буфер обмена`);
              }}
            >
              <Text style={{ color: '#000', fontWeight: '700', fontSize: 13 }}>📋 Копировать</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.referralActionBtn, { backgroundColor: '#1a1a1a' }]}
              onPress={() => {
                Share.share({
                  message: `Присоединяйся к Axentis Taxi! Мой реферальный код: ${driver.referral_code}`,
                });
              }}
            >
              <Text style={{ color: '#FFCC00', fontWeight: '700', fontSize: 13 }}>📤 Поделиться</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={[s.section, { backgroundColor: colors.card }]}>
        <View style={s.row}>
          <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang,'darkMode')}</Text>
          <Switch value={isDark} onValueChange={toggleTheme}
            trackColor={{ true: colors.primary, false: colors.border }} />
        </View>
        <TouchableOpacity style={s.row} onPress={() => setLangModal(true)}>
          <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang,'language')}</Text>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>
            {lang === 'ru' ? '🇷🇺 Русский' : "🇺🇿 O'zbek"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.row} onPress={() => Alert.alert(t(lang,'support'), SUPPORT_PHONE)}>
          <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang,'support')}</Text>
          <Text style={{ color: colors.textSecondary }}>📞</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={[s.logoutBtn, { borderColor: colors.error }]} onPress={handleLogout}>
        <Text style={{ color: colors.error, fontWeight: '700', fontSize: 15 }}>{t(lang,'logout')}</Text>
      </TouchableOpacity>

      {/* Ratings section */}
      <View style={[s.section, { backgroundColor: colors.card, marginTop: 20 }]}>
        <View style={s.row}>
          <View>
            <Text style={[s.rowLabel, { color: colors.text }]}>⭐ Мои оценки</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
              {ratingsData.average_rating.toFixed(1)} / 5.0 ({ratingsData.rating_count} оценок)
            </Text>
          </View>
        </View>
        <View style={s.ratingSummaryRow}>
          {[1,2,3,4,5].map((star) => (
            <Text key={star} style={{ fontSize: 28, color: star <= Math.round(ratingsData.average_rating) ? '#FFC107' : colors.border }}>★</Text>
          ))}
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', marginLeft: 8 }}>
            {ratingsData.average_rating.toFixed(1)}
          </Text>
        </View>
      </View>

      {/* Trip history */}
      <View style={[s.section, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={s.row} onPress={() => { loadHistory(); setHistoryModalVisible(true); }}>
          <Text style={[s.rowLabel, { color: colors.text }]}>📋 {t(lang,'tripHistory') || 'История поездок'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {loadingHistory
              ? <ActivityIndicator size="small" color={colors.textSecondary} />
              : <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{orders.length}</Text>}
            <Text style={{ color: colors.textSecondary, fontSize: 18 }}>›</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* ── Referral section ── */}
      <View style={[s.section, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={s.row} onPress={() => setReferralExpanded((v) => !v)}>
          <Text style={[s.rowLabel, { color: colors.text }]}>🎁 Рефералка</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 18 }}>{referralExpanded ? '▾' : '›'}</Text>
        </TouchableOpacity>

        {referralExpanded && (
          <View style={{ paddingHorizontal: 4, paddingBottom: 12 }}>

            {/* My unique referral code */}
            {driver?.referral_code ? (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 4 }}>Мой реферальный код</Text>
                <TouchableOpacity
                  onPress={() => {
                    Clipboard.setString(driver.referral_code);
                    Alert.alert('Скопировано', `Код ${driver.referral_code} скопирован в буфер обмена`);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.background, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.primary }}
                >
                  <Text style={{ color: colors.primary, fontSize: 22, fontWeight: '900', letterSpacing: 4, flex: 1 }}>{driver.referral_code}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>📋 Копировать</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Applied benefit display */}
            {driver?.referral_benefit_type ? (
              <View style={{ backgroundColor: '#E8F5E9', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                <Text style={{ color: '#2E7D32', fontWeight: '700', fontSize: 14 }}>
                  {driver.referral_benefit_type === 'commission'
                    ? '✅ Применено: сниженная комиссия'
                    : '✅ Применено: еженедельный бонус'}
                </Text>
                {driver.referred_by ? (
                  <Text style={{ color: '#388E3C', fontSize: 12, marginTop: 4 }}>Реферал от: {driver.referred_by}</Text>
                ) : null}
              </View>
            ) : (
              /* Input + benefit selector */
              <>
                {referralStep === 'input' && (
                  <View>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 6 }}>Введите реферальный код друга</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TextInput
                        style={[s.referralInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background, flex: 1 }]}
                        value={referralInput}
                        onChangeText={(v) => setReferralInput(v.replace(/\D/g, '').slice(0, 7))}
                        keyboardType="numeric"
                        maxLength={7}
                        placeholder="7-значный код"
                        placeholderTextColor={colors.textSecondary}
                      />
                      <TouchableOpacity
                        style={[s.referralBtn, { backgroundColor: referralInput.length === 7 ? colors.primary : colors.border }]}
                        disabled={referralInput.length !== 7}
                        onPress={() => setReferralStep('choose')}
                      >
                        <Text style={{ color: '#000', fontWeight: '700' }}>Далее</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {referralStep === 'choose' && (
                  <View>
                    <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 10 }}>Выберите тип бонуса</Text>

                    <TouchableOpacity
                      style={[s.benefitCard, { borderColor: colors.primary }]}
                      disabled={applyingReferral}
                      onPress={async () => {
                        setApplyingReferral(true);
                        try {
                          await driverAPI.applyReferral(referralInput, 'commission');
                          const profile = await authAPI.getProfile();
                          setUser(profile.data.user);
                          // Refresh driver data
                          Alert.alert('Готово', 'Сниженная комиссия активирована!');
                          setReferralStep('input');
                        } catch (e) {
                          Alert.alert('Ошибка', e?.response?.data?.error || 'Не удалось применить');
                        } finally {
                          setApplyingReferral(false);
                        }
                      }}
                    >
                      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15 }}>💸 Сниженная комиссия</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>Ваш % с поездок уменьшится (вместо стандартных 8% — всего 6%)</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[s.benefitCard, { borderColor: '#43A047', marginTop: 10 }]}
                      disabled={applyingReferral}
                      onPress={async () => {
                        setApplyingReferral(true);
                        try {
                          await driverAPI.applyReferral(referralInput, 'bonus');
                          Alert.alert('Готово', 'Еженедельный бонус активирован!');
                          setReferralStep('input');
                        } catch (e) {
                          Alert.alert('Ошибка', e?.response?.data?.error || 'Не удалось применить');
                        } finally {
                          setApplyingReferral(false);
                        }
                      }}
                    >
                      <Text style={{ color: '#43A047', fontWeight: '800', fontSize: 15 }}>🎁 Еженедельный бонус</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>Получайте фиксированный бонус каждую неделю на баланс</Text>
                    </TouchableOpacity>

                    {applyingReferral && <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />}

                    <TouchableOpacity onPress={() => setReferralStep('input')} style={{ marginTop: 10, alignItems: 'center' }}>
                      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>← Изменить код</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        )}
      </View>

      {/* History modal */}
      <Modal visible={historyModalVisible} animationType="slide" onRequestClose={() => setHistoryModalVisible(false)}>
        <SafeAreaView style={[{ flex: 1, backgroundColor: colors.background }]} edges={['top']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <TouchableOpacity onPress={() => setHistoryModalVisible(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>← {t(lang, 'back') || 'Назад'}</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center', marginRight: 40 }}>
              {t(lang, 'tripHistory') || 'История поездок'}
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
                    {lang === 'uz' ? "Sayohatlar yo'q" : 'Нет поездок'}
                  </Text>
                }
                renderItem={({ item: order }) => {
                  const statusColors = { completed: '#43A047', cancelled: '#E53935', searching: '#FF9800', accepted: '#2196F3', arrived: '#FF9800', in_progress: '#4CAF50' };
                  const statusLabels = { completed: 'Завершён', cancelled: 'Отменён', searching: 'Поиск', accepted: 'Принят', arrived: 'На месте', in_progress: 'В пути' };
                  const d = new Date(order.created_at);
                  const dateStr = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                  return (
                    <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <View style={{ backgroundColor: statusColors[order.status] || '#9E9E9E', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 }}>
                          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{statusLabels[order.status] || order.status}</Text>
                        </View>
                        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{dateStr}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                        <Text style={{ fontSize: 10, color: '#43A047', marginRight: 6 }}>●</Text>
                        <Text style={{ color: colors.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{order.pickup_address || '—'}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                        <Text style={{ fontSize: 10, color: '#E53935', marginRight: 6 }}>■</Text>
                        <Text style={{ color: colors.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{order.destination_address || '—'}</Text>
                      </View>
                      {order.total_price != null && (
                        <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '800', marginTop: 4 }}>
                          {parseFloat(order.total_price).toLocaleString()} {t(lang, 'sum') || 'сум'}
                        </Text>
                      )}
                    </View>
                  );
                }}
              />
          }
        </SafeAreaView>
      </Modal>

      <Modal visible={langModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { backgroundColor: colors.background }]}>
            <Text style={[s.modalTitle, { color: colors.text }]}>{t(lang,'selectLanguage')}</Text>
            {[{ code:'ru', label:'🇺🇳 Русский' }, { code:'uz', label:"\ud83c\uddfa\ud83c\uddff O'zbek" }].map((item) => (
              <TouchableOpacity key={item.code} style={s.langOption}
                onPress={() => {
                  setLang(item.code);
                  setLangModal(false);
                }}>
                <Text style={[s.langLabel, { color: colors.text }]}>{item.label}</Text>
                {lang === item.code && <Text style={{ color: colors.primary }}>✓</Text>}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={{ padding: 16, alignItems: 'center' }} onPress={() => setLangModal(false)}>
              <Text style={{ color: colors.textSecondary }}>{t(lang,'close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

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
    carBadge: { marginTop: 8, borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
    section: { borderRadius: 16, marginBottom: 20, overflow: 'hidden' },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
    rowLabel: { fontSize: 15 },
    logoutBtn: { borderWidth: 1.5, borderRadius: 14, padding: 14, alignItems: 'center' },
    ratingSummaryRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
    ratingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1 },
    modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
    modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 20 },
    langOption: { flexDirection: 'row', justifyContent: 'space-between', padding: 14 },
    langLabel: { fontSize: 16 },
    referralInput: {
      borderWidth: 1.5, borderRadius: 10, padding: 12,
      fontSize: 18, fontWeight: '700', letterSpacing: 4, textAlign: 'center',
    },
    referralBtn: {
      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      justifyContent: 'center', alignItems: 'center',
    },
    benefitCard: {
      borderWidth: 2, borderRadius: 14, padding: 14,
    },
    referralCodeCard: {
      borderWidth: 2, borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 20,
    },
    referralActionBtn: {
      flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center',
    },
  });
}
