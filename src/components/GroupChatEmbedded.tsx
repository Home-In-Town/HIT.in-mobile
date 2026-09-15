// AI Lead Matching — Group Chat (full port of the website group-chat).
// Room list → open a room → full-screen thread with:
//   • project banner + 3-dot menu (Copy link, Download PDF, Download QR, Download Gallery)
//   • room options (Leave for anyone; Delete for owner/room-admin/platform admin)
//   • bottom composer: Text / Requirement / Inventory (role-gated)
//   • requirement cards render their auto-match results + "Interested" button
//
// When a room is open we call onRoomOpenChange(true) so the hub hides its top tabs.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator,
  TextInput, KeyboardAvoidingView, Platform, Modal, ScrollView, Switch, Alert,
  Animated, PanResponder,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Image, Linking } from 'react-native';
import {
  Users, Plus, Globe, ChevronLeft, Send, X, MoreVertical, Building2,
  Link as LinkIcon, FileText, QrCode, Image as ImageIcon, LogOut, Trash2,
  Search, MapPin, Check, Camera, Paperclip, Sparkles,
} from 'lucide-react-native';
import { groupChatApi, shareApi, mediaApi, GroupRoom, GroupMessage } from '../lib/api';
import AiAssistant, { AiAssistantApi, AiPostDraft } from './AiAssistant';
import { useAuth } from '../lib/authContext';
import { useSocket } from '../hooks/useSocket';
import { useToast } from './Toast';
import { ShareModal } from './ShareActions';
import { colors } from '../theme';

const ROOM_ICON: Record<string, string> = { project: '🏗', area: '📍', universal: '🌐' };

