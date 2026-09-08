import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, Modal, Linking, ActivityIndicator, StyleSheet,
} from 'react-native';
import { Plus, Search, X, ChevronRight, AlertTriangle, Clock, Calendar } from 'lucide-react-native';
import { projectsApi, ProjectLite, ProjectAsset, humanLeadsApi, HumanLead, LeadPerson } from '../../lib/api';
import { useToast } from '../Toast';
import { useAuth } from '../../lib/authContext';
import LeadDetailView from './LeadDetailView';
import { colors } from '../../theme';

export const PIPELINE_STAGES = [
  'New Lead', 'Contacted', 'Qualified', 'Site Visit Scheduled',
  'Site Visit Done', 'Negotiation', 'Booking', 'Won', 'Lost',
];

export type LeadType = 'inbound' | 'outbound';

// Leads are real, team-scoped records from the backend (with ownership info)
export type DemoLead = HumanLead;
export type { LeadPerson };

// Colors for the inbound/outbound lead-type badge
export function leadTypeColor(type: LeadType): { bg: string; text: string; border: string } {
  return type === 'inbound'
    ? { bg: '#ECFDF5', text: '#047857', border: '#A7F3D0' }
    : { bg: '#F5F3FF', text: '#6D28D9', border: '#DDD6FE' };
}

const HOME_TYPES = ['1 BHK', '2 BHK', '3 BHK', '4 BHK', '5 BHK+', 'Villa', 'Row House', 'Duplex', 'Penthouse', 'Plot', 'Shop', 'Office'];
const BUYING_TYPES = ['Self-use', 'Investment', 'Rental income', 'Upgrade', 'Second home', 'NRI purchase'];
const SOURCES = ['Meta Ad', 'WhatsApp', 'Website', 'Google Ad', 'Walk-in', 'Referral', 'Broker', 'Cold Database', 'Cold Call', 'Other'];

