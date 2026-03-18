import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { orderAPI } from '../services/api';
import { t } from '../i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STATUS_COLORS = {
  completed:  '#4CAF50',
  cancelled:  '#E53935',
  searching:  '#FF9800',
  accepted:   '#2196F3',
  arrived:    '#9C27B0',
  in_progress: '#FF9800',
};

const STATUS_LABELS = {
  ru: {
    completed:   'Завершена',
    cancelled:   'Отменена',
    searching:   'Поиск',
    accepted:    'Принята',
    arrived:     'Водитель прибыл',
    in_progress: 'В пути',
  },
  uz: {
    completed:   'Yakunlandi',
    cancelled:   'Bekor qilindi',
    searching:   'Qidirmoqda',
    accepted:    'Qabul qilindi',
    arrived:     'Haydovchi keldi',
    in_progress: "Yo'lda",
  },
};

function formatDate(dateStr, lang) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (lang === 'uz') {
    return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2,'0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function HistoryScreen() {
  const { colors } = useTheme();
  const [lang, setLang] = useState('ru');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    AsyncStorage.getItem('language').then((l) => { if (l) setLang(l); });
    fetchHistory();
  }, []);

  async function fetchHistory() {
    setError(null);
    try {
      const { data } = await orderAPI.getHistory();
      setOrders(data.orders || []);
    } catch (e) {
      setError(t(lang, 'error'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchHistory();
  }, [lang]);

  const s = makeStyles(colors);

  function renderItem({ item }) {
    const statusColor = STATUS_COLORS[item.status] || '#999';
    const statusLabel = STATUS_LABELS[lang]?.[item.status] || item.status;
    return (
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={s.cardHeader}>
          <View style={[s.statusBadge, { backgroundColor: statusColor + '22' }]}>
            <Text style={[s.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          <Text style={[s.dateText, { color: colors.textSecondary }]}>
            {formatDate(item.created_at, lang)}
          </Text>
        </View>

        <View style={s.routeRow}>
          <View style={s.routeLeft}>
            <View style={[s.dot, { backgroundColor: '#43A047' }]} />
            <View style={s.routeLine} />
            <View style={[s.dot, { backgroundColor: '#E53935' }]} />
          </View>
          <View style={s.routeRight}>
            <Text style={[s.addressText, { color: colors.text }]} numberOfLines={1}>
              {item.pickup_address || t(lang, 'from')}
            </Text>
            <View style={{ height: 14 }} />
            <Text style={[s.addressText, { color: colors.text }]} numberOfLines={1}>
              {item.destination_address || t(lang, 'to')}
            </Text>
          </View>
        </View>

        <View style={[s.cardFooter, { borderTopColor: colors.border }]}>
          <Text style={[s.metaText, { color: colors.textSecondary }]}>
            {item.distance_km ? `${Number(item.distance_km).toFixed(1)} ${t(lang,'km')}` : '—'}
          </Text>
          <Text style={[s.priceText, { color: colors.primary }]}>
            {item.total_price ? `${Number(item.total_price).toLocaleString()} ${t(lang,'sum')}` : '—'}
          </Text>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <View style={[s.headerBar, { borderBottomColor: colors.border }]}>
        <Text style={[s.headerTitle, { color: colors.text }]}>{t(lang,'history')}</Text>
      </View>

      {error && (
        <View style={s.center}>
          <Text style={{ color: colors.error }}>{error}</Text>
          <TouchableOpacity style={[s.retryBtn, { backgroundColor: colors.primary }]} onPress={fetchHistory}>
            <Text style={s.retryText}>{t(lang,'retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {!error && orders.length === 0 && (
        <View style={s.center}>
          <Text style={{ fontSize: 48 }}>🚕</Text>
          <Text style={[s.emptyText, { color: colors.textSecondary }]}>
            {lang === 'uz' ? "Hali buyurtmalar yo'q" : 'Заказов пока нет'}
          </Text>
        </View>
      )}

      {!error && orders.length > 0 && (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    headerBar: {
      paddingTop: 52, paddingBottom: 16, paddingHorizontal: 20,
      borderBottomWidth: 1,
    },
    headerTitle: { fontSize: 24, fontWeight: '800' },
    list: { padding: 16, paddingBottom: 32 },
    card: {
      borderWidth: 1, borderRadius: 16, marginBottom: 14,
      overflow: 'hidden',
    },
    cardHeader: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      padding: 12, paddingBottom: 8,
    },
    statusBadge: {
      borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
    },
    statusText: { fontSize: 12, fontWeight: '700' },
    dateText: { fontSize: 12 },
    routeRow: {
      flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8,
    },
    routeLeft: {
      width: 18, alignItems: 'center', marginRight: 10, justifyContent: 'space-between', paddingVertical: 2,
    },
    dot: { width: 10, height: 10, borderRadius: 5 },
    routeLine: { width: 2, flex: 1, backgroundColor: '#ccc', marginVertical: 2 },
    routeRight: { flex: 1, justifyContent: 'space-between' },
    addressText: { fontSize: 14 },
    cardFooter: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      borderTopWidth: 1, padding: 12,
    },
    metaText: { fontSize: 13 },
    priceText: { fontSize: 16, fontWeight: '800' },
    emptyText: { fontSize: 16, marginTop: 12 },
    retryBtn: { marginTop: 16, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
    retryText: { fontWeight: '700', color: '#000' },
  });
}