function timeStr(iso: string) {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function fmtPrice(v: number): string {
  if (!v) return '—';
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(0)}L`;
  return `₹${v.toLocaleString('en-IN')}`;
}

// Display name override: the universal / "HIT Community" room shows as "AI Lead Matching".
function roomDisplayName(room?: GroupRoom | null): string {
  if (!room) return '';
  if (room.isUniversal || /hit community/i.test(room.name)) return 'AI Lead Matching';
  return room.name;
}

type PostMode = 'text' | 'requirement' | 'inventory';

const BHK_TYPES = ['1BHK', '2BHK', '3BHK', '4BHK', 'Plot', 'Shop'];
const POSSESSION_NEEDED = [
  { v: 'immediate', l: 'Immediate' }, { v: '6months', l: '6 Months' }, { v: '1year', l: '1 Year' },
];
const URGENCY = [
  { v: 'normal', l: 'Normal' }, { v: 'urgent', l: 'Urgent' }, { v: 'very_urgent', l: 'Very Urgent' },
];
const POSSESSION_STATUS = [
  { v: 'ready', l: 'Ready to Move' }, { v: '6months', l: '6 Months' }, { v: '1year', l: '1 Year' }, { v: '2year+', l: '2+ Years' },
];

// ─── Draggable "AI Lead Assist" FAB ──────────────────────────────────────────
// A movable floating button. It stays inside its parent (the message area) and
// never leaves the viewport. A small movement threshold distinguishes a tap
// (opens AI) from a drag (repositions the button), so tapping never triggers a
// stray drag on mobile.
const FAB_W = 128; // approx pill width (clamp margin)
const FAB_H = 44;  // approx pill height
const DRAG_THRESHOLD = 6; // px of movement before it's treated as a drag

function DraggableFab({ onPress }: { onPress: () => void }) {
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const bounds = useRef({ w: 0, h: 0 }).current;
  const start = useRef({ x: 0, y: 0 });
  const moved = useRef(false);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Only claim the gesture once the finger actually moves — lets taps pass.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > DRAG_THRESHOLD || Math.abs(g.dy) > DRAG_THRESHOLD,
      onPanResponderGrant: () => {
        moved.current = false;
        // @ts-ignore - _value exists at runtime
        start.current = { x: pan.x._value, y: pan.y._value };
      },
      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dx) > DRAG_THRESHOLD || Math.abs(g.dy) > DRAG_THRESHOLD) moved.current = true;
        pan.setValue({ x: start.current.x + g.dx, y: start.current.y + g.dy });
      },
      onPanResponderRelease: (_e, g) => {
        if (!moved.current && Math.abs(g.dx) < DRAG_THRESHOLD && Math.abs(g.dy) < DRAG_THRESHOLD) {
          onPress();
          return;
        }
        // Clamp final position inside the container (keep fully on-screen).
        const maxX = 0;
        const minX = -(bounds.w - FAB_W - 28); // 14px margins both sides
        const maxY = 0;
        const minY = -(bounds.h - FAB_H - 28);
        const nx = clamp(start.current.x + g.dx, minX, maxX);
        const ny = clamp(start.current.y + g.dy, minY, maxY);
        Animated.spring(pan, { toValue: { x: nx, y: ny }, useNativeDriver: false, friction: 6 }).start();
      },
    })
  ).current;

  return (
    <View
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => { bounds.w = e.nativeEvent.layout.width; bounds.h = e.nativeEvent.layout.height; }}
    >
      <Animated.View
        {...responder.panHandlers}
        style={[s.aiFab, { transform: pan.getTranslateTransform() }]}
      >
        <Sparkles size={16} color="#fff" />
        <Text style={s.aiFabText}>AI Lead Assist</Text>
      </Animated.View>
    </View>
  );
}

export default function GroupChatEmbedded({ onRoomOpenChange, topInset = 0, autoOpenUniversal = false, hideThreadBack = false }: {
  onRoomOpenChange?: (open: boolean) => void;
  topInset?: number;
  // When true, the Universal ("AI Lead Matching") room opens automatically and
  // the thread's back button is hidden — used when this component IS the
  // AI Lead Matching section (no separate room-list step).
  autoOpenUniversal?: boolean;
  hideThreadBack?: boolean;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const socket = useSocket();

  const [myRooms, setMyRooms] = useState<GroupRoom[]>([]);
  const [discoverRooms, setDiscoverRooms] = useState<GroupRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<GroupRoom | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [roomForm, setRoomForm] = useState({ name: '', city: '', location: '' });
  const [search, setSearch] = useState('');

  // Thread UI state
  const [postMode, setPostMode] = useState<PostMode>('text');
  const [text, setText] = useState('');
  const [showMediaMenu, setShowMediaMenu] = useState(false);
  const [showRoomMenu, setShowRoomMenu] = useState(false);
  const [shareProject, setShareProject] = useState<any>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  // AI Assist mode — when on, the composer + a private inline panel drive the
  // existing AI Lead Matching assistant instead of posting to the group.
  const [aiMode, setAiMode] = useState(false);
  const [showAiMenu, setShowAiMenu] = useState(false);
  // Post card built from the AI-collected property details (no manual form).
  const [postDraft, setPostDraft] = useState<AiPostDraft | null>(null);
  const [postingDraft, setPostingDraft] = useState(false);
  const aiApiRef = useRef<AiAssistantApi | null>(null);
  const flatRef = useRef<FlatList>(null);

  const role = user?.role ?? '';
  const canRequirement = ['agent', 'admin', 'captain'].includes(role);
  const canInventory = ['builder', 'admin', 'captain', 'agent'].includes(role);

  // Requirement / inventory composer state
  const [reqForm, setReqForm] = useState({ bhkType: '2BHK', budget: '', area: '', city: '', possessionNeeded: 'immediate', loanRequired: false, urgency: 'normal', clientNotes: '' });
  const [invForm, setInvForm] = useState({ bhkOptions: '', min: '', max: '', area: '', city: '', possessionStatus: 'ready', bankLoanAvailable: false, commissionPercent: '2', description: '' });

  useEffect(() => { onRoomOpenChange?.(!!activeRoom); }, [activeRoom, onRoomOpenChange]);

  const loadRooms = useCallback(async () => {
    try {
      const data = await groupChatApi.getRooms(search ? { search } : undefined);
      setMyRooms(data.myRooms);
      setDiscoverRooms(data.discoverRooms);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  // Real-time incoming messages
  useEffect(() => {
    const unsub = socket.onGroupMessage((msg: any) => {
      if ((msg.room || msg.roomId) !== activeRoom?.id) return;
      const roomId = activeRoom?.id ?? '';
      setMessages(prev => [...prev, {
        id: String(msg._id || msg.id || Date.now()),
        room: roomId,
        sender: { id: String(msg.sender?._id || msg.sender?.id || ''), name: msg.sender?.name || '', role: msg.sender?.role || '', companyName: msg.sender?.companyName },
        messageType: msg.messageType || 'text',
        content: msg.content || '',
        requirementCard: msg.requirementCard,
        inventoryCard: msg.inventoryCard,
        matchResults: msg.matchResults,
        createdAt: msg.createdAt || new Date().toISOString(),
      }]);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return unsub;
  }, [activeRoom?.id, socket.onGroupMessage]);

  const openRoom = async (room: GroupRoom) => {
    if (activeRoom) socket.leaveGroup(activeRoom.id);
    setActiveRoom(room);
    setMessages([]);
    setLoadingMsgs(true);
    setPostMode('text');
    socket.joinGroup(room.id);
    try {
      setMessages(await groupChatApi.getMessages(room.id));
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 150);
    } catch { /* silent */ }
    finally { setLoadingMsgs(false); }
  };

  const closeRoom = () => {
    if (activeRoom) socket.leaveGroup(activeRoom.id);
    setActiveRoom(null);
    setShowMediaMenu(false);
    setShowRoomMenu(false);
  };

  // When used as the AI Lead Matching section, auto-open the Universal room so
  // the group chat shows directly (no room-list step). Runs once after rooms load.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!autoOpenUniversal || autoOpenedRef.current || activeRoom || loading) return;
    const universal = myRooms.find(r => r.isUniversal) || myRooms.find(r => /hit community/i.test(r.name));
    if (universal) {
      autoOpenedRef.current = true;
      openRoom(universal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenUniversal, myRooms, loading, activeRoom]);

  // Single composer handler: routes to AI when AI mode is on, else to the group.
  const handleComposerSend = () => {
    const t = text.trim();
    if (!t) return;
    if (aiMode) {
      // Private AI answer — never posted to the group.
      setText('');
      aiApiRef.current?.submitFreeText(t);
      return;
    }
    sendText();
  };

  const sendText = async () => {
    if (!text.trim() || !activeRoom) return;
    const content = text.trim();
    setText('');
    try {
      await groupChatApi.postMessage(activeRoom.id, { messageType: 'text', content });
      // socket broadcast will echo the message back to us
    } catch {
      socket.sendGroupMessage({ roomId: activeRoom.id, content, messageType: 'text' });
    }
  };

  // ── Attachments: Camera / Gallery / Files ──
  // Uploads the picked media via the shared media proxy, then posts it into the
  // group as an image/file message so everyone in the room can view/download it.
  const uploadAndSendAttachment = async (
    file: { uri: string; name: string; mimeType: string },
    kind: 'image' | 'file',
  ) => {
    if (!activeRoom) return;
    setUploading(true);
    setShowAttachMenu(false);
    try {
      const projId = activeRoom.project?.id || '';
      const { url } = await mediaApi.uploadAndSave({
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
        projectId: projId,
        type: kind === 'image' ? 'gallery' : 'brochure',
      });
      if (!url) throw new Error('Upload failed');
      // messageType image|file; content holds the URL (backend accepts free string type,
      // and the bubble renderer shows an Image for image and a file chip for file).
      await groupChatApi.postMessage(activeRoom.id, {
        messageType: kind,
        content: url,
      });
      toast.show(kind === 'image' ? 'Photo sent 📷' : 'File sent 📎', 'success');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) {
      toast.show(e?.message || 'Could not send attachment', 'error');
    } finally {
      setUploading(false);
    }
  };

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { toast.show('Camera permission needed', 'error'); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await uploadAndSendAttachment(
      { uri: a.uri, name: a.fileName || `photo_${Date.now()}.jpg`, mimeType: a.mimeType || 'image/jpeg' },
      'image',
    );
  };

  const pickFromGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast.show('Photos permission needed', 'error'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await uploadAndSendAttachment(
      { uri: a.uri, name: a.fileName || `image_${Date.now()}.jpg`, mimeType: a.mimeType || 'image/jpeg' },
      'image',
    );
  };

  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: '*/*' });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await uploadAndSendAttachment(
      { uri: a.uri, name: a.name || `file_${Date.now()}`, mimeType: a.mimeType || 'application/octet-stream' },
      'file',
    );
  };

  const postRequirement = async () => {
    if (!activeRoom) return;
    if (!reqForm.budget || !reqForm.area) { toast.show('Budget and Area are required', 'error'); return; }
    const card = {
      bhkType: reqForm.bhkType,
      budget: Number(reqForm.budget),
      area: reqForm.area.trim(),
      city: reqForm.city.trim(),
      possessionNeeded: reqForm.possessionNeeded,
      loanRequired: reqForm.loanRequired,
      urgency: reqForm.urgency,
      clientNotes: reqForm.clientNotes.trim(),
    };
    try {
      const res = await groupChatApi.postMessage(activeRoom.id, { messageType: 'requirement_card', requirementCard: card });
      if (res?.message) setMessages(prev => [...prev, normalizeMsg(res.message, activeRoom.id)]);
      const n = res?.message?.matchResults?.length || 0;
      toast.show(n > 0 ? `Posted — ${n} match${n > 1 ? 'es' : ''} found 🚀` : 'Posted — no matches yet', 'success');
      setReqForm({ bhkType: '2BHK', budget: '', area: '', city: '', possessionNeeded: 'immediate', loanRequired: false, urgency: 'normal', clientNotes: '' });
      setPostMode('text');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) { toast.show(e?.message || 'Failed to post', 'error'); }
  };

  const postInventory = async () => {
    if (!activeRoom) return;
    if (!invForm.area || !invForm.min) { toast.show('Area and Min Price are required', 'error'); return; }
    const card = {
      bhkOptions: invForm.bhkOptions.split(',').map(s => s.trim()).filter(Boolean),
      priceRange: { min: Number(invForm.min), max: Number(invForm.max) || 0 },
      area: invForm.area.trim(),
      city: invForm.city.trim(),
      possessionStatus: invForm.possessionStatus,
      bankLoanAvailable: invForm.bankLoanAvailable,
      commissionPercent: Number(invForm.commissionPercent) || 0,
      description: invForm.description.trim(),
    };
    try {
      const res = await groupChatApi.postMessage(activeRoom.id, { messageType: 'inventory_card', inventoryCard: card });
      if (res?.message) setMessages(prev => [...prev, normalizeMsg(res.message, activeRoom.id)]);
      toast.show('Inventory posted 📢', 'success');
      setInvForm({ bhkOptions: '', min: '', max: '', area: '', city: '', possessionStatus: 'ready', bankLoanAvailable: false, commissionPercent: '2', description: '' });
      setPostMode('text');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) { toast.show(e?.message || 'Failed to post', 'error'); }
  };

  // Publish the AI-collected property draft into the group as an inventory card
  // (reuses the existing group posting). No manual form — details come from AI.
  const publishDraft = async () => {
    if (!activeRoom || !postDraft) return;
    setPostingDraft(true);
    const get = (re: RegExp) => postDraft.fields.find(f => re.test(f.label))?.value || '';
    const priceStr = get(/price/i);
    const priceNum = Number((priceStr.match(/[\d.]+/) || [])[0]) || 0;
    const card = {
      bhkOptions: get(/bhk|property type|type/i) ? [get(/bhk|property type|type/i)] : [],
      priceRange: { min: priceNum, max: 0 },
      area: get(/location/i) || get(/area/i),
      city: get(/city/i),
      possessionStatus: get(/status|possession/i) || 'ready',
      bankLoanAvailable: /yes/i.test(get(/loan/i)),
      commissionPercent: 0,
      description: postDraft.fields.map(f => `${f.label}: ${f.value}`).join(' • '),
    };
    try {
      const res = await groupChatApi.postMessage(activeRoom.id, { messageType: 'inventory_card', inventoryCard: card });
      if (res?.message) setMessages(prev => [...prev, normalizeMsg(res.message, activeRoom.id)]);
      toast.show('Property posted 📢', 'success');
      setPostDraft(null);
      setAiMode(false);
      aiApiRef.current = null;
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to post', 'error');
    } finally {
      setPostingDraft(false);
    }
  };

  const handleInterested = async (projectId: string, messageId: string) => {
    try {
      const res = await groupChatApi.showInterest({ projectId, messageId, roomId: activeRoom?.id });
      toast.show(res?.message || 'Builder notified! Deal room created.', 'success');
    } catch (e: any) {
      toast.show(e?.message?.includes('exists') ? 'Deal already exists' : (e?.message || 'Failed'), 'error');
    }
  };

  // ── Project media menu ──
  const projectForShare = () => {
    const p = (activeRoom?.project as any) || {};
    return {
      id: String(p.id || p._id || ''),
      name: p.projectName || activeRoom?.name || 'Project',
      slug: p.slug,
      type: 'flat', city: p.city || '', location: '',
      startingPrice: p.pricing?.startingPrice ?? 0,
      bhkOptions: p.configuration?.bhkOptions ?? [],
      reraApproved: false, projectStatus: 'pre-launch',
      bankLoanAvailable: false, gatedCommunity: false, isPublished: true,
      coverImage: p.media?.coverImage ?? null, amenities: [],
    };
  };

  const handleCopyLink = async () => {
    setShowMediaMenu(false);
    const slug = (activeRoom?.project as any)?.slug;
    const url = slug ? `https://homeintown.in/visit/${slug}` : 'https://homeintown.in';
    setShareProject(projectForShare()); // ShareModal has Copy/QR/brochure
  };

  const handlePdfOrQr = () => {
    setShowMediaMenu(false);
    if (!(activeRoom?.project as any)?.id && !(activeRoom?.project as any)?._id) {
      toast.show('No project linked to this group', 'error'); return;
    }
    setShareProject(projectForShare());
  };

  const handleDownloadGallery = async () => {
    setShowMediaMenu(false);
    const pid = (activeRoom?.project as any)?.id || (activeRoom?.project as any)?._id;
    if (!pid) { toast.show('No project linked to this group', 'error'); return; }
    toast.show('Downloading gallery…', 'info');
    try {
      const { url, token } = await shareApi.galleryDownload(String(pid));
      const name = ((activeRoom?.project as any)?.projectName || 'project').replace(/[^a-zA-Z0-9]/g, '_');
      const target = `${FileSystem.cacheDirectory}${name}_Gallery.zip`;
      const res = await FileSystem.downloadAsync(url, target, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.status !== 200) throw new Error('Download failed');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(res.uri, { mimeType: 'application/zip', dialogTitle: 'Project Gallery' });
      } else {
        toast.show('Gallery saved', 'success');
      }
    } catch (e: any) {
      toast.show(e?.message || 'Failed to download gallery', 'error');
    }
  };

  // ── Room options ──
  const canDelete = !!activeRoom && !activeRoom.isUniversal && (
    role === 'admin' ||
    activeRoom.members.some(m => m.user.id === user?.id && m.role === 'admin')
  );
  const canLeave = !!activeRoom && !activeRoom.isUniversal && activeRoom.canLeave !== false;

  const handleLeave = () => {
    setShowRoomMenu(false);
    if (!activeRoom) return;
    Alert.alert('Leave group?', `Leave "${roomDisplayName(activeRoom)}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive', onPress: async () => {
          try {
            await groupChatApi.leaveRoom(activeRoom.id);
            setMyRooms(prev => prev.filter(r => r.id !== activeRoom.id));
            toast.show('Left group', 'success');
            closeRoom();
          } catch (e: any) { toast.show(e?.message || 'Failed to leave', 'error'); }
        },
      },
    ]);
  };

  const handleDelete = () => {
    setShowRoomMenu(false);
    if (!activeRoom) return;
    Alert.alert('Delete group?', `This will close "${roomDisplayName(activeRoom)}" for everyone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await groupChatApi.deleteRoom(activeRoom.id);
            setMyRooms(prev => prev.filter(r => r.id !== activeRoom.id));
            toast.show('Group deleted', 'success');
            closeRoom();
          } catch (e: any) { toast.show(e?.message || 'Failed to delete', 'error'); }
        },
      },
    ]);
  };

  const handleJoin = async (room: GroupRoom) => {
    try {
      const r = await groupChatApi.joinRoom(room.id);
      setMyRooms(prev => [r, ...prev]);
      setDiscoverRooms(prev => prev.filter(x => x.id !== room.id));
      setShowDiscover(false);
      openRoom(r);
    } catch (e: any) { toast.show(e?.message || 'Failed', 'error'); }
  };

  const handleCreate = async () => {
    if (!roomForm.name || !roomForm.city || !roomForm.location) {
      toast.show('Name, city, location required', 'error'); return;
    }
    setCreating(true);
    try {
      const r = await groupChatApi.createRoom({ name: roomForm.name, roomType: 'area', area: { city: roomForm.city, location: roomForm.location } });
      setMyRooms(prev => [r, ...prev]);
      setShowCreate(false);
      setRoomForm({ name: '', city: '', location: '' });
      openRoom(r);
    } catch (e: any) { toast.show(e?.message || 'Failed', 'error'); }
    finally { setCreating(false); }
  };

  // ═══════════ ROOM LIST ═══════════
  if (!activeRoom) {
    return (
      <View style={{ flex: 1 }}>
        <View style={s.searchRow}>
          <Search size={15} color={colors.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search groups…"
            placeholderTextColor={colors.muted} style={s.searchInput} onSubmitEditing={loadRooms} />
        </View>
        <View style={s.listHeader}>
          <Text style={s.listTitle}>{myRooms.length} group{myRooms.length !== 1 ? 's' : ''}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => setShowDiscover(true)} style={s.iconBtn}><Globe size={15} color={colors.brand} /></Pressable>
            <Pressable onPress={() => setShowCreate(true)} style={s.iconBtn}><Plus size={15} color={colors.brand} /></Pressable>
          </View>
        </View>
        {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /> : (
          <FlatList
            data={[...myRooms].sort((a, b) => {
              // Universal (pinned) always first
              if (a.isUniversal && !b.isUniversal) return -1;
              if (!a.isUniversal && b.isUniversal) return 1;
              return 0;
            })}
            keyExtractor={r => r.id}
            ListEmptyComponent={
              <View style={s.empty}>
                <Users size={28} color={colors.muted} />
                <Text style={s.emptyText}>No groups yet</Text>
                <Pressable onPress={() => setShowDiscover(true)} style={s.joinBtn}><Text style={s.joinBtnText}>Discover Groups</Text></Pressable>
              </View>
            }
            renderItem={({ item: room }) => (
              <Pressable onPress={() => openRoom(room)} style={[s.roomRow, room.isUniversal && s.roomRowPinned]}>
                <View style={[s.roomAvatar, room.isUniversal && { backgroundColor: colors.brand }]}>
                  <Text style={{ fontSize: 17 }}>{room.isUniversal ? '🌐' : (ROOM_ICON[room.roomType] || '💬')}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[s.roomName, room.isUniversal && { color: colors.brand }]} numberOfLines={1}>
                      {roomDisplayName(room)}
                    </Text>
                  </View>
                  <Text style={s.roomMeta} numberOfLines={1}>
                    {room.members.length} member{room.members.length !== 1 ? 's' : ''}
                    {!room.isUniversal && room.area?.location ? ` · ${room.area.location}` : ''}
                  </Text>
                </View>
                <Text style={s.roomTime}>{timeStr(room.lastActivity)}</Text>
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 64 }} />}
          />
        )}

        {/* Discover */}
        <Modal visible={showDiscover} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowDiscover(false)}>
          <View style={{ flex: 1, backgroundColor: colors.cream }}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Discover Groups</Text>
              <Pressable onPress={() => setShowDiscover(false)}><X size={20} color={colors.ink} /></Pressable>
            </View>
            <FlatList
              data={discoverRooms}
              keyExtractor={r => r.id}
              contentContainerStyle={{ padding: 16, gap: 10 }}
              ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.muted, marginTop: 40 }}>No groups to discover</Text>}
              renderItem={({ item: room }) => (
                <View style={s.discoverRow}>
                  <Text style={{ fontSize: 19 }}>{ROOM_ICON[room.roomType] || '💬'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.roomName}>{roomDisplayName(room)}</Text>
                    <Text style={s.roomMeta}>{room.members.length} members</Text>
                  </View>
                  <Pressable onPress={() => handleJoin(room)} style={s.smallJoin}>
                    <Text style={s.smallJoinText}>Join</Text>
                  </Pressable>
                </View>
              )}
            />
          </View>
        </Modal>

        {/* Create */}
        <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCreate(false)}>
          <View style={{ flex: 1, backgroundColor: colors.cream }}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Create Group</Text>
              <Pressable onPress={() => setShowCreate(false)}><X size={20} color={colors.ink} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
              {[{ k: 'name', lbl: 'Group Name *', ph: 'e.g. Baner Builders' }, { k: 'city', lbl: 'City *', ph: 'e.g. Pune' }, { k: 'location', lbl: 'Area / Location *', ph: 'e.g. Baner' }].map(f => (
                <View key={f.k} style={{ gap: 4 }}>
                  <Text style={s.fieldLabel}>{f.lbl}</Text>
                  <TextInput value={(roomForm as any)[f.k]} onChangeText={v => setRoomForm(r => ({ ...r, [f.k]: v }))} placeholder={f.ph} placeholderTextColor={colors.muted} style={s.fieldInput} />
                </View>
              ))}
              <Pressable onPress={handleCreate} disabled={creating} style={[s.primaryBtn, creating && { opacity: 0.6 }]}>
                {creating ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Create Group</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </Modal>
      </View>
    );
  }

  // ═══════════ THREAD (full-screen) ═══════════
  const proj = (activeRoom.project as any) || null;
  return (
    <KeyboardAvoidingView style={{ flex: 1, paddingTop: topInset }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Thread header */}
      <View style={s.threadHeader}>
        {!hideThreadBack && (
          <Pressable onPress={closeRoom} style={{ padding: 4 }}><ChevronLeft size={22} color={colors.ink} /></Pressable>
        )}
        <View style={s.threadAvatar}><Text style={{ fontSize: 15 }}>{ROOM_ICON[activeRoom.roomType] || '💬'}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.threadTitle} numberOfLines={1}>{roomDisplayName(activeRoom)}</Text>
          <Text style={s.threadSub} numberOfLines={1}>{activeRoom.members.length} members</Text>
        </View>
        <Pressable onPress={() => { setShowRoomMenu(v => !v); setShowMediaMenu(false); }} style={{ padding: 4 }}>
          <MoreVertical size={20} color={colors.ink} />
        </Pressable>

        {/* Room options menu */}
        {showRoomMenu && (
          <View style={s.menu}>
            {(proj?.slug || proj?.id || proj?._id) && (
              <Pressable style={s.menuItem} onPress={() => { setShowRoomMenu(false); setShowMediaMenu(true); }}>
                <Building2 size={15} color={colors.muted2} /><Text style={s.menuText}>Project media</Text>
              </Pressable>
            )}
            {canLeave && (
              <Pressable style={s.menuItem} onPress={handleLeave}>
                <LogOut size={15} color={colors.muted2} /><Text style={s.menuText}>Leave group</Text>
              </Pressable>
            )}
            {canDelete && (
              <Pressable style={s.menuItem} onPress={handleDelete}>
                <Trash2 size={15} color={colors.red} /><Text style={[s.menuText, { color: colors.red }]}>Delete group</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Project media menu (3-dot: PDF/QR/Gallery/Copy link) */}
        {showMediaMenu && (
          <View style={s.menu}>
            <Pressable style={s.menuItem} onPress={handleCopyLink}>
              <LinkIcon size={15} color={colors.muted2} /><Text style={s.menuText}>Copy link</Text>
            </Pressable>
            <Pressable style={s.menuItem} onPress={handlePdfOrQr}>
              <FileText size={15} color={colors.muted2} /><Text style={s.menuText}>Download PDF</Text>
            </Pressable>
            <Pressable style={s.menuItem} onPress={handlePdfOrQr}>
              <QrCode size={15} color={colors.muted2} /><Text style={s.menuText}>Download QR</Text>
            </Pressable>
            <Pressable style={s.menuItem} onPress={handleDownloadGallery}>
              <ImageIcon size={15} color={colors.muted2} /><Text style={s.menuText}>Download Gallery</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Project banner */}
      {proj && (
        <Pressable onPress={() => setShowMediaMenu(v => !v)} style={s.banner}>
          <View style={s.bannerIcon}><Building2 size={16} color={colors.blueText} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.bannerName} numberOfLines={1}>{proj.projectName || activeRoom.name}</Text>
            <Text style={s.bannerMeta} numberOfLines={1}>
              {proj.pricing?.startingPrice ? `💰 ${fmtPrice(proj.pricing.startingPrice)}+  ` : ''}
              {proj.configuration?.bhkOptions?.length ? `🏠 ${proj.configuration.bhkOptions.join(', ')}` : ''}
            </Text>
          </View>
          <MoreVertical size={18} color={colors.blueText} />
        </Pressable>
      )}

      {/* Tap-catcher to close menus */}
      {(showRoomMenu || showMediaMenu) && (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => { setShowRoomMenu(false); setShowMediaMenu(false); }} />
      )}

      {/* Messages — the group chat is ALWAYS the base view. */}
      {loadingMsgs ? <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /> : (
        <View style={{ flex: 1 }}>
          <FlatList
            ref={flatRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 14, gap: 10 }}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item: msg }) => (
              <MessageBubble msg={msg} meId={user?.id || ''} onInterested={handleInterested} />
            )}
          />

          {/* ── AI Assist (inline, private) — overlays the message area while
              active. Runs the existing AI Lead Matching assistant via the user's
              own private thread (leadChatApi); other members see nothing. Only a
              shared match becomes public. Uses the SAME group composer below. ── */}
          {aiMode && (
            <View style={s.aiOverlay}>
              <View style={s.aiInlineBanner}>
                <View style={s.aiPrivatePill}>
                  <Sparkles size={11} color={colors.brand} />
                  <Text style={s.aiPrivateText}>AI Assist · Private to you</Text>
                </View>
                {/* 3-dot menu (End Chat / Exit Chat / Post & Matching) */}
                <Pressable onPress={() => setShowAiMenu(v => !v)} style={s.aiMenuBtn}>
                  <MoreVertical size={18} color={colors.brand} />
                </Pressable>
              </View>

              {showAiMenu && (
                <>
                  <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAiMenu(false)} />
                  <View style={s.aiMenu}>
                    {/* Post — show the property the AI already collected as a small
                        card (no manual re-entry). */}
                    <Pressable
                      style={s.aiMenuItem}
                      onPress={() => {
                        setShowAiMenu(false);
                        const draft = aiApiRef.current?.getPostDraft();
                        if (!draft || draft.fields.length === 0) {
                          toast.show('Pehle AI ko apni property ki detail batayein.', 'info');
                          return;
                        }
                        if (!draft.isSellable) {
                          toast.show('Post sirf sell/rent property ke liye hai.', 'info');
                          return;
                        }
                        setPostDraft(draft);
                      }}
                    >
                      <Building2 size={15} color={colors.greenText} />
                      <Text style={s.aiMenuText}>Post</Text>
                    </Pressable>
                    {/* Matching — run AI matching, reveal all matches with scores */}
                    <Pressable
                      style={s.aiMenuItem}
                      onPress={() => { setShowAiMenu(false); aiApiRef.current?.runMatching(); }}
                    >
                      <Search size={15} color={colors.brand} />
                      <Text style={s.aiMenuText}>Matching</Text>
                    </Pressable>
                    <Pressable
                      style={s.aiMenuItem}
                      onPress={() => { setShowAiMenu(false); aiApiRef.current?.endChat(); }}
                    >
                      <X size={15} color={colors.muted2} />
                      <Text style={s.aiMenuText}>End Chat</Text>
                    </Pressable>
                    <Pressable
                      style={s.aiMenuItem}
                      onPress={() => { setShowAiMenu(false); setAiMode(false); aiApiRef.current = null; }}
                    >
                      <LogOut size={15} color={colors.muted2} />
                      <Text style={s.aiMenuText}>Exit Chat</Text>
                    </Pressable>
                  </View>
                </>
              )}

              <View style={{ flex: 1 }}>
                <AiAssistant
                  hideOwnChrome
                  groupContext={{ roomId: activeRoom.id, roomName: roomDisplayName(activeRoom) }}
                  onReady={(api) => { aiApiRef.current = api; }}
                  onMatchShared={() => {}}
                />
              </View>
            </View>
          )}

          {/* AI Lead Assist floating button (FAB) — draggable; toggles AI mode. */}
          {!aiMode && <DraggableFab onPress={() => setAiMode(true)} />}
        </View>
      )}

      {/* Composer — the SINGLE input box. Routes to the group when in normal
          mode, and to the AI assistant when AI mode is active. */}
      <View style={s.composer}>
        {/* Attachment options: Camera / Gallery / Files (group mode only) */}
        {!aiMode && showAttachMenu && (
          <View style={s.attachRow}>
            <Pressable onPress={pickFromCamera} disabled={uploading} style={s.attachOpt}>
              <View style={[s.attachIcon, { backgroundColor: '#EFF6FF' }]}><Camera size={17} color="#2563EB" /></View>
              <Text style={s.attachLabel}>Camera</Text>
            </Pressable>
            <Pressable onPress={pickFromGallery} disabled={uploading} style={s.attachOpt}>
              <View style={[s.attachIcon, { backgroundColor: '#F0FDF4' }]}><ImageIcon size={17} color={colors.greenText} /></View>
              <Text style={s.attachLabel}>Gallery</Text>
            </Pressable>
            <Pressable onPress={pickFile} disabled={uploading} style={s.attachOpt}>
              <View style={[s.attachIcon, { backgroundColor: '#FFF8F0' }]}><FileText size={17} color={colors.brand} /></View>
              <Text style={s.attachLabel}>Files</Text>
            </Pressable>
          </View>
        )}

        <View style={s.textRow}>
          {!aiMode ? (
            <Pressable
              onPress={() => setShowAttachMenu(v => !v)}
              disabled={uploading}
              style={[s.attachBtn, showAttachMenu && { backgroundColor: colors.brandTint }]}
            >
              {uploading
                ? <ActivityIndicator size="small" color={colors.brand} />
                : <Paperclip size={18} color={showAttachMenu ? colors.brand : colors.muted2} />}
            </Pressable>
          ) : (
            <View style={[s.attachBtn, { backgroundColor: colors.brandTint, borderColor: `${colors.brand}55` }]}>
              <Sparkles size={16} color={colors.brand} />
            </View>
          )}
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={aiMode ? 'Answer the AI…' : 'Type a message…'}
            placeholderTextColor={colors.muted}
            style={s.textInput}
            multiline
            onSubmitEditing={handleComposerSend}
          />
          <Pressable onPress={handleComposerSend} disabled={!text.trim()} style={[s.sendBtn, !text.trim() && { opacity: 0.4 }]}>
            <Send size={16} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* Requirement composer sheet */}
      <RequirementSheet
        visible={postMode === 'requirement'}
        form={reqForm}
        setForm={setReqForm}
        onClose={() => setPostMode('text')}
        onSubmit={postRequirement}
      />

      {/* Inventory composer sheet */}
      <InventorySheet
        visible={postMode === 'inventory'}
        form={invForm}
        setForm={setInvForm}
        onClose={() => setPostMode('text')}
        onSubmit={postInventory}
      />

      {/* ── Post Property Card — built from the AI-collected details (no manual
          form). Shows a small property card; user just confirms to post. ── */}
      <Modal visible={!!postDraft} transparent animationType="slide" onRequestClose={() => setPostDraft(null)}>
        <Pressable style={pd.overlay} onPress={() => setPostDraft(null)}>
          <Pressable style={pd.sheet} onPress={() => {}}>
            <View style={pd.head}>
              <Building2 size={18} color={colors.greenText} />
              <View style={{ flex: 1 }}>
                <Text style={pd.headTitle}>Your Property</Text>
                <Text style={pd.headSub}>AI ne aapki di hui detail se banaya</Text>
              </View>
              <Pressable onPress={() => setPostDraft(null)} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
            </View>

            {/* Small property card */}
            <View style={pd.card}>
              <View style={pd.cardTop}>
                <View style={pd.cardIcon}><Building2 size={22} color={colors.brand} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={pd.cardTitle} numberOfLines={1}>{postDraft?.title || 'Property'}</Text>
                  {postDraft?.subtitle ? <Text style={pd.cardLoc} numberOfLines={1}>📍 {postDraft.subtitle}</Text> : null}
                </View>
                {postDraft?.price ? <Text style={pd.cardPrice}>{postDraft.price}</Text> : null}
              </View>
              <View style={pd.detailList}>
                {(postDraft?.fields || []).map((f, i) => (
                  <View key={i} style={pd.detailRow}>
                    <Text style={pd.detailLabel}>{f.label}</Text>
                    <Text style={pd.detailValue} numberOfLines={1}>{f.value}</Text>
                  </View>
                ))}
              </View>
            </View>

            <Pressable onPress={publishDraft} disabled={postingDraft} style={[pd.postBtn, postingDraft && { opacity: 0.6 }]}>
              {postingDraft
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={pd.postBtnText}>Post to Group 📢</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Share sheet (Copy link / QR / brochure) */}
      {shareProject && <ShareModal project={shareProject} onClose={() => setShareProject(null)} />}

    </KeyboardAvoidingView>
  );
}

