// CRM AI Lead Detail Drawer
// Shows full detail of a CRM Bridge lead: score, contact, journey timeline.

import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, Linking,
} from 'react-native';
import {
  X, Phone, MessageSquare, Star, ChevronRight, TrendingUp,
  Calendar, MapPin, Clock,
} from 'lucide-react-native';
import { crmBridgeApi, CrmLead } from '../../lib/api';
import { useToast } from '../Toast';
import { colors } from '../../theme';

interface Props {
  leadId: string | null;
  onClose: () => void;
}

const STATUS_C: Record<string, { bg: string; text: string }> = {
  HOT:     { bg: '#FEE2E2', text: '#B91C1C' },
  WARM:    { bg: '#FEF3C7', text: '#B45309' },
  COLD:    { bg: '#DBEAFE', text: '#1D4ED8' },
  CREATED: { bg: '#F5F5F4', text: '#57534E' },
};

const JOURNEY_STAGES = [
  'initial_contact', 'qualified', 'site_visit', 'negotiation', 'booking', 'won', 'lost',
];

const STAGE_LABELS: Record<string, string> = {
  initial_contact: 'Initial Contact',
  qualified: 'Qualified',
  site_visit: 'Site Visit',
  negotiation: 'Negotiation',
  booking: 'Booking',
  won: '🏆 Won',
  lost: '❌ Lost',
};

function scoreBar(score: number) {
  const pct = Math.min(100, Math.max(0, score));
  const col = pct >= 70 ? colors.green : pct >= 40 ? colors.amber : colors.red;
  return (
    <View style={sb.track}>
      <View style={[sb.fill, { width: `${pct}%` as any, backgroundColor: col }]} />
    </View>
  );
}

const sb = StyleSheet.create({
  track: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden', flex: 1 },
  fill: { height: '100%', borderRadius: 3 },
});

