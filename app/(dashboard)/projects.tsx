import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  RefreshControl, TextInput, FlatList, Share, Modal, Linking, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Building2, Plus, Search,
  Pencil, LayoutTemplate, BarChart3, Link as LinkIcon, ExternalLink, Trash2, X, UserPlus,
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

// ── Project 3-dot menu rows. Options mirror the website exactly. ──
// This is now a plain CONTENT component: it renders no RN Modal and no overlay of
// its own. PREVIOUS BEHAVIOUR / WHY it was wrong: it owned an RN Modal, and so
// did the picker (then AssignmentPickerModal), so tapping "Assign Captain" ran
// `onClose(); setTimeout(it.onPress, 60)` — the menu's modal unmounted
// synchronously while its slide-out animation was still running and the picker's
// separate modal was mounted 60 ms later, on top of a dismissing dialog. On
// Android a modal opened out of a dismissing modal does not reliably appear,
// which is exactly why the two assignment rows looked like dead buttons while
// every other row worked (the others open a native Alert or leave the app, so
// this was the screen's only modal-from-modal path). Both bodies now live inside
// one host Modal in ProjectsScreen and simply swap in place.
function ProjectMenuBody({ project, user, onClose, onEdit, onLayout, onAnalytics, onCopyLink, onVisit, onDelete, onAssignCaptain, onAssignAgent }: {
  project: Project;
  user: { role?: string } | null;
  onClose: () => void;
  onEdit: (p: Project) => void;
  onLayout: (p: Project) => void;
  onAnalytics: (p: Project) => void;
  onCopyLink: (p: Project) => void;
  onVisit: (p: Project) => void;
  onDelete: (p: Project) => void;
  onAssignCaptain: (p: Project) => void;
  onAssignAgent: (p: Project) => void;
}) {
  // Role gate — the record of WHY, corrected. An earlier comment here claimed the
  // assignment rows were invisible because of role CASING ('Admin' vs 'admin'),
  // and commit c1f266c added .toLowerCase() on that theory. That was a no-op:
  // HIT_Backend/models/User.js:15 declares the role enum
  // ['admin','builder','agent','unassigned','user','employee','captain'] — already
  // all lowercase — which is precisely why it fixed nothing. The normalisation is
  // kept only as cheap defence against stray whitespace/casing from storage.
  // What the gate really does: a `builder` (the role that can create projects) sees
  // NEITHER row, and that is correct — GET /projects/captains is restrictTo('admin')
  // and GET /projects/my-agents is restrictTo('captain'), so a builder has nothing
  // to pick from. This gate is PRESENTATION ONLY; restrictTo in
  // HIT_Backend/middleware/auth.js is the actual boundary.
  const userRole = (user?.role || '').toString().trim().toLowerCase();
  const isAdmin = userRole === 'admin';
  const isCaptain = userRole === 'captain';

  // Visibility mirrors the website (ProjectTable kebab): Analytics + Visit only
  // appear for a published project; Visit also needs a slug.
  // Assignment is role-gated: admin sees "Assign Captain", captain sees "Assign Agent".
  // The .filter(show) leaves a non-admin/non-captain with no row at all, not a
  // disabled one.
  // The two assignment labels carry the CURRENT assignment when there is one, so the
  // result of an assignment is observable with no reload (handleAssignSubmit patches
  // `projects` state). ListingCard was deliberately NOT changed: it is shared with the
  // marketplace, AI and CRM surfaces, so an assignee line there would alter four
  // screens for one feature — and the 3-dot menu is where the user looks right after
  // assigning anyway.
  //
  // The role check on `owner` is load-bearing, not defensive. Server-side `owner`
  // means "creator OR assigned captain": ProjectController.create (:202) sets
  // `owner = user.id` for any builder/agent/admin/captain creator, and only
  // ProjectService.assignCaptainToProject (:188) overwrites it with the captain.
  // An admin's getAll returns EVERY project, and admin is the only role this row is
  // shown to, so reading `owner.name` unconditionally — which is what this line did
  // first — printed `Captain: <builder name> · Change` on projects that have never
  // had a captain, asserting an assignment the database does not contain. `role` is
  // already on the populated owner (ProjectRepository.js:17 populates
  // 'name role companyName phone') so the gate costs no extra request. `assignedAgent`
  // needs no equivalent: nothing but assign-agent ever writes it.
  const captainName = project.owner?.role === 'captain' ? project.owner.name : undefined;
  const agentName = project.assignedAgent?.name;
  const items = [
    { key: 'edit', label: 'Edit Details', icon: <Pencil size={17} color={colors.ink} />, onPress: () => onEdit(project), show: true },
    { key: 'layout', label: 'Layout Editor', icon: <LayoutTemplate size={17} color={colors.ink} />, onPress: () => onLayout(project), show: true },
    { key: 'analytics', label: 'View Analytics', icon: <BarChart3 size={17} color={colors.ink} />, onPress: () => onAnalytics(project), show: !!project.isPublished },
    { key: 'assign-captain', label: captainName ? `Captain: ${captainName} · Change` : 'Assign Captain', icon: <UserPlus size={17} color={colors.ink} />, onPress: () => onAssignCaptain(project), show: isAdmin },
    { key: 'assign-agent', label: agentName ? `Agent: ${agentName} · Change` : 'Assign Agent', icon: <UserPlus size={17} color={colors.ink} />, onPress: () => onAssignAgent(project), show: isCaptain },
    { key: 'copy', label: 'Copy Project Link', icon: <LinkIcon size={17} color={colors.ink} />, onPress: () => onCopyLink(project), show: true },
    { key: 'visit', label: 'Visit Project ↗', icon: <ExternalLink size={17} color={colors.ink} />, onPress: () => onVisit(project), show: !!project.isPublished && !!project.slug },
    { key: 'delete', label: 'Delete Project', icon: <Trash2 size={17} color={colors.redText} />, danger: true, onPress: () => onDelete(project), show: true },
  ].filter(it => it.show);
  return (
    <>
      <View style={km.handle} />
      <View style={km.head}>
        <Text style={km.headTitle} numberOfLines={1}>{project.name}</Text>
        <Pressable onPress={onClose} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
      </View>
      {items.map((it) => (
        // Direct call, no onClose() + setTimeout: the rows that leave the screen
        // close the sheet themselves (see handleEdit/.../handleDelete) and the two
        // assignment rows swap this body for the picker inside the same modal.
        <Pressable key={it.key} style={km.row} onPress={it.onPress}>
          <View style={km.rowIcon}>{it.icon}</View>
          <Text style={[km.rowLabel, it.danger && { color: colors.redText }]} numberOfLines={1}>{it.label}</Text>
        </Pressable>
      ))}
    </>
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
  // flex: 1 so the longer "Captain: <name> · Change" label truncates inside the
  // row instead of pushing the row wider than the sheet.
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink },
});