// ═══════════ Requirement composer (bottom sheet) ═══════════
function RequirementSheet({ visible, form, setForm, onClose, onSubmit }: {
  visible: boolean; form: any; setForm: (fn: any) => void; onClose: () => void; onSubmit: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sh.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={sh.sheet}>
          <View style={[sh.head, { backgroundColor: colors.brand }]}>
            <Search size={18} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={sh.headTitle}>Post Client Requirement</Text>
              <Text style={sh.headSub}>Auto-match with available inventory</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}><X size={20} color="#fff" /></Pressable>
          </View>

          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
            <Field label="Configuration" required>
              <View style={sh.chipsWrap}>
                {BHK_TYPES.map(o => (
                  <Pressable key={o} onPress={() => setForm((f: any) => ({ ...f, bhkType: o }))} style={[sh.chip, form.bhkType === o && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
                    <Text style={[sh.chipText, form.bhkType === o && { color: '#fff' }]}>{o}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>

            <View style={sh.row2}>
              <Field label="Budget (Lakhs)" required flex>
                <TextInput style={sh.input} keyboardType="numeric" placeholder="e.g. 85" placeholderTextColor={colors.muted} value={form.budget} onChangeText={(v: string) => setForm((f: any) => ({ ...f, budget: v }))} />
              </Field>
              <Field label="City" flex>
                <TextInput style={sh.input} placeholder="e.g. Nagpur" placeholderTextColor={colors.muted} value={form.city} onChangeText={(v: string) => setForm((f: any) => ({ ...f, city: v }))} />
              </Field>
            </View>

            <Field label="Area / Locality" required>
              <TextInput style={sh.input} placeholder="e.g. Manish Nagar" placeholderTextColor={colors.muted} value={form.area} onChangeText={(v: string) => setForm((f: any) => ({ ...f, area: v }))} />
            </Field>

            <Field label="Possession">
              <View style={sh.chipsWrap}>
                {POSSESSION_NEEDED.map(o => (
                  <Pressable key={o.v} onPress={() => setForm((f: any) => ({ ...f, possessionNeeded: o.v }))} style={[sh.chip, form.possessionNeeded === o.v && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
                    <Text style={[sh.chipText, form.possessionNeeded === o.v && { color: '#fff' }]}>{o.l}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>

            <Field label="Urgency">
              <View style={sh.chipsWrap}>
                {URGENCY.map(o => (
                  <Pressable key={o.v} onPress={() => setForm((f: any) => ({ ...f, urgency: o.v }))} style={[sh.chip, form.urgency === o.v && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
                    <Text style={[sh.chipText, form.urgency === o.v && { color: '#fff' }]}>{o.l}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>

            <View style={sh.switchRow}>
              <Text style={sh.switchLabel}>Loan Required</Text>
              <Switch value={form.loanRequired} onValueChange={(v: boolean) => setForm((f: any) => ({ ...f, loanRequired: v }))} trackColor={{ true: colors.brand }} thumbColor="#fff" />
            </View>

            <Field label="Client Notes">
              <TextInput style={[sh.input, { height: 66, textAlignVertical: 'top' }]} multiline placeholder="Any extra details…" placeholderTextColor={colors.muted} value={form.clientNotes} onChangeText={(v: string) => setForm((f: any) => ({ ...f, clientNotes: v }))} />
            </Field>
          </ScrollView>

          <View style={sh.footer}>
            <Pressable onPress={onSubmit} style={[sh.submitBtn, { backgroundColor: colors.brand }]}>
              <Text style={sh.submitText}>Post & Auto-Match 🚀</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ═══════════ Inventory composer (bottom sheet) ═══════════
function InventorySheet({ visible, form, setForm, onClose, onSubmit }: {
  visible: boolean; form: any; setForm: (fn: any) => void; onClose: () => void; onSubmit: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sh.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={sh.sheet}>
          <View style={[sh.head, { backgroundColor: colors.green }]}>
            <Building2 size={18} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={sh.headTitle}>Post Inventory Card</Text>
              <Text style={sh.headSub}>Share what you have available</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}><X size={20} color="#fff" /></Pressable>
          </View>

          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
            <Field label="BHK Options" required>
              <TextInput style={sh.input} placeholder="e.g. 2BHK, 3BHK" placeholderTextColor={colors.muted} value={form.bhkOptions} onChangeText={(v: string) => setForm((f: any) => ({ ...f, bhkOptions: v }))} />
            </Field>

            <View style={sh.row2}>
              <Field label="Min Price (L)" required flex>
                <TextInput style={sh.input} keyboardType="numeric" placeholder="e.g. 50" placeholderTextColor={colors.muted} value={form.min} onChangeText={(v: string) => setForm((f: any) => ({ ...f, min: v }))} />
              </Field>
              <Field label="Max Price (L)" flex>
                <TextInput style={sh.input} keyboardType="numeric" placeholder="e.g. 90" placeholderTextColor={colors.muted} value={form.max} onChangeText={(v: string) => setForm((f: any) => ({ ...f, max: v }))} />
              </Field>
            </View>

            <View style={sh.row2}>
              <Field label="Area / Location" required flex>
                <TextInput style={sh.input} placeholder="e.g. Baner" placeholderTextColor={colors.muted} value={form.area} onChangeText={(v: string) => setForm((f: any) => ({ ...f, area: v }))} />
              </Field>
              <Field label="City" flex>
                <TextInput style={sh.input} placeholder="e.g. Pune" placeholderTextColor={colors.muted} value={form.city} onChangeText={(v: string) => setForm((f: any) => ({ ...f, city: v }))} />
              </Field>
            </View>

            <Field label="Possession Status">
              <View style={sh.chipsWrap}>
                {POSSESSION_STATUS.map(o => (
                  <Pressable key={o.v} onPress={() => setForm((f: any) => ({ ...f, possessionStatus: o.v }))} style={[sh.chip, form.possessionStatus === o.v && { backgroundColor: colors.green, borderColor: colors.green }]}>
                    <Text style={[sh.chipText, form.possessionStatus === o.v && { color: '#fff' }]}>{o.l}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>

            <View style={sh.row2}>
              <View style={[sh.switchRow, { flex: 1, marginTop: 0 }]}>
                <Text style={sh.switchLabel}>Bank Loan</Text>
                <Switch value={form.bankLoanAvailable} onValueChange={(v: boolean) => setForm((f: any) => ({ ...f, bankLoanAvailable: v }))} trackColor={{ true: colors.green }} thumbColor="#fff" />
              </View>
              <Field label="Commission %" flex>
                <TextInput style={sh.input} keyboardType="numeric" placeholder="e.g. 2" placeholderTextColor={colors.muted} value={form.commissionPercent} onChangeText={(v: string) => setForm((f: any) => ({ ...f, commissionPercent: v }))} />
              </Field>
            </View>

            <Field label="Description">
              <TextInput style={[sh.input, { height: 66, textAlignVertical: 'top' }]} multiline placeholder="Highlights, offers…" placeholderTextColor={colors.muted} value={form.description} onChangeText={(v: string) => setForm((f: any) => ({ ...f, description: v }))} />
            </Field>
          </ScrollView>

          <View style={sh.footer}>
            <Pressable onPress={onSubmit} style={[sh.submitBtn, { backgroundColor: colors.green }]}>
              <Text style={sh.submitText}>Post Inventory 📢</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, required, flex, children }: { label: string; required?: boolean; flex?: boolean; children: React.ReactNode }) {
  return (
    <View style={[{ gap: 7 }, flex && { flex: 1 }]}>
      <Text style={sh.label}>{label}{required ? <Text style={{ color: colors.red }}> *</Text> : null}</Text>
      {children}
    </View>
  );
}

// Normalize a posted message from REST into our GroupMessage shape.
function normalizeMsg(m: any, roomId: string): GroupMessage {
  return {
    id: String(m._id || m.id || Date.now()),
    room: String(m.room || roomId),
    sender: { id: String(m.sender?._id || m.sender?.id || ''), name: m.sender?.name || '', role: m.sender?.role || '', companyName: m.sender?.companyName },
    messageType: m.messageType || 'text',
    content: m.content || '',
    requirementCard: m.requirementCard,
    inventoryCard: m.inventoryCard,
    matchResults: m.matchResults,
    createdAt: m.createdAt || new Date().toISOString(),
  };
}

// ── Message bubble ──
function MessageBubble({ msg, meId, onInterested }: {
  msg: GroupMessage; meId: string; onInterested: (projectId: string, messageId: string) => void;
}) {
  const isMe = msg.sender.id === meId;

  if (msg.messageType === 'system') {
    if (msg.content?.startsWith('📋 Project:')) return null;
    return <Text style={mbs.system}>{msg.content}</Text>;
  }

  if (msg.messageType === 'inventory_card' && msg.inventoryCard) {
    const inv = msg.inventoryCard;
    // AI Match Found card — posted from the private AI Assist for the whole group.
    if (inv.aiMatch) {
      return (
        <View style={[mbs.cardWrap, { alignSelf: 'flex-start' }]}>
          <View style={[mbs.card, { backgroundColor: colors.brandTint, borderColor: `${colors.brand}55` }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[mbs.cardTag, { color: colors.brand }]}>🎯 AI Match Found · {msg.sender.name}</Text>
              {inv.score ? <Text style={[mbs.cardTag, { color: colors.brand }]}>{Math.round(inv.score)}%</Text> : null}
            </View>
            <Text style={mbs.cardMain}>{inv.projectName || 'Project'}</Text>
            {(inv.area || inv.city) ? <Text style={mbs.cardSub}>📍 {[inv.area, inv.city].filter(Boolean).join(', ')}</Text> : null}
          </View>
        </View>
      );
    }
    return (
      <View style={[mbs.cardWrap, { alignSelf: 'flex-start' }]}>
        <View style={[mbs.card, { backgroundColor: '#F0FDF4', borderColor: colors.greenBorder }]}>
          <Text style={[mbs.cardTag, { color: colors.greenText }]}>🏠 Inventory · {msg.sender.name}</Text>
          {inv.bhkOptions?.length ? <Text style={mbs.cardMain}>{inv.bhkOptions.join(', ')}</Text> : null}
          <Text style={mbs.cardSub}>📍 {inv.area}{inv.city ? `, ${inv.city}` : ''}</Text>
          <Text style={mbs.cardSub}>💰 {fmtPrice((inv.priceRange?.min || 0) * 100000)}{inv.priceRange?.max ? ` — ${fmtPrice(inv.priceRange.max * 100000)}` : ''}</Text>
          <View style={mbs.tagRow}>
            {inv.bankLoanAvailable && <Tag text="🏦 Loan" />}
            {inv.possessionStatus ? <Tag text={inv.possessionStatus} /> : null}
            {inv.commissionPercent > 0 && <Tag text={`💵 ${inv.commissionPercent}%`} />}
          </View>
          {inv.description ? <Text style={mbs.cardNote}>{inv.description}</Text> : null}
        </View>
      </View>
    );
  }

  if (msg.messageType === 'requirement_card' && msg.requirementCard) {
    const req = msg.requirementCard;
    const matches = msg.matchResults || [];
    return (
      <View style={[mbs.cardWrap, { alignSelf: 'flex-start', gap: 6 }]}>
        <View style={[mbs.card, { backgroundColor: '#FFF8F0', borderColor: `${colors.brand}44` }]}>
          <Text style={[mbs.cardTag, { color: colors.brand }]}>🔍 Requirement · {msg.sender.name}
            {req.urgency === 'urgent' ? '  ⚡ URGENT' : req.urgency === 'very_urgent' ? '  🔥 VERY URGENT' : ''}
          </Text>
          <Text style={mbs.cardMain}>{req.bhkType} · ₹{req.budget}L · {req.area}</Text>
          <View style={mbs.tagRow}>
            {req.city ? <Tag text={req.city} /> : null}
            <Tag text={`🕐 ${req.possessionNeeded}`} />
            {req.loanRequired && <Tag text="🏦 Loan" />}
          </View>
          {req.clientNotes ? <Text style={mbs.cardNote}>📝 {req.clientNotes}</Text> : null}
        </View>

        {matches.length > 0 && (
          <View style={mbs.matchBox}>
            <Text style={mbs.matchTitle}>⚡ {matches.length} Matches Found</Text>
            {matches.map((m: any, i: number) => {
              const p = m.project || {};
              const pid = String(p._id || p.id || '');
              const scoreColor = m.score >= 70 ? colors.greenText : m.score >= 50 ? colors.amberText : colors.muted2;
              return (
                <View key={pid || i} style={mbs.matchRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={mbs.matchName} numberOfLines={1}>{p.projectName || 'Project'}</Text>
                      <Text style={[mbs.matchScore, { color: scoreColor }]}>{m.score}%</Text>
                    </View>
                    <Text style={mbs.matchLoc} numberOfLines={1}>📍 {p.location || p.city || '—'} · {fmtPrice(p.pricing?.startingPrice || 0)}</Text>
                    <View style={mbs.tagRow}>
                      {(m.matchedOn || []).slice(0, 4).map((t: string) => <Tag key={t} text={t} brand />)}
                    </View>
                  </View>
                  <Pressable onPress={() => onInterested(pid, msg.id)} style={mbs.interestedBtn}>
                    <Check size={12} color="#fff" />
                    <Text style={mbs.interestedText}>Interested</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  }

  // image attachment
  if (msg.messageType === 'image' && msg.content) {
    return (
      <View style={[{ flexDirection: 'row' }, isMe ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
        <View style={[mbs.textBubble, isMe ? mbs.textMe : mbs.textThem, { padding: 4 }]}>
          {!isMe && <Text style={[mbs.textSender, { marginHorizontal: 6, marginTop: 4 }]}>{msg.sender.name} · {msg.sender.role}</Text>}
          <Pressable onPress={() => Linking.openURL(msg.content)}>
            <Image source={{ uri: msg.content }} style={mbs.attachImage} resizeMode="cover" />
          </Pressable>
        </View>
      </View>
    );
  }

  // file attachment
  if (msg.messageType === 'file' && msg.content) {
    const fileName = decodeURIComponent(String(msg.content).split('/').pop() || 'File').split('?')[0];
    return (
      <View style={[{ flexDirection: 'row' }, isMe ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
        <View style={[mbs.textBubble, isMe ? mbs.textMe : mbs.textThem]}>
          {!isMe && <Text style={mbs.textSender}>{msg.sender.name} · {msg.sender.role}</Text>}
          <Pressable onPress={() => Linking.openURL(msg.content)} style={mbs.fileRow}>
            <FileText size={18} color={isMe ? '#fff' : colors.brand} />
            <Text style={[mbs.fileName, { color: isMe ? '#fff' : colors.ink }]} numberOfLines={1}>{fileName}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // text
  return (
    <View style={[{ flexDirection: 'row' }, isMe ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
      <View style={[mbs.textBubble, isMe ? mbs.textMe : mbs.textThem]}>
        {!isMe && <Text style={mbs.textSender}>{msg.sender.name} · {msg.sender.role}</Text>}
        <Text style={[mbs.textContent, { color: isMe ? '#fff' : colors.ink }]}>{msg.content}</Text>
      </View>
    </View>
  );
}

function Tag({ text, brand }: { text: string; brand?: boolean }) {
  return (
    <View style={[mbs.tag, brand && { backgroundColor: colors.brandTint }]}>
      <Text style={[mbs.tagText, brand && { color: colors.brand }]}>{text}</Text>
    </View>
  );
}

function Chips({ options, value, onChange, small }: { options: string[]; value: string; onChange: (v: string) => void; small?: boolean }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map(o => (
        <Pressable key={o} onPress={() => onChange(o)} style={[cs.chip, value === o && cs.chipOn, small && { paddingVertical: 6 }]}>
          <Text style={[cs.chipText, value === o && cs.chipTextOn]}>{o}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function SelectRow({ label, options, value, onChange }: { label: string; options: { v: string; l: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={cs.selLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {options.map(o => (
          <Pressable key={o.v} onPress={() => onChange(o.v)} style={[cs.chip, value === o.v && cs.chipOn]}>
            <Text style={[cs.chipText, value === o.v && cs.chipTextOn]}>{o.l}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, marginBottom: 6, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 13, color: colors.ink },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8 },
  listTitle: { fontSize: 12, fontWeight: '700', color: colors.muted2 },
  iconBtn: { padding: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  roomRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12, backgroundColor: colors.white },
  roomRowPinned: { backgroundColor: `${colors.brand}08` },
  roomAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  pinBadge: { backgroundColor: colors.brandTint, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  pinText: { fontSize: 9, fontWeight: '800', color: colors.brand },
  roomName: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  roomMeta: { fontSize: 10.5, color: colors.muted2, marginTop: 1 },
  roomTime: { fontSize: 10, color: colors.muted },
  empty: { alignItems: 'center', paddingVertical: 50, gap: 10 },
  emptyText: { fontSize: 13, color: colors.muted },
  joinBtn: { paddingHorizontal: 16, paddingVertical: 9, backgroundColor: colors.brand, borderRadius: 12, marginTop: 4 },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  discoverRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 12 },
  smallJoin: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: colors.brand },
  smallJoinText: { fontSize: 11.5, fontWeight: '800', color: colors.brand },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.ink },
  fieldInput: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 13, color: colors.ink, backgroundColor: colors.white },
  primaryBtn: { backgroundColor: colors.brand, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  threadHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line, zIndex: 20 },
  threadAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  threadTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink, letterSpacing: -0.2 },
  threadSub: { fontSize: 10.5, color: colors.muted, marginTop: 1 },
  menu: { position: 'absolute', right: 8, top: 52, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingVertical: 4, minWidth: 180, zIndex: 30, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  menuText: { fontSize: 12.5, fontWeight: '600', color: colors.muted2 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.blueBg, borderBottomWidth: 1, borderBottomColor: colors.blueBorder, paddingHorizontal: 14, paddingVertical: 10 },
  bannerIcon: { width: 34, height: 34, borderRadius: 9, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  bannerName: { fontSize: 12.5, fontWeight: '800', color: colors.blueText },
  bannerMeta: { fontSize: 10, color: colors.blueText, marginTop: 1 },

  composer: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 10 },
  quickRow: { flexDirection: 'row', gap: 8 },
  aiInlineBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.brandTint, borderBottomWidth: 1, borderBottomColor: `${colors.brand}33` },
  aiBackBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}33` },
  aiBackText: { fontSize: 11.5, fontWeight: '800', color: colors.brand },
  aiPrivatePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}44`, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  aiPrivateText: { fontSize: 10, fontWeight: '800', color: colors.brand, letterSpacing: 0.2 },
  aiMenuBtn: { padding: 6, borderRadius: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}33` },
  aiMenu: { position: 'absolute', right: 12, top: 46, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingVertical: 4, minWidth: 190, zIndex: 40, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 10 },
  aiMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  aiMenuText: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  // AI Assist overlay (covers the message area while AI mode is active)
  aiOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.cream },
  // Floating AI Assist button over the group chat — compact brand pill, clearly
  // visible but not oversized; brand orange with a subtle darker rim + shadow.
  aiFab: {
    position: 'absolute', right: 14, bottom: 14,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.blue,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22,
    borderWidth: 1, borderColor: colors.blueText,
    shadowColor: colors.blueText, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  aiFabText: { color: '#fff', fontSize: 12.5, fontWeight: '800', letterSpacing: 0.2 },
  quickChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1 },
  quickChipText: { fontSize: 11.5, fontWeight: '800' },
  modeRow: { flexDirection: 'row', gap: 6 },
  modeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  modeBtnActive: { backgroundColor: colors.night, borderColor: colors.night },
  modeText: { fontSize: 10.5, fontWeight: '800', color: colors.muted2 },
  modeTextActive: { color: '#fff' },
  textRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  attachBtn: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  attachRow: { flexDirection: 'row', gap: 10, paddingBottom: 8, paddingHorizontal: 2 },
  attachOpt: { alignItems: 'center', gap: 4 },
  attachIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  attachLabel: { fontSize: 10, fontWeight: '700', color: colors.muted2 },
  textInput: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 21, paddingHorizontal: 16, paddingVertical: 10, fontSize: 13.5, color: colors.ink, backgroundColor: colors.cream, maxHeight: 100, minHeight: 42 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  cardBox: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 9 },
  cardTitle: { fontSize: 12, fontWeight: '800' },
  grid2: { flexDirection: 'row', gap: 8 },
  miniInput: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 12, color: colors.ink, backgroundColor: colors.white },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
  switchLabel: { fontSize: 12, fontWeight: '700', color: colors.ink },
  postBtn: { paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 2 },
  postBtnText: { color: '#fff', fontWeight: '800', fontSize: 12.5 },
});

const pd = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  headSub: { fontSize: 10.5, color: colors.muted2, marginTop: 1 },
  card: { backgroundColor: colors.cream, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  cardLoc: { fontSize: 11, color: colors.muted2, marginTop: 2 },
  cardPrice: { fontSize: 14, fontWeight: '800', color: colors.brand },
  detailList: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, gap: 6 },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  detailLabel: { fontSize: 11, fontWeight: '700', color: colors.muted2 },
  detailValue: { fontSize: 12, fontWeight: '700', color: colors.ink, flexShrink: 1, textAlign: 'right' },
  postBtn: { backgroundColor: colors.green, borderRadius: 14, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  postBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
});

const cs = StyleSheet.create({
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 11, fontWeight: '700', color: colors.muted2 },
  chipTextOn: { color: '#fff' },
  selLabel: { fontSize: 10, fontWeight: '700', color: colors.muted2 },
});

const mbs = StyleSheet.create({
  system: { textAlign: 'center', fontSize: 10, color: colors.muted2, backgroundColor: colors.slateBg, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, overflow: 'hidden' },
  cardWrap: { maxWidth: '90%' },
  card: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 4 },
  cardTag: { fontSize: 10, fontWeight: '800' },
  cardMain: { fontSize: 13, fontWeight: '800', color: colors.ink },
  cardSub: { fontSize: 11, color: colors.muted2 },
  cardNote: { fontSize: 10.5, color: colors.muted, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 3 },
  tag: { backgroundColor: colors.slateBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  tagText: { fontSize: 8.5, fontWeight: '700', color: colors.slateText },
  matchBox: { backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}33`, borderRadius: 16, padding: 10, gap: 8 },
  matchTitle: { fontSize: 11, fontWeight: '800', color: colors.brand },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.cream, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 9 },
  matchName: { fontSize: 11.5, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  matchScore: { fontSize: 10, fontWeight: '800' },
  matchLoc: { fontSize: 9.5, color: colors.muted2, marginTop: 1 },
  interestedBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brand, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  interestedText: { fontSize: 9.5, fontWeight: '800', color: '#fff' },
  textBubble: { maxWidth: '75%', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16 },
  textMe: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  textThem: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 4 },
  textSender: { fontSize: 9, fontWeight: '800', color: colors.brand, marginBottom: 2 },
  textContent: { fontSize: 13, lineHeight: 20 },
  attachImage: { width: 200, height: 200, borderRadius: 12 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  fileName: { fontSize: 12.5, fontWeight: '600', maxWidth: 180 },
});

const sh = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  headTitle: { fontSize: 15, fontWeight: '800', color: '#fff' },
  headSub: { fontSize: 10, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
  label: { fontSize: 11.5, fontWeight: '700', color: colors.muted2 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13.5, color: colors.ink, backgroundColor: colors.cream },
  row2: { flexDirection: 'row', gap: 12 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.muted2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  switchLabel: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  footer: { padding: 14, borderTopWidth: 1, borderTopColor: colors.line },
  submitBtn: { paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  submitText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
