import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  RefreshControl, TextInput, FlatList, Share, Modal, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Building2, Plus, Search,
  Pencil, LayoutTemplate, BarChart3, Link as LinkIcon, ExternalLink, Trash2, X,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { projectsApiExtended, Project, MarketplaceListing } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authContext';
import { useToast } from '../../src/components/Toast';
import { SkeletonCard } from '../../src/components/Skeleton';
import EmptyState from '../../src/components/EmptyState';
import MenuButton from '../../src/components/MenuButton';
import ProjectDetailsModal from '../../src/components/ProjectDetailsModal';
import ListingCard from '../../src/components/ListingCard';
import { ShareModal } from '../../src/components/ShareActions';
import { colors } from '../../src/theme';

const SITE_ORIGIN = 'https://homeintown.in';
// Web dashboard host (the "Advanced" web app). Edit Details / Layout Editor /
// per-project Analytics open the existing web routes here.
const WEB_DASHBOARD = 'https://sales.homeintown.in';
const visitUrlOf = (p: Project) => `${SITE_ORIGIN}${p.slug ? `/visit/${p.slug}` : ''}`;

// Render a Project through the shared marketplace ListingCard. The card's helpers
// accept the flat Project shape directly, so we wrap it in a loose listing object
// and flag it `isStd` (renders as a plain project card: STD badge, no commission).
function projectToListing(p: Project): MarketplaceListing {
  return {
    id: p.id,
    isStd: true,
    listingType: 'selling',
    commissionType: 'percentage',
    commissionValue: 0,
    status: 'Active',
    project: p as any,
  } as any;
}

