import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  RefreshControl, Image, TextInput, FlatList, Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Building2, Plus, Search, CheckCircle, Trash2,
  LayoutGrid, List, MapPin, Link as LinkIcon, Info,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { projectsApiExtended, Project } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authContext';
import { useToast } from '../../src/components/Toast';
import { SkeletonCard, SkeletonRow } from '../../src/components/Skeleton';
import EmptyState from '../../src/components/EmptyState';
import MenuButton from '../../src/components/MenuButton';
import ProjectDetailsModal from '../../src/components/ProjectDetailsModal';
import { colors } from '../../src/theme';

function fmtPrice(n: number): string {
  if (!n) return '—';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(0)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function getCoverUrl(p: Project): string | null {
  if (!p.coverImage) return null;
  return typeof p.coverImage === 'string' ? p.coverImage : (p.coverImage as any).url ?? null;
}

// Filter chip labels
const STATUS_LABEL: Record<string, string> = {
  All: 'All',
  'pre-launch': 'Pre Launch',
  'under-construction': 'Under Construction',
  ready: 'Ready',
};

// Human-readable property label (mirrors web getPropertyLabel)
function propertyLabel(p: Project): string {
  if (p.propertyType) return p.propertyType;
  if (p.category) return p.category;
  if (p.type === 'plot') return 'Plot';
  return 'Apartment';
}

// ── Grid Card (matches website ProjectGrid) ─────────────────
function GridCard({ p, onPublish, onDelete, onCopyLink, onDetails, publishing, deleting }: {
  p: Project; onPublish: (p: Project) => void; onDelete: (p: Project) => void;
  onCopyLink: (p: Project) => void; onDetails: (p: Project) => void;
  publishing: string | null; deleting: string | null;
}) {
  const cover = getCoverUrl(p);
  return (
    <View style={gc.card}>
      {/* Header: Name + location */}
      <View style={gc.head}>
        <Text style={gc.name} numberOfLines={2}>{p.name}</Text>
        <View style={gc.locationRow}>
          <MapPin size={13} color={colors.brand} />
          <Text style={gc.locationText} numberOfLines={1}>
            {p.location ? `${p.location}, ` : ''}{p.city}
          </Text>
        </View>
      </View>

      {/* Cover image */}
      {cover ? (
        <Image source={{ uri: cover }} style={gc.img} resizeMode="cover" />
      ) : (
        <View style={[gc.img, gc.noImg]}>
          <Building2 size={30} color={colors.muted} />
          <Text style={gc.noImgText}>No Image</Text>
        </View>
      )}

      {/* Details */}
      <View style={gc.body}>
        <View style={gc.pubRow}>
          <View style={[gc.pubBadge, p.isPublished ? gc.pubBadgeLive : gc.pubBadgeDraft]}>
            <Text style={[gc.pubBadgeText, { color: p.isPublished ? colors.greenText : colors.muted2 }]}>
              {p.isPublished ? 'Published' : 'Draft'}
            </Text>
          </View>
          <Text style={gc.price}>{fmtPrice(p.startingPrice)}</Text>
        </View>

        {p.reraApproved && (
          <View style={gc.reraStrip}>
            <CheckCircle size={13} color={colors.brand} />
            <Text style={gc.reraText}>RERA VERIFIED</Text>
          </View>
        )}
      </View>

      {/* Actions: Details (primary) + Publish-tick (if draft) / Copy Link (if live) */}
      <View style={gc.actions}>
        <Pressable onPress={() => onDetails(p)} style={[gc.actionBtn, gc.detailsBtn]}>
          <Info size={14} color="#fff" />
          <Text style={gc.detailsBtnText}>Details</Text>
        </Pressable>

        {!p.isPublished ? (
          <Pressable onPress={() => onPublish(p)} disabled={publishing === p.id} style={[gc.iconAction, gc.approveAction]}>
            <CheckCircle size={17} color={colors.greenText} />
          </Pressable>
        ) : (
          <Pressable onPress={() => onCopyLink(p)} style={[gc.iconAction, gc.linkAction]}>
            <LinkIcon size={16} color={colors.brand} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const gc = StyleSheet.create({
  card: { flex: 1, backgroundColor: colors.white, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  head: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  name: { fontSize: 16, fontWeight: '800', color: colors.ink, letterSpacing: -0.3, marginBottom: 4 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  locationText: { fontSize: 11, color: colors.muted2, fontWeight: '600', flex: 1 },
  img: { width: '100%', height: 150 },
  noImg: { backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center', gap: 6 },
  noImgText: { fontSize: 9, color: colors.muted, fontWeight: '700', letterSpacing: 1 },
  body: { padding: 16, gap: 12 },
  pubRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pubBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  pubBadgeLive: { backgroundColor: colors.greenBg, borderColor: colors.greenBorder },
  pubBadgeDraft: { backgroundColor: colors.cream, borderColor: colors.line },
  pubBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  price: { fontSize: 18, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  infoGrid: { flexDirection: 'row', gap: 10 },
  infoBox: { flex: 1, backgroundColor: colors.cream, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 10 },
  infoLabel: { fontSize: 8, fontWeight: '800', color: colors.muted, letterSpacing: 1, marginBottom: 3 },
  infoValue: { fontSize: 11.5, fontWeight: '800', color: colors.ink },
  reraStrip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: `${colors.brand}22`, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  reraText: { fontSize: 9, fontWeight: '800', color: colors.brand, letterSpacing: 1.5 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: `${colors.cream}80` },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12 },
  detailsBtn: { backgroundColor: colors.brand },
  detailsBtnText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  iconAction: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1 },
  approveAction: { backgroundColor: colors.greenBg, borderColor: colors.greenBorder },
  linkAction: { backgroundColor: colors.white, borderColor: colors.line },
});

// ── List Row ───────────────────────────────────────────────
function ListRow({ p, onPublish, onDelete, onDetails, publishing, deleting }: {
  p: Project; onPublish: (p: Project) => void; onDelete: (p: Project) => void;
  onDetails: (p: Project) => void; publishing: string | null; deleting: string | null;
}) {
  const cover = getCoverUrl(p);
  const STATUS_C: Record<string, { bg: string; text: string }> = {
    'pre-launch': { bg: colors.amberBg, text: colors.amberText },
    'under-construction': { bg: colors.blueBg, text: colors.blueText },
    'ready': { bg: colors.greenBg, text: colors.greenText },
    'ready-to-move': { bg: colors.greenBg, text: colors.greenText },
  };
  const sc = STATUS_C[p.projectStatus] || { bg: colors.slateBg, text: colors.slateText };
  return (
    <View style={lr.row}>
      {cover ? (
        <Image source={{ uri: cover }} style={lr.thumb} resizeMode="cover" />
      ) : (
        <View style={[lr.thumb, lr.noThumb]}><Building2 size={20} color={colors.muted} /></View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={lr.name} numberOfLines={1}>{p.name}</Text>
          <View style={[lr.badge, { backgroundColor: sc.bg }]}>
            <Text style={[lr.badgeText, { color: sc.text }]}>{p.projectStatus}</Text>
          </View>
        </View>
        <Text style={lr.sub}>{p.city}{p.location ? ` · ${p.location}` : ''}</Text>
        <Text style={lr.price}>{fmtPrice(p.startingPrice)}</Text>
      </View>
      <View style={lr.actions}>
        {!p.isPublished && (
          <Pressable onPress={() => onPublish(p)} disabled={publishing === p.id}
            style={[lr.btn, { backgroundColor: colors.greenBg, borderColor: colors.greenBorder }]}>
            <CheckCircle size={15} color={colors.greenText} />
          </Pressable>
        )}
        <Pressable onPress={() => onDetails(p)} style={lr.detailsBtn}>
          <Info size={14} color="#fff" />
          <Text style={lr.detailsText}>Details</Text>
        </Pressable>
      </View>
    </View>
  );
}

const lr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 10 },
  thumb: { width: 72, height: 72, borderRadius: 10 },
  noThumb: { backgroundColor: colors.slateBg, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 13, fontWeight: '700', color: colors.ink, flex: 1 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 8, fontWeight: '800' },
  sub: { fontSize: 10, color: colors.muted2 },
  price: { fontSize: 12, fontWeight: '800', color: colors.brand },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: { padding: 9, borderRadius: 10, borderWidth: 1 },
  detailsBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.brand, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
  detailsText: { fontSize: 11.5, fontWeight: '800', color: '#fff' },
});

// ── Main Screen ────────────────────────────────────────────
export default function ProjectsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [publishing, setPublishing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [detailProject, setDetailProject] = useState<Project | null>(null);

  const canCreate = ['admin', 'builder'].includes(user?.role ?? '');

  const load = useCallback(async () => {
    try {
      const data = await projectsApiExtended.getAll();
      setProjects(data);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to load projects', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePublish = async (p: Project) => {
    setPublishing(p.id);
    try {
      await projectsApiExtended.publish(p.id);
      toast.show('Published! 🎉', 'success');
      load();
    } catch (e: any) { toast.show(e?.message || 'Publish failed', 'error'); }
    finally { setPublishing(null); }
  };

  const handleDelete = async (p: Project) => {
    setDeleting(p.id);
    try {
      await projectsApiExtended.delete(p.id);
      setProjects(prev => prev.filter(x => x.id !== p.id));
      toast.show('Deleted', 'success');
    } catch (e: any) { toast.show(e?.message || 'Delete failed', 'error'); }
    finally { setDeleting(null); }
  };

  const SITE_ORIGIN = 'https://homeintown.in';
  const handleCopyLink = async (p: Project) => {
    const path = p.slug ? `/visit/${p.slug}` : '';
    const url = `${SITE_ORIGIN}${path}`;
    try {
      await Share.share({ message: url, url });
    } catch { /* user dismissed */ }
  };

  const statuses = ['All', 'pre-launch', 'under-construction', 'ready'];

  const filtered = projects.filter(p => {
    const matchS = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.city?.toLowerCase().includes(search.toLowerCase());
    const matchSt = statusFilter === 'All' || p.projectStatus === statusFilter;
    return matchS && matchSt;
  });

  const published = filtered.filter(p => p.isPublished).length;
  const drafts = filtered.length - published;

  // Search + filter chips — rendered as the scrollable list header so they
  // move together with the project cards.
  const listHeader = (
    <View style={{ paddingTop: 12 }}>
      <View style={s.searchWrap}>
        <Search size={15} color={colors.muted} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search name or city..."
          placeholderTextColor={colors.muted} style={s.searchInput} />
        {search ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Text style={{ color: colors.muted, fontSize: 17 }}>×</Text></Pressable> : null}
      </View>

      <View style={s.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterContent}>
          {statuses.map(st => (
            <Pressable key={st} onPress={() => setStatusFilter(st)}
              style={[s.pill, statusFilter === st && s.pillActive]}>
              <Text style={[s.pillText, statusFilter === st && s.pillTextActive]} numberOfLines={1}>
                {STATUS_LABEL[st] ?? st}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
          <MenuButton />
          <View>
            <Text style={s.title}>Projects</Text>
            <Text style={s.sub}>
              Total: {filtered.length}  ·  <Text style={{ color: colors.greenText }}>Published: {published}</Text>  ·  <Text style={{ color: colors.muted2 }}>Draft: {drafts}</Text>
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {/* View toggle */}
          <Pressable onPress={() => setViewMode(v => v === 'grid' ? 'list' : 'grid')} style={s.iconBtn}>
            {viewMode === 'grid'
              ? <List size={17} color={colors.muted2} />
              : <LayoutGrid size={17} color={colors.muted2} />}
          </Pressable>
          {canCreate && (
            <Pressable style={s.addBtn} onPress={() => router.push('/(dashboard)/add-project' as any)}>
              <Plus size={15} color="#fff" />
              <Text style={s.addBtnText}>New</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Search + Filters scroll WITH the list (ListHeaderComponent) */}
      {loading ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          {listHeader}
          {viewMode === 'grid'
            ? [0,1,2].map(i => <SkeletonCard key={i} />)
            : [0,1,2,3].map(i => <SkeletonRow key={i} />)}
        </ScrollView>
      ) : viewMode === 'grid' ? (
        <FlatList
          data={filtered}
          keyExtractor={p => p.id}
          ListHeaderComponent={listHeader}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 16 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          ListEmptyComponent={
            <EmptyState
              icon={<Building2 size={28} color={colors.muted} />}
              title="No projects found"
              subtitle="Try adjusting your search or filters."
              actionLabel={canCreate ? 'Create Project' : undefined}
            />
          }
          renderItem={({ item: p }) => (
            <GridCard p={p} onPublish={handlePublish} onDelete={handleDelete}
              onCopyLink={handleCopyLink} onDetails={setDetailProject}
              publishing={publishing} deleting={deleting} />
          )}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={p => p.id}
          ListHeaderComponent={listHeader}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 10 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          ListEmptyComponent={
            <EmptyState
              icon={<Building2 size={28} color={colors.muted} />}
              title="No projects found"
              subtitle="Try adjusting your search or filters."
            />
          }
          renderItem={({ item: p }) => (
            <ListRow p={p} onPublish={handlePublish} onDelete={handleDelete}
              onDetails={setDetailProject} publishing={publishing} deleting={deleting} />
          )}
        />
      )}

      {/* Full project details popup */}
      <ProjectDetailsModal project={detailProject} onClose={() => setDetailProject(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 21, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 11, color: colors.muted, marginTop: 1 },
  iconBtn: { padding: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.brand, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 },
  searchInput: { flex: 1, fontSize: 13, color: colors.ink },
  filterBar: { paddingTop: 6, paddingBottom: 12, marginHorizontal: -16 },
  filterContent: { gap: 8, paddingHorizontal: 16, alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 34, paddingHorizontal: 16, borderRadius: 17, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  pillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  pillText: { fontSize: 11.5, fontWeight: '700', color: colors.muted2 },
  pillTextActive: { color: '#fff' },
});
