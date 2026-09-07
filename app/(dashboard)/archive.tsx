import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Clock, MapPin, MessageSquare } from 'lucide-react-native';
import { employeeApiExtended } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authContext';
import { useToast } from '../../src/components/Toast';
import MenuButton from '../../src/components/MenuButton';
import { colors } from '../../src/theme';

function timeAgo(iso: string): string {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ArchiveScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [tab, setTab] = useState<'meetings' | 'locations'>('meetings');

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await employeeApiExtended.getHistory(user.id);
      setMeetings(res.meetings || []);
      setLocations(res.locations || []);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to load archive', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const source = tab === 'meetings' ? meetings : locations;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <MenuButton />
          <View>
            <Text style={s.title}>Archive</Text>
            <Text style={s.sub}>Your activity history</Text>
          </View>
        </View>
      </View>

      <View style={s.tabs}>
        {(['meetings', 'locations'] as const).map(t => (
          <View key={t} style={[s.tabBtn, tab === t && s.tabBtnActive]}>
            <Text onPress={() => setTab(t)} style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'meetings' ? `Meetings (${meetings.length})` : `Pings (${locations.length})`}
            </Text>
          </View>
        ))}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
        >
          {source.length === 0 ? (
            <View style={s.empty}>
              <Clock size={32} color={colors.muted} />
              <Text style={s.emptyText}>No {tab} yet</Text>
            </View>
          ) : source.map((item: any, i: number) => (
            <View key={i} style={s.card}>
              <View style={s.cardTop}>
                {tab === 'meetings'
                  ? <MessageSquare size={16} color={colors.brand} />
                  : <MapPin size={16} color={colors.indigo} />}
                <View style={{ flex: 1 }}>
                  {tab === 'meetings' ? (
                    <>
                      <Text style={s.cardTitle}>{item.withWhom || 'Meeting'}</Text>
                      {item.description && <Text style={s.cardDesc} numberOfLines={3}>{item.description}</Text>}
                      {item.projectName && <Text style={s.cardMeta}>📍 {item.projectName}</Text>}
                    </>
                  ) : (
                    <>
                      <Text style={s.cardTitle}>{item.placeName || `${item.latitude?.toFixed(4)}, ${item.longitude?.toFixed(4)}`}</Text>
                    </>
                  )}
                </View>
                <Text style={s.timeAgo}>{timeAgo(item.createdAt || item.timestamp)}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 22, fontWeight: 'bold', color: colors.ink },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.white },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: colors.brand },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.muted2 },
  tabTextActive: { color: colors.brand },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 15, color: colors.muted },
  card: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  cardDesc: { fontSize: 13, color: colors.muted2, marginTop: 3, lineHeight: 18 },
  cardMeta: { fontSize: 12, color: colors.muted, marginTop: 4 },
  timeAgo: { fontSize: 11, color: colors.muted },
});
