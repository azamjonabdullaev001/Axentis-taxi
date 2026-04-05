import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, Modal, FlatList,
} from 'react-native';
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
    car_region: '01', car_number_suffix: '',
    pinfl: '',
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

    const phone = form.phone.startsWith('+998') ? form.phone : `+998${form.phone}`;
    setLoading(true);
    try {
      await register({
        first_name: form.first_name,
        last_name: form.last_name,
        phone,
        password: form.password,
        confirm_password: form.confirm_password,
        car_number: buildCarNumber(),
        pinfl: form.pinfl.trim(),
      });
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
        <ScrollView contentContainerStyle={[s.scroll, { paddingTop: Math.max(insets.top, 12), paddingBottom: 72 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <Text style={s.logo}>🚖</Text>
          <Text style={s.title}>Axentis Driver</Text>
          <Text style={s.subtitle}>{t(lang,'register')}</Text>
        </View>

        {[
          { key:'first_name', label: t(lang,'firstName') },
          { key:'last_name', label: t(lang,'lastName') },
        ].map(({ key, label }) => (
          <View key={key} style={{ marginBottom: 14 }}>
            <Text style={s.label}>{label}</Text>
            <TextInput style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              value={form[key]} onChangeText={(v) => setField(key, v)}
              placeholderTextColor={colors.textSecondary} />
          </View>
        ))}

        <Text style={s.label}>{t(lang,'phone')}</Text>
        <View style={s.phoneRow}>
          <View style={s.prefix}><Text style={s.prefixText}>+998</Text></View>
          <TextInput
            style={[s.phoneInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            value={form.phone} onChangeText={(v) => setField('phone', v.replace(/\D/g,''))}
            keyboardType="phone-pad" maxLength={9} placeholder="90 000 00 00"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        {[
          { key:'password', label: t(lang,'password') },
          { key:'confirm_password', label: t(lang,'confirmPassword') },
        ].map(({ key, label }) => {
          const isVisible = key === 'password' ? passwordVisible : confirmPasswordVisible;
          const toggleVisibility = key === 'password' ? setPasswordVisible : setConfirmPasswordVisible;

          return (
          <View key={key} style={{ marginBottom: 14 }}>
            <Text style={s.label}>{label}</Text>
            <View style={[s.passwordWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <TextInput
                style={[s.passwordInput, { color: colors.text }]}
                value={form[key]}
                onChangeText={(v) => setField(key, v)}
                secureTextEntry={!isVisible}
                placeholderTextColor={colors.textSecondary}
                placeholder="Минимум 8 символов"
              />
              <TouchableOpacity style={s.eyeBtn} onPress={() => toggleVisibility((value) => !value)}>
                <Ionicons
                  name={isVisible ? 'eye-outline' : 'eye-off-outline'}
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
          </View>
        )})}

        {/* Car number */}
        <Text style={s.label}>{t(lang,'carNumber')}</Text>
        <View style={s.carRow}>
          <TouchableOpacity style={[s.regionBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => setRegionModal(true)}>
            <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 16 }}>{form.car_region}</Text>
          </TouchableOpacity>
          <TextInput
            style={[s.carNumberInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            value={form.car_number_suffix}
            onChangeText={(v) => setField('car_number_suffix', normalizeCarSuffix(v))}
            placeholder="A123BC"
            maxLength={6}
            autoCapitalize="characters"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
        <Text style={[s.carPreview, { color: colors.textSecondary }]}>
          Номер: {buildCarNumber() || '—'}
        </Text>
        <Text style={[s.carHint, { color: colors.textSecondary }]}>После кода региона вводите номер слитно: например A123BC, AB123C или ABC123</Text>

        {/* PINFL / JSHSHIR */}
        <View style={{ marginBottom: 14 }}>
          <Text style={s.label}>ПИНФЛ (ЖШШИР) — 14 цифр</Text>
          <TextInput
            style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            value={form.pinfl}
            onChangeText={(v) => setField('pinfl', v.replace(/\D/g, '').slice(0, 14))}
            keyboardType="numeric"
            maxLength={14}
            placeholder="14-значный ПИНФЛ"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={handleRegister} disabled={loading}>
          {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btnText}>{t(lang,'register')}</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={s.linkRow} onPress={() => navigation.navigate('Login')}>
          <Text style={s.link}>{t(lang,'haveAccount')} <Text style={s.linkBold}>{t(lang,'login')}</Text></Text>
        </TouchableOpacity>

        {/* Region Modal */}
        <Modal visible={regionModal} transparent animationType="slide">
          <View style={s.modalOverlay}>
            <View style={[s.modalSheet, { backgroundColor: colors.background }]}>
              <Text style={[s.modalTitle, { color: colors.text }]}>{t(lang,'region')}</Text>
              <FlatList
                data={UZ_REGIONS}
                keyExtractor={(i) => i.code}
                renderItem={({ item }) => (
                  <TouchableOpacity style={s.regionItem}
                    onPress={() => { setField('car_region', item.code); setRegionModal(false); }}>
                    <Text style={{ color: colors.primary, fontWeight: '700', width: 36 }}>{item.code}</Text>
                    <Text style={{ color: colors.text }}>{item.name}</Text>
                  </TouchableOpacity>
                )}
              />
              <TouchableOpacity onPress={() => setRegionModal(false)} style={{ padding: 16, alignItems: 'center' }}>
                <Text style={{ color: colors.textSecondary }}>Закрыть</Text>
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
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flexGrow: 1, paddingHorizontal: 24 },
    header: { alignItems: 'center', marginTop: 32, marginBottom: 28 },
    logo: { fontSize: 56 },
    title: { fontSize: 26, fontWeight: '800', color: colors.primary, marginTop: 8 },
    subtitle: { fontSize: 15, color: colors.textSecondary },
    label: { color: colors.textSecondary, fontSize: 13, marginBottom: 6 },
    input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15, marginBottom: 0 },
    passwordWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12 },
    passwordInput: { flex: 1, padding: 14, fontSize: 15 },
    eyeBtn: { paddingHorizontal: 14, paddingVertical: 12 },
    phoneRow: { flexDirection: 'row', marginBottom: 14 },
    prefix: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center', marginRight: 8 },
    prefixText: { fontWeight: '700', fontSize: 15, color: '#000' },
    phoneInput: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15 },
    carRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
    regionBtn: { borderWidth: 1, borderRadius: 12, padding: 14, minWidth: 52, alignItems: 'center' },
    carNumberInput: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14, textAlign: 'center', fontSize: 16, letterSpacing: 1.5 },
    carPreview: { fontSize: 13, marginBottom: 16 },
    carHint: { fontSize: 12, lineHeight: 18, marginTop: -8, marginBottom: 16 },
    btn: { backgroundColor: colors.primary, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 4 },
    btnDisabled: { opacity: 0.6 },
    btnText: { fontWeight: '800', fontSize: 16, color: '#000' },
    linkRow: { alignItems: 'center', marginTop: 20 },
    link: { color: colors.textSecondary, fontSize: 14 },
    linkBold: { color: colors.primary, fontWeight: '700' },
    modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
    modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '70%' },
    modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
    regionItem: { flexDirection: 'row', padding: 14, alignItems: 'center', gap: 12 },
  });
}