export default function CrmLeadDrawer({ leadId, onClose }: Props) {
  const toast = useToast();
  const [lead, setLead] = useState<CrmLead | null>(null);
  const [journey, setJourney] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [advancingStage, setAdvancingStage] = useState(false);
  const [activeJourneyStage, setActiveJourneyStage] = useState<string | null>(null);

  useEffect(() => {
    if (!leadId) { setLead(null); setJourney(null); return; }
    setLoading(true);
    Promise.all([
      crmBridgeApi.getLeadById(leadId).catch(() => null),
      crmBridgeApi.getJourney(leadId).catch(() => null),
    ]).then(([l, j]) => {
      setLead(l);
      setJourney(j);
      if (j?.currentStage) setActiveJourneyStage(j.currentStage);
    }).finally(() => setLoading(false));
  }, [leadId]);

  const handleAdvance = async (stage: string) => {
    if (!leadId || advancingStage) return;
    setAdvancingStage(true);
    try {
      await crmBridgeApi.advanceStage(leadId, { stage });
      setActiveJourneyStage(stage);
      toast.show('Stage updated ✓', 'success');
      // Refresh journey
      const j = await crmBridgeApi.getJourney(leadId).catch(() => null);
      setJourney(j);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to advance stage', 'error');
    } finally {
      setAdvancingStage(false);
    }
  };

  const sc = STATUS_C[lead?.status || 'CREATED'] || STATUS_C.CREATED;

  return (
    <Modal
      visible={!!leadId}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle} numberOfLines={1}>
            {lead ? `${lead.first_name}${lead.last_name ? ' ' + lead.last_name : ''}` : 'Lead Detail'}
          </Text>
          <Pressable onPress={onClose} style={s.closeBtn}>
            <X size={20} color={colors.ink} />
          </Pressable>
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator color={colors.brand} size="large" /></View>
        ) : !lead ? (
          <View style={s.center}>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Failed to load lead details.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>

            {/* Identity card */}
            <View style={s.card}>
              <View style={s.cardTopRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.leadName}>{lead.first_name} {lead.last_name || ''}</Text>
                  {lead.email && <Text style={s.leadSub}>{lead.email}</Text>}
                  <Text style={s.leadSub}>Source: {lead.source || '—'}</Text>
                </View>
                <View style={[s.statusBadge, { backgroundColor: sc.bg }]}>
                  <Text style={[s.statusText, { color: sc.text }]}>{lead.status}</Text>
                </View>
              </View>

              {/* CTA row */}
              <View style={s.ctaRow}>
                <Pressable
                  style={[s.ctaBtn, { backgroundColor: colors.greenBg, borderColor: colors.greenBorder }]}
                  onPress={() => Linking.openURL(`tel:${lead.phone_number}`)}
                >
                  <Phone size={14} color={colors.greenText} />
                  <Text style={[s.ctaBtnText, { color: colors.greenText }]}>Call</Text>
                </Pressable>
                <Pressable
                  style={[s.ctaBtn, { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' }]}
                  onPress={() => {
                    const ph = lead.phone_number.replace(/\D/g, '');
                    Linking.openURL(`https://wa.me/${ph}`);
                  }}
                >
                  <MessageSquare size={14} color="#15803D" />
                  <Text style={[s.ctaBtnText, { color: '#15803D' }]}>WhatsApp</Text>
                </Pressable>
              </View>
            </View>

            {/* Score */}
            <View style={s.card}>
              <Text style={s.cardTitle}>Lead Score</Text>
              <View style={s.scoreRow}>
                {scoreBar(lead.score)}
                <Text style={s.scoreNum}>{lead.score}/100</Text>
              </View>
              <View style={s.scoreBreakdown}>
                {[
                  { label: 'Interest',  val: Math.round(lead.score * 0.35) },
                  { label: 'Budget',    val: Math.round(lead.score * 0.30) },
                  { label: 'Timeline',  val: Math.round(lead.score * 0.20) },
                  { label: 'Sentiment', val: Math.round(lead.score * 0.15) },
                ].map(item => (
                  <View key={item.label} style={s.breakdownItem}>
                    <Text style={s.breakdownLabel}>{item.label}</Text>
                    <View style={s.breakdownBarRow}>
                      {scoreBar(item.val * (100 / 35))}
                      <Text style={s.breakdownVal}>{item.val}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            {/* Journey Timeline */}
            {journey && (
              <View style={s.card}>
                <Text style={s.cardTitle}>Sales Journey</Text>

                {/* Stage pipeline */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  <View style={s.stagePipeline}>
                    {JOURNEY_STAGES.map((st, idx) => {
                      const isActive = activeJourneyStage === st;
                      const isPast = JOURNEY_STAGES.indexOf(activeJourneyStage || '') > idx;
                      return (
                        <Pressable
                          key={st}
                          onPress={() => handleAdvance(st)}
                          disabled={advancingStage}
                          style={[
                            s.stageBtn,
                            isActive && s.stageBtnActive,
                            isPast && s.stageBtnPast,
                          ]}
                        >
                          <Text style={[s.stageBtnText, isActive && s.stageBtnTextActive]}>
                            {STAGE_LABELS[st] || st}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>

                {/* Timeline entries */}
                {(journey.timeline || journey.stages || []).map((entry: any, i: number) => (
                  <View key={i} style={s.timelineEntry}>
                    <View style={s.timelineDot} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.timelineStage}>{entry.stage || entry.name || '—'}</Text>
                      {entry.notes && <Text style={s.timelineNotes}>{entry.notes}</Text>}
                      {entry.timestamp && (
                        <Text style={s.timelineDate}>
                          {new Date(entry.timestamp).toLocaleDateString()}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}

                {(!journey.timeline?.length && !journey.stages?.length) && (
                  <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', paddingVertical: 12 }}>
                    No journey entries yet
                  </Text>
                )}
              </View>
            )}

            {/* Activity */}
            <View style={s.card}>
              <Text style={s.cardTitle}>Activity</Text>
              <View style={s.activityRow}>
                <ActivityItem icon={<Clock size={14} color={colors.brand} />} label="Added" value={new Date(lead.createdAt).toLocaleDateString()} />
                <ActivityItem icon={<TrendingUp size={14} color={colors.indigo} />} label="Updated" value={new Date(lead.updatedAt).toLocaleDateString()} />
              </View>
            </View>

          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function ActivityItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={s.activityItem}>
      {icon}
      <View>
        <Text style={s.activityLabel}>{label}</Text>
        <Text style={s.activityValue}>{value}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, backgroundColor: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: colors.ink, flex: 1, marginRight: 12 },
  closeBtn: { padding: 6, borderRadius: 8, backgroundColor: colors.slateBg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 10 },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  leadName: { fontSize: 17, fontWeight: 'bold', color: colors.ink },
  leadSub: { fontSize: 11, color: colors.muted2, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '700' },
  ctaRow: { flexDirection: 'row', gap: 10 },
  ctaBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  ctaBtnText: { fontSize: 12, fontWeight: '700' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  scoreNum: { fontSize: 15, fontWeight: 'bold', color: colors.ink, minWidth: 40, textAlign: 'right' },
  scoreBreakdown: { gap: 8 },
  breakdownItem: { gap: 3 },
  breakdownLabel: { fontSize: 10, color: colors.muted2, fontWeight: '600' },
  breakdownBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakdownVal: { fontSize: 10, fontWeight: '600', color: colors.ink, minWidth: 20 },
  stagePipeline: { flexDirection: 'row', gap: 6, paddingBottom: 4 },
  stageBtn: {
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8,
    backgroundColor: colors.slateBg, borderWidth: 1, borderColor: colors.slateBorder,
  },
  stageBtnActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  stageBtnPast: { backgroundColor: colors.greenBg, borderColor: colors.greenBorder },
  stageBtnText: { fontSize: 10, fontWeight: '600', color: colors.slateText },
  stageBtnTextActive: { color: '#fff' },
  timelineEntry: { flexDirection: 'row', gap: 10, paddingLeft: 6 },
  timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginTop: 5 },
  timelineStage: { fontSize: 12, fontWeight: '700', color: colors.ink },
  timelineNotes: { fontSize: 11, color: colors.muted2, marginTop: 2 },
  timelineDate: { fontSize: 10, color: colors.muted, marginTop: 2 },
  activityRow: { flexDirection: 'row', gap: 14 },
  activityItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activityLabel: { fontSize: 10, color: colors.muted, fontWeight: '600' },
  activityValue: { fontSize: 11, fontWeight: '700', color: colors.ink },
});