// ── Project 3-dot menu (bottom sheet). Options mirror the website exactly. ──
function ProjectMenuSheet({ project, onClose, onEdit, onLayout, onAnalytics, onCopyLink, onVisit, onDelete }: {
  project: Project | null;
  onClose: () => void;
  onEdit: (p: Project) => void;
  onLayout: (p: Project) => void;
  onAnalytics: (p: Project) => void;
  onCopyLink: (p: Project) => void;
  onVisit: (p: Project) => void;
  onDelete: (p: Project) => void;
}) {
  if (!project) return null;
  // Visibility mirrors the website (ProjectTable kebab): Analytics + Visit only
  // appear for a published project; Visit also needs a slug.
  const items = [
    { label: 'Edit Details', icon: <Pencil size={17} color={colors.ink} />, onPress: () => onEdit(project), show: true },
    { label: 'Layout Editor', icon: <LayoutTemplate size={17} color={colors.ink} />, onPress: () => onLayout(project), show: true },
    { label: 'View Analytics', icon: <BarChart3 size={17} color={colors.ink} />, onPress: () => onAnalytics(project), show: !!project.isPublished },
    { label: 'Copy Project Link', icon: <LinkIcon size={17} color={colors.ink} />, onPress: () => onCopyLink(project), show: true },
    { label: 'Visit Project ↗', icon: <ExternalLink size={17} color={colors.ink} />, onPress: () => onVisit(project), show: !!project.isPublished && !!project.slug },
    { label: 'Delete Project', icon: <Trash2 size={17} color={colors.redText} />, danger: true, onPress: () => onDelete(project), show: true },
  ].filter(it => it.show);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={km.overlay} onPress={onClose}>
        <Pressable style={km.sheet} onPress={() => {}}>
          <View style={km.handle} />
          <View style={km.head}>
            <Text style={km.headTitle} numberOfLines={1}>{project.name}</Text>
            <Pressable onPress={onClose} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
          </View>
          {items.map((it) => (
            <Pressable key={it.label} style={km.row} onPress={() => { onClose(); setTimeout(it.onPress, 60); }}>
              <View style={km.rowIcon}>{it.icon}</View>
              <Text style={[km.rowLabel, it.danger && { color: colors.redText }]}>{it.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const km = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 12, paddingBottom: 28, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6, paddingBottom: 6 },
  headTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.ink, marginRight: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: colors.line },
  rowIcon: { width: 24, alignItems: 'center' },
  rowLabel: { fontSize: 14, fontWeight: '700', color: colors.ink },
});

// Filter chip labels
const STATUS_LABEL: Record<string, string> = {
  All: 'All',
  'pre-launch': 'Pre Launch',
  'under-construction': 'Under Construction',
  ready: 'Ready',
};

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
  const [deleting, setDeleting] = useState<string | null>(null);
  const [detailProject, setDetailProject] = useState<Project | null>(null);
  const [shareProject, setShareProject] = useState<Project | null>(null);
  const [menuProject, setMenuProject] = useState<Project | null>(null);
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});

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

  // Live buyer-match counts for the card badge (same source as marketplace).
  useEffect(() => {
    const ids = projects.map(p => p.id).filter(Boolean);
    if (ids.length === 0) return;
    let cancelled = false;
    projectsApiExtended.matchCounts(ids)
      .then(counts => { if (!cancelled) setMatchCounts(prev => ({ ...prev, ...counts })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projects]);

  const handleDelete = async (p: Project) => {
    setDeleting(p.id);
    try {
      await projectsApiExtended.delete(p.id);
      setProjects(prev => prev.filter(x => x.id !== p.id));
      toast.show('Deleted', 'success');
    } catch (e: any) { toast.show(e?.message || 'Delete failed', 'error'); }
    finally { setDeleting(null); }
  };

  const handleCopyLink = async (p: Project) => {
    const url = visitUrlOf(p);
    try {
      await Share.share({ message: url, url });
    } catch { /* user dismissed */ }
  };

  // ── 3-dot menu actions ──
  // Edit Details, Layout Editor and per-project Analytics reuse the EXISTING web
  // dashboard implementations (there is no native RN screen for these). We open
  // the same authenticated routes the website uses, via the browser — the same
  // pattern the app already uses for the CRM "Advanced" panel and visit links.
  // Publish (draft → live) lives inside the web edit form, so it is preserved
  // there. Web dashboard host: https://sales.homeintown.in
  const openWeb = async (path: string) => {
    try { await Linking.openURL(`${WEB_DASHBOARD}${path}`); }
    catch { toast.show('Could not open link', 'error'); }
  };
  const handleEdit = (p: Project) => openWeb(`/dashboard/projects/${p.id}/edit`);
  const handleLayout = (p: Project) => openWeb(`/dashboard/projects/${p.id}/layout-editor`);
  const handleAnalytics = (p: Project) => openWeb(`/dashboard/analytics/${p.id}`);
  const handleVisit = async (p: Project) => {
    const url = visitUrlOf(p);
    try { await Linking.openURL(url); }
    catch { toast.show('Could not open link', 'error'); }
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
          {canCreate && (
            <Pressable style={s.addBtn} onPress={() => router.push('/(dashboard)/add-project' as any)}>
              <Plus size={15} color="#fff" />
              <Text style={s.addBtnText}>New</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Search + Filters scroll WITH the list (ListHeaderComponent).
          Project cards render through the shared marketplace ListingCard. */}
      {loading ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          {listHeader}
          {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
        </ScrollView>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={p => p.id}
          ListHeaderComponent={listHeader}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }}
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
            <ListingCard
              l={projectToListing(p)}
              matchCount={matchCounts[p.id] || 0}
              onView={() => setDetailProject(p)}
              onShare={() => setShareProject(p)}
              onMenu={() => setMenuProject(p)}
            />
          )}
        />
      )}

      {/* Full project details popup */}
      <ProjectDetailsModal project={detailProject} onClose={() => setDetailProject(null)} />

      {/* Share sheet (Copy link, QR, brochure/PDF) */}
      {shareProject && <ShareModal project={shareProject} onClose={() => setShareProject(null)} />}

      {/* 3-dot menu (Edit / Layout / Analytics / Copy link / Visit / Delete) */}
      <ProjectMenuSheet
        project={menuProject}
        onClose={() => setMenuProject(null)}
        onEdit={handleEdit}
        onLayout={handleLayout}
        onAnalytics={handleAnalytics}
        onCopyLink={handleCopyLink}
        onVisit={handleVisit}
        onDelete={handleDelete}
      />
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
