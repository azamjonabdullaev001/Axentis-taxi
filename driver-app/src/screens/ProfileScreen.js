import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Image, Switch, Alert, ActivityIndicator, Modal,
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

  useEffect(() => {
    driverAPI.getDriverRatings().then(({ data }) => setRatingsData(data)).catch(() => {});
  }, []);

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
  });
}
