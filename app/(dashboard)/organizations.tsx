import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable, TextInput, RefreshControl, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Building, Plus, Trash2, X } from 'lucide-react-native';
import { organizationsApi, Organization } from '../../src/lib/api';
import { useToast } from '../../src/components/Toast';
import MenuButton from '../../src/components/MenuButton';
import { colors } from '../../src/theme';

export default function OrganizationsScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selected, setSelected] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await organizationsApi.getAll();
      setOrgs(data);
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.show('Name required', 'error'); return; }
    setCreating(true);
    try {
      const org = await organizationsApi.create({ name: form.name.trim(), description: form.description.trim() });
      setOrgs(prev => [org, ...prev]);
      setForm({ name: '', description: '' });
      setShowCreate(false);
      toast.show('Created!', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await organizationsApi.delete(id);
      setOrgs(prev => prev.filter(o => o.id !== id));
      if (selected?.id === id) setSelected(null);
      toast.show('Deleted', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
          <MenuButton />
          <View>
            <Text style={s.title}>Organizations</Text>
            <Text style={s.sub}>{orgs.length} total</Text>
          </View>
        </View>
        <Pressable onPress={() => setShowCreate(true)} style={s.addBtn}>
          <Plus size={16} color="#fff" />
          <Text style={s.addBtnText}>New</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
        >
          {orgs.length === 0 ? (
            <View style={s.empty}><Building size={32} color={colors.muted} /><Text style={s.emptyText}>No organizations yet</Text></View>
          ) : orgs.map(org => (
            <Pressable key={org.id} onPress={() => setSelected(selected?.id === org.id ? null : org)} style={[s.card, selected?.id === org.id && s.cardActive]}>
              <View style={s.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardName}>{org.name}</Text>
                  {org.description ? <Text style={s.cardDesc} numberOfLines={1}>{org.description}</Text> : null}
                </View>
                <Pressable onPress={() => handleDelete(org.id)} disabled={deleting === org.id} style={s.deleteBtn}>
                  {deleting === org.id ? <ActivityIndicator size="small" color={colors.redText} /> : <Trash2 size={14} color={colors.redText} />}
                </Pressable>
              </View>

              <View style={s.metaRow}>
                <Text style={s.metaText}>{org.projects.length} projects</Text>
                <Text style={s.metaText}>{org.agents.length} agents</Text>
              </View>

              {selected?.id === org.id && (
                <View style={s.detail}>
                  {org.projects.length > 0 && (
                    <View>
                      <Text style={s.detailLabel}>Projects</Text>
                      {org.projects.map(p => (
                        <Text key={p.id} style={s.detailItem}>• {p.name}{p.city ? ` — ${p.city}` : ''}</Text>
                      ))}
                    </View>
                  )}
                  {org.agents.length > 0 && (
                    <View>
                      <Text style={s.detailLabel}>Agents</Text>
                      <View style={s.agentChips}>
                        {org.agents.map(a => (
                          <View key={a.id} style={s.agentChip}>
                            <Text style={s.agentChipText}>{a.name}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Create Modal */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCreate(false)}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>New Organization</Text>
            <Pressable onPress={() => setShowCreate(false)}><X size={22} color={colors.ink} /></Pressable>
          </View>
          <View style={{ padding: 16, gap: 14 }}>
            <View style={{ gap: 6 }}>
              <Text style={s.fieldLabel}>Name *</Text>
              <TextInput value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} placeholder="Organization name" placeholderTextColor={colors.muted} style={s.input} />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={s.fieldLabel}>Description</Text>
              <TextInput value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))} multiline placeholder="Short description..." placeholderTextColor={colors.muted} style={[s.input, { height: 80, textAlignVertical: 'top' }]} />
            </View>
            <Pressable onPress={handleCreate} disabled={creating} style={[s.createBtn, creating && { opacity: 0.6 }]}>
              {creating ? <ActivityIndicator color="#fff" /> : <Text style={s.createBtnText}>Create</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 21, fontWeight: 'bold', color: colors.ink },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brand, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 14, color: colors.muted },
  card: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 10 },
  cardActive: { borderColor: colors.brand, borderWidth: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  cardDesc: { fontSize: 11, color: colors.muted2, marginTop: 2 },
  deleteBtn: { padding: 6 },
  metaRow: { flexDirection: 'row', gap: 14 },
  metaText: { fontSize: 11, color: colors.muted2, fontWeight: '600' },
  detail: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, gap: 10 },
  detailLabel: { fontSize: 11, fontWeight: '700', color: colors.muted2, textTransform: 'uppercase', marginBottom: 4 },
  detailItem: { fontSize: 12, color: colors.ink, paddingVertical: 2 },
  agentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  agentChip: { backgroundColor: colors.brandTint, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  agentChipText: { fontSize: 11, fontWeight: '600', color: colors.brand },
  modal: { flex: 1, backgroundColor: colors.cream },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  modalTitle: { fontSize: 17, fontWeight: 'bold', color: colors.ink },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.ink },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13, color: colors.ink, backgroundColor: colors.white },
  createBtn: { backgroundColor: colors.brand, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  createBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