export function stageColor(stage: string): { bg: string; text: string; border: string } {
  switch (stage) {
    case 'New Lead': return { bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE' };
    case 'Contacted': return { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' };
    case 'Qualified': return { bg: '#EEF2FF', text: '#4338CA', border: '#C7D2FE' };
    case 'Site Visit Scheduled': return { bg: '#ECFEFF', text: '#0E7490', border: '#A5F3FC' };
    case 'Site Visit Done': return { bg: '#FAF5FF', text: '#7E22CE', border: '#E9D5FF' };
    case 'Negotiation': return { bg: '#FFF7ED', text: '#C2410C', border: '#FED7AA' };
    case 'Booking': return { bg: '#FDF2F8', text: '#BE185D', border: '#FBCFE8' };
    case 'Won': return { bg: '#F0FDF4', text: '#15803D', border: '#BBF7D0' };
    case 'Lost': return { bg: '#FEF2F2', text: '#B91C1C', border: '#FECACA' };
    default: return { bg: '#F5F5F4', text: '#57534E', border: '#E7E5E4' };
  }
}

export default function HumanLeadManager() {
  const toast = useToast();
  const { user } = useAuth();
  // Only captains can (re)assign leads to their team agents
  const canAssign = user?.role === 'captain';

  const [leads, setLeads] = useState<DemoLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedLead, setSelectedLead] = useState<DemoLead | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStage, setFilterStage] = useState('All');

  const [schedulingLead, setSchedulingLead] = useState<DemoLead | null>(null);
  const [visitDate, setVisitDate] = useState('');
  const [visitTime, setVisitTime] = useState('');

  const [showAddLead, setShowAddLead] = useState(false);
  const [newLead, setNewLead] = useState({
    name: '', phone: '', altPhone: '', email: '', budget: '',
    homeType: '', buyingType: '', location: '', project: '',
    source: 'Meta Ad', customSource: '', stage: 'New Lead',
    leadType: 'inbound' as LeadType,
  });
  const [projectsList, setProjectsList] = useState<ProjectLite[]>([]);
  const [teamAgents, setTeamAgents] = useState<{ id: string; name: string; role: string }[]>([]);
  const [assigningLead, setAssigningLead] = useState<DemoLead | null>(null);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await humanLeadsApi.list();
      setLeads(data);
    } catch {
      setLoadError('Could not load leads.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  useEffect(() => {
    projectsApi.getAllPublic().then(setProjectsList).catch(() => {});
  }, []);

  useEffect(() => {
    if (!canAssign) return;
    humanLeadsApi.teamAgents().then(setTeamAgents).catch(() => {});
  }, [canAssign]);

  // Resolve the selected lead's project assets by matching project name
  const assetsForLead = (lead: DemoLead): ProjectAsset[] =>
    projectsList.find((p) => p.name === lead.project)?.assets || [];

  const getSiteVisitAlert = (lead: DemoLead): 'missing' | 'close' | null => {
    if (lead.stage !== 'Site Visit Scheduled') return null;
    if (!lead.siteVisitDate || !lead.siteVisitTime) return 'missing';
    const diffDays = (new Date(lead.siteVisitDate).getTime() - Date.now()) / 86400000;
    if (diffDays <= 2 && diffDays >= 0) return 'close';
    return null;
  };

  const handleScheduleVisit = async () => {
    if (!schedulingLead || !visitDate || !visitTime) return;
    try {
      const updated = await humanLeadsApi.update(schedulingLead.id, { siteVisitDate: visitDate, siteVisitTime: visitTime });
      setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      toast.success('Site visit scheduled');
    } catch {
      toast.error('Could not schedule visit');
    }
    setSchedulingLead(null); setVisitDate(''); setVisitTime('');
  };

  const handleAddLead = async () => {
    if (!newLead.name || !newLead.phone || saving) return;
    setSaving(true);
    try {
      const created = await humanLeadsApi.create({
        name: newLead.name,
        phone: newLead.phone,
        altPhone: newLead.altPhone,
        email: newLead.email,
        budget: newLead.budget,
        homeType: newLead.homeType,
        buyingType: newLead.buyingType,
        location: newLead.location,
        projectName: newLead.project,
        source: newLead.source === 'Other' ? newLead.customSource || 'Other' : newLead.source,
        leadType: newLead.leadType,
        stage: newLead.stage,
      });
      setLeads((prev) => [created, ...prev]);
      setNewLead({ name: '', phone: '', altPhone: '', email: '', budget: '', homeType: '', buyingType: '', location: '', project: '', source: 'Meta Ad', customSource: '', stage: 'New Lead', leadType: 'inbound' });
      setShowAddLead(false);
      toast.success('Lead added');
    } catch {
      toast.error('Could not add lead');
    } finally {
      setSaving(false);
    }
  };

  const handleAssign = async (leadId: string, agentId: string | null) => {
    try {
      const updated = await humanLeadsApi.assign(leadId, agentId);
      setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      if (selectedLead?.id === updated.id) setSelectedLead(updated);
      setAssigningLead(null);
      toast.success(agentId ? 'Lead assigned' : 'Lead unassigned');
    } catch {
      toast.error('Could not update assignment');
    }
  };

  const filteredLeads = leads.filter((lead) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = lead.name.toLowerCase().includes(q) || lead.project.toLowerCase().includes(q) || lead.phone.includes(searchQuery);
    const matchesStage = filterStage === 'All' || lead.stage === filterStage;
    return matchesSearch && matchesStage;
  });

  // ── Lead detail view ──
  if (selectedLead) {
    const handleStageChange = async (newStage: string) => {
      setLeads((prev) => prev.map((l) => (l.id === selectedLead.id ? { ...l, stage: newStage } : l)));
      setSelectedLead({ ...selectedLead, stage: newStage });
      try {
        const updated = await humanLeadsApi.updateStage(selectedLead.id, newStage);
        setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
        setSelectedLead(updated);
      } catch {
        loadLeads();
      }
    };
    return (
      <View style={s.outerCard}>
        <LeadDetailView lead={selectedLead} onBack={() => setSelectedLead(null)} stages={PIPELINE_STAGES} onStageChange={handleStageChange} projectAssets={assetsForLead(selectedLead)} />
      </View>
    );
  }

  return (
    <View style={s.outerCard}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerRow}>
          <View>
            <Text style={s.headerTitle}>Leads</Text>
            <Text style={s.headerSub}>{filteredLeads.length} total leads</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable onPress={() => Linking.openURL('https://sales.homeintown.in')} style={s.advBtn}>
              <Text style={s.advBtnText}>Advanced</Text>
            </Pressable>
            <Pressable onPress={() => setShowAddLead(true)} style={s.addBtn}>
              <Plus size={14} color="#fff" strokeWidth={2.5} />
              <Text style={s.addBtnText}>Add lead</Text>
            </Pressable>
          </View>
        </View>

        {/* Search */}
        <View style={s.searchBar}>
          <Search size={16} color={colors.muted} />
          <TextInput
            placeholder="Search name or phone..."
            placeholderTextColor={colors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={s.searchInput}
          />
        </View>

        {/* Stage filter pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {['All', ...PIPELINE_STAGES].map((stage) => {
              const active = filterStage === stage;
              return (
                <Pressable key={stage} onPress={() => setFilterStage(stage)} style={[s.filterPill, active ? s.pillActive : s.pillInactive]}>
                  <Text style={[s.filterPillText, { color: active ? '#fff' : colors.muted2 }]}>{stage}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Lead list */}
      <View>
        {loading && (
          <View style={s.centerPad}><ActivityIndicator color={colors.brand} /></View>
        )}
        {!loading && loadError && (
          <View style={s.centerPad}>
            <Text style={s.mutedSm}>{loadError}</Text>
            <Pressable onPress={loadLeads} style={{ marginTop: 8 }}><Text style={s.brandBold}>Try again</Text></Pressable>
          </View>
        )}
        {!loading && !loadError && filteredLeads.map((lead) => {
          const alert = getSiteVisitAlert(lead);
          const sc = stageColor(lead.stage);
          return (
            <Pressable
              key={lead.id}
              onPress={() => setSelectedLead(lead)}
              style={[s.leadRow, { backgroundColor: alert ? 'rgba(254,242,242,0.5)' : '#fff' }]}
            >
              <View style={s.avatar}>
                <Text style={s.avatarText}>{lead.name.split(' ').map((n) => n[0]).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={s.leadName} numberOfLines={1}>{lead.name}</Text>
                  <View style={{ backgroundColor: sc.bg, borderColor: sc.border, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                    <Text style={{ color: sc.text, fontSize: 8, fontWeight: '700' }}>{lead.stage}</Text>
                  </View>
                  {(() => { const lt = leadTypeColor(lead.leadType); return (
                    <View style={{ backgroundColor: lt.bg, borderColor: lt.border, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                      <Text style={{ color: lt.text, fontSize: 8, fontWeight: '700', textTransform: 'uppercase' }}>{lead.leadType}</Text>
                    </View>
                  ); })()}
                </View>
                <Text style={s.leadProject} numberOfLines={1}>{lead.project}</Text>

                {/* Ownership — who brought the lead and who it's assigned to */}
                <View style={{ marginTop: 4 }}>
                  {lead.createdBy && (
                    <Text style={s.ownerLine}>Added by <Text style={s.ownerBold}>{lead.createdBy.name}</Text> ({lead.createdBy.role})</Text>
                  )}
                  <Text style={s.ownerLine}>
                    Assigned to <Text style={{ fontWeight: 'bold', color: lead.assignedAgent ? colors.brand : colors.muted }}>{lead.assignedAgent ? lead.assignedAgent.name : 'Unassigned'}</Text>
                  </Text>
                </View>

                {/* Assign — captain only */}
                {canAssign && (
                  <Pressable onPress={() => setAssigningLead(lead)} style={s.assignBtn}>
                    <Text style={s.assignBtnText}>{lead.assignedAgent ? 'Reassign' : 'Assign to agent'}</Text>
                  </Pressable>
                )}

                {alert === 'missing' && (
                  <View style={s.alertRow}>
                    <AlertTriangle size={12} color="#EF4444" />
                    <Text style={s.alertText}>Visit date/time not set!</Text>
                    <Pressable onPress={() => setSchedulingLead(lead)} style={s.alertScheduleBtn}>
                      <Text style={s.alertScheduleText}>Schedule</Text>
                    </Pressable>
                  </View>
                )}
                {alert === 'close' && (
                  <View style={s.alertRow}>
                    <Clock size={12} color="#EF4444" />
                    <Text style={s.alertText}>Visit soon: {lead.siteVisitDate} at {lead.siteVisitTime}</Text>
                  </View>
                )}
                {lead.stage === 'Site Visit Scheduled' && !alert && lead.siteVisitDate && (
                  <View style={s.alertRow}>
                    <Calendar size={12} color="#0E7490" />
                    <Text style={{ fontSize: 9, fontWeight: '500', color: '#0E7490' }}>{lead.siteVisitDate} at {lead.siteVisitTime}</Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={s.dateText}>{lead.date}</Text>
                <ChevronRight size={16} color={colors.muted} />
              </View>
            </Pressable>
          );
        })}
        {!loading && !loadError && filteredLeads.length === 0 && (
          <View style={s.centerPad}>
            <Text style={s.mutedSm}>No leads found</Text>
            <Text style={[s.mutedSm, { marginTop: 4, fontSize: 11 }]}>Add a lead to get started.</Text>
          </View>
        )}
      </View>

      {/* Assign Agent Modal — captain/admin */}
      <Modal visible={!!assigningLead} transparent animationType="fade" onRequestClose={() => setAssigningLead(null)}>
        <View style={s.modalOverlayCenter}>
          <View style={[s.modalCard, { maxWidth: 420 }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Assign Lead</Text>
              <Pressable onPress={() => setAssigningLead(null)}><X size={20} color={colors.muted} /></Pressable>
            </View>
            {assigningLead && (
              <Text style={[s.mutedSm, { marginBottom: 12 }]}>Assign <Text style={{ fontWeight: 'bold', color: colors.ink }}>{assigningLead.name}</Text> to a team agent.</Text>
            )}
            <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: 8 }}>
              <Pressable onPress={() => assigningLead && handleAssign(assigningLead.id, null)} style={s.agentRow}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.muted2 }}>Unassigned</Text>
                {!assigningLead?.assignedAgent && <Text style={s.brandBold}>Current</Text>}
              </Pressable>
              {teamAgents.length === 0 && (
                <Text style={[s.mutedSm, { fontStyle: 'italic', paddingVertical: 8, textAlign: 'center' }]}>No team agents found.</Text>
              )}
              {teamAgents.map((a) => {
                const isCurrent = assigningLead?.assignedAgent?.id === a.id;
                return (
                  <Pressable key={a.id} onPress={() => assigningLead && handleAssign(assigningLead.id, a.id)} style={[s.agentRow, isCurrent && { borderColor: colors.brand, backgroundColor: colors.brandTint }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={s.agentAvatar}>
                        <Text style={{ fontSize: 10, fontWeight: 'bold', color: colors.brand }}>{a.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}</Text>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }}>{a.name}</Text>
                    </View>
                    {isCurrent && <Text style={s.brandBold}>Current</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Site Visit Scheduling Modal */}
      <Modal visible={!!schedulingLead} transparent animationType="fade" onRequestClose={() => setSchedulingLead(null)}>
        <View style={s.modalOverlayCenter}>
          <View style={[s.modalCard, { maxWidth: 420 }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Schedule Site Visit</Text>
              <Pressable onPress={() => { setSchedulingLead(null); setVisitDate(''); setVisitTime(''); }}><X size={20} color={colors.muted} /></Pressable>
            </View>
            {schedulingLead && (
              <View style={s.leadChip}>
                <View style={s.chipAvatar}>
                  <Text style={{ fontSize: 11, fontWeight: 'bold', color: colors.brand }}>{schedulingLead.name.split(' ').map((n) => n[0]).join('')}</Text>
                </View>
                <View>
                  <Text style={{ fontSize: 13, fontWeight: 'bold', color: colors.ink }}>{schedulingLead.name}</Text>
                  <Text style={{ fontSize: 9, color: colors.muted }}>{schedulingLead.project}</Text>
                </View>
              </View>
            )}
            <Text style={s.fieldLabel}>Visit Date</Text>
            <TextInput placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} value={visitDate} onChangeText={setVisitDate} style={[s.textInput, { marginBottom: 12 }]} />
            <Text style={s.fieldLabel}>Visit Time</Text>
            <TextInput placeholder="e.g. 11:00 AM" placeholderTextColor={colors.muted} value={visitTime} onChangeText={setVisitTime} style={[s.textInput, { marginBottom: 16 }]} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => { setSchedulingLead(null); setVisitDate(''); setVisitTime(''); }} style={s.cancelBtn}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleScheduleVisit} disabled={!visitDate || !visitTime} style={[s.confirmBtn, { opacity: !visitDate || !visitTime ? 0.4 : 1 }]}>
                <Text style={s.confirmBtnText}>Schedule</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Lead Modal */}
      <Modal visible={showAddLead} transparent animationType="slide" onRequestClose={() => setShowAddLead(false)}>
        <View style={s.modalOverlayBottom}>
          <View style={s.sheet}>
            <View style={s.sheetHeader}>
              <Text style={s.modalTitle}>Add New Lead</Text>
              <Pressable onPress={() => setShowAddLead(false)}><X size={22} color={colors.muted} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
              <LabeledInput label="Name *" placeholder="Client name" value={newLead.name} onChange={(v) => setNewLead((p) => ({ ...p, name: v }))} />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}><LabeledInput label="Phone *" placeholder="+91 XXXXX" value={newLead.phone} onChange={(v) => setNewLead((p) => ({ ...p, phone: v }))} keyboardType="phone-pad" /></View>
                <View style={{ flex: 1 }}><LabeledInput label="Alt. Number" placeholder="+91 XXXXX" value={newLead.altPhone} onChange={(v) => setNewLead((p) => ({ ...p, altPhone: v }))} keyboardType="phone-pad" /></View>
              </View>
              <LabeledInput label="Email" placeholder="client@email.com" value={newLead.email} onChange={(v) => setNewLead((p) => ({ ...p, email: v }))} keyboardType="email-address" />
              <LabeledInput label="Budget" placeholder="e.g. 50L - 80L" value={newLead.budget} onChange={(v) => setNewLead((p) => ({ ...p, budget: v }))} />

              <PillGroup label="Home Type" options={HOME_TYPES} selected={newLead.homeType} onSelect={(v) => setNewLead((p) => ({ ...p, homeType: v }))} />
              <PillGroup label="Buying Type" options={BUYING_TYPES} selected={newLead.buyingType} onSelect={(v) => setNewLead((p) => ({ ...p, buyingType: v }))} />

              <LabeledInput label="Location" placeholder="Area / City" value={newLead.location} onChange={(v) => setNewLead((p) => ({ ...p, location: v }))} />

              {/* Project Interest — from uploaded projects */}
              <View>
                <Text style={s.fieldLabel}>Project Interest</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {projectsList.map((p) => {
                    const active = newLead.project === p.name;
                    return (
                      <Pressable key={p.id} onPress={() => setNewLead((prev) => ({ ...prev, project: p.name }))} style={[s.pill, active ? s.pillActive : s.pillInactive]}>
                        <Text style={[s.pillText, { color: active ? '#fff' : colors.muted2 }]}>{p.name}</Text>
                      </Pressable>
                    );
                  })}
                  {projectsList.length === 0 && (
                    <LabeledInput label="" placeholder="Type project name" value={newLead.project} onChange={(v) => setNewLead((p) => ({ ...p, project: v }))} />
                  )}
                </View>
              </View>

              {/* Lead Type — Inbound vs Outbound */}
              <View>
                <Text style={s.fieldLabel}>Lead Type</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable
                    onPress={() => setNewLead((p) => ({ ...p, leadType: 'inbound' }))}
                    style={[s.leadTypeBtn, newLead.leadType === 'inbound' ? { backgroundColor: '#059669', borderColor: '#059669' } : { backgroundColor: colors.cream, borderColor: colors.line }]}
                  >
                    <Text style={[s.leadTypeTitle, { color: newLead.leadType === 'inbound' ? '#fff' : colors.muted2 }]}>Inbound</Text>
                    <Text style={[s.leadTypeSub, { color: newLead.leadType === 'inbound' ? '#fff' : colors.muted }]}>Client ne khud enquiry ki</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setNewLead((p) => ({ ...p, leadType: 'outbound' }))}
                    style={[s.leadTypeBtn, newLead.leadType === 'outbound' ? { backgroundColor: '#7C3AED', borderColor: '#7C3AED' } : { backgroundColor: colors.cream, borderColor: colors.line }]}
                  >
                    <Text style={[s.leadTypeTitle, { color: newLead.leadType === 'outbound' ? '#fff' : colors.muted2 }]}>Outbound</Text>
                    <Text style={[s.leadTypeSub, { color: newLead.leadType === 'outbound' ? '#fff' : colors.muted }]}>Cold / manually sourced</Text>
                  </Pressable>
                </View>
              </View>

              {/* Source with custom */}
              <PillGroup label="Source" options={SOURCES} selected={newLead.source} onSelect={(v) => setNewLead((p) => ({ ...p, source: v }))} />
              {newLead.source === 'Other' && (
                <LabeledInput label="" placeholder="Enter custom source" value={newLead.customSource} onChange={(v) => setNewLead((p) => ({ ...p, customSource: v }))} />
              )}

              {/* Stage */}
              <PillGroup label="Stage" options={PIPELINE_STAGES} selected={newLead.stage} onSelect={(v) => setNewLead((p) => ({ ...p, stage: v }))} />

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Pressable onPress={() => setShowAddLead(false)} style={s.cancelBtn}>
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={handleAddLead} disabled={!newLead.name || !newLead.phone || saving} style={[s.confirmBtn, { opacity: !newLead.name || !newLead.phone || saving ? 0.4 : 1 }]}>
                  <Text style={s.confirmBtnText}>{saving ? 'Adding…' : 'Add Lead'}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Helpers ──
function LabeledInput({ label, placeholder, value, onChange, keyboardType }: { label: string; placeholder: string; value: string; onChange: (v: string) => void; keyboardType?: any }) {
  return (
    <View>
      {label ? <Text style={s.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
        style={s.textInput}
      />
    </View>
  );
}

function PillGroup({ label, options, selected, onSelect }: { label: string; options: string[]; selected: string; onSelect: (v: string) => void }) {
  return (
    <View>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.map((opt) => {
          const active = selected === opt;
          return (
            <Pressable key={opt} onPress={() => onSelect(opt)} style={[s.pill, active ? s.pillActive : s.pillInactive]}>
              <Text style={[s.pillText, { color: active ? '#fff' : colors.muted2 }]}>{opt}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  outerCard: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: colors.ink },
  headerSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  advBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.line },
  advBtnText: { fontSize: 9, fontWeight: 'bold', color: colors.muted2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.brand, borderRadius: 8 },
  addBtnText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12 },
  searchInput: { flex: 1, paddingVertical: 10, paddingHorizontal: 8, fontSize: 13, color: colors.ink },
  filterPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  filterPillText: { fontSize: 10, fontWeight: 'bold' },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  pillActive: { backgroundColor: colors.brand },
  pillInactive: { backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line },
  pillText: { fontSize: 10, fontWeight: 'bold' },
  centerPad: { paddingVertical: 48, alignItems: 'center' },
  mutedSm: { fontSize: 13, color: colors.muted },
  brandBold: { fontSize: 11, fontWeight: 'bold', color: colors.brand },
  leadRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.white },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  leadName: { fontSize: 13, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  leadProject: { fontSize: 11, color: colors.muted2, marginTop: 2 },
  ownerLine: { fontSize: 9, color: colors.muted },
  ownerBold: { fontWeight: 'bold', color: colors.muted2 },
  assignBtn: { marginTop: 6, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line },
  assignBtnText: { fontSize: 9, fontWeight: 'bold', color: colors.muted2 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  alertText: { fontSize: 9, fontWeight: 'bold', color: '#DC2626' },
  alertScheduleBtn: { marginLeft: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#FEE2E2' },
  alertScheduleText: { fontSize: 8, fontWeight: 'bold', color: '#B91C1C' },
  dateText: { fontSize: 9, color: colors.muted },
  modalOverlayCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)', padding: 16 },
  modalOverlayBottom: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, width: '100%', padding: 24 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 15, fontWeight: 'bold', color: colors.ink },
  agentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.line },
  agentAvatar: { width: 32, height: 32, borderRadius: 999, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  leadChip: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, marginBottom: 12 },
  chipAvatar: { width: 36, height: 36, borderRadius: 999, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontSize: 11, fontWeight: 'bold', color: colors.muted2, marginBottom: 4 },
  textInput: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: colors.ink },
  cancelBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.line, alignItems: 'center' },
  cancelBtnText: { fontSize: 13, fontWeight: 'bold', color: colors.muted2 },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center' },
  confirmBtnText: { fontSize: 13, fontWeight: 'bold', color: '#fff' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.line },
  leadTypeBtn: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  leadTypeTitle: { fontSize: 11, fontWeight: 'bold' },
  leadTypeSub: { fontSize: 8, marginTop: 2 },
});
