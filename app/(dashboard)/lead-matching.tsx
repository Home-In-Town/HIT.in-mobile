// AI Lead Matching Hub — 4-tab container
// Tabs: Groups (GroupChat), Chats (Chat), Assistant (AI slot-filling), Leads/Stats (admin)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator,
  TextInput, KeyboardAvoidingView, Platform, FlatList, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Users, MessageSquare, Zap, BarChart2, Send, RefreshCw, X } from 'lucide-react-native';
import { leadMatchingApi, leadChatApi } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authContext';
import { useToast } from '../../src/components/Toast';
import { colors } from '../../src/theme';

// We import the full screens as components and render them inside tabs.
// This avoids duplicating navigation logic.
import GroupChatEmbedded from '../../src/components/GroupChatEmbedded';
import ChatEmbedded from '../../src/components/ChatEmbedded';
import MenuButton from '../../src/components/MenuButton';
import AiAssistant from '../../src/components/AiAssistant';

type Tab = 'groups' | 'chats' | 'assistant' | 'leads';

const CONF_COLOR = (c: number) => c >= 0.8 ? colors.greenText : c >= 0.5 ? colors.amberText : colors.redText;
const CONF_BG    = (c: number) => c >= 0.8 ? colors.greenBg  : c >= 0.5 ? colors.amberBg  : colors.redBg;

// ── AI Assistant (lead slot-filling chat) ──────────────────
// The rich, template-driven assistant lives in its own component.
function AssistantTab({ onViewLeads }: { onViewLeads?: () => void }) {
  return <AiAssistant onViewLeads={onViewLeads} />;
}

// ── Leads Tab (admin only) ─────────────────────────────────
function LeadsTab() {
  const toast = useToast();
  const [leads, setLeads] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [leadsTab, setLeadsTab] = useState<'list' | 'stats'>('list');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      leadMatchingApi.getLeads({ limit: 30 }),
      leadMatchingApi.getStats(),
    ]).then(([ld, st]) => {
      setLeads(ld.leads || []);
      setStats(st);
    }).catch(() => toast.show('Failed to load', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const handleStatus = async (id: string, status: string) => {
    setUpdating(id);
    try {
      await leadMatchingApi.updateStatus(id, status);
      setLeads(prev => prev.map(l => l._id === id ? { ...l, status } : l));
      toast.show('Updated', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setUpdating(null);
    }
  };

  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.brand} size="large" /></View>;

  return (
    <View style={{ flex: 1 }}>
      <View style={lt.tabs}>
        {(['list', 'stats'] as const).map(t => (
          <Pressable key={t} onPress={() => setLeadsTab(t)} style={[lt.tabBtn, leadsTab === t && lt.tabBtnActive]}>
            <Text style={[lt.tabText, leadsTab === t && lt.tabTextActive]}>{t === 'list' ? 'Extracted Leads' : 'Stats'}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}>
        {leadsTab === 'stats' && stats ? (
          <View style={{ gap: 12 }}>
            <View style={lt.statsRow}>
              {[['Total', stats.total], ['Matched', stats.withMatches], ['Rate', stats.matchRate]].map(([k, v]) => (
                <View key={k as string} style={lt.statCard}>
                  <Text style={lt.statNum}>{v}</Text>
                  <Text style={lt.statLbl}>{k}</Text>
                </View>
              ))}
            </View>
            {stats.byStatus && Object.entries(stats.byStatus).map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                <Text style={{ fontSize: 13, color: colors.muted2, textTransform: 'capitalize' }}>{k}</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>{v as number}</Text>
              </View>
            ))}
          </View>
        ) : (
          leads.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 60 }}>
              <Text style={{ color: colors.muted, fontSize: 14 }}>No extracted leads yet</Text>
            </View>
          ) : leads.map(l => {
            const conf = l.extractionConfidence || 0;
            return (
              <View key={l._id} style={lt.card}>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <View style={[{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }, { backgroundColor: CONF_BG(conf) }]}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: CONF_COLOR(conf) }}>{Math.round(conf * 100)}% conf</Text>
                  </View>
                  <View style={{ backgroundColor: colors.indigoBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: colors.indigoText }}>{l.intent || ''}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: colors.muted, fontStyle: 'italic' }}>{l.source}</Text>
                </View>
                <Text style={{ fontSize: 13, color: colors.muted2, marginBottom: 6 }} numberOfLines={2}>{l.originalText}</Text>
                {l.params && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                    {l.params.bhkType && <Chip label={l.params.bhkType} />}
                    {l.params.city && <Chip label={l.params.city} />}
                    {l.params.budget && <Chip label={`₹${l.params.budget}L`} />}
                  </View>
                )}
                {l.status === 'auto_detected' && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable onPress={() => handleStatus(l._id, 'confirmed')} disabled={updating === l._id}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.greenBg, borderWidth: 1, borderColor: colors.greenBorder, alignItems: 'center' }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.greenText }}>Confirm</Text>
                    </Pressable>
                    <Pressable onPress={() => handleStatus(l._id, 'rejected')} disabled={updating === l._id}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.redBg, borderWidth: 1, borderColor: colors.redBorder, alignItems: 'center' }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.redText }}>Reject</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const lt = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.white },
  tabBtn: { flex: 1, paddingVertical: 11, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: colors.brand },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.muted2 },
  tabTextActive: { color: colors.brand },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 14, alignItems: 'center' },
  statNum: { fontSize: 20, fontWeight: 'bold', color: colors.ink },
  statLbl: { fontSize: 11, color: colors.muted, marginTop: 2 },
  card: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14 },
});

