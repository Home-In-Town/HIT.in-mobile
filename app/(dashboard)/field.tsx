import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { MapPin, Radio, ClipboardList } from 'lucide-react-native';
import { employeeApi } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authContext';
import { useToast } from '../../src/components/Toast';
import MenuButton from '../../src/components/MenuButton';
import { colors } from '../../src/theme';

export default function FieldScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const toast = useToast();

  const [tracking, setTracking] = useState(false);
  const [currentPlace, setCurrentPlace] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [form, setForm] = useState({ withWhom: '', description: '', projectName: '', projectLocation: '', projectPrice: '' });
  const [logging, setLogging] = useState(false);

  const handleCheckin = async () => {
    setChecking(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { toast.show('Location permission required', 'error'); setChecking(false); return; }

      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = pos.coords;

      // Reverse geocode via OSM
      let placeName: string | null = null;
      try {
        const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
        const geoData = await geo.json();
        placeName = geoData?.display_name?.split(',')?.slice(0, 3)?.join(', ') || null;
      } catch { /* ignore geocode errors */ }

      await employeeApi.submitLocation(latitude, longitude, placeName);
      setCurrentPlace(placeName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      setTracking(true);
      toast.show('Location updated ✓', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Check-in failed', 'error');
    } finally {
      setChecking(false);
    }
  };

  const handleLogMeeting = async () => {
    if (!form.withWhom.trim() || !form.description.trim()) { toast.show('With whom & description required', 'error'); return; }
    setLogging(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { toast.show('Location required for meeting log', 'error'); setLogging(false); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

      let placeName: string | null = null;
      try {
        const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`);
        const geoData = await geo.json();
        placeName = geoData?.display_name?.split(',')?.slice(0, 3)?.join(', ') || null;
      } catch { /* ignore */ }

      await employeeApi.submitLocation(pos.coords.latitude, pos.coords.longitude, placeName);
      setForm({ withWhom: '', description: '', projectName: '', projectLocation: '', projectPrice: '' });
      toast.show('Meeting logged ✓', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Log failed', 'error');
    } finally {
      setLogging(false);
    }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <MenuButton />
          <View>
            <Text style={s.title}>Field Dashboard</Text>
            <Text style={s.sub}>{user?.name || ''}</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}>
        {/* Location check-in card */}
        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <Radio size={18} color={tracking ? colors.green : colors.muted} />
            <Text style={s.cardTitle}>{tracking ? 'Tracking Active' : 'Location Tracking'}</Text>
          </View>

          {currentPlace && (
            <View style={s.placeRow}>
              <MapPin size={14} color={colors.brand} />
              <Text style={s.placeText} numberOfLines={2}>{currentPlace}</Text>
            </View>
          )}

          <Pressable onPress={handleCheckin} disabled={checking} style={[s.checkinBtn, tracking && s.checkinBtnActive]}>
            {checking
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.checkinBtnText}>{tracking ? 'Update Location' : 'Initialize Tether'}</Text>}
          </Pressable>
        </View>

        {/* Log meeting card */}
        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <ClipboardList size={18} color={colors.brand} />
            <Text style={s.cardTitle}>Log Intelligence</Text>
          </View>

          <FieldInput label="Who did you meet? *" value={form.withWhom} onChange={v => setForm(f => ({ ...f, withWhom: v }))} placeholder="Client / prospect name" />
          <FieldInput label="Strategic brief *" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Meeting notes..." multiline />
          <FieldInput label="Project name" value={form.projectName} onChange={v => setForm(f => ({ ...f, projectName: v }))} placeholder="Project discussed (optional)" />
          <FieldInput label="Project location" value={form.projectLocation} onChange={v => setForm(f => ({ ...f, projectLocation: v }))} placeholder="Location (optional)" />

          <Pressable onPress={handleLogMeeting} disabled={logging} style={[s.logBtn, logging && { opacity: 0.6 }]}>
            {logging ? <ActivityIndicator color="#fff" /> : <Text style={s.logBtnText}>Log Meeting</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function FieldInput({ label, value, onChange, placeholder, multiline }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  return (
    <View style={{ gap: 4, marginTop: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.muted2 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        style={[fi.input, multiline && { height: 80, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

const fi = StyleSheet.create({ input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: colors.ink, backgroundColor: colors.cream } });

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 22, fontWeight: 'bold', color: colors.ink },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  card: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 12 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  placeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.greenBg, borderRadius: 10, padding: 10 },
  placeText: { flex: 1, fontSize: 13, color: colors.greenText, fontWeight: '600' },
  checkinBtn: { backgroundColor: colors.brand, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  checkinBtnActive: { backgroundColor: colors.green },
  checkinBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  logBtn: { backgroundColor: colors.brand, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  logBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
