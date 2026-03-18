import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, Modal, FlatList,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { t, UZ_REGIONS } from '../i18n';

export default function RegisterScreen({ navigation }) {
  const { colors } = useTheme();
  const { register } = useAuth();
  const [lang] = useState('ru');

  const [form, setForm] = useState({
    first_name: '', last_name: '', phone: '',
    password: '', confirm_password: '',
    car_region: '01', car_letters: '', car_digits: '',
  });
  const [loading, setLoading] = useState(false);
  const [regionModal, setRegionModal] = useState(false);

  function setField(k, v) { setForm((p) => ({ ...p, [k]: v })); }

  function buildCarNumber() {
    return `${form.car_region}${form.car_letters.toUpperCase()}${form.car_digits}`;
  }

  async function handleRegister() {
    if (!form.first_name.trim()) { Alert.alert(t(lang,'error'), 'Введите имя'); return; }
    if (!form.last_name.trim()) { Alert.alert(t(lang,'error'), 'Введите фамилию'); return; }
    if (!form.phone.trim()) { Alert.alert(t(lang,'error'), 'Введите телефон'); return; }
    if (form.password.length < 8) { Alert.alert(t(lang,'error'), t(lang,'passwordMin')); return; }
    if (form.password !== form.confirm_password) {
      Alert.alert(t(lang,'error'), t(lang,'passwordMismatch')); return;
    }
    if (!form.car_letters || !form.car_digits) {
      Alert.alert(t(lang,'error'), 'Введите номер автомобиля'); return;
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
      });
    } catch (e) {
      Alert.alert(t(lang,'error'), e.response?.data?.error || 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  }

  const s = makeStyles(colors);

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
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
        ].map(({ key, label }) => (
          <View key={key} style={{ marginBottom: 14 }}>
            <Text style={s.label}>{label}</Text>
            <TextInput style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              value={form[key]} onChangeText={(v) => setField(key, v)}
              secureTextEntry placeholderTextColor={colors.textSecondary}
              placeholder="Минимум 8 символов" />
          </View>
        ))}

        {/* Car number */}
        <Text style={s.label}>{t(lang,'carNumber')}</Text>
        <View style={s.carRow}>
          <TouchableOpacity style={[s.regionBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => setRegionModal(true)}>
            <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 16 }}>{form.car_region}</Text>
          </TouchableOpacity>
          <TextInput
            style={[s.carLetters, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            value={form.car_letters}
            onChangeText={(v) => setField('car_letters', v.replace(/[^a-zA-Z]/g,'').toUpperCase())}
            placeholder="ABC" maxLength={3} autoCapitalize="characters"
            placeholderTextColor={colors.textSecondary}
          />
          <TextInput
            style={[s.carDigits, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            value={form.car_digits}
            onChangeText={(v) => setField('car_digits', v.replace(/\D/g,''))}
            placeholder="123" maxLength={3} keyboardType="numeric"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
        <Text style={[s.carPreview, { color: colors.textSecondary }]}>
          Номер: {buildCarNumber() || '—'}
        </Text>

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
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { padding: 24, paddingBottom: 48 },
    header: { alignItems: 'center', marginTop: 32, marginBottom: 28 },
    logo: { fontSize: 56 },
    title: { fontSize: 26, fontWeight: '800', color: colors.primary, marginTop: 8 },
    subtitle: { fontSize: 15, color: colors.textSecondary },
    label: { color: colors.textSecondary, fontSize: 13, marginBottom: 6 },
    input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15, marginBottom: 0 },
    phoneRow: { flexDirection: 'row', marginBottom: 14 },
    prefix: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center', marginRight: 8 },
    prefixText: { fontWeight: '700', fontSize: 15, color: '#000' },
    phoneInput: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15 },
    carRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
    regionBtn: { borderWidth: 1, borderRadius: 12, padding: 14, minWidth: 52, alignItems: 'center' },
    carLetters: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14, textAlign: 'center', fontSize: 16, letterSpacing: 2 },
    carDigits: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14, textAlign: 'center', fontSize: 16, letterSpacing: 2 },
    carPreview: { fontSize: 13, marginBottom: 16 },
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
