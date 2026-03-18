import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Image, Switch, Alert, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from '../i18n';

const SUPPORT_PHONE = '+998712001122';

export default function ProfileScreen() {
  const { colors, isDark, toggleTheme } = useTheme();
  const { user, logout, updateUser } = useAuth();
  const [lang, setLang] = useState('ru');
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('language').then((l) => { if (l) setLang(l); });
  }, []);

  async function handleLanguageChange(newLang) {
    setLang(newLang);
    await AsyncStorage.setItem('language', newLang);
    setLangModalVisible(false);
  }

  async function handlePickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Нет доступа к галерее'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) {
      setLoading(true);
      try {
        await authAPI.updateProfile({ avatar_url: result.assets[0].uri });
        await updateUser({ ...user, avatar_url: result.assets[0].uri });
      } finally {
        setLoading(false);
      }
    }
  }

  async function handleLogout() {
    Alert.alert('Выход', 'Вы уверены, что хотите выйти?', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: logout },
    ]);
  }

  const s = makeStyles(colors);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Avatar */}
      <View style={s.avatarSection}>
        <TouchableOpacity onPress={handlePickImage} style={s.avatarWrap}>
          {user?.avatar_url
            ? <Image source={{ uri: user.avatar_url }} style={s.avatar} />
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
      </View>

      <TouchableOpacity style={[s.logoutBtn, { borderColor: colors.error }]} onPress={handleLogout}>
        <Text style={{ color: colors.error, fontWeight: '700', fontSize: 15 }}>{t(lang,'logout')}</Text>
      </TouchableOpacity>

      {/* Language modal */}
      <Modal visible={langModalVisible} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { backgroundColor: colors.background }]}>
            <Text style={[s.modalTitle, { color: colors.text }]}>Выберите язык</Text>
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
              <Text style={{ color: colors.textSecondary }}>Закрыть</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
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
    modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
    modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 20 },
    langOption: { flexDirection: 'row', justifyContent: 'space-between', padding: 14 },
    langLabel: { fontSize: 16 },
    closeBtn: { alignItems: 'center', marginTop: 16, padding: 12 },
  });
}
