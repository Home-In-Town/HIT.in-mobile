import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MessageSquare, Send, ChevronLeft, Users, Zap, Wifi, Globe,
} from 'lucide-react-native';
import { chatApi, ChatSession, ChatMessage } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authContext';
import { useSocket } from '../../src/hooks/useSocket';
import { useToast } from '../../src/components/Toast';
import { SkeletonRow } from '../../src/components/Skeleton';
import EmptyState from '../../src/components/EmptyState';
import { colors } from '../../src/theme';

function timeStr(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dateDiff(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Builders Network Pulse Bar ─────────────────────────
function BuildersPulseBar() {
  const [pulse, setPulse] = useState<{ onlineNow: number; activeLeadsToday: number; dealsClosedToday: number } | null>(null);

  useEffect(() => {
    chatApi.getBuildersNetwork({ limit: 1 })
      .then((res: any) => { if (res?.pulse) setPulse(res.pulse); })
      .catch(() => {});
  }, []);

  if (!pulse) return null;

  return (
    <View style={pb.bar}>
      <View style={pb.stat}>
        <View style={pb.onlineDot} />
        <Text style={pb.num}>{pulse.onlineNow}</Text>
        <Text style={pb.lbl}>Online</Text>
      </View>
      <View style={pb.divider} />
      <View style={pb.stat}>
        <Zap size={11} color={colors.amberText} />
        <Text style={pb.num}>{pulse.activeLeadsToday}</Text>
        <Text style={pb.lbl}>Active leads</Text>
      </View>
      <View style={pb.divider} />
      <View style={pb.stat}>
        <Globe size={11} color={colors.greenText} />
        <Text style={pb.num}>{pulse.dealsClosedToday}</Text>
        <Text style={pb.lbl}>Deals today</Text>
      </View>
    </View>
  );
}

const pb = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1C1917', paddingHorizontal: 16, paddingVertical: 10 },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ADE80' },
  num: { fontSize: 13, fontWeight: '800', color: '#fff' },
  lbl: { fontSize: 9, color: 'rgba(255,255,255,0.45)', fontWeight: '600' },
  divider: { width: 1, height: 20, backgroundColor: 'rgba(255,255,255,0.12)' },
});

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const toast = useToast();
  const socket = useSocket();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const flatRef = useRef<FlatList>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const data = await chatApi.getSessions();
      setSessions(data);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to load chats', 'error');
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Socket: incoming messages
  useEffect(() => {
    const unsub = socket.onMessage((msg: any) => {
      const msgSessionId = msg.session || msg.sessionId;
      if (msgSessionId === activeSession?.id) {
        const m: ChatMessage = {
          id: String(msg._id || msg.id || Date.now()),
          sender: { id: String(msg.sender?._id || msg.sender?.id || ''), name: msg.sender?.name || '', role: msg.sender?.role || '' },
          content: msg.content || '',
          messageType: msg.messageType || 'text',
          createdAt: msg.createdAt || new Date().toISOString(),
        };
        setMessages(prev => [...prev, m]);
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
      }
      // Update last message in session list
      setSessions(prev => prev.map(s => s.id === msgSessionId
        ? { ...s, lastMessage: msg.content || '', updatedAt: new Date().toISOString() }
        : s
      ));
    });
    return unsub;
  }, [activeSession?.id, socket.onMessage]);

  // Socket: typing
  useEffect(() => {
    const unsub = socket.onTyping((data: any) => {
      if (data.sessionId !== activeSession?.id) return;
      const uid = String(data.userId || data.user?._id || '');
      if (!uid || uid === user?.id) return;
      setTypingUsers(prev => {
        const next = new Set(prev);
        if (data.isTyping) next.add(uid); else next.delete(uid);
        return next;
      });
    });
    return unsub;
  }, [activeSession?.id, user?.id, socket.onTyping]);

  const openSession = async (session: ChatSession) => {
    if (activeSession?.id === session.id) return;
    if (activeSession) socket.leaveChat(activeSession.id);
    setActiveSession(session);
    setMessages([]);
    setLoadingMessages(true);
    socket.joinChat(session.id);
    try {
      const msgs = await chatApi.getMessages(session.id);
      setMessages(msgs);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 150);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to load messages', 'error');
    } finally {
      setLoadingMessages(false);
    }
    chatApi.markRead(session.id).catch(() => {});
  };

  const handleSend = async () => {
    if (!text.trim() || !activeSession || sending) return;
    const content = text.trim();
    setText('');
    setSending(true);
    // Optimistic message
    const tempId = `temp_${Date.now()}`;
    const temp: ChatMessage = {
      id: tempId,
      sender: { id: user?.id || '', name: user?.name || '', role: user?.role || '' },
      content,
      messageType: 'text',
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, temp]);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      socket.sendMessage({ sessionId: activeSession.id, content });
    } catch {
      toast.show('Failed to send', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleTextChange = (t: string) => {
    setText(t);
    if (activeSession) {
      socket.sendTyping(activeSession.id, true);
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => socket.sendTyping(activeSession.id!, false), 2000);
    }
  };

  const getPartnerName = (session: ChatSession): string => {
    const other = session.participants.find(p => p.id !== user?.id);
    return other?.name || 'Unknown';
  };

  const getInitial = (name: string) => (name || '?').charAt(0).toUpperCase();

  // ── Session list ────────────────────────────────────────
  if (!activeSession) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>Messages</Text>
          <Text style={s.sub}>{sessions.length} conversation{sessions.length !== 1 ? 's' : ''}</Text>
        </View>

        {/* Builders Network pulse bar */}
        <BuildersPulseBar />

        {/* Sessions */}
        {loadingSessions ? (
          <View style={{ padding: 16, gap: 10 }}>
            {[0,1,2,3].map(i => <SkeletonRow key={i} />)}
          </View>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={28} color={colors.muted} />}
            title="No messages yet"
            subtitle="Start a conversation with a builder or agent."
          />
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={s => s.id}
            refreshControl={<RefreshControl refreshing={false} onRefresh={loadSessions} tintColor={colors.brand} />}
            renderItem={({ item: session }) => {
              const name = getPartnerName(session);
              return (
                <Pressable onPress={() => openSession(session)} style={sl.row}>
                  <View style={sl.avatar}>
                    <Text style={sl.avatarText}>{getInitial(name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={sl.rowTop}>
                      <Text style={sl.name}>{name}</Text>
                      <Text style={sl.time}>{dateDiff(session.updatedAt)}</Text>
                    </View>
                    <Text style={sl.lastMsg} numberOfLines={1}>{session.lastMessage || 'Start chatting'}</Text>
                  </View>
                  {session.unreadCount > 0 && (
                    <View style={sl.unreadBadge}>
                      <Text style={sl.unreadText}>{session.unreadCount}</Text>
                    </View>
                  )}
                </Pressable>
              );
            }}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 72 }} />}
          />
        )}
      </View>
    );
  }

  // ── Message thread ────────────────────────────────────────
  const partnerName = getPartnerName(activeSession);

  return (
    <KeyboardAvoidingView
      style={[s.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.bottom}
    >
      {/* Thread header */}
      <View style={s.threadHeader}>
        <Pressable onPress={() => { socket.leaveChat(activeSession.id); setActiveSession(null); setMessages([]); }} style={s.backBtn}>
          <ChevronLeft size={22} color={colors.ink} />
        </Pressable>
        <View style={sl.avatar}>
          <Text style={sl.avatarText}>{getInitial(partnerName)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.threadName}>{partnerName}</Text>
          {typingUsers.size > 0 && <Text style={s.typingText}>typing…</Text>}
        </View>
      </View>

      {/* Messages */}
      {loadingMessages ? (
        <View style={s.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          renderItem={({ item: msg }) => {
            const isMe = msg.sender.id === user?.id;
            return (
              <View style={[mb.wrap, isMe ? mb.wrapMe : mb.wrapThem]}>
                {!isMe && (
                  <View style={mb.avatarSmall}>
                    <Text style={mb.avatarSmallText}>{getInitial(msg.sender.name)}</Text>
                  </View>
                )}
                <View style={[mb.bubble, isMe ? mb.bubbleMe : mb.bubbleThem]}>
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
          onChangeText={handleTextChange}
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
  header: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 21, fontWeight: 'bold', color: colors.ink },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  emptyDesc: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  threadHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  backBtn: { padding: 4 },
  threadName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  typingText: { fontSize: 11, color: colors.muted, fontStyle: 'italic' },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingTop: 10, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.ink, backgroundColor: colors.cream },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});

const sl = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, backgroundColor: colors.white },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between' },
  name: { fontSize: 14, fontWeight: '700', color: colors.ink },
  time: { fontSize: 11, color: colors.muted },
  lastMsg: { fontSize: 12, color: colors.muted2, marginTop: 2 },
  unreadBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadText: { fontSize: 10, fontWeight: '700', color: '#fff' },
});

const mb = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  wrapMe: { justifyContent: 'flex-end' },
  wrapThem: { justifyContent: 'flex-start' },
  avatarSmall: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.slateBg, alignItems: 'center', justifyContent: 'center' },
  avatarSmallText: { fontSize: 10, fontWeight: '700', color: colors.slateText },
  bubble: { maxWidth: '72%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, gap: 2 },
  bubbleMe: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 4 },
  text: { fontSize: 14, lineHeight: 21 },
  textMe: { color: '#fff' },
  textThem: { color: colors.ink },
  time: { fontSize: 9 },
  timeMe: { color: 'rgba(255,255,255,0.65)', textAlign: 'right' },
  timeThem: { color: colors.muted, textAlign: 'left' },
});
