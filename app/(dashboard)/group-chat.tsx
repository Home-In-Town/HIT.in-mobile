import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, Modal, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Users, ChevronLeft, Send, Plus, Hash, Globe, X } from 'lucide-react-native';
import { groupChatApi, GroupRoom, GroupMessage } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authContext';
import { useSocket } from '../../src/hooks/useSocket';
import { useToast } from '../../src/components/Toast';
import { colors } from '../../src/theme';

function timeStr(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString();
}

const ROOM_ICON = { project: '🏗', area: '📍', universal: '🌐' };

export default function GroupChatScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const toast = useToast();
  const socket = useSocket();

  const [myRooms, setMyRooms] = useState<GroupRoom[]>([]);
  const [discoverRooms, setDiscoverRooms] = useState<GroupRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<GroupRoom | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [roomForm, setRoomForm] = useState({ name: '', city: '', location: '', description: '' });
  const [creating, setCreating] = useState(false);
  const flatRef = useRef<FlatList>(null);

  const loadRooms = useCallback(async () => {
    try {
      const data = await groupChatApi.getRooms();
      setMyRooms(data.myRooms);
      setDiscoverRooms(data.discoverRooms);
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  // Real-time incoming messages
  useEffect(() => {
    const unsub = socket.onGroupMessage((msg: any) => {
      const roomId = msg.room || msg.roomId;
      if (roomId !== activeRoom?.id) return;
      const m: GroupMessage = {
        id: String(msg._id || msg.id || Date.now()),
        room: roomId,
        sender: { id: String(msg.sender?._id || msg.sender?.id || ''), name: msg.sender?.name || '', role: msg.sender?.role || '', companyName: msg.sender?.companyName },
        messageType: msg.messageType || 'text',
        content: msg.content || '',
        requirementCard: msg.requirementCard,
        inventoryCard: msg.inventoryCard,
        matchResults: msg.matchResults,
        createdAt: msg.createdAt || new Date().toISOString(),
      };
      setMessages(prev => [...prev, m]);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return unsub;
  }, [activeRoom?.id, socket.onGroupMessage]);

  const openRoom = async (room: GroupRoom) => {
    if (activeRoom) socket.leaveGroup(activeRoom.id);
    setActiveRoom(room);
    setMessages([]);
    setLoadingMsgs(true);
    socket.joinGroup(room.id);
    try {
      const msgs = await groupChatApi.getMessages(room.id);
      setMessages(msgs);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 150);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to load messages', 'error');
    } finally {
      setLoadingMsgs(false);
    }
  };

  const handleJoin = async (room: GroupRoom) => {
    try {
      const joined = await groupChatApi.joinRoom(room.id);
      setMyRooms(prev => [joined, ...prev]);
      setDiscoverRooms(prev => prev.filter(r => r.id !== room.id));
      setShowDiscover(false);
      openRoom(joined);
      toast.show('Joined!', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    }
  };

  const handleSend = async () => {
    if (!text.trim() || !activeRoom || sending) return;
    const content = text.trim();
    setText('');
    setSending(true);
    try {
      socket.sendGroupMessage({ roomId: activeRoom.id, content, messageType: 'text' });
    } catch {
      toast.show('Failed to send', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleCreate = async () => {
    if (!roomForm.name.trim() || !roomForm.city.trim() || !roomForm.location.trim()) {
      toast.show('Name, city, and location required', 'error'); return;
    }
    setCreating(true);
    try {
      const room = await groupChatApi.createRoom({
        name: roomForm.name.trim(),
        roomType: 'area',
        area: { city: roomForm.city.trim(), location: roomForm.location.trim() },
        description: roomForm.description.trim(),
      });
      setMyRooms(prev => [room, ...prev]);
      setShowCreate(false);
      setRoomForm({ name: '', city: '', location: '', description: '' });
      openRoom(room);
      toast.show('Room created!', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setCreating(false);
    }
  };

  // ── Room list ────────────────────────────────────────────
  if (!activeRoom) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>Group Chat</Text>
            <Text style={s.sub}>{myRooms.length} rooms</Text>
          </View>
          <View style={s.headerBtns}>
            <Pressable onPress={() => setShowDiscover(true)} style={s.headerBtn}>
              <Globe size={16} color={colors.brand} />
            </Pressable>
            <Pressable onPress={() => setShowCreate(true)} style={s.headerBtn}>
              <Plus size={16} color={colors.brand} />
            </Pressable>
          </View>
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator color={colors.brand} size="large" /></View>
        ) : myRooms.length === 0 ? (
          <View style={s.emptyWrap}>
            <Users size={40} color={colors.muted} />
            <Text style={s.emptyTitle}>No rooms yet</Text>
            <Text style={s.emptyDesc}>Join or create a group to start collaborating.</Text>
            <Pressable onPress={() => setShowDiscover(true)} style={s.discoverBtn}>
              <Text style={s.discoverBtnText}>Discover Rooms</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={myRooms}
            keyExtractor={r => r.id}
            renderItem={({ item: room }) => (
              <Pressable onPress={() => openRoom(room)} style={rl.row}>
                <View style={rl.iconBox}>
                  <Text style={rl.roomIcon}>{ROOM_ICON[room.roomType] || '💬'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={rl.rowTop}>
                    <Text style={rl.name} numberOfLines={1}>{room.name}</Text>
                    <Text style={rl.time}>{timeStr(room.lastActivity)}</Text>
                  </View>
                  <Text style={rl.members}>{room.members.length} members</Text>
                </View>
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 64 }} />}
          />
        )}

        {/* Discover Modal */}
        <Modal visible={showDiscover} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowDiscover(false)}>
          <View style={s.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Discover Rooms</Text>
              <Pressable onPress={() => setShowDiscover(false)}><X size={22} color={colors.ink} /></Pressable>
            </View>
            <FlatList
              data={discoverRooms}
              keyExtractor={r => r.id}
              contentContainerStyle={{ padding: 16, gap: 10 }}
              ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.muted, marginTop: 40 }}>No rooms to discover</Text>}
              renderItem={({ item: room }) => (
                <View style={rl.discoverRow}>
                  <Text style={rl.discoverIcon}>{ROOM_ICON[room.roomType] || '💬'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={rl.name}>{room.name}</Text>
                    <Text style={rl.members}>{room.members.length} members · {room.area?.city || room.project?.city || ''}</Text>
                  </View>
                  <Pressable onPress={() => handleJoin(room)} style={rl.joinBtn}>
                    <Text style={rl.joinBtnText}>Join</Text>
                  </Pressable>
                </View>
              )}
            />
          </View>
        </Modal>

        {/* Create Room Modal */}
        <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCreate(false)}>
          <View style={s.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Create Room</Text>
              <Pressable onPress={() => setShowCreate(false)}><X size={22} color={colors.ink} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
              {[{ label: 'Room Name *', key: 'name', placeholder: 'e.g. Pune Builders' },
                { label: 'City *', key: 'city', placeholder: 'e.g. Pune' },
                { label: 'Location *', key: 'location', placeholder: 'e.g. Baner, Wakad' },
                { label: 'Description', key: 'description', placeholder: 'Short description...' }].map(f => (
                <View key={f.key} style={{ gap: 5 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }}>{f.label}</Text>
                  <TextInput
                    value={(roomForm as any)[f.key]}
                    onChangeText={v => setRoomForm(rf => ({ ...rf, [f.key]: v }))}
                    placeholder={f.placeholder}
                    placeholderTextColor={colors.muted}
                    style={s.input}
                  />
                </View>
              ))}
              <Pressable onPress={handleCreate} disabled={creating} style={[s.createBtn, creating && { opacity: 0.6 }]}>
                {creating ? <ActivityIndicator color="#fff" /> : <Text style={s.createBtnText}>Create Room</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </Modal>
      </View>
    );
  }

  // ── Room chat thread ─────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[s.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.threadHeader}>
        <Pressable onPress={() => { socket.leaveGroup(activeRoom.id); setActiveRoom(null); setMessages([]); }} style={s.backBtn}>
          <ChevronLeft size={22} color={colors.ink} />
        </Pressable>
        <Text style={s.roomIcon}>{ROOM_ICON[activeRoom.roomType] || '💬'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.threadName} numberOfLines={1}>{activeRoom.name}</Text>
          <Text style={s.threadSub}>{activeRoom.members.length} members</Text>
        </View>
      </View>

      {loadingMsgs ? (
        <View style={s.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          renderItem={({ item: msg }) => {
            const isMe = msg.sender.id === user?.id;
            if (msg.messageType === 'system') {
              return <Text style={mb.system}>{msg.content}</Text>;
            }
            if (msg.messageType === 'requirement_card' && msg.requirementCard) {
              const rc = msg.requirementCard;
              return (
                <View style={mb.cardBubble}>
                  <Text style={mb.cardTitle}>🔍 Buyer Requirement</Text>
                  <Text style={mb.cardLine}>{rc.bhkType} · ₹{rc.budget}L · {rc.area}, {rc.city}</Text>
                  <Text style={mb.cardLine}>Possession: {rc.possessionNeeded} · Loan: {rc.loanRequired ? 'Yes' : 'No'}</Text>
                  <Text style={mb.cardFooter}>by {msg.sender.name} · {timeStr(msg.createdAt)}</Text>
                </View>
              );
            }
            if (msg.messageType === 'inventory_card' && msg.inventoryCard) {
              const ic = msg.inventoryCard;
              return (
                <View style={[mb.cardBubble, { borderLeftColor: colors.green }]}>
                  <Text style={mb.cardTitle}>🏠 Inventory Available</Text>
                  <Text style={mb.cardLine}>{ic.bhkOptions?.join('/')} · ₹{ic.priceRange?.min}L–₹{ic.priceRange?.max}L</Text>
                  <Text style={mb.cardLine}>{ic.area}, {ic.city} · Commission: {ic.commissionPercent}%</Text>
                  <Text style={mb.cardFooter}>by {msg.sender.name} · {timeStr(msg.createdAt)}</Text>
                </View>
              );
            }
            return (
              <View style={[mb.wrap, isMe ? mb.wrapMe : mb.wrapThem]}>
                {!isMe && (
                  <View style={mb.avatarSmall}>
                    <Text style={mb.avatarSmallText}>{(msg.sender.name || '?').charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <View style={[mb.bubble, isMe ? mb.bubbleMe : mb.bubbleThem]}>
                  {!isMe && <Text style={mb.senderName}>{msg.sender.name}{msg.sender.companyName ? ` · ${msg.sender.companyName}` : ''}</Text>}
                  <Text style={[mb.text, isMe ? mb.textMe : mb.textThem]}>{msg.content}</Text>
                  <Text style={[mb.time, isMe ? mb.timeMe : mb.timeThem]}>{timeStr(msg.createdAt)}</Text>
                </View>
              </View>
            );
          }}
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Input */}
      <View style={[s.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Type a message..."
          placeholderTextColor={colors.muted}
          style={s.input}
          multiline
          maxLength={1000}
        />
        <Pressable onPress={handleSend} disabled={!text.trim() || sending} style={[s.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}>
          {sending ? <ActivityIndicator color="#fff" size="small" /> : <Send size={18} color="#fff" />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 22, fontWeight: 'bold', color: colors.ink },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  headerBtns: { flexDirection: 'row', gap: 8 },
  headerBtn: { padding: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  emptyDesc: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  discoverBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: colors.brand, borderRadius: 12 },
  discoverBtnText: { color: '#fff', fontWeight: '700' },
  threadHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  backBtn: { padding: 4 },
  roomIcon: { fontSize: 20 },
  threadName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  threadSub: { fontSize: 12, color: colors.muted },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingTop: 10, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: colors.ink, backgroundColor: colors.cream },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  modal: { flex: 1, backgroundColor: colors.cream },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: colors.ink },
  createBtn: { backgroundColor: colors.brand, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  createBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

const rl = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, backgroundColor: colors.white },
  iconBox: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.slateBg, alignItems: 'center', justifyContent: 'center' },
  roomIcon: { fontSize: 20 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between' },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink, flex: 1 },
  time: { fontSize: 12, color: colors.muted },
  members: { fontSize: 12, color: colors.muted2, marginTop: 2 },
  discoverRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10 },
  discoverIcon: { fontSize: 22 },
  joinBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: colors.brand },
  joinBtnText: { fontSize: 13, fontWeight: '700', color: colors.brand },
});

const mb = StyleSheet.create({
  system: { textAlign: 'center', fontSize: 12, color: colors.muted, fontStyle: 'italic', marginVertical: 4 },
  wrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  wrapMe: { justifyContent: 'flex-end' },
  wrapThem: { justifyContent: 'flex-start' },
  avatarSmall: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.slateBg, alignItems: 'center', justifyContent: 'center' },
  avatarSmallText: { fontSize: 11, fontWeight: '700', color: colors.slateText },
  bubble: { maxWidth: '72%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, gap: 2 },
  bubbleMe: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 4 },
  senderName: { fontSize: 11, fontWeight: '700', color: colors.brand, marginBottom: 2 },
  text: { fontSize: 15, lineHeight: 21 },
  textMe: { color: '#fff' },
  textThem: { color: colors.ink },
  time: { fontSize: 10 },
  timeMe: { color: 'rgba(255,255,255,0.65)', textAlign: 'right' },
  timeThem: { color: colors.muted, textAlign: 'left' },
  cardBubble: { borderLeftWidth: 3, borderLeftColor: colors.brand, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 12, maxWidth: '80%', gap: 4 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  cardLine: { fontSize: 12, color: colors.muted2 },
  cardFooter: { fontSize: 11, color: colors.muted, marginTop: 2 },
});
