import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Image, Switch, Alert, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { authAPI, orderAPI, quizAPI } from '../services/api';
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
  const [puzzleModalVisible, setPuzzleModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();
  const [sharingLocation, setSharingLocation] = useState(user?.share_live_location !== false);
  const [orders, setOrders] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [puzzleScores, setPuzzleScores] = useState([]);
  const [puzzleTotal, setPuzzleTotal] = useState(0);
  const [loadingPuzzle, setLoadingPuzzle] = useState(false);

  useEffect(() => {
    setSharingLocation(user?.share_live_location !== false);
  }, [user?.share_live_location]);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const { data } = await orderAPI.getHistory();
      setOrders(data.orders || []);
    } catch {}
    setLoadingHistory(false);
  }

  useEffect(() => { loadHistory(); }, []);

  async function loadPuzzleScores() {
    setLoadingPuzzle(true);
    try {
      const [scoresRes, totalRes] = await Promise.all([
        quizAPI.getMyScores(),
        quizAPI.getTotalScore(),
      ]);
      setPuzzleScores(scoresRes.data.scores || []);
      setPuzzleTotal(totalRes.data.total_score || 0);
    } catch {}
    setLoadingPuzzle(false);
  }

  useEffect(() => { loadPuzzleScores(); }, []);

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
            <Ionicons name="camera" size={12} color="#000" />
          </View>
        </TouchableOpacity>
        {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />}
        <Text style={[s.name, { color: colors.text }]}>
          {user?.first_name} {user?.last_name}
        </Text>
        <Text style={[s.phone, { color: colors.textSecondary }]}>{user?.phone}</Text>
      </View>

      {/* ── Unified panel: all sections combined ── */}
      <View style={[s.section, { backgroundColor: colors.card }]}>

        {/* Dark mode */}
        <Row label={t(lang,'darkMode')} colors={colors} icon={isDark ? 'sunny-outline' : 'moon-outline'} iconBg="#5E5CE6">
          <Switch
            value={isDark} onValueChange={toggleTheme}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </Row>
        <View style={[s.divider, { backgroundColor: colors.border }]} />

        {/* Language */}
        <TouchableOpacity style={s.row} onPress={() => setLangModalVisible(!langModalVisible)}>
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
            <Ionicons name={langModalVisible ? 'chevron-up' : 'chevron-forward'} size={16} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>

        {langModalVisible && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            {[{ code:'ru', label:'🇷🇺 Русский' }, { code:'uz', label:"🇺🇿 O'zbek" }].map((item) => (
              <TouchableOpacity key={item.code}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: lang === item.code ? (isDark ? 'rgba(255,204,0,0.1)' : '#FFF8E1') : 'transparent', marginBottom: 4 }}
                onPress={() => handleLanguageChange(item.code)}>
                <Text style={{ color: colors.text, fontSize: 16 }}>{item.label}</Text>
                {lang === item.code && <Ionicons name="checkmark" size={20} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={[s.divider, { backgroundColor: colors.border }]} />

        {/* Location sharing */}
        <Row label={t(lang, 'shareLocation')} colors={colors} icon="location-outline" iconBg="#FF3B3020">
          <Switch
            value={sharingLocation}
            onValueChange={handleToggleLocationSharing}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </Row>
        <View style={[s.divider, { backgroundColor: colors.border }]} />

        {/* Support */}
        <TouchableOpacity style={s.row} onPress={() => Alert.alert(t(lang,'support'), SUPPORT_PHONE)}>
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#34C75920' }]}>
              <Ionicons name="call-outline" size={18} color="#34C759" />
            </View>
            <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang,'support')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={[s.divider, { backgroundColor: colors.border }]} />

        {/* ── Referral ── */}
        <TouchableOpacity style={s.row} onPress={() => Alert.alert(t(lang, 'referral'), t(lang, 'referralInfo'))}>
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#FF9F0A20' }]}>
              <Ionicons name="gift-outline" size={18} color="#FF9F0A" />
            </View>
            <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang, 'referral')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={[s.divider, { backgroundColor: colors.border }]} />

        {/* ── Bonus History ── */}
        <TouchableOpacity style={s.row} onPress={() => Alert.alert(t(lang, 'bonusHistory'), t(lang, 'comingSoon'))}>
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#F59E0B20' }]}>
              <Ionicons name="trophy-outline" size={18} color="#F59E0B" />
            </View>
            <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang, 'bonusHistory')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </TouchableOpacity>

      </View>

      {/* Puzzle game scores section */}
      <View style={[s.section, { backgroundColor: colors.card, marginTop: 8 }]}>
        <View style={[s.puzzleBanner, { backgroundColor: colors.primary + '18' }]}>
          <Text style={{ fontSize: 28 }}>🧩</Text>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 }}>
              {t(lang, 'totalPoints')}
            </Text>
            {loadingPuzzle
              ? <ActivityIndicator size="small" color={colors.primary} style={{ alignSelf: 'flex-start' }} />
              : <Text style={{ color: colors.primary, fontSize: 28, fontWeight: '900', lineHeight: 32 }}>
                  {puzzleTotal.toLocaleString()}
                </Text>
            }
          </View>
          <View style={[s.puzzleTrophyBadge, { backgroundColor: colors.primary }]}>
            <Text style={{ color: '#000', fontSize: 11, fontWeight: '800' }}>
              🏆 {puzzleScores.length}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={s.row}
          onPress={() => { loadPuzzleScores(); setPuzzleModalVisible(true); }}
        >
          <View style={s.rowLeft}>
            <View style={[s.rowIconWrap, { backgroundColor: '#FF6B0020' }]}>
              <Text style={{ fontSize: 16 }}>🎮</Text>
            </View>
            <Text style={[s.rowLabel, { color: colors.text }]}>{t(lang, 'gameHistory')}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {loadingPuzzle
              ? <ActivityIndicator size="small" color={colors.textSecondary} />
              : <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{puzzleScores.length}</Text>
            }
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={[s.logoutBtn, { borderColor: colors.error, marginTop: 8 }]} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={18} color={colors.error} />
        <Text style={{ color: colors.error, fontWeight: '700', fontSize: 15 }}>{t(lang,'logout')}</Text>
      </TouchableOpacity>

      {/* Puzzle scores modal */}
      <Modal visible={puzzleModalVisible} animationType="slide" onRequestClose={() => setPuzzleModalVisible(false)}>
        <SafeAreaView style={[{ flex: 1, backgroundColor: colors.background }]} edges={['top']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <TouchableOpacity onPress={() => setPuzzleModalVisible(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>{t(lang, 'back')}</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center', marginRight: 40 }}>
              🧩 {t(lang, 'gameHistory')}
            </Text>
          </View>
          <View style={[s.puzzleModalTotal, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{t(lang, 'totalPointsEarned')}</Text>
            <Text style={{ color: colors.primary, fontSize: 32, fontWeight: '900' }}>{puzzleTotal.toLocaleString()}</Text>
          </View>

          {loadingPuzzle
            ? <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />
            : <FlatList
                data={puzzleScores}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                ListEmptyComponent={
                  <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 40 }}>
                    {t(lang, 'noGamesYet')}
                  </Text>
                }
                renderItem={({ item: sc, index }) => {
                  const diffLabel = (() => {
                    if (sc.total_questions <= 9)  return { label: t(lang, 'diffEasy'),     color: '#43A047', grid: '3×3' };
                    if (sc.total_questions <= 16) return { label: t(lang, 'diffMedium'),    color: '#1E88E5', grid: '4×4' };
                    if (sc.total_questions <= 25) return { label: t(lang, 'diffHard'),      color: '#FB8C00', grid: '5×5' };
                    return                               { label: t(lang, 'diffHardcore'),  color: '#E53935', grid: '6×6' };
                  })();
                  return (
                    <View style={[s.puzzleCard, { backgroundColor: colors.card }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                        <Text style={{ fontSize: 20, marginRight: 8 }}>🧩</Text>
                        <View style={[s.statusBadge, { backgroundColor: diffLabel.color }]}>
                          <Text style={s.statusBadgeText}>{diffLabel.label}  {diffLabel.grid}</Text>
                        </View>
                        <Text style={{ color: colors.textSecondary, fontSize: 12, marginLeft: 'auto' }}>
                          {formatDate(sc.played_at)}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                        <Text style={{ color: colors.primary, fontSize: 22, fontWeight: '900' }}>
                          +{sc.score} pts
                        </Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                          {sc.total_questions} {t(lang, 'pieces')}
                        </Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 13, marginLeft: 'auto' }}>
                          #{index + 1}
                        </Text>
                      </View>
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

function Row({ label, colors, children, icon, iconBg, iconColor }) {
  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.left}>
        {icon && (
          <View style={[rowStyles.iconWrap, { backgroundColor: iconBg || colors.border + '40' }]}>
            <Ionicons
              name={icon}
              size={18}
              color={
                iconColor ||
                (iconBg
                  ? iconBg.endsWith('20') ? iconBg.slice(0, -2) : '#FFFFFF'
                  : colors.textSecondary)
              }
            />
          </View>
        )}
        <Text style={[rowStyles.label, { color: colors.text }]}>{label}</Text>
      </View>
      {children}
    </View>
  );
}
const rowStyles = StyleSheet.create({
  row: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical: 13, paddingHorizontal: 16 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  iconWrap: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
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
    editBadge: {
      position: 'absolute', bottom: 0, right: 0, borderRadius: 12,
      width: 26, height: 26, justifyContent: 'center', alignItems: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
    },
    name: { fontSize: 20, fontWeight: '700' },
    phone: { fontSize: 15, marginTop: 4 },
    section: { borderRadius: 16, marginBottom: 12, overflow: 'hidden' },
    divider: { height: 1, marginHorizontal: 16, opacity: 0.3 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    rowIconWrap: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
    rowLabel: { fontSize: 15 },
    logoutBtn: {
      borderWidth: 1.5, borderRadius: 14, padding: 14,
      alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
    },
    historyCard: { borderRadius: 14, padding: 14, marginBottom: 10 },
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
    puzzleBanner: {
      flexDirection: 'row', alignItems: 'center', padding: 16,
      borderRadius: 16, margin: 12, marginBottom: 4,
    },
    puzzleTrophyBadge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
    puzzleModalTotal: { alignItems: 'center', padding: 16, borderBottomWidth: 1 },
    puzzleCard: { borderRadius: 14, padding: 14, marginBottom: 10 },
  });
}
