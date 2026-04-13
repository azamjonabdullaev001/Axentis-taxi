import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, ActivityIndicator, Modal, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { driverAPI } from '../services/api';
import { connectSocket } from '../services/socket';
import { t } from '../i18n';

export default function BalanceScreen() {
  const { colors, lang } = useTheme();
  const { driver } = useAuth();

  const [balance, setBalance] = useState(0);
  const [exempt, setExempt] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Top-up modal
  const [topUpVisible, setTopUpVisible] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [selectedCard, setSelectedCard] = useState(null);
  const [topUpLoading, setTopUpLoading] = useState(false);

  // Add card modal
  const [addCardVisible, setAddCardVisible] = useState(false);
  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [addCardLoading, setAddCardLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [balRes, cardRes] = await Promise.all([
        driverAPI.getBalance(),
        driverAPI.getCards(),
      ]);
      setBalance(balRes.data.balance || 0);
      setExempt(balRes.data.balance_exempt || false);
      setTransactions(balRes.data.transactions || []);
      setCards(cardRes.data.cards || []);
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const socket = connectSocket();
    const handler = (data) => {
      if (data.balance !== undefined) setBalance(data.balance);
    };
    socket.on('balance_updated', handler);
    return () => socket.off('balance_updated', handler);
  }, [loadData]);

  const handleTopUp = async () => {
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
    try {
      const { data } = await driverAPI.selfTopUp(amt, selectedCard.id);
      setBalance(data.new_balance);
      setTopUpVisible(false);
      setTopUpAmount('');
      Alert.alert('✅', lang === 'uz' ? 'Balans toʻldirildi!' : 'Баланс пополнен!');
      loadData();
    } catch (e) {
      Alert.alert(t(lang, 'error'), e?.response?.data?.error || 'Ошибка');
    } finally { setTopUpLoading(false); }
  };

  const handleAddCard = async () => {
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
    try {
      await driverAPI.addCard(num, cardHolder, cardExpiry);
      setAddCardVisible(false);
      setCardNumber('');
      setCardHolder('');
      setCardExpiry('');
      Alert.alert('✅', lang === 'uz' ? 'Karta qoʻshildi!' : 'Карта добавлена!');
      loadData();
    } catch (e) {
      Alert.alert(t(lang, 'error'), e?.response?.data?.error || 'Ошибка');
    } finally { setAddCardLoading(false); }
  };

  const handleDeleteCard = (card) => {
    Alert.alert(
      lang === 'uz' ? 'Kartani oʻchirish' : 'Удалить карту',
      `${card.card_type.toUpperCase()} •••• ${card.card_number.slice(-4)}`,
      [
        { text: lang === 'uz' ? 'Bekor qilish' : 'Отмена', style: 'cancel' },
        {
          text: lang === 'uz' ? 'Oʻchirish' : 'Удалить', style: 'destructive',
          onPress: async () => {
            try {
              await driverAPI.deleteCard(card.id);
              loadData();
            } catch (e) {
              Alert.alert(t(lang, 'error'), e?.response?.data?.error || 'Ошибка');
            }
          },
        },
      ]
    );
  };

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
      case 'uzcard': return '🏦';
      case 'humo': return '🔵';
      case 'visa': return '💳';
      case 'mastercard': return '🟠';
      default: return '💳';
    }
  };

  const s = makeStyles(colors);

  if (loading) {
    return (
      <SafeAreaView style={[s.container, { justifyContent: 'center', alignItems: 'center' }]} edges={['top']}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={colors.primary} />}
      >
        {/* Balance card */}
        <View style={s.balanceCard}>
          <Text style={s.balanceTitle}>{lang === 'uz' ? 'Joriy balans' : 'Текущий баланс'}</Text>
          <Text style={[s.balanceAmount, balance <= 0 && !exempt && { color: '#EF4444' }]}>
            {Math.round(balance).toLocaleString('ru-RU')} <Text style={s.balanceCurrency}>{t(lang, 'sum')}</Text>
          </Text>
          {exempt && (
            <View style={s.exemptBadge}>
              <Text style={s.exemptText}>✓ {lang === 'uz' ? 'Balansdan ozod' : 'Освобождён от баланса'}</Text>
            </View>
          )}
          {balance <= 0 && !exempt && (
            <View style={s.warningBanner}>
              <Ionicons name="warning" size={16} color="#EF4444" />
              <Text style={s.warningText}>
                {lang === 'uz' ? 'Balans manfiy — yangi buyurtmalar bloklanadi' : 'Баланс отрицательный — новые заказы заблокированы'}
              </Text>
            </View>
          )}
          <TouchableOpacity style={s.topUpBtn} onPress={() => { setTopUpVisible(true); if (cards.length > 0) setSelectedCard(cards[0]); }}>
            <Ionicons name="add-circle" size={20} color="#000" />
            <Text style={s.topUpBtnText}>{lang === 'uz' ? 'Balansni toʻldirish' : 'Пополнить баланс'}</Text>
          </TouchableOpacity>
        </View>

        {/* Cards section */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>{lang === 'uz' ? 'Mening kartalarim' : 'Мои карты'}</Text>
            <TouchableOpacity style={s.addCardBtn} onPress={() => setAddCardVisible(true)}>
              <Ionicons name="add" size={18} color={colors.primary} />
              <Text style={s.addCardText}>{lang === 'uz' ? 'Qoʻshish' : 'Добавить'}</Text>
            </TouchableOpacity>
          </View>
          {cards.length === 0 ? (
            <View style={s.emptyCard}>
              <Ionicons name="card-outline" size={40} color={colors.border} />
              <Text style={s.emptyText}>{lang === 'uz' ? 'Kartalar yoʻq' : 'Нет сохранённых карт'}</Text>
              <TouchableOpacity style={s.addFirstCardBtn} onPress={() => setAddCardVisible(true)}>
                <Text style={s.addFirstCardText}>{lang === 'uz' ? 'Birinchi kartani qoʻshing' : 'Добавить первую карту'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            cards.map((card) => (
              <View key={card.id} style={s.cardItem}>
                <View style={s.cardLeft}>
                  <Text style={{ fontSize: 24 }}>{cardTypeIcon(card.card_type)}</Text>
                  <View>
                    <Text style={s.cardType}>{card.card_type.toUpperCase()}</Text>
                    <Text style={s.cardNum}>•••• {card.card_number.slice(-4)}</Text>
                  </View>
                </View>
                <View style={s.cardRight}>
                  <Text style={s.cardExpiry}>{card.expiry}</Text>
                  {card.is_default && (
                    <View style={s.defaultBadge}>
                      <Text style={s.defaultText}>{lang === 'uz' ? 'Asosiy' : 'Основная'}</Text>
                    </View>
                  )}
                  <TouchableOpacity onPress={() => handleDeleteCard(card)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Transactions */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{lang === 'uz' ? 'Oxirgi operatsiyalar' : 'Последние операции'}</Text>
          {transactions.length === 0 ? (
            <Text style={s.emptyText}>{lang === 'uz' ? 'Operatsiyalar yoʻq' : 'Нет операций'}</Text>
          ) : (
            transactions.slice(0, 20).map((tx, i) => {
              const isPositive = tx.amount > 0;
              const icon = tx.tx_type === 'commission' ? '📉' : tx.tx_type === 'top_up' ? '💰' : tx.tx_type === 'bonus' ? '🎁' : '⚙️';
              const label = tx.tx_type === 'commission' ? (lang === 'uz' ? 'Komissiya' : 'Комиссия')
                : tx.tx_type === 'top_up' ? (lang === 'uz' ? 'Toʻldirish' : 'Пополнение')
                : tx.tx_type === 'bonus' ? (lang === 'uz' ? 'Bonus' : 'Бонус')
                : (lang === 'uz' ? 'Tuzatish' : 'Корректировка');
              return (
                <View key={tx.id || i} style={[s.txRow, i < transactions.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                    <Text style={{ fontSize: 18 }}>{icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.txLabel}>{label}</Text>
                      <Text style={s.txDate}>
                        {tx.created_at ? new Date(tx.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                      </Text>
                    </View>
                  </View>
                  <Text style={[s.txAmount, { color: isPositive ? '#22C55E' : '#EF4444' }]}>
                    {isPositive ? '+' : ''}{Math.round(tx.amount).toLocaleString('ru-RU')} {t(lang, 'sum')}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* ── Top-Up Modal ── */}
      <Modal visible={topUpVisible} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={[s.modal, { backgroundColor: colors.card }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{lang === 'uz' ? 'Balansni toʻldirish' : 'Пополнить баланс'}</Text>
              <TouchableOpacity onPress={() => setTopUpVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Card selector */}
            <Text style={[s.inputLabel, { color: colors.textSecondary }]}>{lang === 'uz' ? 'Karta tanlang' : 'Выберите карту'}</Text>
            {cards.length === 0 ? (
              <TouchableOpacity style={s.noCardBanner} onPress={() => { setTopUpVisible(false); setAddCardVisible(true); }}>
                <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                <Text style={{ color: colors.primary, fontWeight: '600' }}>{lang === 'uz' ? 'Avval karta qoʻshing' : 'Сначала добавьте карту'}</Text>
              </TouchableOpacity>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                {cards.map((card) => (
                  <TouchableOpacity
                    key={card.id}
                    onPress={() => setSelectedCard(card)}
                    style={[s.cardChip, selectedCard?.id === card.id && { borderColor: colors.primary, backgroundColor: colors.primary + '15' }]}
                  >
                    <Text style={{ fontSize: 16 }}>{cardTypeIcon(card.card_type)}</Text>
                    <Text style={[s.cardChipText, { color: colors.text }]}>•••• {card.card_number.slice(-4)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Amount */}
            <Text style={[s.inputLabel, { color: colors.textSecondary }]}>{lang === 'uz' ? 'Summa' : 'Сумма'}</Text>
            <TextInput
              style={[s.amountInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              value={topUpAmount}
              onChangeText={(v) => setTopUpAmount(v.replace(/\D/g, ''))}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.textSecondary}
            />

            {/* Quick amounts */}
            <View style={s.quickAmounts}>
              {[10000, 50000, 100000, 200000, 500000].map((amt) => (
                <TouchableOpacity key={amt} style={[s.quickBtn, { borderColor: colors.border }]} onPress={() => setTopUpAmount(String(amt))}>
                  <Text style={[s.quickBtnText, { color: colors.text }]}>{(amt / 1000)}K</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[s.confirmBtn, (!topUpAmount || !selectedCard) && { opacity: 0.4 }]}
              disabled={!topUpAmount || !selectedCard || topUpLoading}
              onPress={handleTopUp}
            >
              {topUpLoading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={s.confirmBtnText}>{lang === 'uz' ? 'Toʻldirish' : 'Пополнить'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Add Card Modal ── */}
      <Modal visible={addCardVisible} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={[s.modal, { backgroundColor: colors.card }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{lang === 'uz' ? 'Yangi karta' : 'Новая карта'}</Text>
              <TouchableOpacity onPress={() => setAddCardVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={[s.inputLabel, { color: colors.textSecondary }]}>{lang === 'uz' ? 'Karta raqami' : 'Номер карты'}</Text>
            <TextInput
              style={[s.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              value={cardNumber}
              onChangeText={(v) => setCardNumber(formatCardInput(v))}
              keyboardType="numeric"
              placeholder="0000 0000 0000 0000"
              placeholderTextColor={colors.textSecondary}
              maxLength={19}
            />

            <Text style={[s.inputLabel, { color: colors.textSecondary }]}>{lang === 'uz' ? 'Karta egasi' : 'Имя владельца'}</Text>
            <TextInput
              style={[s.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              value={cardHolder}
              onChangeText={setCardHolder}
              placeholder="IVAN IVANOV"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="characters"
            />

            <Text style={[s.inputLabel, { color: colors.textSecondary }]}>{lang === 'uz' ? 'Amal qilish muddati' : 'Срок действия'}</Text>
            <TextInput
              style={[s.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              value={cardExpiry}
              onChangeText={(v) => setCardExpiry(formatExpiryInput(v))}
              keyboardType="numeric"
              placeholder="MM/YY"
              placeholderTextColor={colors.textSecondary}
              maxLength={5}
            />

            <View style={{ backgroundColor: '#FFF8E1', borderRadius: 10, padding: 12, marginTop: 8, marginBottom: 16 }}>
              <Text style={{ color: '#F57F17', fontSize: 12 }}>
                ⚠️ {lang === 'uz' ? 'Demo rejim — real toʻlov amalga oshirilmaydi' : 'Демо-режим — реальных списаний не будет'}
              </Text>
            </View>

            <TouchableOpacity
              style={[s.confirmBtn, (!cardNumber || !cardExpiry) && { opacity: 0.4 }]}
              disabled={!cardNumber || !cardExpiry || addCardLoading}
              onPress={handleAddCard}
            >
              {addCardLoading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={s.confirmBtnText}>{lang === 'uz' ? 'Qoʻshish' : 'Добавить'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    balanceCard: {
      margin: 16, backgroundColor: colors.card, borderRadius: 20,
      padding: 24, alignItems: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8,
      elevation: 4,
    },
    balanceTitle: { color: colors.textSecondary, fontSize: 13, marginBottom: 8 },
    balanceAmount: { color: colors.text, fontSize: 36, fontWeight: '900' },
    balanceCurrency: { fontSize: 18, fontWeight: '400', color: colors.textSecondary },
    exemptBadge: {
      backgroundColor: '#E8F5E9', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4, marginTop: 8,
    },
    exemptText: { color: '#2E7D32', fontSize: 12, fontWeight: '600' },
    warningBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: '#FEE2E2', borderRadius: 10, padding: 10, marginTop: 10, width: '100%',
    },
    warningText: { color: '#EF4444', fontSize: 12, flex: 1 },
    topUpBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.primary, borderRadius: 14,
      paddingHorizontal: 24, paddingVertical: 14, marginTop: 16,
    },
    topUpBtnText: { color: '#000', fontWeight: '800', fontSize: 15 },
    section: {
      marginHorizontal: 16, marginTop: 16, backgroundColor: colors.card,
      borderRadius: 16, padding: 16,
    },
    sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    addCardBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    addCardText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
    emptyCard: { alignItems: 'center', paddingVertical: 20 },
    emptyText: { color: colors.textSecondary, fontSize: 13, marginTop: 8 },
    addFirstCardBtn: {
      marginTop: 12, backgroundColor: colors.primary, borderRadius: 10,
      paddingHorizontal: 20, paddingVertical: 10,
    },
    addFirstCardText: { color: '#000', fontWeight: '700', fontSize: 13 },
    cardItem: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    cardType: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
    cardNum: { color: colors.text, fontSize: 15, fontWeight: '700', letterSpacing: 1 },
    cardRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cardExpiry: { color: colors.textSecondary, fontSize: 12 },
    defaultBadge: { backgroundColor: '#E8F5E9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
    defaultText: { color: '#2E7D32', fontSize: 10, fontWeight: '700' },
    txRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
    txLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
    txDate: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
    txAmount: { fontSize: 14, fontWeight: '800' },
    modalOverlay: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end',
    },
    modal: {
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 24, paddingBottom: 40,
    },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
    inputLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 12 },
    amountInput: {
      borderWidth: 1.5, borderRadius: 12, padding: 14,
      fontSize: 22, fontWeight: '800', textAlign: 'center',
    },
    quickAmounts: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
    quickBtn: {
      borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
    },
    quickBtnText: { fontSize: 13, fontWeight: '700' },
    confirmBtn: {
      backgroundColor: colors.primary, borderRadius: 14,
      paddingVertical: 16, alignItems: 'center', marginTop: 20,
    },
    confirmBtnText: { color: '#000', fontWeight: '800', fontSize: 16 },
    cardChip: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      borderWidth: 1.5, borderColor: colors.border, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 10, marginRight: 8,
    },
    cardChipText: { fontSize: 14, fontWeight: '600' },
    noCardBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.background, borderRadius: 12, padding: 14, marginBottom: 12,
    },
    formInput: {
      borderWidth: 1.5, borderRadius: 12, padding: 14, fontSize: 16, fontWeight: '600',
    },
  });
}
