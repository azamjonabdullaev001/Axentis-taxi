import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, Modal, FlatList,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { t, UZ_REGIONS } from '../i18n';
import { getAPIErrorMessage } from '../services/api';

function normalizeCarSuffix(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function isValidCarSuffix(value) {
  return value.length >= 4 && /[A-Z]/.test(value) && /\d/.test(value);
}

export default function RegisterScreen({ navigation }) {
  const { colors } = useTheme();
  const { register } = useAuth();
  const [lang] = useState('ru');

  const [form, setForm] = useState({
    first_name: '', last_name: '', phone: '',
    password: '', confirm_password: '',
    pinfl: '',
    car_region: '01', car_number_suffix: '',
  });
  const [docs, setDocs] = useState({
    selfie: null,
    license_front: null,
    license_back: null,
    id_document: null,
  });
  const [loading, setLoading] = useState(false);
  const [regionModal, setRegionModal] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const insets = useSafeAreaInsets();

  function setField(k, v) { setForm((p) => ({ ...p, [k]: v })); }

  function buildCarNumber() {
    return `${form.car_region}${normalizeCarSuffix(form.car_number_suffix)}`;
  }

  async function pickImageFor(key, label) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert(t(lang, 'error'), 'Нужен доступ к галерее');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const ext = (asset.fileName?.split('.').pop() || 'jpg').toLowerCase();
    setDocs((prev) => ({
      ...prev,
      [key]: {
        uri: asset.uri,
        type: asset.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        name: asset.fileName || `${key}.${ext}`,
        label,
      },
    }));
  }

  async function handleRegister() {
    if (!form.first_name.trim()) { Alert.alert(t(lang,'error'), 'Введите имя'); return; }
    if (!form.last_name.trim()) { Alert.alert(t(lang,'error'), 'Введите фамилию'); return; }
    if (!form.phone.trim()) { Alert.alert(t(lang,'error'), 'Введите телефон'); return; }
    if (form.password.length < 8) { Alert.alert(t(lang,'error'), t(lang,'passwordMin')); return; }
    if (form.password !== form.confirm_password) {
      Alert.alert(t(lang,'error'), t(lang,'passwordMismatch')); return;
    }
    if (!isValidCarSuffix(form.car_number_suffix)) {
      Alert.alert(t(lang,'error'), 'Введите номер автомобиля в едином формате: 4-6 символов, буквы и цифры вместе'); return;
    }
    if (!form.pinfl.trim() || form.pinfl.trim().length !== 14 || !/^\d{14}$/.test(form.pinfl.trim())) {
      Alert.alert(t(lang,'error'), 'ПИНФЛ (ЖШШИР) должен быть ровно 14 цифр'); return;
    }
    if (!docs.selfie || !docs.license_front || !docs.license_back || !docs.id_document) {
      Alert.alert(t(lang, 'error'), 'Загрузите selfie, права (2 стороны) и паспорт/ID');
      return;
    }

    const phone = form.phone.startsWith('+998') ? form.phone : `+998${form.phone}`;
    setLoading(true);
    try {
      const res = await register({
        first_name: form.first_name,
        last_name: form.last_name,
        phone,
        password: form.password,
        confirm_password: form.confirm_password,
        car_number: buildCarNumber(),
        pinfl: form.pinfl.trim(),
        selfie: docs.selfie,
        license_front: docs.license_front,
        license_back: docs.license_back,
        id_document: docs.id_document,
      });

      if (res?.registration_status === 'pending') {
        Alert.alert('Registration sent', 'Your account is waiting for admin approval.', [
          { text: 'OK', onPress: () => navigation.navigate('Login') },
        ]);
      }
    } catch (e) {
      Alert.alert(t(lang,'error'), getAPIErrorMessage(e, 'Ошибка регистрации'));
    } finally {
      setLoading(false);
    }
  }

  const s = makeStyles(colors);

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={s.container}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: 40 + insets.bottom }]} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <View style={s.logoOuter}>
              <View style={s.logoCircle}>
                <Ionicons name="car-sport" size={36} color="#000" />
              </View>
            </View>
            <Text style={s.title}>Axentis Driver</Text>
            <Text style={s.subtitle}>{t(lang,'register')}</Text>
          </View>

          {/* Personal info card */}
          <View style={s.card}>
            <Text style={s.sectionTitle}>Личные данные</Text>

            {[
              { key:'first_name', label: t(lang,'firstName') },
              { key:'last_name', label: t(lang,'lastName') },
            ].map(({ key, label }) => (
              <View key={key}>
                <Text style={s.label}>{label}</Text>
                <TextInput
                  style={s.input}
                  value={form[key]}
                  onChangeText={(v) => setField(key, v)}
                  placeholderTextColor="#505068"
                />
              </View>
            ))}

            <Text style={s.label}>{t(lang,'phone')}</Text>
            <View style={s.phoneRow}>
              <View style={s.prefix}><Text style={s.prefixText}>+998</Text></View>
              <TextInput
                style={s.phoneInput}
                value={form.phone}
                onChangeText={(v) => setField('phone', v.replace(/\D/g,''))}
                keyboardType="phone-pad"
                maxLength={9}
                placeholder="90 000 00 00"
                placeholderTextColor="#505068"
              />
            </View>

            {[
              { key:'password', label: t(lang,'password') },
              { key:'confirm_password', label: t(lang,'confirmPassword') },
            ].map(({ key, label }) => {
              const isVisible = key === 'password' ? passwordVisible : confirmPasswordVisible;
              const toggleVisibility = key === 'password' ? setPasswordVisible : setConfirmPasswordVisible;
              return (
                <View key={key}>
                  <Text style={s.label}>{label}</Text>
                  <View style={s.passwordWrap}>
                    <TextInput
                      style={s.passwordInput}
                      value={form[key]}
                      onChangeText={(v) => setField(key, v)}
                      secureTextEntry={!isVisible}
                      placeholderTextColor="#505068"
                      placeholder="Минимум 8 символов"
                    />
                    <TouchableOpacity style={s.eyeBtn} onPress={() => toggleVisibility((v) => !v)}>
                      <Ionicons
                        name={isVisible ? 'eye-outline' : 'eye-off-outline'}
                        size={20}
                        color="#6B6B80"
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}

            <Text style={s.label}>ПИНФЛ (ЖШШИР) — 14 цифр</Text>
            <TextInput
              style={s.input}
              value={form.pinfl}
              onChangeText={(v) => setField('pinfl', v.replace(/\D/g, '').slice(0, 14))}
              keyboardType="number-pad"
              maxLength={14}
              placeholder="12345678901234"
              placeholderTextColor="#505068"
            />
          </View>

          {/* Car number card */}
          <View style={s.card}>
            <Text style={s.sectionTitle}>{t(lang,'carNumber')}</Text>
            <View style={s.carRow}>
              <TouchableOpacity style={s.regionBtn} onPress={() => setRegionModal(true)}>
                <Text style={s.regionBtnText}>{form.car_region}</Text>
              </TouchableOpacity>
              <TextInput
                style={s.carNumberInput}
                value={form.car_number_suffix}
                onChangeText={(v) => setField('car_number_suffix', normalizeCarSuffix(v))}
                placeholder="A123BC"
                maxLength={6}
                autoCapitalize="characters"
                placeholderTextColor="#505068"
              />
            </View>
            <Text style={s.carPreview}>Номер: {buildCarNumber() || '—'}</Text>
            <Text style={s.carHint}>После кода региона вводите номер слитно: например A123BC, AB123C или ABC123</Text>
          </View>

          {/* Documents card */}
          <View style={s.card}>
            <Text style={s.sectionTitle}>Документы для проверки</Text>
            {[
              { key: 'selfie', icon: 'camera-outline', text: 'Selfie водителя' },
              { key: 'license_front', icon: 'card-outline', text: 'Права (лицевая сторона)' },
              { key: 'license_back', icon: 'card-outline', text: 'Права (обратная сторона)' },
              { key: 'id_document', icon: 'document-outline', text: 'Паспорт или ID-карта' },
            ].map(({ key, icon, text }) => (
              <TouchableOpacity
                key={key}
                style={s.docBtn}
                onPress={() => pickImageFor(key, text)}
                activeOpacity={0.7}
              >
                <View style={s.docLeft}>
                  <Ionicons name={icon} size={20} color="#8A8A9E" style={{ marginRight: 10 }} />
                  <Text style={s.docText}>{text}</Text>
                </View>
                <View style={[s.docBadge, docs[key] && s.docBadgeOk]}>
                  <Text style={[s.docState, docs[key] && s.docStateOk]}>
                    {docs[key] ? 'Загружено' : 'Не выбрано'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[s.btn, loading && s.btnDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btnText}>{t(lang,'register')}</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={s.linkRow} onPress={() => navigation.navigate('Login')}>
            <Text style={s.link}>{t(lang,'haveAccount')} <Text style={s.linkBold}>{t(lang,'login')}</Text></Text>
          </TouchableOpacity>

          {/* Region Modal */}
          <Modal visible={regionModal} transparent animationType="slide">
            <View style={s.modalOverlay}>
              <View style={s.modalSheet}>
                <View style={s.modalHandle} />
                <Text style={s.modalTitle}>{t(lang,'region')}</Text>
                <FlatList
                  data={UZ_REGIONS}
                  keyExtractor={(i) => i.code}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={s.regionItem}
                      onPress={() => { setField('car_region', item.code); setRegionModal(false); }}
                      activeOpacity={0.6}
                    >
                      <Text style={s.regionItemCode}>{item.code}</Text>
                      <Text style={s.regionItemName}>{item.name}</Text>
                    </TouchableOpacity>
                  )}
                />
                <TouchableOpacity onPress={() => setRegionModal(false)} style={s.modalClose}>
                  <Text style={s.modalCloseText}>Закрыть</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0B0B11' },
    scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 28 },
    header: { alignItems: 'center', marginBottom: 24 },
    logoOuter: {
      width: 96, height: 96, borderRadius: 48,
      borderWidth: 2, borderColor: 'rgba(255,204,0,0.15)',
      justifyContent: 'center', alignItems: 'center',
      marginBottom: 16,
    },
    logoCircle: {
      width: 78, height: 78, borderRadius: 39,
      backgroundColor: colors.primary,
      justifyContent: 'center', alignItems: 'center',
      shadowColor: '#FFCC00',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.4,
      shadowRadius: 18,
      elevation: 14,
    },
    title: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.8, marginBottom: 4 },
    subtitle: { fontSize: 14, color: '#6E6E82', fontWeight: '500' },
    card: {
      backgroundColor: '#12121A',
      borderRadius: 20,
      padding: 20,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.05)',
    },
    sectionTitle: {
      fontSize: 15, fontWeight: '700', color: '#FFFFFF',
      marginBottom: 16, letterSpacing: 0.3,
    },
    label: { color: '#8A8A9E', fontSize: 13, marginBottom: 8, fontWeight: '600', letterSpacing: 0.2 },
    input: {
      borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 14,
      paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#FFFFFF',
      backgroundColor: '#1A1A26', marginBottom: 16,
    },
    passwordWrap: {
      flexDirection: 'row', alignItems: 'center',
      borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 14,
      marginBottom: 16, backgroundColor: '#1A1A26',
    },
    passwordInput: { flex: 1, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#FFFFFF' },
    eyeBtn: { paddingHorizontal: 14, paddingVertical: 12 },
    phoneRow: { flexDirection: 'row', marginBottom: 16 },
    prefix: {
      backgroundColor: colors.primary, borderRadius: 14,
      paddingHorizontal: 16, justifyContent: 'center', marginRight: 10,
      shadowColor: '#FFCC00',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 4,
    },
    prefixText: { fontWeight: '800', fontSize: 15, color: '#000' },
    phoneInput: {
      flex: 1, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 14,
      paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, backgroundColor: '#1A1A26', color: '#FFFFFF',
    },
    carRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
    regionBtn: {
      borderWidth: 1.5, borderColor: 'rgba(255,204,0,0.25)', borderRadius: 14,
      paddingHorizontal: 16, paddingVertical: 14, minWidth: 56,
      alignItems: 'center', backgroundColor: '#1A1A26',
    },
    regionBtnText: { color: colors.primary, fontWeight: '800', fontSize: 16 },
    carNumberInput: {
      flex: 1, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 14,
      paddingHorizontal: 16, paddingVertical: 14, textAlign: 'center',
      fontSize: 16, letterSpacing: 2, backgroundColor: '#1A1A26', color: '#FFFFFF',
    },
    carPreview: { fontSize: 13, color: '#6E6E82', marginBottom: 4 },
    carHint: { fontSize: 12, lineHeight: 18, color: '#505068', marginBottom: 4 },
    docBtn: {
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.06)',
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 14,
      marginBottom: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: '#1A1A26',
    },
    docLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    docText: { color: '#FFFFFF', fontSize: 14 },
    docBadge: {
      paddingHorizontal: 10, paddingVertical: 4,
      borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)',
    },
    docBadgeOk: { backgroundColor: 'rgba(34,197,94,0.12)' },
    docState: { fontSize: 12, fontWeight: '700', color: '#6E6E82' },
    docStateOk: { color: '#22C55E' },
    btn: {
      backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16,
      alignItems: 'center', marginTop: 4, marginBottom: 4,
      shadowColor: '#FFCC00',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 10,
    },
    btnDisabled: { opacity: 0.5 },
    btnText: { fontWeight: '800', fontSize: 16, color: '#000', letterSpacing: 0.5 },
    linkRow: { alignItems: 'center', marginTop: 20 },
    link: { color: '#6E6E82', fontSize: 14 },
    linkBold: { color: colors.primary, fontWeight: '700' },
    modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
    modalSheet: {
      backgroundColor: '#12121A', borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 20, maxHeight: '70%',
      borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
    },
    modalHandle: {
      width: 40, height: 4, borderRadius: 2,
      backgroundColor: 'rgba(255,255,255,0.15)',
      alignSelf: 'center', marginBottom: 16,
    },
    modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16, color: '#FFFFFF' },
    regionItem: {
      flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 4,
      alignItems: 'center', gap: 12,
      borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
    },
    regionItemCode: { color: colors.primary, fontWeight: '700', width: 36, fontSize: 15 },
    regionItemName: { color: '#FFFFFF', fontSize: 15 },
    modalClose: { paddingVertical: 16, alignItems: 'center' },
    modalCloseText: { color: '#6E6E82', fontSize: 15, fontWeight: '600' },
  });
}
