import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Image, Switch, Alert, ActivityIndicator, Modal, FlatList,
  TextInput, Clipboard, Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { authAPI, driverAPI, friendsAPI } from '../services/api';
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

  // Friends
  const [friendsExpanded, setFriendsExpanded] = useState(false);
  const [friendSearch, setFriendSearch] = useState('');
  const [friendSearchResult, setFriendSearchResult] = useState(null);
  const [friendSearchLoading, setFriendSearchLoading] = useState(false);
  const [friendsList, setFriendsList] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);

  // Referral
  const [referralExpanded, setReferralExpanded] = useState(false);
  const [referralInput, setReferralInput] = useState('');
  const [referralStep, setReferralStep] = useState('input'); // 'input' | 'choose'
  const [applyingReferral, setApplyingReferral] = useState(false);

  // Bonus history
  const [bonusExpanded, setBonusExpanded] = useState(false);
  const [bonusEvents, setBonusEvents] = useState([]);
  const [bonusStats, setBonusStats] = useState({ streak_days: 0, lifetime_trips: 0 });
  const [loadingBonuses, setLoadingBonuses] = useState(false);

  useEffect(() => {
    driverAPI.getDriverRatings().then(({ data }) => setRatingsData(data)).catch(() => {});
    loadHistory();
    loadBonusHistory();
  }, []);

  async function loadFriendsData() {
    setFriendsLoading(true);
    try {
      const [friendsRes, requestsRes] = await Promise.all([
        friendsAPI.getFriends(),
        friendsAPI.getPendingRequests(),
      ]);
      setFriendsList(friendsRes.data.friends || []);
      setPendingRequests(requestsRes.data.requests || []);
    } catch {}
    setFriendsLoading(false);
  }

  async function loadBonusHistory() {
    setLoadingBonuses(true);
    try {
      const { data } = await driverAPI.getBonusHistory();
      setBonusEvents(data.events || []);
      setBonusStats({ streak_days: data.streak_days || 0, lifetime_trips: data.lifetime_trips || 0 });
    } catch {}
    setLoadingBonuses(false);
  }

  async function handleSearchFriend() {
    if (!friendSearch.trim()) return;
    setFriendSearchLoading(true);
    setFriendSearchResult(null);
    try {
      const { data } = await friendsAPI.searchDriver(friendSearch.trim());
      setFriendSearchResult(data.driver);
    } catch {
      setFriendSearchResult({ notFound: true });
    }
    setFriendSearchLoading(false);
  }

  async function handleSendFriendRequest(driverID) {
    try {
      await friendsAPI.sendRequest(driverID);
      Alert.alert('✅', t(lang, 'requestSent'));
      setFriendSearchResult(null);
      setFriendSearch('');
    } catch (e) {
      Alert.alert(t(lang, 'error'), e?.response?.data?.error || 'Ошибка');
    }
  }

  async function handleAcceptFriendRequest(requestID) {
    try {
      await friendsAPI.acceptRequest(requestID);
      Alert.alert('✅', t(lang, 'friendAdded'));
      loadFriendsData();
    } catch (e) {
      Alert.alert(t(lang, 'error'), e?.response?.data?.error || 'Ошибка');
    }
  }

  async function handleDeclineFriendRequest(requestID) {
    try {
      await friendsAPI.declineRequest(requestID);
      loadFriendsData();
    } catch {}
  }

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
            <Ionicons name="camera" size={12} color="#000" />
          </View>
        </TouchableOpacity>
        {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />}
        <Text style={[s.name, { color: colors.text }]}>{user?.first_name} {user?.last_name}</Text>
        <Text style={[s.phone, { color: colors.textSecondary }]}>{user?.phone}</Text>
        {driver && (
          <View style={[s.carBadge, { backgroundColor: colors.card, borderColor: colors.primary }]}>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>🚗 {driver.car_brand ? `${driver.car_brand} · ` : ''}{driver.car_number}</Text>
          </View>
        )}
      </View>

      <View style={[s.section, { backgroundColor: colors.card }]}>
        <View style={s.row}>
          <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang,'darkMode')}</Text>
          <Switch value={isDark} onValueChange={toggleTheme}
            trackColor={{ true: colors.primary, false: colors.border }} />
        </View>
        <TouchableOpacity style={s.row} onPress={() => setLangModal(true)}>
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#30D15820' }]}>
              <Ionicons name="language-outline" size={18} color="#30D158" />
            </View>
            <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang,'language')}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
              {lang === 'ru' ? 'Русский' : "O'zbek"}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={s.row} onPress={() => Alert.alert(t(lang,'support'), SUPPORT_PHONE)}>
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#34C75920' }]}>
              <Ionicons name="call-outline" size={18} color="#34C759" />
            </View>
            <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang,'support')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* ── Order Progress section ── */}
      <View style={[s.section, { backgroundColor: colors.card }]}>
        <View style={s.row}>
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#4CAF5020' }]}>
              <Ionicons name="trending-up" size={18} color="#4CAF50" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.rowLabel, { color: colors.text }]}>Мой прогресс</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                {bonusStats.lifetime_trips} заказов выполнено
              </Text>
            </View>
          </View>
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          {(() => {
            const trips = bonusStats.lifetime_trips;
            const milestones = [10, 50, 100, 250, 500, 1000, 2500, 5000];
            const currentMilestone = milestones.find(m => trips < m) || milestones[milestones.length - 1];
            const prevMilestone = milestones[milestones.indexOf(currentMilestone) - 1] || 0;
            const progress = currentMilestone > prevMilestone
              ? Math.min((trips - prevMilestone) / (currentMilestone - prevMilestone), 1)
              : 1;
            const pct = Math.round(progress * 100);
            const rank = trips >= 5000 ? '🏆 Легенда' : trips >= 2500 ? '🥇 Профи' : trips >= 1000 ? '🥈 Мастер' : trips >= 500 ? '🥉 Эксперт' : trips >= 250 ? '⭐ Опытный' : trips >= 100 ? '🚗 Водитель' : trips >= 50 ? '🔰 Активный' : '🆕 Новичок';
            return (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 14 }}>{rank}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{trips} / {currentMilestone}</Text>
                </View>
                <View style={{ height: 10, backgroundColor: colors.border, borderRadius: 5, overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${pct}%`, backgroundColor: '#4CAF50', borderRadius: 5 }} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{prevMilestone}</Text>
                  <Text style={{ color: '#4CAF50', fontSize: 12, fontWeight: '700' }}>{pct}%</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{currentMilestone}</Text>
                </View>
                {bonusStats.streak_days > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 }}>
                    <Text style={{ fontSize: 16 }}>🔥</Text>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                      {bonusStats.streak_days} дн. подряд
                    </Text>
                  </View>
                )}
              </>
            );
          })()}
        </View>
      </View>

      {/* Ratings section */}
      <View style={[s.section, { backgroundColor: colors.card, marginTop: 20 }]}>
        <View style={s.row}>
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#FFC10720' }]}>
              <Ionicons name="star" size={18} color="#FFC107" />
            </View>
            <View>
              <Text style={[s.rowLabel, { color: colors.text }]}>Мои оценки</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
                {ratingsData.average_rating.toFixed(1)} / 5.0 ({ratingsData.rating_count} оценок)
              </Text>
            </View>
          </View>
        </View>
        <View style={s.ratingSummaryRow}>
          {[1,2,3,4,5].map((star) => (
            <Ionicons key={star} name={star <= Math.round(ratingsData.average_rating) ? 'star' : 'star-outline'} size={26} color={star <= Math.round(ratingsData.average_rating) ? '#FFC107' : colors.border} />
          ))}
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', marginLeft: 8 }}>
            {ratingsData.average_rating.toFixed(1)}
          </Text>
        </View>
      </View>

      {/* Trip history */}
      <View style={[s.section, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={s.row} onPress={() => { loadHistory(); setHistoryModalVisible(true); }}>
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#FFCC0020' }]}>
              <Ionicons name="time-outline" size={18} color="#FFCC00" />
            </View>
            <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang,'tripHistory') || 'История поездок'}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {loadingHistory
              ? <ActivityIndicator size="small" color={colors.textSecondary} />
              : <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{orders.length}</Text>}
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>
      </View>

      {/* ── Referral section ── */}
      <View style={[s.section, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={s.row} onPress={() => setReferralExpanded((v) => !v)}>
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#FF9F0A20' }]}>
              <Ionicons name="gift-outline" size={18} color="#FF9F0A" />
            </View>
            <Text style={[s.rowLabel, { color: colors.text }]}>Рефералка</Text>
          </View>
          <Ionicons name={referralExpanded ? 'chevron-up' : 'chevron-forward'} size={16} color={colors.textSecondary} />
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
                    : driver.referral_benefit_type === 'cashback'
                    ? `✅ ${t(lang, 'cashbackApplied')}`
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

                    <TouchableOpacity
                      style={[s.benefitCard, { borderColor: '#10B981', marginTop: 10 }]}
                      disabled={applyingReferral}
                      onPress={async () => {
                        setApplyingReferral(true);
                        try {
                          await driverAPI.applyReferral(referralInput, 'cashback');
                          const profile = await authAPI.getProfile();
                          setUser(profile.data.user);
                          Alert.alert('Готово', 'Кэшбэк активирован!');
                          setReferralStep('input');
                        } catch (e) {
                          Alert.alert('Ошибка', e?.response?.data?.error || 'Не удалось применить');
                        } finally {
                          setApplyingReferral(false);
                        }
                      }}
                    >
                      <Text style={{ color: '#10B981', fontWeight: '800', fontSize: 15 }}>💰 {t(lang, 'cashback')}</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>{t(lang, 'cashbackDesc')}</Text>
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

      {/* ── Bonus History section ── */}
      <View style={[s.section, { backgroundColor: colors.card }]}>
        <TouchableOpacity
          style={s.row}
          onPress={() => {
            const next = !bonusExpanded;
            setBonusExpanded(next);
            if (next) loadBonusHistory();
          }}
        >
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#F59E0B20' }]}>
              <Ionicons name="trophy-outline" size={18} color="#F59E0B" />
            </View>
            <View>
              <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang, 'bonusHistory')}</Text>
              {bonusStats.lifetime_trips > 0 && (
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                  🔥 {bonusStats.streak_days} {t(lang, 'streakDays')} · {bonusStats.lifetime_trips} {t(lang, 'lifetimeTrips')}
                </Text>
              )}
            </View>
          </View>
          <Ionicons name={bonusExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        {bonusExpanded && (
          <View style={{ paddingHorizontal: 4, paddingBottom: 12 }}>
            {/* Stats cards */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <View style={{ flex: 1, backgroundColor: colors.background, borderRadius: 10, padding: 12, alignItems: 'center' }}>
                <Text style={{ color: '#F59E0B', fontSize: 24, fontWeight: '900' }}>{bonusStats.streak_days}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 11 }}>🔥 {t(lang, 'streakDays')}</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: colors.background, borderRadius: 10, padding: 12, alignItems: 'center' }}>
                <Text style={{ color: '#10B981', fontSize: 24, fontWeight: '900' }}>{bonusStats.lifetime_trips}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 11 }}>🚕 {t(lang, 'lifetimeTrips')}</Text>
              </View>
            </View>

            {loadingBonuses ? (
              <ActivityIndicator color={colors.primary} />
            ) : bonusEvents.length === 0 ? (
              <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 8 }}>{t(lang, 'noBonuses')}</Text>
            ) : (
              bonusEvents.slice(0, 10).map((ev, i) => (
                <View key={ev.id || i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: i < Math.min(bonusEvents.length, 10) - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                      {ev.bonus_type === 'cashback' ? '💰' : ev.bonus_type === 'night_bonus' ? '🌙' : ev.bonus_type === 'streak' ? '🔥' : '🏆'}{' '}
                      {ev.description || ev.bonus_type}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>{ev.created_at ? new Date(ev.created_at).toLocaleDateString('ru-RU') : ''}</Text>
                  </View>
                  <Text style={{ color: '#10B981', fontWeight: '800', fontSize: 14 }}>+{Number(ev.amount || 0).toLocaleString('ru-RU')} {t(lang, 'sum')}</Text>
                </View>
              ))
            )}
          </View>
        )}
      </View>

      {/* ── Friends section ── */}
      <View style={[s.section, { backgroundColor: colors.card }]}>
        <TouchableOpacity
          style={s.row}
          onPress={() => {
            const next = !friendsExpanded;
            setFriendsExpanded(next);
            if (next) loadFriendsData();
          }}
        >
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#5B8DEE20' }]}>
              <Ionicons name="people-outline" size={18} color="#5B8DEE" />
            </View>
            <View>
              <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang, 'friends')}</Text>
              {friendsList.length > 0 && (
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                  {friendsList.length} {lang === 'uz' ? "do'st" : 'друзей'}
                </Text>
              )}
            </View>
          </View>
          <Ionicons name={friendsExpanded ? 'chevron-up' : 'chevron-forward'} size={16} color={colors.textSecondary} />
        </TouchableOpacity>

        {friendsExpanded && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 16 }}>

            {/* Search input */}
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 6 }}>{t(lang, 'searchByPhone')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <TextInput
                style={[s.referralInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background, flex: 1, letterSpacing: 0 }]}
                value={friendSearch}
                onChangeText={setFriendSearch}
                keyboardType="phone-pad"
                placeholder="+998 XX XXX XX XX"
                placeholderTextColor={colors.textSecondary}
                returnKeyType="search"
                onSubmitEditing={handleSearchFriend}
              />
              <TouchableOpacity
                style={[s.referralBtn, { backgroundColor: friendSearch.length >= 9 ? colors.primary : colors.border }]}
                disabled={friendSearch.length < 9 || friendSearchLoading}
                onPress={handleSearchFriend}
              >
                {friendSearchLoading
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Text style={{ color: '#000', fontWeight: '700' }}>{lang === 'uz' ? 'Qidirish' : 'Найти'}</Text>}
              </TouchableOpacity>
            </View>

            {/* Search result */}
            {friendSearchResult && (
              friendSearchResult.notFound
                ? <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 12 }}>
                    {lang === 'uz' ? "Haydovchi topilmadi" : 'Водитель не найден'}
                  </Text>
                : <View style={[s.friendCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                      {friendSearchResult.avatar_url
                        ? <Image source={{ uri: buildAvatarUrl(friendSearchResult.avatar_url) }} style={s.friendAvatar} />
                        : <View style={[s.friendAvatar, { backgroundColor: '#5B8DEE', justifyContent: 'center', alignItems: 'center' }]}>
                            <Text style={{ color: '#fff', fontWeight: '700' }}>{(friendSearchResult.first_name?.[0] || '?').toUpperCase()}</Text>
                          </View>}
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '600' }}>{friendSearchResult.first_name} {friendSearchResult.last_name}</Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{friendSearchResult.phone}</Text>
                        <Text style={{ color: colors.primary, fontSize: 12 }}>🚗 {friendSearchResult.car_number}</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleSendFriendRequest(friendSearchResult.driver_id)}
                      style={{ backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
                    >
                      <Text style={{ color: '#000', fontWeight: '700', fontSize: 13 }}>{t(lang, 'addFriend')}</Text>
                    </TouchableOpacity>
                  </View>
            )}

            {/* Pending incoming requests */}
            {friendsLoading
              ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
              : (
                <>
                  {pendingRequests.length > 0 && (
                    <>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8, marginTop: 4 }}>{t(lang, 'pendingRequests')}</Text>
                      {pendingRequests.map((req) => (
                        <View key={req.request_id} style={[s.friendCard, { borderColor: '#FFCC0040', backgroundColor: colors.background, marginBottom: 8 }]}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                            {req.avatar_url
                              ? <Image source={{ uri: buildAvatarUrl(req.avatar_url) }} style={s.friendAvatar} />
                              : <View style={[s.friendAvatar, { backgroundColor: '#5B8DEE', justifyContent: 'center', alignItems: 'center' }]}>
                                  <Text style={{ color: '#fff', fontWeight: '700' }}>{(req.first_name?.[0] || '?').toUpperCase()}</Text>
                                </View>}
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: colors.text, fontWeight: '600' }}>{req.first_name} {req.last_name}</Text>
                              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{req.phone}</Text>
                            </View>
                          </View>
                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            <TouchableOpacity
                              onPress={() => handleAcceptFriendRequest(req.request_id)}
                              style={{ backgroundColor: '#22C55E', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                            >
                              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>✓</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => handleDeclineFriendRequest(req.request_id)}
                              style={{ backgroundColor: '#EF4444', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                            >
                              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                    </>
                  )}

                  {/* Accepted friends list */}
                  {friendsList.length === 0 && pendingRequests.length === 0 ? (
                    <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 8 }}>{t(lang, 'noFriends')}</Text>
                  ) : friendsList.length > 0 ? (
                    <>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8, marginTop: 4 }}>{t(lang, 'friends')}</Text>
                      {friendsList.map((f) => (
                        <View key={f.friendship_id} style={[s.friendCard, { borderColor: '#22C55E40', backgroundColor: colors.background, marginBottom: 8 }]}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                            {f.avatar_url
                              ? <Image source={{ uri: buildAvatarUrl(f.avatar_url) }} style={s.friendAvatar} />
                              : <View style={[s.friendAvatar, { backgroundColor: '#5B8DEE', justifyContent: 'center', alignItems: 'center' }]}>
                                  <Text style={{ color: '#fff', fontWeight: '700' }}>{(f.first_name?.[0] || '?').toUpperCase()}</Text>
                                </View>}
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: colors.text, fontWeight: '600' }}>{f.first_name} {f.last_name}</Text>
                              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{f.phone}</Text>
                              <Text style={{ color: colors.primary, fontSize: 12 }}>🚗 {f.car_number}</Text>
                            </View>
                          </View>
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#22C55E' }} />
                        </View>
                      ))}
                    </>
                  ) : null}
                </>
              )}
          </View>
        )}
      </View>

      {/* ── Logout button (bottom) ── */}
      <TouchableOpacity style={[s.logoutBtn, { borderColor: colors.error, marginTop: 20 }]} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={18} color={colors.error} />
        <Text style={{ color: colors.error, fontWeight: '700', fontSize: 15 }}>{t(lang,'logout')}</Text>
      </TouchableOpacity>

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
    editBadge: {
      position: 'absolute', bottom: 0, right: 0, borderRadius: 12,
      width: 26, height: 26, justifyContent: 'center', alignItems: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
    },
    name: { fontSize: 20, fontWeight: '700' },
    phone: { fontSize: 15, marginTop: 4 },
    carBadge: { marginTop: 8, borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
    section: { borderRadius: 16, marginBottom: 12, overflow: 'hidden' },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    rowIconWrap: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
    rowLabel: { fontSize: 15 },
    logoutBtn: { borderWidth: 1.5, borderRadius: 14, padding: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
    ratingSummaryRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, gap: 4 },
    ratingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1 },
    friendCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 10 },
    friendAvatar: { width: 40, height: 40, borderRadius: 20 },
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
