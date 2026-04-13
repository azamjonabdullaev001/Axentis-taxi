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
import socketService from '../services/socket';
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
  const [bonusSettings, setBonusSettings] = useState(null);
  const [weeklyProgress, setWeeklyProgress] = useState(null);
  const [weeklyTiers, setWeeklyTiers] = useState([]);
  const [referralBenefitInfo, setReferralBenefitInfo] = useState({ type: '', referred_by: '' });
  const [loadingBonuses, setLoadingBonuses] = useState(false);

  // Balance / Wallet
  const [balanceExpanded, setBalanceExpanded] = useState(false);
  const [balance, setBalance] = useState(0);
  const [balanceExempt, setBalanceExempt] = useState(false);
  const [balanceTransactions, setBalanceTransactions] = useState([]);
  const [balanceCards, setBalanceCards] = useState([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [topUpVisible, setTopUpVisible] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [selectedCard, setSelectedCard] = useState(null);
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [addCardVisible, setAddCardVisible] = useState(false);
  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [addCardLoading, setAddCardLoading] = useState(false);

  useEffect(() => {
    driverAPI.getDriverRatings().then(({ data }) => setRatingsData(data)).catch(() => {});
    loadHistory();
    loadBonusHistory();
  }, []);

  // Balance socket listener
  useEffect(() => {
    const handler = (data) => {
      if (data.balance !== undefined) setBalance(data.balance);
    };
    socketService.on('balance_updated', handler);
    return () => socketService.off('balance_updated');
  }, []);

  async function loadBalanceData() {
    setBalanceLoading(true);
    try {
      const [balRes, cardRes] = await Promise.all([
        driverAPI.getBalance(),
        driverAPI.getCards(),
      ]);
      setBalance(balRes.data.balance || 0);
      setBalanceExempt(balRes.data.balance_exempt || false);
      setBalanceTransactions(balRes.data.transactions || []);
      setBalanceCards(cardRes.data.cards || []);
    } catch {} finally { setBalanceLoading(false); }
  }

  function handleTopUp() {
    const amt = parseInt(topUpAmount, 10);
    if (!amt || amt < 1000) {
      Alert.alert(t(lang, 'error'), lang === 'uz' ? 'Minimum 1 000 soʻm' : 'Минимум 1 000 сум');
      return;
    }
    if (!selectedCard) {
      Alert.alert(t(lang, 'error'), lang === 'uz' ? 'Kartani tanlang' : 'Выберите карту');
      return;
    }
    setTopUpLoading(true);
    driverAPI.selfTopUp(amt, selectedCard.id).then(({ data }) => {
      setBalance(data.new_balance);
      setTopUpVisible(false);
      setTopUpAmount('');
      Alert.alert('✅', lang === 'uz' ? 'Balans toʻldirildi!' : 'Баланс пополнен!');
      loadBalanceData();
    }).catch((e) => {
      Alert.alert(t(lang, 'error'), e?.response?.data?.error || 'Ошибка');
    }).finally(() => setTopUpLoading(false));
  }

  function handleAddCard() {
    const num = cardNumber.replace(/\s/g, '');
    if (num.length < 13) {
      Alert.alert(t(lang, 'error'), lang === 'uz' ? 'Karta raqami notoʻgʻri' : 'Неверный номер карты');
      return;
    }
    if (cardExpiry.length < 4) {
      Alert.alert(t(lang, 'error'), lang === 'uz' ? 'Amal qilish muddati notoʻgʻri' : 'Неверный срок действия');
      return;
    }
    setAddCardLoading(true);
    driverAPI.addCard(num, cardHolder, cardExpiry).then(() => {
      setAddCardVisible(false);
      setCardNumber(''); setCardHolder(''); setCardExpiry('');
      Alert.alert('✅', lang === 'uz' ? 'Karta qoʻshildi!' : 'Карта добавлена!');
      loadBalanceData();
    }).catch((e) => {
      Alert.alert(t(lang, 'error'), e?.response?.data?.error || 'Ошибка');
    }).finally(() => setAddCardLoading(false));
  }

  function handleDeleteCard(card) {
    Alert.alert(
      lang === 'uz' ? 'Kartani oʻchirish' : 'Удалить карту',
      `${card.card_type.toUpperCase()} •••• ${card.card_number.slice(-4)}`,
      [
        { text: lang === 'uz' ? 'Bekor qilish' : 'Отмена', style: 'cancel' },
        { text: lang === 'uz' ? 'Oʻchirish' : 'Удалить', style: 'destructive',
          onPress: () => driverAPI.deleteCard(card.id).then(() => loadBalanceData()).catch((e) => Alert.alert(t(lang, 'error'), e?.response?.data?.error || 'Ошибка')),
        },
      ]
    );
  }

  const formatCardInput = (text) => {
    const clean = text.replace(/\D/g, '').slice(0, 16);
    return clean.replace(/(.{4})/g, '$1 ').trim();
  };
  const formatExpiryInput = (text) => {
    const clean = text.replace(/\D/g, '').slice(0, 4);
    if (clean.length >= 3) return clean.slice(0, 2) + '/' + clean.slice(2);
    return clean;
  };
  const cardTypeIcon = (type) => {
    switch (type) {
      case 'uzcard': return '🏦'; case 'humo': return '🔵';
      case 'visa': return '💳'; case 'mastercard': return '🟠'; default: return '💳';
    }
  };

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
      if (data.bonus_settings) setBonusSettings(data.bonus_settings);
      if (data.weekly_progress) setWeeklyProgress(data.weekly_progress);
      if (data.weekly_tiers) setWeeklyTiers(data.weekly_tiers);
      setReferralBenefitInfo({
        type: data.referral_benefit_type || '',
        referred_by: data.referred_by || '',
      });
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

  // Progress section expanded
  const [progressExpanded, setProgressExpanded] = useState(false);

  const s = makeStyles(colors);
  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: Math.max(insets.top, 12), paddingBottom: 40 + insets.bottom }]}>
      {/* ── Avatar section ── */}
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
            <Text style={{ color: colors.primary, fontWeight: '700' }}>🚗 {driver.car_number}</Text>
          </View>
        )}
      </View>

      {/* ══════ UNIFIED BLOCK ══════ */}
      <View style={[s.section, { backgroundColor: colors.card }]}>

        {/* ── Divider ── */}
        <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: 16 }} />

        {/* ── Dark mode toggle ── */}
        <View style={s.row}>
          <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang,'darkMode')}</Text>
          <Switch value={isDark} onValueChange={toggleTheme}
            trackColor={{ true: colors.primary, false: colors.border }} />
        </View>

        <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: 16 }} />

        {/* ── Language ── */}
        <TouchableOpacity style={s.row} onPress={() => setLangModal(!langModal)}>
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
            <Ionicons name={langModal ? 'chevron-up' : 'chevron-forward'} size={16} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>

        {langModal && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            {[{ code:'ru', label:'🇷🇺 Русский' }, { code:'uz', label:"🇺🇿 O'zbek" }].map((item) => (
              <TouchableOpacity key={item.code}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: lang === item.code ? (isDark ? 'rgba(255,204,0,0.1)' : '#FFF8E1') : 'transparent', marginBottom: 4 }}
                onPress={() => {
                  setLang(item.code);
                  setLangModal(false);
                }}>
                <Text style={{ color: colors.text, fontSize: 16 }}>{item.label}</Text>
                {lang === item.code && <Ionicons name="checkmark" size={20} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: 16 }} />

        {/* ── Support ── */}
        <TouchableOpacity style={s.row} onPress={() => Alert.alert(t(lang,'support'), SUPPORT_PHONE)}>
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#34C75920' }]}>
              <Ionicons name="call-outline" size={18} color="#34C759" />
            </View>
            <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang,'support')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: 16 }} />

        {/* ── Balance / Wallet (collapsible) ── */}
        <TouchableOpacity style={s.row} onPress={() => {
          const next = !balanceExpanded;
          setBalanceExpanded(next);
          if (next) loadBalanceData();
        }}>
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#FFCC0020' }]}>
              <Ionicons name="wallet-outline" size={18} color="#FFCC00" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.rowLabel, { color: colors.text }]}>{lang === 'uz' ? 'Hamyon' : 'Кошелёк'}</Text>
              <Text style={{ color: balance <= 0 && !balanceExempt ? '#EF4444' : colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                {Math.round(balance).toLocaleString('ru-RU')} {t(lang, 'sum')}
              </Text>
            </View>
          </View>
          <Ionicons name={balanceExpanded ? 'chevron-up' : 'chevron-forward'} size={16} color={colors.textSecondary} />
        </TouchableOpacity>

        {balanceExpanded && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            {balanceLoading ? <ActivityIndicator color={colors.primary} /> : (
              <>
                {/* Balance card */}
                <View style={{ backgroundColor: colors.background, borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 12 }}>
                  <Text style={{ color: colors.text, fontSize: 32, fontWeight: '900' }}>
                    {Math.round(balance).toLocaleString('ru-RU')} <Text style={{ fontSize: 16, fontWeight: '400', color: colors.textSecondary }}>{t(lang, 'sum')}</Text>
                  </Text>
                  {balanceExempt && (
                    <View style={{ backgroundColor: '#E8F5E9', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4, marginTop: 6 }}>
                      <Text style={{ color: '#2E7D32', fontSize: 12, fontWeight: '600' }}>✓ {lang === 'uz' ? 'Balansdan ozod' : 'Освобождён от баланса'}</Text>
                    </View>
                  )}
                  {balance <= 0 && !balanceExempt && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FEE2E2', borderRadius: 10, padding: 8, marginTop: 8, width: '100%' }}>
                      <Ionicons name="warning" size={14} color="#EF4444" />
                      <Text style={{ color: '#EF4444', fontSize: 11, flex: 1 }}>{lang === 'uz' ? 'Balans manfiy — buyurtmalar bloklanadi' : 'Баланс отрицательный — заказы заблокированы'}</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 12 }}
                    onPress={() => { setTopUpVisible(true); if (balanceCards.length > 0) setSelectedCard(balanceCards[0]); }}
                  >
                    <Ionicons name="add-circle" size={18} color="#000" />
                    <Text style={{ color: '#000', fontWeight: '800', fontSize: 14 }}>{lang === 'uz' ? 'Toʻldirish' : 'Пополнить'}</Text>
                  </TouchableOpacity>
                </View>

                {/* Cards */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{lang === 'uz' ? 'Kartalarim' : 'Мои карты'}</Text>
                  <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} onPress={() => setAddCardVisible(true)}>
                    <Ionicons name="add" size={16} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 12 }}>{lang === 'uz' ? 'Qoʻshish' : 'Добавить'}</Text>
                  </TouchableOpacity>
                </View>
                {balanceCards.length === 0 ? (
                  <Text style={{ color: colors.textSecondary, fontSize: 12, textAlign: 'center', paddingVertical: 8 }}>
                    {lang === 'uz' ? 'Kartalar yoʻq' : 'Нет сохранённых карт'}
                  </Text>
                ) : (
                  balanceCards.map((card) => (
                    <View key={card.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Text style={{ fontSize: 20 }}>{cardTypeIcon(card.card_type)}</Text>
                        <View>
                          <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '600' }}>{card.card_type.toUpperCase()}</Text>
                          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700', letterSpacing: 1 }}>•••• {card.card_number.slice(-4)}</Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{card.expiry}</Text>
                        {card.is_default && (
                          <View style={{ backgroundColor: '#E8F5E9', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                            <Text style={{ color: '#2E7D32', fontSize: 9, fontWeight: '700' }}>{lang === 'uz' ? 'Asosiy' : 'Осн.'}</Text>
                          </View>
                        )}
                        <TouchableOpacity onPress={() => handleDeleteCard(card)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                          <Ionicons name="trash-outline" size={16} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}

                {/* Transactions */}
                {balanceTransactions.length > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: 6 }}>{lang === 'uz' ? 'Oxirgi operatsiyalar' : 'Последние операции'}</Text>
                    {balanceTransactions.slice(0, 10).map((tx, i) => {
                      const isPositive = tx.amount > 0;
                      const icon = tx.tx_type === 'commission' ? '📉' : tx.tx_type === 'top_up' ? '💰' : tx.tx_type === 'bonus' ? '🎁' : '⚙️';
                      const label = tx.tx_type === 'commission' ? (lang === 'uz' ? 'Komissiya' : 'Комиссия')
                        : tx.tx_type === 'top_up' ? (lang === 'uz' ? 'Toʻldirish' : 'Пополнение')
                        : tx.tx_type === 'bonus' ? (lang === 'uz' ? 'Bonus' : 'Бонус')
                        : (lang === 'uz' ? 'Tuzatish' : 'Корректировка');
                      return (
                        <View key={tx.id || i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: i < balanceTransactions.slice(0, 10).length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                            <Text style={{ fontSize: 16 }}>{icon}</Text>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{label}</Text>
                              <Text style={{ color: colors.textSecondary, fontSize: 10, marginTop: 1 }}>
                                {tx.created_at ? new Date(tx.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                              </Text>
                            </View>
                          </View>
                          <Text style={{ color: isPositive ? '#22C55E' : '#EF4444', fontSize: 13, fontWeight: '800' }}>
                            {isPositive ? '+' : ''}{Math.round(tx.amount).toLocaleString('ru-RU')} {t(lang, 'sum')}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </View>
        )}

        <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: 16 }} />

        {/* ── My Progress (collapsible) ── */}
        <TouchableOpacity style={s.row} onPress={() => setProgressExpanded(v => !v)}>
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#4CAF5020' }]}>
              <Ionicons name="trending-up" size={18} color="#4CAF50" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.rowLabel, { color: colors.text }]}>{lang === 'uz' ? 'Mening taraqqiyotim' : 'Мой прогресс'}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                {bonusStats.lifetime_trips} {lang === 'uz' ? 'buyurtma bajarildi' : 'заказов выполнено'}
              </Text>
            </View>
          </View>
          <Ionicons name={progressExpanded ? 'chevron-up' : 'chevron-forward'} size={16} color={colors.textSecondary} />
        </TouchableOpacity>

        {progressExpanded && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
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
                        {bonusStats.streak_days} {lang === 'uz' ? "kun ketma-ket" : 'дн. подряд'}
                      </Text>
                    </View>
                  )}
                </>
              );
            })()}

            {/* ── Trip history inside progress ── */}
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, backgroundColor: colors.background, borderRadius: 10, padding: 12 }}
              onPress={() => { loadHistory(); setHistoryModalVisible(true); }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="time-outline" size={18} color="#FFCC00" />
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{t(lang,'tripHistory') || 'История поездок'}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {loadingHistory
                  ? <ActivityIndicator size="small" color={colors.textSecondary} />
                  : <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{orders.length}</Text>}
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: 16 }} />

        {/* ── Ratings ── */}
        <View style={s.row}>
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#FFC10720' }]}>
              <Ionicons name="star" size={18} color="#FFC107" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.rowLabel, { color: colors.text }]}>{lang === 'uz' ? 'Mening baholarim' : 'Мои оценки'}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
                {ratingsData.average_rating.toFixed(1)} / 5.0 ({ratingsData.rating_count} {lang === 'uz' ? 'baho' : 'оценок'})
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            {[1,2,3,4,5].map((star) => (
              <Ionicons key={star} name={star <= Math.round(ratingsData.average_rating) ? 'star' : 'star-outline'} size={16} color={star <= Math.round(ratingsData.average_rating) ? '#FFC107' : colors.border} />
            ))}
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800', marginLeft: 4 }}>
              {ratingsData.average_rating.toFixed(1)}
            </Text>
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: 16 }} />

        {/* ── Referral apply (collapsible) ── */}
        <TouchableOpacity style={s.row} onPress={() => setReferralExpanded((v) => !v)}>
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#FF9F0A20' }]}>
              <Ionicons name="gift-outline" size={18} color="#FF9F0A" />
            </View>
            <Text style={[s.rowLabel, { color: colors.text }]}>{lang === 'uz' ? 'Referalka' : 'Рефералка'}</Text>
          </View>
          <Ionicons name={referralExpanded ? 'chevron-up' : 'chevron-forward'} size={16} color={colors.textSecondary} />
        </TouchableOpacity>

        {referralExpanded && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            {/* ── My referral code ── */}
            {driver?.referral_code ? (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 6, textAlign: 'center' }}>🎁 {lang === 'uz' ? 'Mening referal kodam' : 'Мой реферальный код'}</Text>
                <View style={{ backgroundColor: colors.primary, borderRadius: 14, padding: 14, alignItems: 'center' }}>
                  <Text style={{ color: '#000', fontSize: 26, fontWeight: '900', letterSpacing: 6 }}>{driver.referral_code}</Text>
                  <View style={{ flexDirection: 'row', marginTop: 10, gap: 12 }}>
                    <TouchableOpacity
                      onPress={() => { Clipboard.setString(driver.referral_code); Alert.alert('✅', lang === 'uz' ? 'Nusxalandi' : 'Скопировано'); }}
                      style={{ backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                      <Ionicons name="copy-outline" size={16} color="#000" />
                      <Text style={{ color: '#000', fontWeight: '700', fontSize: 13 }}>{lang === 'uz' ? 'Nusxalash' : 'Копировать'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={async () => { try { await Share.share({ message: `${lang === 'uz' ? "Mening referal kodam" : 'Мой реферальный код'}: ${driver.referral_code}` }); } catch {} }}
                      style={{ backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                      <Ionicons name="share-social-outline" size={16} color="#000" />
                      <Text style={{ color: '#000', fontWeight: '700', fontSize: 13 }}>{lang === 'uz' ? 'Ulashish' : 'Поделиться'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ) : null}

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
              <>
                {referralStep === 'input' && (
                  <View>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 6 }}>{lang === 'uz' ? "Do'stingizning referal kodini kiriting" : 'Введите реферальный код друга'}</Text>
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
                        <Text style={{ color: '#000', fontWeight: '700' }}>{lang === 'uz' ? 'Keyingi' : 'Далее'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {referralStep === 'choose' && (
                  <View>
                    <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 10 }}>{lang === 'uz' ? 'Bonus turini tanlang' : 'Выберите тип бонуса'}</Text>
                    <TouchableOpacity style={[s.benefitCard, { borderColor: colors.primary }]} disabled={applyingReferral}
                      onPress={async () => {
                        setApplyingReferral(true);
                        try {
                          await driverAPI.applyReferral(referralInput, 'commission');
                          const profile = await authAPI.getProfile();
                          setUser(profile.data.user);
                          Alert.alert('✅', lang === 'uz' ? 'Komissiya kamaytirildi!' : 'Сниженная комиссия активирована!');
                          setReferralStep('input');
                        } catch (e) {
                          Alert.alert(t(lang, 'error'), e?.response?.data?.error || 'Ошибка');
                        } finally { setApplyingReferral(false); }
                      }}
                    >
                      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15 }}>💸 {lang === 'uz' ? 'Komissiya kamaytirish' : 'Сниженная комиссия'}</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>{lang === 'uz' ? '8% o\'rniga 6% komissiya' : 'Ваш % с поездок уменьшится (вместо стандартных 8% — всего 6%)'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.benefitCard, { borderColor: '#43A047', marginTop: 10 }]} disabled={applyingReferral}
                      onPress={async () => {
                        setApplyingReferral(true);
                        try {
                          await driverAPI.applyReferral(referralInput, 'bonus');
                          Alert.alert('✅', lang === 'uz' ? 'Haftalik bonus faollashtirildi!' : 'Еженедельный бонус активирован!');
                          setReferralStep('input');
                        } catch (e) {
                          Alert.alert(t(lang, 'error'), e?.response?.data?.error || 'Ошибка');
                        } finally { setApplyingReferral(false); }
                      }}
                    >
                      <Text style={{ color: '#43A047', fontWeight: '800', fontSize: 15 }}>🎁 {lang === 'uz' ? 'Haftalik bonus' : 'Еженедельный бонус'}</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>{lang === 'uz' ? 'Har hafta balansingizga bonus tushadi' : 'Получайте фиксированный бонус каждую неделю на баланс'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.benefitCard, { borderColor: '#10B981', marginTop: 10 }]} disabled={applyingReferral}
                      onPress={async () => {
                        setApplyingReferral(true);
                        try {
                          await driverAPI.applyReferral(referralInput, 'cashback');
                          const profile = await authAPI.getProfile();
                          setUser(profile.data.user);
                          Alert.alert('✅', lang === 'uz' ? 'Keshbek faollashtirildi!' : 'Кэшбэк активирован!');
                          setReferralStep('input');
                        } catch (e) {
                          Alert.alert(t(lang, 'error'), e?.response?.data?.error || 'Ошибка');
                        } finally { setApplyingReferral(false); }
                      }}
                    >
                      <Text style={{ color: '#10B981', fontWeight: '800', fontSize: 15 }}>💰 {t(lang, 'cashback')}</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>{t(lang, 'cashbackDesc')}</Text>
                    </TouchableOpacity>
                    {applyingReferral && <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />}
                    <TouchableOpacity onPress={() => setReferralStep('input')} style={{ marginTop: 10, alignItems: 'center' }}>
                      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>← {lang === 'uz' ? "Kodni o'zgartirish" : 'Изменить код'}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: 16 }} />

        {/* ── Bonuses (collapsible) ── */}
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
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            {/* ── Active bonuses list ── */}
            {bonusSettings && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14, marginBottom: 8 }}>{t(lang, 'activeBonuses')}</Text>

                {bonusSettings.night_bonus_enabled && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                    <Text style={{ fontSize: 16 }}>🌙</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{t(lang, 'nightBonus')}</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 11 }}>22:00–06:00 · +{bonusSettings.night_bonus_pct}%</Text>
                    </View>
                    <View style={{ backgroundColor: '#4CAF5020', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: '#4CAF50', fontSize: 11, fontWeight: '700' }}>ON</Text>
                    </View>
                  </View>
                )}

                {bonusSettings.streak_bonus_enabled && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                    <Text style={{ fontSize: 16 }}>🔥</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{t(lang, 'streak')}</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
                        {bonusSettings.streak_days_required} {t(lang, 'streakDays')} → +{Number(bonusSettings.streak_bonus_amount).toLocaleString('ru-RU')} {t(lang, 'sum')}
                      </Text>
                    </View>
                    <View style={{ backgroundColor: '#4CAF5020', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: '#4CAF50', fontSize: 11, fontWeight: '700' }}>ON</Text>
                    </View>
                  </View>
                )}

                {bonusSettings.milestones_enabled && (
                  <View style={{ paddingVertical: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <Text style={{ fontSize: 16 }}>🏆</Text>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 }}>{t(lang, 'milestone')}</Text>
                      <View style={{ backgroundColor: '#4CAF5020', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text style={{ color: '#4CAF50', fontSize: 11, fontWeight: '700' }}>ON</Text>
                      </View>
                    </View>
                    {[50, 100, 500, 1000].map((target) => {
                      const trips = bonusStats.lifetime_trips || 0;
                      const done = trips >= target;
                      const pct = done ? 100 : Math.min((trips / target) * 100, 100);
                      return (
                        <View key={target} style={{ marginBottom: 8 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                            <Text style={{ color: done ? '#4CAF50' : colors.text, fontSize: 12, fontWeight: '600' }}>
                              {done ? '✅' : '🎯'} {target} {t(lang, 'lifetimeTrips')}
                            </Text>
                            <Text style={{ color: done ? '#4CAF50' : colors.textSecondary, fontSize: 11, fontWeight: '700' }}>
                              {done ? (lang === 'uz' ? 'Bajarildi' : 'Выполнено') : `${trips} / ${target}`}
                            </Text>
                          </View>
                          <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' }}>
                            <View style={{ height: '100%', width: `${pct}%`, backgroundColor: done ? '#4CAF50' : '#F59E0B', borderRadius: 3 }} />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                {referralBenefitInfo.type !== '' && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                    <Text style={{ fontSize: 16 }}>🎁</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{t(lang, 'referralBonus')}</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
                        {referralBenefitInfo.type === 'commission'
                          ? (lang === 'uz' ? 'Komissiya kamaytirish' : 'Сниженная комиссия')
                          : referralBenefitInfo.type === 'cashback'
                          ? t(lang, 'cashback')
                          : (lang === 'uz' ? 'Haftalik bonus' : 'Еженедельный бонус')}
                        {referralBenefitInfo.referred_by ? ` · ${lang === 'uz' ? 'Kod' : 'Код'}: ${referralBenefitInfo.referred_by}` : ''}
                      </Text>
                    </View>
                    <View style={{ backgroundColor: '#FF9F0A20', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: '#FF9F0A', fontSize: 11, fontWeight: '700' }}>✓</Text>
                    </View>
                  </View>
                )}

                {!bonusSettings.night_bonus_enabled && !bonusSettings.streak_bonus_enabled && !bonusSettings.milestones_enabled && !bonusSettings.weekly_bonus_enabled && referralBenefitInfo.type === '' && (
                  <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 6 }}>
                    {lang === 'uz' ? "Hozircha faol bonuslar yo'q" : 'Пока нет активных бонусов'}
                  </Text>
                )}
              </View>
            )}

            {/* ── Weekly bonus challenge ── */}
            {bonusSettings?.weekly_bonus_enabled && weeklyProgress && (
              <View style={{ backgroundColor: colors.background, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1.5, borderColor: '#F59E0B30' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Text style={{ fontSize: 18 }}>🎯</Text>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{t(lang, 'weeklyBonus')}</Text>
                </View>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 10 }}>{t(lang, 'weeklyBonusDesc')}</Text>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>
                    {t(lang, 'weekLabel')} {weeklyProgress.week_number}
                  </Text>
                  <Text style={{ color: weeklyProgress.bonus_paid ? '#4CAF50' : colors.primary, fontWeight: '700', fontSize: 13 }}>
                    {weeklyProgress.bonus_paid ? t(lang, 'completed') : `${weeklyProgress.trips_completed} / ${weeklyProgress.required_trips}`}
                  </Text>
                </View>

                <View style={{ height: 10, backgroundColor: colors.border, borderRadius: 5, overflow: 'hidden', marginBottom: 6 }}>
                  <View style={{
                    height: '100%',
                    width: `${Math.min((weeklyProgress.trips_completed / weeklyProgress.required_trips) * 100, 100)}%`,
                    backgroundColor: weeklyProgress.bonus_paid ? '#4CAF50' : '#F59E0B',
                    borderRadius: 5,
                  }} />
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>0</Text>
                  <Text style={{ color: '#F59E0B', fontSize: 12, fontWeight: '700' }}>
                    +{Number(weeklyProgress.bonus_amount).toLocaleString('ru-RU')} {t(lang, 'sum')}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{weeklyProgress.required_trips}</Text>
                </View>

                {/* Mini tier preview */}
                {weeklyTiers.length > 0 && (
                  <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {weeklyTiers.map((tier) => (
                        <View key={tier.week_number} style={{
                          alignItems: 'center', marginRight: 12, opacity: tier.week_number < weeklyProgress.week_number ? 0.5 : 1,
                        }}>
                          <View style={{
                            width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center',
                            backgroundColor: tier.week_number === weeklyProgress.week_number ? '#F59E0B' : tier.week_number < weeklyProgress.week_number ? '#4CAF50' : colors.border,
                          }}>
                            <Text style={{ color: tier.week_number <= weeklyProgress.week_number ? '#fff' : colors.textSecondary, fontSize: 11, fontWeight: '700' }}>{tier.week_number}</Text>
                          </View>
                          <Text style={{ color: colors.textSecondary, fontSize: 9, marginTop: 2 }}>{tier.required_trips}</Text>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>
            )}

            {/* ── Bonus events history ── */}
            {loadingBonuses ? (
              <ActivityIndicator color={colors.primary} />
            ) : bonusEvents.length === 0 ? (
              <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 8 }}>{t(lang, 'noBonuses')}</Text>
            ) : (
              bonusEvents.slice(0, 10).map((ev, i) => (
                <View key={ev.id || i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: i < Math.min(bonusEvents.length, 10) - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                      {ev.bonus_type === 'cashback' ? '💰' : ev.bonus_type === 'night_bonus' ? '🌙' : ev.bonus_type === 'streak' ? '🔥' : ev.bonus_type === 'weekly_bonus' ? '🎯' : '🏆'}{' '}
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

        <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: 16 }} />

        {/* ── Friends (collapsible) ── */}
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
                            <TouchableOpacity onPress={() => handleAcceptFriendRequest(req.request_id)}
                              style={{ backgroundColor: '#22C55E', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>✓</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleDeclineFriendRequest(req.request_id)}
                              style={{ backgroundColor: '#EF4444', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                    </>
                  )}

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
      {/* ══════ END UNIFIED BLOCK ══════ */}

      {/* ── Logout button (bottom) ── */}
      <TouchableOpacity style={[s.logoutBtn, { borderColor: colors.error, marginTop: 20 }]} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={18} color={colors.error} />
        <Text style={{ color: colors.error, fontWeight: '700', fontSize: 15 }}>{t(lang,'logout')}</Text>
      </TouchableOpacity>

      {/* History modal */}
      <Modal visible={historyModalVisible} animationType="slide" onRequestClose={() => setHistoryModalVisible(false)}>

      {/* ── Top-Up Modal ── */}
      <Modal visible={topUpVisible} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, backgroundColor: colors.card }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{lang === 'uz' ? 'Balansni toʻldirish' : 'Пополнить баланс'}</Text>
              <TouchableOpacity onPress={() => setTopUpVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>{lang === 'uz' ? 'Karta tanlang' : 'Выберите карту'}</Text>
            {balanceCards.length === 0 ? (
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.background, borderRadius: 12, padding: 14, marginBottom: 12 }} onPress={() => { setTopUpVisible(false); setAddCardVisible(true); }}>
                <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                <Text style={{ color: colors.primary, fontWeight: '600' }}>{lang === 'uz' ? 'Avval karta qoʻshing' : 'Сначала добавьте карту'}</Text>
              </TouchableOpacity>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                {balanceCards.map((card) => (
                  <TouchableOpacity key={card.id} onPress={() => setSelectedCard(card)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: selectedCard?.id === card.id ? colors.primary : colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginRight: 8, backgroundColor: selectedCard?.id === card.id ? colors.primary + '15' : 'transparent' }}>
                    <Text style={{ fontSize: 16 }}>{cardTypeIcon(card.card_type)}</Text>
                    <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>•••• {card.card_number.slice(-4)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 8 }}>{lang === 'uz' ? 'Summa' : 'Сумма'}</Text>
            <TextInput
              style={{ borderWidth: 1.5, borderRadius: 12, padding: 14, fontSize: 22, fontWeight: '800', textAlign: 'center', color: colors.text, borderColor: colors.border, backgroundColor: colors.background }}
              value={topUpAmount}
              onChangeText={(v) => setTopUpAmount(v.replace(/\D/g, ''))}
              keyboardType="numeric" placeholder="0" placeholderTextColor={colors.textSecondary}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {[10000, 50000, 100000, 200000, 500000].map((amt) => (
                <TouchableOpacity key={amt} style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }} onPress={() => setTopUpAmount(String(amt))}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{(amt / 1000)}K</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={{ backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 20, opacity: (!topUpAmount || !selectedCard) ? 0.4 : 1 }}
              disabled={!topUpAmount || !selectedCard || topUpLoading}
              onPress={handleTopUp}
            >
              {topUpLoading ? <ActivityIndicator color="#000" /> : <Text style={{ color: '#000', fontWeight: '800', fontSize: 16 }}>{lang === 'uz' ? 'Toʻldirish' : 'Пополнить'}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Add Card Modal ── */}
      <Modal visible={addCardVisible} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, backgroundColor: colors.card }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{lang === 'uz' ? 'Yangi karta' : 'Новая карта'}</Text>
              <TouchableOpacity onPress={() => setAddCardVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>{lang === 'uz' ? 'Karta raqami' : 'Номер карты'}</Text>
            <TextInput
              style={{ borderWidth: 1.5, borderRadius: 12, padding: 14, fontSize: 16, fontWeight: '600', color: colors.text, borderColor: colors.border, backgroundColor: colors.background }}
              value={cardNumber} onChangeText={(v) => setCardNumber(formatCardInput(v))}
              keyboardType="numeric" placeholder="0000 0000 0000 0000" placeholderTextColor={colors.textSecondary} maxLength={19}
            />
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 12 }}>{lang === 'uz' ? 'Karta egasi' : 'Имя владельца'}</Text>
            <TextInput
              style={{ borderWidth: 1.5, borderRadius: 12, padding: 14, fontSize: 16, fontWeight: '600', color: colors.text, borderColor: colors.border, backgroundColor: colors.background }}
              value={cardHolder} onChangeText={setCardHolder}
              placeholder="IVAN IVANOV" placeholderTextColor={colors.textSecondary} autoCapitalize="characters"
            />
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 12 }}>{lang === 'uz' ? 'Amal qilish muddati' : 'Срок действия'}</Text>
            <TextInput
              style={{ borderWidth: 1.5, borderRadius: 12, padding: 14, fontSize: 16, fontWeight: '600', color: colors.text, borderColor: colors.border, backgroundColor: colors.background }}
              value={cardExpiry} onChangeText={(v) => setCardExpiry(formatExpiryInput(v))}
              keyboardType="numeric" placeholder="MM/YY" placeholderTextColor={colors.textSecondary} maxLength={5}
            />
            <View style={{ backgroundColor: '#FFF8E1', borderRadius: 10, padding: 12, marginTop: 8, marginBottom: 16 }}>
              <Text style={{ color: '#F57F17', fontSize: 12 }}>⚠️ {lang === 'uz' ? 'Demo rejim — real toʻlov amalga oshirilmaydi' : 'Демо-режим — реальных списаний не будет'}</Text>
            </View>
            <TouchableOpacity
              style={{ backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', opacity: (!cardNumber || !cardExpiry) ? 0.4 : 1 }}
              disabled={!cardNumber || !cardExpiry || addCardLoading}
              onPress={handleAddCard}
            >
              {addCardLoading ? <ActivityIndicator color="#000" /> : <Text style={{ color: '#000', fontWeight: '800', fontSize: 16 }}>{lang === 'uz' ? 'Qoʻshish' : 'Добавить'}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
