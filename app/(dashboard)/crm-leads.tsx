// CRM Leads — AI leads table + Human Lead Manager + Course.
// Opened from the Home dashboard's "CRM" bottom-bar button.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, TextInput, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Monitor, Users, GraduationCap, Search, ChevronLeft, ChevronRight,
} from 'lucide-react-native';
import { crmBridgeApi, CrmLead } from '../../src/lib/api';
import CrmLeadDrawer from '../../src/components/crm/CrmLeadDrawer';
import HumanLeadManager from '../../src/components/crm/HumanLeadManager';
import LeadCourse from '../../src/components/crm/LeadCourse';
import { SkeletonRow } from '../../src/components/Skeleton';
import EmptyState from '../../src/components/EmptyState';
import { colors } from '../../src/theme';

const STATUS_PILLS = ['All', 'HOT', 'WARM', 'COLD', 'CREATED'];
const STATUS_C: Record<string, { bg: string; text: string; dot: string }> = {
  HOT:     { bg: '#FEE2E2', text: '#B91C1C', dot: '#EF4444' },
  WARM:    { bg: '#FEF3C7', text: '#B45309', dot: '#F59E0B' },
  COLD:    { bg: '#DBEAFE', text: '#1D4ED8', dot: '#3B82F6' },
  CREATED: { bg: '#F5F5F4', text: '#57534E', dot: '#A8A29E' },
};

export default function CrmLeadsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [mode, setMode] = useState<'ai' | 'human' | 'course'>('ai');

  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLeads = useCallback(async (pg: number, q: string, status: string) => {
    setLoading(true);
    try {
      const params: any = { page: pg, limit: 20 };
      if (q) params.search = q;
      if (status !== 'All') params.status = status;
      const res = await crmBridgeApi.getLeads(params);
      setLeads(res.leads || []);
      setTotalPages(res.pages || 1);
    } catch { setLeads([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (mode === 'ai') fetchLeads(page, search, statusFilter);
  }, [page, statusFilter, mode]);

  const handleSearch = (t: string) => {
    setSearch(t); setPage(1);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => fetchLeads(1, t, statusFilter), 400);
  };

  const modes: { key: 'ai' | 'human' | 'course'; label: string; Icon: typeof Monitor }[] = [
    { key: 'ai', label: 'AI Leads', Icon: Monitor },
    { key: 'human', label: 'Human Leads', Icon: Users },
    { key: 'course', label: 'Learn', Icon: GraduationCap },
  ];

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={s.backBtn}>
          <ChevronLeft size={24} color={colors.ink} />
        </Pressable>
        <View>
          <Text style={s.title}>CRM Pipeline</Text>
          <Text style={s.sub}>Lead intelligence</Text>
        </View>
      </View>

      {/* Mode toggle */}
      <View style={s.modeBar}>
        {modes.map(({ key, label, Icon }) => {
          const active = mode === key;
          return (
            <Pressable key={key} onPress={() => setMode(key)} style={[s.modeBtn, active && s.modeBtnActive]}>
              <Icon size={15} color={active ? colors.brand : colors.muted2} />
              <Text style={[s.modeText, active && s.modeTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {mode === 'ai' && (
        <View style={{ flex: 1 }}>
          {/* Search */}
          <View style={s.searchWrap}>
            <View style={s.searchRow}>
              <Search size={15} color={colors.muted} />
              <TextInput value={search} onChangeText={handleSearch} placeholder="Search name, phone..."
                placeholderTextColor={colors.muted} style={s.searchInput} />
            </View>
          </View>

          {/* Status pills */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
            {STATUS_PILLS.map(sp => (
              <Pressable key={sp} onPress={() => { setStatusFilter(sp); setPage(1); fetchLeads(1, search, sp); }}
                style={[s.pill, statusFilter === sp && s.pillActive]}>
                {sp !== 'All' && <View style={[s.pillDot, { backgroundColor: STATUS_C[sp]?.dot }]} />}
                <Text style={[s.pillText, statusFilter === sp && s.pillTextActive]}>{sp}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Leads */}
          {loading ? (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
              {[0,1,2,3,4].map(i => <SkeletonRow key={i} />)}
            </ScrollView>
          ) : (
            <FlatList
              data={leads}
              keyExtractor={l => l.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 8 }}
              ListEmptyComponent={<EmptyState icon={<Monitor size={28} color={colors.muted} />} title="No leads found" subtitle="Try adjusting search or filter." />}
              ListFooterComponent={totalPages > 1 ? (
                <View style={s.pagination}>
                  <Pressable disabled={page <= 1} onPress={() => setPage(p => p - 1)} style={[s.pageBtn, page <= 1 && { opacity: 0.3 }]}>
                    <ChevronLeft size={16} color={colors.brand} />
                  </Pressable>
                  <Text style={s.pageText}>Page {page} of {totalPages}</Text>
                  <Pressable disabled={page >= totalPages} onPress={() => setPage(p => p + 1)} style={[s.pageBtn, page >= totalPages && { opacity: 0.3 }]}>
                    <ChevronRight size={16} color={colors.brand} />
                  </Pressable>
                </View>
              ) : null}
              renderItem={({ item: lead }) => {
                const sc = STATUS_C[lead.status] || STATUS_C.CREATED;
                const pct = Math.min(100, lead.score);
                const col = pct >= 70 ? colors.green : pct >= 40 ? colors.amber : colors.red;
                return (
                  <Pressable onPress={() => setSelectedLeadId(lead.id)} style={s.leadCard}>
                    <View style={s.avatar}><Text style={s.avatarText}>{(lead.first_name || '?').charAt(0).toUpperCase()}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.leadName} numberOfLines={1}>{lead.first_name} {lead.last_name || ''}</Text>
                      <Text style={s.leadMeta} numberOfLines={1}>{lead.source || 'Unknown'}</Text>
                      <View style={s.scoreTrack}><View style={[s.scoreFill, { width: `${pct}%` as any, backgroundColor: col }]} /></View>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 5 }}>
                      <View style={[s.statusBadge, { backgroundColor: sc.bg }]}>
                        <View style={[s.statusDot, { backgroundColor: sc.dot }]} />
                        <Text style={[s.statusText, { color: sc.text }]}>{lead.status}</Text>
                      </View>
                      <Text style={[s.scoreNum, { color: col }]}>{lead.score}pts</Text>
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      )}

      {mode === 'human' && (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}><HumanLeadManager /></ScrollView>
      )}
      {mode === 'course' && (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}><LeadCourse /></ScrollView>
      )}

      <CrmLeadDrawer leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  backBtn: { padding: 2 },
  title: { fontSize: 19, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  modeBar: { flexDirection: 'row', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 11, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  modeBtnActive: { borderBottomColor: colors.brand },
  modeText: { fontSize: 12, fontWeight: '600', color: colors.muted2 },
  modeTextActive: { color: colors.brand },
  searchWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 14, color: colors.ink },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  pillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 12, fontWeight: '600', color: colors.muted2 },
  pillTextActive: { color: '#fff' },
  leadCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  leadName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  leadMeta: { fontSize: 11, color: colors.muted2, marginTop: 2 },
  scoreTrack: { height: 3, borderRadius: 2, backgroundColor: colors.line, marginTop: 5, overflow: 'hidden' },
  scoreFill: { height: '100%', borderRadius: 2 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '700' },
  scoreNum: { fontSize: 11, fontWeight: '700' },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 14 },
  pageBtn: { padding: 9, borderRadius: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  pageText: { fontSize: 13, fontWeight: '600', color: colors.ink },
});