// A candidate for assignment. getCaptains() carries companyName, getMyAgents()
// does not — HIT_Backend ProjectController.getMyAgents (:779) selects only
// `_id name phone` on role 'employee' users, so a captain's assignable "agents"
// are employees and they have no company to show.
type AssignCandidate = { id: string; name: string; companyName?: string };

// ── Assignment picker body (Captain or Agent) ──
// Role-based assignment picker: admin assigns captain, captain assigns agent.
// API endpoints were already present (/projects/:id/assign-captain and assign-agent)
// but had no mobile UI until now. Previous behavior: assignments could only be
// done via the web dashboard.
// Like ProjectMenuBody this is now a plain content component — no RN Modal, no
// overlay — because the two stacked modals were what broke the whole path.
function AssignmentPickerBody({ mode, onClose, onAssign }: {
  mode: 'captain' | 'agent';
  onClose: () => void;
  onAssign: (u: AssignCandidate) => Promise<void>;
}) {
  const [users, setUsers] = useState<AssignCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Per-row busy state. Previously the sheet was closed before the PUT was even
  // sent (`onAssign(u.id); onClose();`), so a slow network looked like yet another
  // dead tap; now the row shows a spinner and the list is disabled until it lands.
  const [assigning, setAssigning] = useState<string | null>(null);
  const toast = useToast();

  // Explicit states instead of the old "toast on failure, then a body that says
  // 'No captains available'" — which lied, because the list was empty only
  // because the request had failed. Now: loading / error+Retry / empty / no match.
  const fetchCandidates = useCallback(() => {
    setLoading(true);
    setError(null);
    (mode === 'captain' ? projectsApiExtended.getCaptains() : projectsApiExtended.getMyAgents())
      .then(data => { setUsers(data); setError(null); })
      .catch(e => {
        // The user initiated this, so the rejection is never swallowed: a toast for
        // immediacy plus an in-sheet message with Retry so it stays actionable.
        const msg = e?.message || 'Failed to load';
        setUsers([]);
        setError(msg);
        toast.show(msg, 'error');
      })
      .finally(() => setLoading(false));
  }, [mode]);

  useEffect(() => { setSearch(''); fetchCandidates(); }, [fetchCandidates]);

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    (u.companyName && u.companyName.toLowerCase().includes(search.toLowerCase()))
  );

  const pick = async (u: AssignCandidate) => {
    if (assigning) return;
    setAssigning(u.id);
    // onAssign resolves either way (it toasts its own failure) and closes the sheet
    // only on success, so clearing here just re-enables the rows for a retry.
    try { await onAssign(u); } finally { setAssigning(null); }
  };

  return (
    <>
      <View style={km.handle} />
      <View style={km.head}>
        <Text style={km.headTitle}>
          {mode === 'captain' ? 'Assign Captain' : 'Assign Agent'}
        </Text>
        <Pressable onPress={onClose} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
      </View>

      {/* Search input */}
      <View style={apm.searchWrap}>
        <Search size={15} color={colors.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name..."
          placeholderTextColor={colors.muted}
          style={apm.searchInput}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <Text style={{ color: colors.muted, fontSize: 17 }}>×</Text>
          </Pressable>
        ) : null}
      </View>

      {/* User list */}
      {loading ? (
        <View style={apm.emptyWrap}>
          <ActivityIndicator size="small" color={colors.brand} />
        </View>
      ) : error ? (
        <View style={apm.emptyWrap}>
          <Text style={apm.emptyText}>{error}</Text>
          <Pressable style={apm.retryBtn} onPress={fetchCandidates}>
            <Text style={apm.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : users.length === 0 ? (
        <View style={apm.emptyWrap}>
          <Text style={apm.emptyText}>
            {mode === 'captain' ? 'No captains available' : 'No agents in your team'}
          </Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={apm.emptyWrap}>
          <Text style={apm.emptyText}>No matches</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={u => u.id}
          // flexShrink: 1 — the sheet is content-sized with maxHeight 70% and RN
          // defaults children to flexShrink: 0, so with no style at all this list
          // laid itself out at the full height of every row and the sheet's clamp
          // simply cropped the bottom off, unreachable. `flex: 1` would instead
          // lay it out at height 0. Same fix, same reason, as the three precedents
          // in src/components/GroupChatEmbedded.tsx: the group-info FlatList (~5480),
          // the My Posts ScrollView (~5148) and the Your Matches ScrollView (~6090).
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ paddingVertical: 8 }}
          extraData={assigning}
          renderItem={({ item: u }) => {
            const busy = assigning === u.id;
            return (
              <Pressable
                style={[apm.userRow, !!assigning && !busy && { opacity: 0.45 }]}
                disabled={!!assigning}
                onPress={() => pick(u)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={apm.userName}>{u.name}</Text>
                  {u.companyName ? <Text style={apm.userCompany}>{u.companyName}</Text> : null}
                </View>
                {busy ? <ActivityIndicator size="small" color={colors.brand} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </>
  );
}

const apm = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 6,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 13, color: colors.ink },
  emptyWrap: { paddingVertical: 40, alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 13, color: colors.muted, textAlign: 'center', paddingHorizontal: 16 },
  retryBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.brand },
  retryText: { fontSize: 12.5, fontWeight: '700', color: colors.brand },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  userName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  userCompany: { fontSize: 12, color: colors.muted, marginTop: 2 },
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
  const [assignProject, setAssignProject] = useState<Project | null>(null);
  const [assignMode, setAssignMode] = useState<'captain' | 'agent' | null>(null);

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

  // Delete confirmation — previously the delete was immediate with no safeguard,
  // which is dangerous for a destructive action that also deactivates the project's
  // group room. Now we show a native Alert dialog before proceeding.
  const handleDelete = (p: Project) => {
    setMenuProject(null);
    Alert.alert(
      'Delete Project?',
      `Delete "${p.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(p.id);
            try {
              await projectsApiExtended.delete(p.id);
              setProjects(prev => prev.filter(x => x.id !== p.id));
              toast.show('Deleted', 'success');
            } catch (e: any) {
              toast.show(e?.message || 'Delete failed', 'error');
            } finally {
              setDeleting(null);
            }
          },
        },
      ]
    );
  };

  const handleCopyLink = async (p: Project) => {
    setMenuProject(null);
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
  // These six rows LEAVE the screen (browser, share sheet or a native dialog), so
  // each closes the sheet itself. Previously the menu row did `onClose()` for them
  // and then fired the action 60 ms later — the same stacking that killed the two
  // assignment rows.
  const handleEdit = (p: Project) => { setMenuProject(null); openWeb(`/dashboard/projects/${p.id}/edit`); };
  const handleLayout = (p: Project) => { setMenuProject(null); openWeb(`/dashboard/projects/${p.id}/layout-editor`); };
  const handleAnalytics = (p: Project) => { setMenuProject(null); openWeb(`/dashboard/analytics/${p.id}`); };
  const handleVisit = async (p: Project) => {
    setMenuProject(null);
    const url = visitUrlOf(p);
    try { await Linking.openURL(url); }
    catch { toast.show('Could not open link', 'error'); }
  };

  // ── Assignment handlers ──
  // Role-based assignment: admin assigns captain, captain assigns agent.
  // API endpoints were already present but had no mobile UI until now.
  // Clearing menuProject while setting assignProject in the same handler swaps the
  // host modal's body in place (React batches both, so the Modal never flips to
  // invisible and there is no second dialog to lose).
  const handleAssignCaptain = (p: Project) => {
    setMenuProject(null);
    setAssignProject(p);
    setAssignMode('captain');
  };

  const handleAssignAgent = (p: Project) => {
    setMenuProject(null);
    setAssignProject(p);
    setAssignMode('agent');
  };

  // Back out of the picker to the menu it was opened from (Android back + the X).
  const closePicker = () => {
    setMenuProject(assignProject);
    setAssignProject(null);
    setAssignMode(null);
  };

  // Dismiss the whole sheet, whichever body is showing (overlay tap).
  const dismissSheet = () => {
    setMenuProject(null);
    setAssignProject(null);
    setAssignMode(null);
  };

  const handleAssignSubmit = async (u: AssignCandidate) => {
    const project = assignProject;
    const mode = assignMode;
    if (!project || !mode) return;
    try {
      const updated = mode === 'captain'
        ? await projectsApiExtended.assignCaptain(project.id, u.id)
        : await projectsApiExtended.assignAgent(project.id, u.id);
      // Merge the candidate we PICKED, never the response's owner/assignedAgent.
      // WHY: HIT_Backend/repositories/ProjectRepository.js:71 update() is
      // findByIdAndUpdate(...).lean() with NO .populate() (unlike getAll/getById),
      // so those two fields come back as bare ObjectId strings. transformProject
      // then does `{ ...p.owner, id: String(...) }` on a string, which spreads it
      // character by character into { '0': '6', '1': '8', ... } with id: '' — and
      // that junk used to be written straight into `projects` state.
      setProjects(prev => prev.map(p => (p.id === updated.id ? {
        ...updated,
        // role is the known role of each endpoint's candidates: /projects/captains
        // lists captains, and getMyAgents selects role 'employee' users.
        owner: mode === 'captain'
          ? { id: u.id, name: u.name, role: 'captain', companyName: u.companyName }
          : p.owner,
        assignedAgent: mode === 'agent'
          ? { id: u.id, name: u.name, role: 'employee' }
          : p.assignedAgent,
      } : p)));
      toast.show(mode === 'captain' ? 'Captain assigned' : 'Agent assigned', 'success');
      setAssignProject(null);
      setAssignMode(null);
    } catch (e: any) {
      // Leave the sheet open so the user can retry or pick someone else.
      toast.show(e?.message || 'Assignment failed', 'error');
    }
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

      {/* ONE host modal for the 3-dot menu AND the assignment picker.
          There used to be two sibling RN Modals here and the picker was mounted
          60 ms after the menu was unmounted, which is why Assign Captain /
          Assign Agent did nothing on the device (see ProjectMenuBody). The body
          is chosen from the state that is already there: menu first, else picker. */}
      <Modal
        visible={!!menuProject || !!(assignProject && assignMode)}
        transparent
        animationType="slide"
        // Android back: out of the picker goes back to the menu it came from,
        // out of the menu dismisses.
        onRequestClose={menuProject ? dismissSheet : closePicker}
      >
        <Pressable style={km.overlay} onPress={dismissSheet}>
          <Pressable style={[km.sheet, !menuProject && { maxHeight: '70%' }]} onPress={() => {}}>
            {menuProject ? (
              <ProjectMenuBody
                project={menuProject}
                user={user}
                onClose={dismissSheet}
                onEdit={handleEdit}
                onLayout={handleLayout}
                onAnalytics={handleAnalytics}
                onCopyLink={handleCopyLink}
                onVisit={handleVisit}
                onDelete={handleDelete}
                onAssignCaptain={handleAssignCaptain}
                onAssignAgent={handleAssignAgent}
              />
            ) : assignProject && assignMode ? (
              <AssignmentPickerBody
                // Remount on a mode change so the candidate fetch and the search
                // box never carry over from a captain list into an agent list.
                key={`${assignProject.id}:${assignMode}`}
                mode={assignMode}
                onClose={closePicker}
                onAssign={handleAssignSubmit}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
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
