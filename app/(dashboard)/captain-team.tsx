import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, TextInput, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Users, UserPlus, UserMinus, Check, X as XIcon, Search } from 'lucide-react-native';
import { captainTeamApi, CaptainPartner } from '../../src/lib/api';
import { useToast } from '../../src/components/Toast';
import MenuButton from '../../src/components/MenuButton';
import { colors } from '../../src/theme';

export default function CaptainTeamScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [partners, setPartners] = useState<CaptainPartner[]>([]);
  const [incoming, setIncoming] = useState<CaptainPartner[]>([]);
  const [outgoing, setOutgoing] = useState<CaptainPartner[]>([]);
  const [discover, setDiscover] = useState<CaptainPartner[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingDiscover, setLoadingDiscover] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [tab, setTab] = useState<'team' | 'find'>('team');

  const loadTeam = useCallback(async () => {
    try {
      const res = await captainTeamApi.getMyTeam();
      setPartners(res.partners || []);
      setIncoming(res.incoming || []);
      setOutgoing(res.outgoing || []);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to load team', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const searchCaptains = useCallback(async () => {
    setLoadingDiscover(true);
    try {
      const res = await captainTeamApi.listCaptains(search || undefined);
      setDiscover(res);
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setLoadingDiscover(false);
    }
  }, [search]);

  useEffect(() => { loadTeam(); }, [loadTeam]);
  useEffect(() => { if (tab === 'find') searchCaptains(); }, [tab]);

  const act = async (action: 'request' | 'accept' | 'decline' | 'remove', captainId: string) => {
    setActing(captainId);
    try {
      await captainTeamApi[action](captainId);
      toast.show(action === 'request' ? 'Request sent!' : action === 'accept' ? 'Accepted!' : action === 'decline' ? 'Declined' : 'Removed', 'success');
      loadTeam();
      if (tab === 'find') searchCaptains();
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setActing(null);
    }
  };

  const CaptainCard = ({ c, showRequest, showAcceptDecline, showRemove }: { c: CaptainPartner; showRequest?: boolean; showAcceptDecline?: boolean; showRemove?: boolean }) => (
    <View style={s.card}>
      <View style={s.cardAvatar}>
        <Text style={s.cardAvatarText}>{(c.name || '?').charAt(0).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.cardName}>{c.name}</Text>
        {c.companyName && <Text style={s.cardSub}>{c.companyName}</Text>}
        {c.businessCity && <Text style={s.cardSub}>📍 {c.businessCity}</Text>}
      </View>
      <View style={s.cardActions}>
        {showRequest && (
          <Pressable onPress={() => act('request', c.id)} disabled={acting === c.id} style={s.btnGreen}>
            {acting === c.id ? <ActivityIndicator size="small" color={colors.greenText} /> : <UserPlus size={14} color={colors.greenText} />}
          </Pressable>
        )}
        {showAcceptDecline && (
          <>
            <Pressable onPress={() => act('accept', c.id)} disabled={acting === c.id} style={s.btnGreen}>
              <Check size={14} color={colors.greenText} />
            </Pressable>
            <Pressable onPress={() => act('decline', c.id)} disabled={acting === c.id} style={s.btnRed}>
              <XIcon size={14} color={colors.redText} />
            </Pressable>
          </>
        )}
        {showRemove && (
          <Pressable onPress={() => act('remove', c.id)} disabled={acting === c.id} style={s.btnRed}>
            <UserMinus size={14} color={colors.redText} />
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <MenuButton />
          <View>
            <Text style={s.title}>Captain Team</Text>
            <Text style={s.sub}>{partners.length} partners</Text>
          </View>
        </View>
      </View>

      <View style={s.tabs}>
        {(['team', 'find'] as const).map(t => (
          <Pressable key={t} onPress={() => setTab(t)} style={[s.tabBtn, tab === t && s.tabBtnActive]}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>{t === 'team' ? 'My Team' : 'Find Captains'}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'team' ? (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadTeam(); }} tintColor={colors.brand} />}
        >
          {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /> : (
            <>
              {incoming.length > 0 && (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>Incoming Requests ({incoming.length})</Text>
                  {incoming.map(c => <CaptainCard key={c.id} c={c} showAcceptDecline />)}
                </View>
              )}
              {outgoing.length > 0 && (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>Sent Requests ({outgoing.length})</Text>
                  {outgoing.map(c => <CaptainCard key={c.id} c={c} />)}
                </View>
              )}
              <View style={s.section}>
                <Text style={s.sectionLabel}>Partners ({partners.length})</Text>
                {partners.length === 0 ? (
                  <View style={s.empty}><Users size={28} color={colors.muted} /><Text style={s.emptyText}>No partners yet. Find and connect with other captains.</Text></View>
                ) : partners.map(c => <CaptainCard key={c.id} c={c} showRemove />)}
              </View>
            </>
          )}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={s.searchRow}>
            <TextInput value={search} onChangeText={setSearch} placeholder="Search by name or city..." placeholderTextColor={colors.muted} style={s.searchInput} onSubmitEditing={searchCaptains} returnKeyType="search" />
            <Pressable onPress={searchCaptains} style={s.searchBtn}>
              <Search size={16} color="#fff" />
            </Pressable>
          </View>
          {loadingDiscover ? <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /> : (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}>
              {discover.length === 0 ? (
                <View style={s.empty}><Users size={28} color={colors.muted} /><Text style={s.emptyText}>Search for captains to connect with.</Text></View>
              ) : discover.map(c => (
                <CaptainCard
                  key={c.id}
                  c={c}
                  showRequest={!c.status || c.status === 'none'}
                />
              ))}
            </ScrollView>
          )}
        </View>
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
  section: { gap: 10 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.muted2, textTransform: 'uppercase', marginBottom: 4 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 12 },
  cardAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  cardAvatarText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cardName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  cardSub: { fontSize: 12, color: colors.muted2 },
  cardActions: { flexDirection: 'row', gap: 8 },
  btnGreen: { padding: 8, borderRadius: 10, backgroundColor: colors.greenBg, borderWidth: 1, borderColor: colors.greenBorder },
  btnRed: { padding: 8, borderRadius: 10, backgroundColor: colors.redBg, borderWidth: 1, borderColor: colors.redBorder },
  searchRow: { flexDirection: 'row', margin: 16, gap: 10 },
  searchInput: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: colors.ink, backgroundColor: colors.white },
  searchBtn: { backgroundColor: colors.brand, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  emptyText: { fontSize: 13, color: colors.muted, textAlign: 'center' },
});
