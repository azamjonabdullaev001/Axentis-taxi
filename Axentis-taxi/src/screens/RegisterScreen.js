import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n';

const UZ_REGIONS = [
  '01','10','20','25','30','40','50','55','60','65','70','75','80','85','90','95'
];

export default function RegisterScreen({ navigation }) {
  const { colors } = useTheme();
  const { register } = useAuth();
  const [lang] = useState('ru');

  const [form, setForm] = useState({
    first_name: '', last_name: '', phone: '',
    password: '', confirm_password: '',
  });
  const [loading, setLoading] = useState(false);

  function setField(key, val) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  async function handleRegister() {
    if (!form.first_name.trim()) { Alert.alert(t(lang,'error'), 'Введите имя'); return; }
    if (!form.last_name.trim()) { Alert.alert(t(lang,'error'), 'Введите фамилию'); return; }
    if (!form.phone.trim()) { Alert.alert(t(lang,'error'), 'Введите телефон'); return; }
    if (form.password.length < 8) { Alert.alert(t(lang,'error'), t(lang,'passwordMin')); return; }
    if (form.password !== form.confirm_password) {
      Alert.alert(t(lang,'error'), t(lang,'passwordMismatch'));
      return;
    }

    const phone = form.phone.startsWith('+998') ? form.phone : `+998${form.phone}`;

    setLoading(true);
    try {
      await register({ ...form, phone });
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
          <Text style={s.logo}>🚕</Text>
          <Text style={s.title}>Axentis Taxi</Text>
          <Text style={s.subtitle}>{t(lang,'register')}</Text>
        </View>

        <View style={s.form}>
          <Input label={t(lang,'firstName')} value={form.first_name}
            onChangeText={(v) => setField('first_name', v)} colors={colors} />
          <Input label={t(lang,'lastName')} value={form.last_name}
            onChangeText={(v) => setField('last_name', v)} colors={colors} />

          <Text style={s.label}>{t(lang,'phone')}</Text>
          <View style={s.phoneRow}>
            <View style={s.prefix}>
              <Text style={s.prefixText}>+998</Text>
            </View>
            <TextInput
              style={[s.phoneInput, { color: colors.text, borderColor: colors.border }]}
              value={form.phone.replace('+998','')}
              onChangeText={(v) => setField('phone', v.replace(/[^0-9]/g,''))}
              keyboardType="phone-pad"
              maxLength={9}
              placeholder="90 123 45 67"
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          <Input label={t(lang,'password')} value={form.password}
            onChangeText={(v) => setField('password', v)}
            secureTextEntry colors={colors} placeholder="Минимум 8 символов" />
          <Input label={t(lang,'confirmPassword')} value={form.confirm_password}
            onChangeText={(v) => setField('confirm_password', v)}
            secureTextEntry colors={colors} />

          <TouchableOpacity style={[s.btn, loading && s.btnDisabled]}
            onPress={handleRegister} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text style={s.btnText}>{t(lang,'register')}</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={s.linkRow} onPress={() => navigation.navigate('Login')}>
            <Text style={s.link}>{t(lang,'haveAccount')} <Text style={s.linkBold}>{t(lang,'login')}</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Input({ label, colors, ...props }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 6 }}>{label}</Text>
      <TextInput
        style={{
          borderWidth: 1, borderColor: colors.border, borderRadius: 12,
          padding: 14, fontSize: 15, color: colors.text, backgroundColor: colors.card,
        }}
        placeholderTextColor={colors.textSecondary}
        {...props}
      />
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { padding: 24, paddingBottom: 40 },
    header: { alignItems: 'center', marginTop: 40, marginBottom: 32 },
    logo: { fontSize: 56 },
    title: { fontSize: 26, fontWeight: '800', color: colors.primary, marginTop: 8 },
    subtitle: { fontSize: 16, color: colors.textSecondary, marginTop: 4 },
    form: {},
    label: { color: colors.textSecondary, fontSize: 13, marginBottom: 6 },
    phoneRow: { flexDirection: 'row', marginBottom: 14 },
    prefix: {
      backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 14,
      justifyContent: 'center', marginRight: 8,
    },
    prefixText: { fontWeight: '700', fontSize: 15, color: '#000' },
    phoneInput: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15, backgroundColor: colors.card },
    btn: {
      backgroundColor: colors.primary, borderRadius: 14, padding: 16,
      alignItems: 'center', marginTop: 8,
    },
    btnDisabled: { opacity: 0.7 },
    btnText: { fontWeight: '800', fontSize: 16, color: '#000' },
    linkRow: { alignItems: 'center', marginTop: 20 },
    link: { color: colors.textSecondary, fontSize: 14 },
    linkBold: { color: colors.primary, fontWeight: '700' },
  });
}
