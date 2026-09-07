import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable, TextInput, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Users, Search, UserPlus, MapPin, Clock } from 'lucide-react-native';
import { employeeApiExtended, EmployeeListItem } from '../../src/lib/api';
import { useToast } from '../../src/components/Toast';
import MenuButton from '../../src/components/MenuButton';
import { colors } from '../../src/theme';

export default function EmployeesScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchPhone, setSearchPhone] = useState('');
  const [searchResult, setSearchResult] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, { locations: any[]; meetings: any[] }>>({});
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await employeeApiExtended.getMyEmployees();
      setEmployees(data);
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSearch = async () => {
    if (!searchPhone.trim()) return;
    setSearching(true);
    setSearchResult(null);
    try {
      const res = await employeeApiExtended.searchByPhone(searchPhone.trim());
      setSearchResult(res);
      if (!res || !(res as any).employee) toast.show('No employee found', 'info');
    } catch (e: any) {
      toast.show(e?.message || 'Search failed', 'error');
    } finally {
      setSearching(false);
    }
  };

  const handleRequest = async (employeeId: string) => {
    setRequesting(true);
    try {
      await employeeApiExtended.requestAssignment(employeeId);
      toast.show('Request sent!', 'success');
      setSearchResult(null);
      setSearchPhone('');
      load();
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setRequesting(false);
    }
  };

  const toggleHistory = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (history[id]) return;
    setLoadingHistory(id);
    try {
      const res = await employeeApiExtended.getHistory(id);
      setHistory(prev => ({ ...prev, [id]: res }));
    } catch {
      toast.show('Failed to load history', 'error');
    } finally {
      setLoadingHistory(null);
    }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <MenuButton />
          <View>
            <Text style={s.title}>Field Team</Text>
            <Text style={s.sub}>{employees.length} employees</Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        {/* Find employee */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Find & Assign Employee</Text>
          <View style={s.searchRow}>
            <TextInput
              value={searchPhone}
              onChangeText={setSearchPhone}
              placeholder="Phone number..."
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              style={s.searchInput}
            />
            <Pressable onPress={handleSearch} disabled={searching} style={s.searchBtn}>
              {searching ? <ActivityIndicator color="#fff" size="small" /> : <Search size={16} color="#fff" />}
            </Pressable>
          </View>

          {searchResult && (searchResult as any).employee && (
            <View style={s.resultCard}>
              <View style={{ flex: 1 }}>
                <Text style={s.resultName}>{(searchResult as any).employee.name}</Text>
                <Text style={s.resultSub}>{(searchResult as any).employee.phone} · {(searchResult as any).employee.role}</Text>
              </View>
              <Pressable onPress={() => handleRequest((searchResult as any).employee._id || (searchResult as any).employee.id)} disabled={requesting} style={s.requestBtn}>
                {requesting ? <ActivityIndicator color={colors.brand} size="small" /> : <UserPlus size={16} color={colors.brand} />}
                <Text style={s.requestBtnText}>Assign</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Employee list */}
        {loading ? (
          <View style={s.center}><ActivityIndicator color={colors.brand} /></View>
        ) : employees.length === 0 ? (
          <View style={s.empty}>
            <Users size={32} color={colors.muted} />
            <Text style={s.emptyText}>No employees yet</Text>
          </View>
        ) : (
          employees.map(e => (
            <View key={e.id} style={s.empCard}>
              <Pressable onPress={() => toggleHistory(e.id)} style={s.empRow}>
                <View style={s.empAvatar}>
                  <Text style={s.empAvatarText}>{e.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.empName}>{e.name}</Text>
                  <Text style={s.empSub}>{e.phone} · {e.role}</Text>
                </View>
                <View style={[s.statusBadge, { backgroundColor: e.isEmployerConfirmed ? colors.greenBg : colors.amberBg }]}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: e.isEmployerConfirmed ? colors.greenText : colors.amberText }}>
                    {e.isEmployerConfirmed ? 'Active' : 'Pending'}
                  </Text>
                </View>
              </Pressable>

              {expandedId === e.id && (
                <View style={s.historyBox}>
                  {loadingHistory === e.id ? (
                    <ActivityIndicator color={colors.brand} style={{ marginVertical: 12 }} />
                  ) : (
                    <>
                      {(history[e.id]?.meetings || []).slice(0, 3).map((m: any, i: number) => (
                        <View key={i} style={s.historyItem}>
                          <Clock size={12} color={colors.brand} />
                          <View style={{ flex: 1 }}>
                            <Text style={s.historyTitle}>{m.withWhom || 'Meeting'}</Text>
                            <Text style={s.historyDesc} numberOfLines={2}>{m.description || ''}</Text>
                          </View>
                        </View>
                      ))}
                      {(history[e.id]?.locations || []).slice(0, 3).map((l: any, i: number) => (
                        <View key={`l${i}`} style={s.historyItem}>
                          <MapPin size={12} color={colors.indigo} />
                          <Text style={s.historyDesc} numberOfLines={1}>{l.placeName || `${l.latitude?.toFixed(4)}, ${l.longitude?.toFixed(4)}`}</Text>
                        </View>
                      ))}
                      {!history[e.id]?.meetings?.length && !history[e.id]?.locations?.length && (
                        <Text style={s.historyEmpty}>No history yet</Text>
                      )}
                    </>
                  )}
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 22, fontWeight: 'bold', color: colors.ink },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  center: { alignItems: 'center', paddingVertical: 20 },
  card: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 12 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  searchRow: { flexDirection: 'row', gap: 10 },
  searchInput: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: colors.ink, backgroundColor: colors.cream },
  searchBtn: { backgroundColor: colors.brand, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  resultCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.slateBg, borderRadius: 12, padding: 12 },
  resultName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  resultSub: { fontSize: 12, color: colors.muted2 },
  requestBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.brandTint },
  requestBtnText: { fontSize: 13, fontWeight: '700', color: colors.brand },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 15, color: colors.muted },
  empCard: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  empRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  empAvatar: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  empAvatarText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  empName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  empSub: { fontSize: 12, color: colors.muted2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  historyBox: { borderTopWidth: 1, borderTopColor: colors.line, padding: 12, gap: 8 },
  historyItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  historyTitle: { fontSize: 13, fontWeight: '600', color: colors.ink },
  historyDesc: { fontSize: 12, color: colors.muted2 },
  historyEmpty: { fontSize: 12, color: colors.muted, textAlign: 'center', paddingVertical: 8 },
});
