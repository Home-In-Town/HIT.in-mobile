// Lightweight 1:1 chat embedded in the Lead Matching hub.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { ChevronLeft, Send, MessageSquare } from 'lucide-react-native';
import { chatApi, ChatSession, ChatMessage } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { useSocket } from '../hooks/useSocket';
import { useToast } from './Toast';
import { colors } from '../theme';

function timeStr(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function diffStr(iso: string) {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export default function ChatEmbedded() {
  const { user } = useAuth();
  const toast = useToast();
  const socket = useSocket();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [active, setActive] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const flatRef = useRef<FlatList>(null);

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await chatApi.getSessions());
    } catch { /* silent */ }
    finally { setLoadingSessions(false); }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    const unsub = socket.onMessage((msg: any) => {
      const sid = msg.session || msg.sessionId;
      if (sid !== active?.id) return;
      setMessages(prev => [...prev, {
        id: String(msg._id || msg.id || Date.now()),
        sender: { id: String(msg.sender?._id || ''), name: msg.sender?.name || '', role: msg.sender?.role || '' },
        content: msg.content || '',
        messageType: msg.messageType || 'text',
        createdAt: msg.createdAt || new Date().toISOString(),
      }]);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return unsub;
  }, [active?.id, socket.onMessage]);

  const openSession = async (session: ChatSession) => {
    if (active) socket.leaveChat(active.id);
    setActive(session);
    setMessages([]);
    setLoadingMsgs(true);
    socket.joinChat(session.id);
    try {
      setMessages(await chatApi.getMessages(session.id));
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 150);
    } catch { /* silent */ }
    finally { setLoadingMsgs(false); }
    chatApi.markRead(session.id).catch(() => {});
  };

  const send = () => {
    if (!text.trim() || !active) return;
    socket.sendMessage({ sessionId: active.id, content: text.trim() });
    setText('');
  };

  const getPartner = (s: ChatSession) => s.participants.find(p => p.id !== user?.id);
  const initial = (name: string) => (name || '?').charAt(0).toUpperCase();

  if (!active) {
    return (
      <View style={{ flex: 1 }}>
        {loadingSessions ? <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /> : sessions.length === 0 ? (
          <View style={s.empty}>
            <MessageSquare size={28} color={colors.muted} />
            <Text style={s.emptyText}>No conversations yet</Text>
          </View>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={s => s.id}
            renderItem={({ item: session }) => {
              const partner = getPartner(session);
              return (
                <Pressable onPress={() => openSession(session)} style={s.sessionRow}>
                  <View style={s.avatar}><Text style={s.avatarText}>{initial(partner?.name || '')}</Text></View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={s.name}>{partner?.name || 'Unknown'}</Text>
                      <Text style={s.time}>{diffStr(session.updatedAt)}</Text>
                    </View>
                    <Text style={s.lastMsg} numberOfLines={1}>{session.lastMessage || 'Start chatting'}</Text>
                  </View>
                  {session.unreadCount > 0 && (
                    <View style={s.badge}><Text style={s.badgeText}>{session.unreadCount}</Text></View>
                  )}
                </Pressable>
              );
            }}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 60 }} />}
          />
        )}
      </View>
    );
  }

  const partner = getPartner(active);
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.threadHeader}>
        <Pressable onPress={() => { socket.leaveChat(active.id); setActive(null); setMessages([]); }} style={{ padding: 4 }}>
          <ChevronLeft size={20} color={colors.ink} />
        </Pressable>
        <View style={s.avatar}><Text style={s.avatarText}>{initial(partner?.name || '')}</Text></View>
        <Text style={s.name}>{partner?.name || 'Unknown'}</Text>
      </View>
      {loadingMsgs ? <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /> : (
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item: msg }) => {
            const isMe = msg.sender.id === user?.id;
            return (
              <View style={[{ flexDirection: 'row' }, isMe ? { justifyContent: 'flex-end' } : {}]}>
                {!isMe && <View style={[s.avatar, { width: 26, height: 26, marginRight: 6 }]}><Text style={[s.avatarText, { fontSize: 9 }]}>{initial(msg.sender.name)}</Text></View>}
                <View style={[{ maxWidth: '72%', padding: 10, borderRadius: 16 }, isMe ? { backgroundColor: colors.brand } : { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }]}>
                  <Text style={{ fontSize: 13, color: isMe ? '#fff' : colors.ink }}>{msg.content}</Text>
                  <Text style={{ fontSize: 8, color: isMe ? 'rgba(255,255,255,0.6)' : colors.muted, marginTop: 2, textAlign: isMe ? 'right' : 'left' }}>{timeStr(msg.createdAt)}</Text>
                </View>
              </View>
            );
          }}
        />
      )}
      <View style={{ flexDirection: 'row', gap: 8, padding: 12, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line }}>
        <TextInput value={text} onChangeText={setText} placeholder="Message..." placeholderTextColor={colors.muted}
          style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontSize: 13, color: colors.ink, backgroundColor: colors.cream }}
          multiline onSubmitEditing={send} />
        <Pressable onPress={send} disabled={!text.trim()} style={[{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' }, !text.trim() && { opacity: 0.4 }]}>
          <Send size={16} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  empty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 13, color: colors.muted },
  sessionRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10, backgroundColor: colors.white },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  name: { fontSize: 13, fontWeight: '700', color: colors.ink, flex: 1 },
  time: { fontSize: 10, color: colors.muted },
  lastMsg: { fontSize: 11, color: colors.muted2, marginTop: 2 },
  badge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  threadHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
});