function Chip({ label }: { label: string }) {
  return (
    <View style={{ backgroundColor: colors.slateBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: colors.slateBorder }}>
      <Text style={{ fontSize: 11, fontWeight: '600', color: colors.slateText }}>{label}</Text>
    </View>
  );
}

// ── Main Hub ─────────────────────────────────────────────────
export default function LeadMatchingHub() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [tab, setTab] = useState<'chats' | 'groups'>('groups');
  // Within the Chats tab: switch between 1:1 Chats and the AI Assistant.
  const [chatSub, setChatSub] = useState<'chats' | 'assistant'>('chats');
  const [showLeads, setShowLeads] = useState(false);
  // When a group room is opened, hide the header + top tab bar for a
  // full-screen chat experience (matches the website behavior).
  const [groupOpen, setGroupOpen] = useState(false);
  const isAdmin = ['admin', 'builder'].includes(user?.role ?? '');

  const TABS: { key: 'chats' | 'groups'; label: string; icon: React.ReactNode }[] = [
    { key: 'chats',  label: 'Chats',  icon: <MessageSquare size={16} /> },
    { key: 'groups', label: 'Groups', icon: <Users size={16} /> },
  ];

  const chromeHidden = tab === 'groups' && groupOpen;

  return (
    <View style={[hub.root, { paddingTop: chromeHidden ? 0 : insets.top }]}>
      {/* Header + tab bar hidden while a group is open */}
      {!chromeHidden && (
        <>
          <View style={hub.header}>
            <MenuButton />
            <Text style={hub.headerTitle}>AI Lead Matching</Text>
            <View style={{ flex: 1 }} />
            {/* Leads pinned at the top (admin/builder only) */}
            {isAdmin && (
              <Pressable onPress={() => setShowLeads(true)} style={hub.leadsBtn}>
                <BarChart2 size={15} color={colors.brand} />
                <Text style={hub.leadsBtnText}>Leads</Text>
              </Pressable>
            )}
          </View>

          <View style={hub.tabBar}>
            {TABS.map(t => (
              <Pressable key={t.key} onPress={() => setTab(t.key)} style={[hub.tabBtn, tab === t.key && hub.tabBtnActive]}>
                <View style={{ opacity: tab === t.key ? 1 : 0.5 }}>
                  {React.cloneElement(t.icon as React.ReactElement, { color: tab === t.key ? colors.brand : colors.muted2 })}
                </View>
                <Text style={[hub.tabText, tab === t.key && hub.tabTextActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Chats sub-toggle: 1:1 Chats vs AI Assistant */}
          {tab === 'chats' && (
            <View style={hub.subRow}>
              {(['chats', 'assistant'] as const).map(sub => (
                <Pressable key={sub} onPress={() => setChatSub(sub)} style={[hub.subBtn, chatSub === sub && hub.subBtnActive]}>
                  {sub === 'assistant' ? <Zap size={13} color={chatSub === sub ? '#fff' : colors.muted2} /> : <MessageSquare size={13} color={chatSub === sub ? '#fff' : colors.muted2} />}
                  <Text style={[hub.subText, chatSub === sub && hub.subTextActive]}>{sub === 'assistant' ? 'AI Assistant' : 'Chats'}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}

      {/* Tab content */}
      <View style={{ flex: 1 }}>
        {tab === 'groups' && <GroupChatEmbedded onRoomOpenChange={setGroupOpen} topInset={insets.top} />}
        {tab === 'chats' && chatSub === 'chats' && <ChatEmbedded />}
        {tab === 'chats' && chatSub === 'assistant' && <AssistantTab onViewLeads={() => { if (isAdmin) setShowLeads(true); }} />}
      </View>

      {/* Leads overlay (opened from the top button) */}
      <Modal visible={showLeads} animationType="slide" onRequestClose={() => setShowLeads(false)}>
        <View style={{ flex: 1, backgroundColor: colors.cream, paddingTop: insets.top }}>
          <View style={hub.header}>
            <Text style={hub.headerTitle}>Extracted Leads</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => setShowLeads(false)} style={hub.closeBtn}>
              <X size={20} color={colors.ink} />
            </Pressable>
          </View>
          <LeadsTab />
        </View>
      </Modal>
    </View>
  );
}

const hub = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.white },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.ink },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 11,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabBtnActive: { borderBottomColor: colors.brand },
  tabText: { fontSize: 12, fontWeight: '600', color: colors.muted2 },
  tabTextActive: { color: colors.brand },
  leadsBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: colors.brand },
  leadsBtnText: { fontSize: 12.5, fontWeight: '800', color: colors.brand },
  closeBtn: { padding: 6, borderRadius: 10, backgroundColor: colors.slateBg },
  subRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  subBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  subBtnActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  subText: { fontSize: 12.5, fontWeight: '700', color: colors.muted2 },
  subTextActive: { color: '#fff' },
});
