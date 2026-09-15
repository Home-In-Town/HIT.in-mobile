// AI Assistant (Lead Matching) — native port of the website's AiAssistantChat.
// Deterministic slot-filling chat: the backend drives the flow via message
// `template`s; this screen renders the right control for each template and
// posts answers. Mirrors web behavior: choice chips / intent cards, number+unit,
// phone (+91, prefill), text/location, skip, summary + edit, results cards,
// actions tray, progress bar, and a typing indicator.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator,
  TextInput, KeyboardAvoidingView, Platform, Modal, FlatList,
} from 'react-native';
import {
  Send, Building2, MapPin, Check, Pencil, Plus, List as ListIcon,
  ArrowRight, CheckCircle2, Undo2, Redo2, RotateCcw, XCircle, Users as UsersIcon, X as XIcon,
} from 'lucide-react-native';
import { leadChatApi, groupChatApi, GroupRoom } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { useToast } from './Toast';
import { colors } from '../theme';

const SKIP_VALUE = '__skipped__';
const TYPING_MS = 600;

// ── Types (loose — backend returns `any`) ──
interface Option { value: string; label: { en: string; hi: string } }
interface Template {
  slotId?: string;
  inputType?: string;
  options?: any;
  unit?: string[];
  skippable?: boolean;
  allowCustom?: boolean;
  prefill?: string;
  progress?: { current: number; total: number };
}
interface Msg {
  _id: string;
  sender: any;
  content: string;
  messageType: 'text' | 'system';
  template?: Template;
  createdAt: string;
}

const INTENT_ICON: Record<string, string> = { sell: '🏷️', buy: '🔑', rent: '🏠' };

function fmtTime(ts: string) {
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

export type AiAssistantApi = {
  submitFreeText: (raw: string) => void;
  activeTemplate: Template | undefined;
  sending: boolean;
  typing: boolean;
  // End the current AI session (stops the conversation; keeps any found match).
  endChat: () => void;
  // Run matching on the collected requirement; reveals ALL matches with scores.
  runMatching: () => void;
  // Returns the property details the AI has collected so far (for the Post card).
  getPostDraft: () => AiPostDraft;
};

export type AiPostDraft = {
  intent: string | null; // 'sell' | 'rent' | 'buy' | null
  isSellable: boolean;    // true when intent is sell/rent (a postable property)
  fields: { label: string; value: string }[]; // labeled details for the card
  title: string;          // e.g. "3BHK Apartment" or property type
  subtitle: string;       // e.g. "Civil Lines, Nagpur"
  price: string;          // formatted price if known
};

export default function AiAssistant({
  onViewLeads,
  onActiveChange,
  groupContext,
  onMatchShared,
  hideOwnChrome = false,
  onReady,
}: {
  onViewLeads?: () => void;
  onActiveChange?: (active: boolean) => void;
  // When the assistant runs inside a group, matches can be shared directly to
  // that room (one-tap) instead of opening the room picker. The private AI
  // conversation still lives in the user's own assistant thread.
  groupContext?: { roomId: string; roomName: string };
  onMatchShared?: () => void;
  // When true (used inside the group), hide the assistant's own control bar and
  // free-text input; the host (group composer) drives text answers instead.
  // Choice/multichoice chips still render inline as part of the chat area.
  hideOwnChrome?: boolean;
  // Exposes an imperative API so the host can route its single input box here.
  onReady?: (api: AiAssistantApi) => void;
}) {
  const { user } = useAuth();
  const toast = useToast();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [flowState, setFlowState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [ended, setEnded] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // ── Undo / Redo history ──
  // Each entry is a snapshot of the visible transcript + flow state. We push a
  // snapshot right before a state-changing action so Undo can restore it.
  type Snap = { messages: Msg[]; flowState: any };
  const [undoStack, setUndoStack] = useState<Snap[]>([]);
  const [redoStack, setRedoStack] = useState<Snap[]>([]);

  const snapshot = useCallback(() => {
    setUndoStack(prev => [...prev, { messages, flowState }]);
    setRedoStack([]); // any new action invalidates the redo history
  }, [messages, flowState]);

  const undo = useCallback(() => {
    setUndoStack(prev => {
      if (prev.length === 0) { toast.show('Kuch undo karne ko nahi hai', 'info'); return prev; }
      const last = prev[prev.length - 1];
      setRedoStack(r => [...r, { messages, flowState }]);
      setMessages(last.messages);
      setFlowState(last.flowState);
      return prev.slice(0, -1);
    });
  }, [messages, flowState, toast]);

  const redo = useCallback(() => {
    setRedoStack(prev => {
      if (prev.length === 0) { toast.show('Kuch redo karne ko nahi hai', 'info'); return prev; }
      const next = prev[prev.length - 1];
      setUndoStack(u => [...u, { messages, flowState }]);
      setMessages(next.messages);
      setFlowState(next.flowState);
      return prev.slice(0, -1);
    });
  }, [messages, flowState, toast]);

  const scrollDown = useCallback((delay = 80) => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), delay);
  }, []);

  // ── Open — ALWAYS start a fresh session ──
  // We never show the previous AI Q&A / answers. We only keep the LATEST match
  // result (if one exists) so the user still sees their last matched property,
  // then we reset the flow to Step 1 so every open begins a brand-new session.
  // The backend history/match data is preserved (nothing is deleted).
  const open = useCallback(async () => {
    setLoading(true);
    try {
      const res = await leadChatApi.open();
      const sid = res.sessionId;
      sessionIdRef.current = sid;

      // Find the most recent match-results message from the persisted history.
      const history: Msg[] = res.messages || [];
      const latestResult = [...history].reverse().find(
        (m) => m.messageType === 'system' && m.template?.inputType === 'results'
      );

      // Reset the backend flow to a fresh Step-1 intent question.
      let freshQuestion: Msg | null = null;
      try {
        const fresh = await leadChatApi.newLead(sid);
        setFlowState(fresh.flowState);
        freshQuestion = fresh.message || null;
      } catch {
        // If reset fails, fall back to whatever the open returned.
        setFlowState(res.flowState);
      }

      // Show only: [previous match result (if any)] + [fresh Step-1 question].
      const initial: Msg[] = [];
      if (latestResult) initial.push(latestResult);
      if (freshQuestion) initial.push(freshQuestion);
      setMessages(initial);
      // Clear undo/redo history so old state can't be restored.
      setUndoStack([]);
      setRedoStack([]);
      scrollDown(200);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to open assistant', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { open(); }, [open]);

  // Reveal assistant message(s) after a short "typing" delay.
  const reveal = useCallback((newMsgs: Msg[]) => {
    setTyping(true);
    scrollDown(60);
    setTimeout(() => {
      setMessages(prev => [...prev, ...newMsgs.filter(Boolean)]);
      setTyping(false);
      scrollDown(60);
    }, TYPING_MS);
  }, [scrollDown]);

  // ── Submit an answer for the active slot ──
  const submit = useCallback(async (slotId: string, value: any, displayText: string) => {
    const sid = sessionIdRef.current;
    if (!sid || sending) return;
    snapshot();
    setSending(true);
    // Optimistic user bubble
    const optimistic: Msg = {
      _id: `tmp_${Date.now()}`, sender: user?.id || 'me',
      content: displayText, messageType: 'text', createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    scrollDown(60);
    try {
      const res = await leadChatApi.answer({ sessionId: sid, slotId, value });
      setFlowState(res.flowState);
      reveal([res.message]);
    } catch (e: any) {
      setMessages(prev => prev.filter(m => m._id !== optimistic._id));
      toast.show(e?.message || 'Could not submit answer', 'error');
    } finally {
      setSending(false);
    }
  }, [sending, user?.id, reveal, scrollDown, snapshot]);

  // ── Edit a slot from the summary ──
  const edit = useCallback(async (slotId: string) => {
    const sid = sessionIdRef.current;
    if (!sid || sending) return;
    try {
      const res = await leadChatApi.edit({ sessionId: sid, slotId });
      setFlowState(res.flowState);
      reveal([res.message]);
    } catch (e: any) {
      toast.show(e?.message || 'Could not edit', 'error');
    }
  }, [sending, reveal]);

  // ── Confirm & find matches ──
  const confirm = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || sending) return;
    snapshot();
    setSending(true);
    try {
      const res = await leadChatApi.confirm(sid);
      setFlowState(res.flowState);
      reveal([res.resultsMessage, res.closingMessage, res.actionsMessage]);
    } catch (e: any) {
      toast.show(e?.message || 'Could not confirm', 'error');
    } finally {
      setSending(false);
    }
  }, [sending, reveal, snapshot]);

  // ── Start a fresh lead ──
  const newLead = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || sending) return;
    snapshot();
    setSending(true);
    try {
      const res = await leadChatApi.newLead(sid);
      setFlowState(res.flowState);
      reveal([res.message]);
    } catch (e: any) {
      toast.show(e?.message || 'Could not start a new requirement', 'error');
    } finally {
      setSending(false);
    }
  }, [sending, reveal, snapshot]);

  // ── Chat controls: End / Restart ──
  // End Chat: stop the visible session (user can tap "Start" to reopen).
  const endChat = useCallback(() => {
    setEnded(true);
    setUndoStack([]);
    setRedoStack([]);
    toast.show('Chat ended', 'info');
  }, [toast]);

  // Restart Chat: start a fresh requirement flow from scratch.
  const restartChat = useCallback(async () => {
    if (ended) { setEnded(false); await open(); return; }
    setUndoStack([]);
    setRedoStack([]);
    await newLead();
  }, [ended, newLead, open]);

  // Reopen from the ended state.
  const resumeChat = useCallback(async () => {
    setEnded(false);
    await open();
  }, [open]);

  // ── Add matched project to a group ──
  const [addTarget, setAddTarget] = useState<MatchCard | null>(null);
  const [rooms, setRooms] = useState<GroupRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [addingRoomId, setAddingRoomId] = useState<string | null>(null);

  // Shared helper: post a match card into a given room as an "AI Match Found" card.
  const shareMatchToRoom = useCallback(async (roomId: string, m: MatchCard) => {
    await groupChatApi.postMessage(roomId, {
      messageType: 'inventory_card',
      inventoryCard: {
        aiMatch: true,
        projectId: m.projectId,
        projectName: m.projectName,
        area: m.location || '',
        city: m.city || '',
        score: m.score,
        description: `🎯 AI Match Found — ${m.projectName}`,
      },
    });
  }, []);

  const openAddToGroup = useCallback(async (m: MatchCard) => {
    // Inside a group → post straight to that room (no picker).
    if (groupContext?.roomId) {
      setAddingRoomId(m.projectId);
      try {
        await shareMatchToRoom(groupContext.roomId, m);
        toast.show(`Shared to ${groupContext.roomName} 🎯`, 'success');
        onMatchShared?.();
      } catch (e: any) {
        toast.show(e?.message || 'Could not share to group', 'error');
      } finally {
        setAddingRoomId(null);
      }
      return;
    }
    // Otherwise open the room picker.
    setAddTarget(m);
    setRoomsLoading(true);
    try {
      const { myRooms } = await groupChatApi.getRooms();
      setRooms(myRooms || []);
    } catch (e: any) {
      toast.show(e?.message || 'Could not load your groups', 'error');
      setRooms([]);
    } finally {
      setRoomsLoading(false);
    }
  }, [toast, groupContext, shareMatchToRoom, onMatchShared]);

  const addToRoom = useCallback(async (room: GroupRoom) => {
    if (!addTarget) return;
    setAddingRoomId(room.id);
    try {
      await shareMatchToRoom(room.id, addTarget);
      toast.show(`Added to ${room.name} ✅`, 'success');
      setAddTarget(null);
    } catch (e: any) {
      toast.show(e?.message || 'Could not add to group', 'error');
    } finally {
      setAddingRoomId(null);
    }
  }, [addTarget, toast, shareMatchToRoom]);

  // ── Matching (finding properties) ──
  // Runs the existing matching on the collected requirement (confirm → persists
  // lead + runs MatchEngine over real Projects/Marketplace data) and reveals ALL
  // matching properties with their score in the private AI panel. It does NOT
  // post anything to the group — the user can share any card via "Add to Group".
  const runMatching = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || sending) return;
    setSending(true);
    try {
      const res = await leadChatApi.confirm(sid);
      setFlowState(res.flowState);
      reveal([res.resultsMessage, res.closingMessage, res.actionsMessage].filter(Boolean) as Msg[]);
      const matches: MatchCard[] = res.resultsMessage?.template?.options?.matches || [];
      if (!matches.length) {
        toast.show('Abhi koi match nahi mila — thodi aur detail add karein.', 'info');
      } else {
        toast.show(`${matches.length} matching ${matches.length === 1 ? 'property' : 'properties'} mili 🎯`, 'success');
      }
    } catch (e: any) {
      // Backend rejects confirm when the conversation isn't complete yet.
      toast.show(e?.message || 'Pehle kuch aur sawaalon ke jawab dein, phir match karein.', 'info');
    } finally {
      setSending(false);
    }
  }, [sending, reveal, toast]);

  // ── Build a Post draft from the AI-collected details ──
  // Reuses the details the user already gave the assistant (no manual re-entry).
  // Prefers the labeled summary values (if the flow reached the summary), else
  // derives labeled fields from the raw collected slots.
  const getPostDraft = useCallback((): AiPostDraft => {
    const intent: string | null = flowState?.intent ?? null;
    const isSellable = intent === 'sell' || intent === 'rent';

    // Preferred source: latest summary message's labeled values.
    const summaryMsg = [...messages].reverse().find(
      (m) => m.messageType === 'system' && m.template?.inputType === 'summary'
    );
    const summaryValues: { slotId: string; label: string; display: string }[] =
      summaryMsg?.template?.options?.values || [];

    const SKIPPED = /^skip/i;
    let fields: { label: string; value: string }[] = [];

    if (summaryValues.length) {
      fields = summaryValues
        .filter(v => v.display && !SKIPPED.test(v.display))
        .map(v => ({ label: v.label, value: v.display }));
    } else {
      // Fallback: derive from raw slots with human labels.
      const slots = flowState?.slots || {};
      const LABELS: Record<string, string> = {
        propertyTypeDetailed: 'Property Type', propertyType: 'Property Type',
        category: 'Category', bhk: 'BHK', location: 'Location', city: 'City',
        area: 'Area', expectedPrice: 'Price', projectStatus: 'Status',
        possession: 'Possession', reraApproved: 'RERA', bankLoanAvailable: 'Bank Loan',
        amenities: 'Amenities', urgency: 'Urgency', contact: 'Contact',
      };
      const fmtSlot = (v: any): string => {
        if (v == null) return '';
        if (Array.isArray(v)) return v.join(', ');
        if (typeof v === 'object') return v.unit ? `${v.value} ${v.unit}` : String(v.value ?? '');
        return String(v);
      };
      fields = Object.entries(slots)
        .filter(([k]) => LABELS[k])
        .map(([k, v]) => ({ label: LABELS[k], value: fmtSlot(v) }))
        .filter(f => f.value && !SKIPPED.test(f.value));
    }

    const findVal = (labelRe: RegExp) => fields.find(f => labelRe.test(f.label))?.value || '';
    const title = findVal(/property type|type|bhk|category/i) || (isSellable ? 'Your Property' : 'Requirement');
    const loc = findVal(/location/i);
    const city = findVal(/city/i);
    const subtitle = [loc, city].filter(Boolean).join(', ');
    const price = findVal(/price/i);

    return { intent, isSellable, fields, title, subtitle, price };
  }, [flowState, messages]);

  // The active template = last system message that carries one.
  const lastAssistant = [...messages].reverse().find(m => m.messageType === 'system' && m.template);
  const activeTemplate = lastAssistant?.template;
  const progress = activeTemplate?.progress;
  const progressPct = progress && progress.total ? Math.round((progress.current / progress.total) * 100) : 0;

  const showAnswerBar = !typing && activeTemplate?.inputType &&
    !['summary', 'results', 'actions'].includes(activeTemplate.inputType);

  // ── Route a free-text answer through the correct backend call (mirrors the
  //    PersistentChatBar routing). Used by the host group composer when the
  //    assistant's own input is hidden. ──
  const submitFreeText = useCallback((raw: string) => {
    const trimmed = (raw || '').trim();
    if (!trimmed || sending || typing) return;
    const type = activeTemplate?.inputType;
    const slotId = activeTemplate?.slotId || '';
    const isCompleted = flowState?.status === 'completed';

    // No active question (completed / fresh) → start a new requirement.
    if (!activeTemplate || isCompleted) { newLead(); return; }
    // Locked states (summary/results/actions) → ignore free text.
    if (['summary', 'results', 'actions'].includes(type || '')) return;

    if (type === 'phone') {
      const digits = trimmed.replace(/\D/g, '').slice(0, 10);
      if (digits.length < 10) return;
      submit(slotId, digits, digits);
      return;
    }
    if (type === 'number') {
      const num = trimmed.replace(/[^\d.]/g, '');
      if (!num) return;
      const units = activeTemplate.unit || [];
      const value = units.length ? { value: num, unit: units[0] } : num;
      const display = units.length ? `${num} ${units[0]}` : num;
      submit(slotId, value, display);
      return;
    }
    // text / location / choice / multichoice free-text
    submit(slotId, trimmed, trimmed);
  }, [activeTemplate, flowState, sending, typing, submit, newLead]);

  // Expose the imperative API to the host (group composer) when requested.
  useEffect(() => {
    if (!onReady) return;
    onReady({ submitFreeText, activeTemplate, sending, typing, endChat, runMatching, getPostDraft });
  }, [onReady, submitFreeText, activeTemplate, sending, typing, endChat, runMatching, getPostDraft]);

  // Report to the parent whether a conversation is active (used to hide the
  // Overview welcome banner). Active = not ended, and the flow is in progress
  // or awaiting confirmation, or the user has already sent at least one message.
  // User answers are stored as messageType 'text'; assistant messages use 'system'.
  const hasUserMessage = messages.some(m => m.messageType === 'text');
  // Consider the chat "active" only once the user has actually engaged — i.e.
  // they sent at least one answer, or the flow reached confirmation/completion.
  // A brand-new thread (status 'in_progress' with only the greeting) still shows
  // the welcome banner.
  const isActiveChat = !ended && !loading &&
    (hasUserMessage ||
     flowState?.status === 'awaiting_confirmation' ||
     flowState?.status === 'completed');
  useEffect(() => {
    onActiveChange?.(isActiveChat);
  }, [isActiveChat, onActiveChange]);
  // Report inactive on unmount so the banner returns when leaving the tab.
  useEffect(() => () => { onActiveChange?.(false); }, [onActiveChange]);

  if (loading) {
    return (
      <View style={s.center}>
        <View style={s.botBubble}><Text style={{ fontSize: 25 }}>🤖</Text></View>
        <ActivityIndicator color={colors.brand} style={{ marginTop: 14 }} />
        <Text style={s.loadingText}>Assistant load ho raha hai…</Text>
      </View>
    );
  }

  // Ended state — chat closed by the user.
  // In group mode (hideOwnChrome) we PRESERVE the transcript so any found match
  // stays visible; we just show a compact "ended" bar + Start-new action. The
  // full-screen ended view is only used in the standalone assistant.
  if (ended) {
    if (hideOwnChrome) {
      return (
        <View style={{ flex: 1, backgroundColor: colors.cream }}>
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 12, paddingBottom: 16, gap: 6 }}
            showsVerticalScrollIndicator={false}
          >
            {messages.map((msg) => {
              const t = msg.template;
              if (msg.messageType === 'system' && t?.inputType === 'results') {
                return <ResultsBubble key={msg._id} msg={msg} onAddToGroup={openAddToGroup} />;
              }
              // In the ended state we only keep the match result visible; other
              // (Q&A) bubbles are hidden per the "don't show old conversation" rule.
              return null;
            })}
            <View style={s.endedNote}>
              <Text style={s.endedNoteText}>Chat ended. Aapka match upar save hai.</Text>
              <Pressable onPress={resumeChat} style={s.endedStartBtn}>
                <RotateCcw size={13} color="#fff" />
                <Text style={s.endedStartText}>Start new chat</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      );
    }
    return (
      <View style={s.center}>
        <View style={s.botBubble}><Text style={{ fontSize: 25 }}>👋</Text></View>
        <Text style={[s.loadingText, { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 16 }]}>Chat ended</Text>
        <Text style={[s.loadingText, { marginTop: 4 }]}>Naye lead ke liye chat dobara shuru karein.</Text>
        <Pressable onPress={resumeChat} style={cc.resumeBtn}>
          <RotateCcw size={15} color="#fff" />
          <Text style={cc.resumeText}>Start Chat</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.cream }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* ── Chat controls: Undo · Redo · Restart · End (hidden when host provides chrome) ── */}
      {!hideOwnChrome && (
      <View style={cc.bar}>
        <Pressable onPress={undo} disabled={undoStack.length === 0 || sending} style={[cc.btn, (undoStack.length === 0 || sending) && cc.btnDim]}>
          <Undo2 size={14} color={colors.muted2} />
          <Text style={cc.btnText}>Undo</Text>
        </Pressable>
        <Pressable onPress={redo} disabled={redoStack.length === 0 || sending} style={[cc.btn, (redoStack.length === 0 || sending) && cc.btnDim]}>
          <Redo2 size={14} color={colors.muted2} />
          <Text style={cc.btnText}>Redo</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={restartChat} disabled={sending} style={[cc.btn, sending && cc.btnDim]}>
          <RotateCcw size={14} color={colors.brand} />
          <Text style={[cc.btnText, { color: colors.brand }]}>Restart</Text>
        </Pressable>
        <Pressable onPress={endChat} style={[cc.btn, cc.btnEnd]}>
          <XCircle size={14} color={colors.red} />
          <Text style={[cc.btnText, { color: colors.red }]}>End</Text>
        </Pressable>
      </View>
      )}

      {/* Progress bar */}
      {progress && progress.total > 1 && (
        <View style={s.progressWrap}>
          <View style={s.progressRow}>
            <Text style={s.progressLabel}>Step {progress.current} of {progress.total}</Text>
            <Text style={s.progressPct}>{progressPct}%</Text>
          </View>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${progressPct}%` }]} />
          </View>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, paddingBottom: 16, gap: 6 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((msg) => {
          const isSystem = msg.messageType === 'system';
          const t = msg.template;

          if (isSystem && t?.inputType === 'summary') {
            return <SummaryBubble key={msg._id} msg={msg} onEdit={edit} onConfirm={confirm} sending={sending} />;
          }
          if (isSystem && t?.inputType === 'results') {
            return <ResultsBubble key={msg._id} msg={msg} onAddToGroup={openAddToGroup} />;
          }
          if (isSystem && t?.inputType === 'actions') {
            return <ActionsBubble key={msg._id} msg={msg} onNewLead={newLead} onViewLeads={onViewLeads} disabled={sending} />;
          }

          return (
            <View key={msg._id} style={[mb.row, isSystem ? mb.rowThem : mb.rowMe]}>
              {isSystem && <View style={mb.avatar}><Text style={{ fontSize: 14 }}>🤖</Text></View>}
              <View style={[mb.bubble, isSystem ? mb.bubbleThem : mb.bubbleMe]}>
                <Text style={[mb.text, isSystem ? mb.textThem : mb.textMe]}>{msg.content}</Text>
                <Text style={[mb.time, isSystem ? mb.timeThem : mb.timeMe]}>{fmtTime(msg.createdAt)}</Text>
              </View>
            </View>
          );
        })}

        {typing && (
          <View style={[mb.row, mb.rowThem]}>
            <View style={mb.avatar}><Text style={{ fontSize: 14 }}>🤖</Text></View>
            <View style={[mb.bubble, mb.bubbleThem, { flexDirection: 'row', gap: 5, paddingVertical: 14 }]}>
              <TypingDot delay={0} /><TypingDot delay={150} /><TypingDot delay={300} />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Structured answer controls (choice chips / multichoice / number unit picker).
          TextControl and PhoneControl are intentionally excluded here — the
          PersistentChatBar below handles those input types directly. */}
      {hideOwnChrome ? (
        // Inside the group: only render chip-style pickers (choice/multichoice)
        // inline; text/location/phone/number are answered via the group's own
        // input box (host-driven). No second text input is rendered here.
        showAnswerBar && activeTemplate &&
          ['choice', 'multichoice'].includes(activeTemplate.inputType || '') && (
          <AnswerControl template={activeTemplate} disabled={sending} onSubmit={submit} />
        )
      ) : (
        <>
          {showAnswerBar && activeTemplate &&
            !['text', 'location', 'phone'].includes(activeTemplate.inputType || '') && (
            <AnswerControl template={activeTemplate} disabled={sending} onSubmit={submit} />
          )}

          {/* ── Persistent chat input bar — only shown when AnswerControl is NOT visible,
              i.e. for text/location/phone slots, completed flow, or no active slot.
              This prevents two input fields appearing simultaneously. ── */}
          {!(showAnswerBar && activeTemplate &&
             !['text', 'location', 'phone'].includes(activeTemplate.inputType || '')) && (
            <PersistentChatBar
              activeTemplate={activeTemplate}
              flowState={flowState}
              disabled={sending || typing}
              onSubmitSlot={submit}
              onNewLead={newLead}
            />
          )}
        </>
      )}

      {/* ── Add to Group picker modal ── */}
      <Modal visible={!!addTarget} transparent animationType="slide" onRequestClose={() => setAddTarget(null)}>
        <Pressable style={atg.overlay} onPress={() => setAddTarget(null)}>
          <Pressable style={atg.sheet} onPress={() => {}}>
            <View style={atg.head}>
              <View style={{ flex: 1 }}>
                <Text style={atg.title}>Add to Group</Text>
                <Text style={atg.sub} numberOfLines={1}>{addTarget?.projectName}</Text>
              </View>
              <Pressable onPress={() => setAddTarget(null)} style={atg.closeBtn}>
                <XIcon size={18} color={colors.ink} />
              </Pressable>
            </View>

            {roomsLoading ? (
              <View style={{ padding: 30, alignItems: 'center' }}><ActivityIndicator color={colors.brand} /></View>
            ) : rooms.length === 0 ? (
              <Text style={atg.empty}>Aap kisi group me nahi hain. Pehle Groups tab se join karein.</Text>
            ) : (
              <FlatList
                data={rooms}
                keyExtractor={r => r.id}
                style={{ maxHeight: 320 }}
                contentContainerStyle={{ paddingBottom: 8 }}
                renderItem={({ item: room }) => (
                  <Pressable onPress={() => addToRoom(room)} disabled={!!addingRoomId} style={atg.roomRow}>
                    <View style={atg.roomIcon}><UsersIcon size={16} color={colors.brand} /></View>
                    <Text style={atg.roomName} numberOfLines={1}>{room.name}</Text>
                    {addingRoomId === room.id
                      ? <ActivityIndicator size="small" color={colors.brand} />
                      : <ArrowRight size={16} color={colors.muted2} />}
                  </Pressable>
                )}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ── Typing dot ──
function TypingDot({ delay }: { delay: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setOn(o => !o), 500);
    const t = setTimeout(() => {}, delay);
    return () => { clearInterval(id); clearTimeout(t); };
  }, [delay]);
  return <View style={[mb.dot, { opacity: on ? 1 : 0.3 }]} />;
}

// ═══════════ PERSISTENT CHAT INPUT BAR ═══════════
// Always visible at the bottom. Routes the user's text to the correct backend
// call depending on the current flow state / active template.
function PersistentChatBar({
  activeTemplate, flowState, disabled, onSubmitSlot, onNewLead,
}: {
  activeTemplate: Template | undefined;
  flowState: any;
  disabled: boolean;
  onSubmitSlot: (slotId: string, value: any, display: string) => void;
  onNewLead: () => void;
}) {
  const [text, setText] = useState('');
  const inputRef = useRef<any>(null);

  const type      = activeTemplate?.inputType;
  const slotId    = activeTemplate?.slotId || '';
  const isCompleted = flowState?.status === 'completed';

  // Derive placeholder and send semantics based on current flow state
  const getPlaceholder = (): string => {
    if (!activeTemplate || isCompleted) return 'Nayi requirement ke liye type karein…';
    if (type === 'text')     return 'Type your answer…';
    if (type === 'location') return 'e.g. Manish Nagar, Nagpur';
    if (type === 'phone')    return '10-digit mobile number';
    if (type === 'number')   return 'Enter amount (e.g. 50)';
    if (type === 'choice' || type === 'multichoice') return 'Ya yahan type karein…';
    if (type === 'summary')  return 'Details confirm karein (upar button se)';
    if (type === 'results')  return 'Results dekh lijiye…';
    if (type === 'actions')  return 'Kya karna chahte hain? (upar choose karein)';
    return 'Type karein…';
  };

  // Whether the bar should be read-only / show a hint instead of accepting input
  const isLocked = !!type && ['summary', 'results', 'actions'].includes(type);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isLocked) return;

    // No active template (flow completed or awaiting new lead) → start a new one
    if (!activeTemplate || isCompleted) {
      setText('');
      onNewLead();
      return;
    }

    // Route by slot input type
    if (type === 'phone') {
      const digits = trimmed.replace(/\D/g, '').slice(0, 10);
      if (digits.length < 10) return; // invalid length — keep text so user sees it
      setText('');
      onSubmitSlot(slotId, digits, digits);
      return;
    }

    if (type === 'number') {
      const num = trimmed.replace(/[^\d.]/g, '');
      if (!num) return;
      const units = activeTemplate.unit || [];
      // Submit as the object shape the backend expects (same as NumberControl)
      const value = units.length ? { value: num, unit: units[0] } : num;
      const display = units.length ? `${num} ${units[0]}` : num;
      setText('');
      onSubmitSlot(slotId, value, display);
      return;
    }

    // text / location / choice / multichoice → free-text answer
    setText('');
    onSubmitSlot(slotId, trimmed, trimmed);
  };

  return (
    <View style={pcb.wrap}>
      <View style={[pcb.row, isLocked && pcb.rowLocked]}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder={getPlaceholder()}
          placeholderTextColor={colors.muted}
          style={pcb.input}
          editable={!isLocked && !disabled}
          keyboardType={type === 'phone' ? 'phone-pad' : type === 'number' ? 'numeric' : 'default'}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
          multiline={false}
        />
        {isLocked ? (
          <View style={pcb.lockIcon}><Text style={{ fontSize: 16 }}>🔒</Text></View>
        ) : (
          <Pressable
            onPress={handleSend}
            disabled={disabled || !text.trim()}
            style={[pcb.sendBtn, (disabled || !text.trim()) && pcb.sendBtnDim]}
          >
            {disabled ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Send size={18} color="#fff" />
            )}
          </Pressable>
        )}
      </View>
      {/* Context hint line */}
      {isLocked && (
        <Text style={pcb.hint}>
          {type === 'summary'  ? '⬆ Upar "Confirm & Find Matches" tap karein' :
           type === 'results'  ? '⬆ Results dekh lijiye, phir aage choose karein' :
                                 '⬆ Upar se apna next step choose karein'}
        </Text>
      )}
      {(!activeTemplate || isCompleted) && !isLocked && (
        <Text style={pcb.hint}>💡 Kuch bhi type karein — nayi requirement shuru hogi</Text>
      )}
    </View>
  );
}

// ═══════════ ANSWER CONTROL ═══════════
function AnswerControl({ template, disabled, onSubmit }: {
  template: Template; disabled: boolean;
  onSubmit: (slotId: string, value: any, display: string) => void;
}) {
  const slotId = template.slotId || '';
  const type = template.inputType;

  if (type === 'choice') return <ChoiceControl template={template} disabled={disabled} onSubmit={onSubmit} />;
  if (type === 'multichoice') return <MultiChoiceControl template={template} disabled={disabled} onSubmit={onSubmit} />;
  if (type === 'number') return <NumberControl slotId={slotId} units={template.unit || []} skippable={!!template.skippable} disabled={disabled} onSubmit={onSubmit} />;
  if (type === 'phone') return <PhoneControl slotId={slotId} prefill={template.prefill} disabled={disabled} onSubmit={onSubmit} />;
  return <TextControl slotId={slotId} inputType={type} allowCustom={!!template.allowCustom} skippable={!!template.skippable} disabled={disabled} onSubmit={onSubmit} />;
}

function SkipBtn({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={ac.skipBtn}>
      <Text style={ac.skipText}>Skip</Text>
    </Pressable>
  );
}

// choice: intent = big cards, else = chips. Supports allowCustom via a text field.
function ChoiceControl({ template, disabled, onSubmit }: {
  template: Template; disabled: boolean;
  onSubmit: (slotId: string, value: any, display: string) => void;
}) {
  const slotId = template.slotId || '';
  const options: Option[] = Array.isArray(template.options) ? template.options : [];
  const isIntent = slotId === 'intent';
  const [custom, setCustom] = useState('');
  // "Other" chip reveals a free-text field. Available on any choice slot (even if
  // the backend didn't flag allowCustom) so users can always type their own value.
  const [otherOpen, setOtherOpen] = useState(false);
  const allowOther = !isIntent; // intent is a fixed set (sell/buy/rent)
  const submitCustom = () => { if (custom.trim()) { onSubmit(slotId, custom.trim(), custom.trim()); setCustom(''); setOtherOpen(false); } };

  return (
    <View style={ac.bar}>
      {/* Intent slot: compact horizontal chips in one row */}
      {isIntent ? (
        <View style={ac.intentRow}>
          {options.map((opt) => {
            const label = opt.label?.hi || opt.label?.en || String(opt.value);
            return (
              <Pressable
                key={opt.value}
                disabled={disabled}
                onPress={() => onSubmit(slotId, opt.value, label)}
                style={ac.intentChip}
              >
                <Text style={ac.intentChipIcon}>{INTENT_ICON[opt.value] || '•'}</Text>
                <View>
                  <Text style={ac.intentChipLabel} numberOfLines={1}>{label}</Text>
                  <Text style={ac.intentChipSub} numberOfLines={1}>{opt.label?.en}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : (
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 200 }} contentContainerStyle={ac.chipsWrap}>
        {options.map((opt) => {
          const label = opt.label?.hi || opt.label?.en || String(opt.value);
          return (
            <Pressable key={opt.value} disabled={disabled} onPress={() => onSubmit(slotId, opt.value, label)} style={ac.chip}>
              <Text style={ac.chipText}>{label}</Text>
            </Pressable>
          );
        })}

        {/* "Other" chip — lets the user type a value not in the list */}
        {allowOther && (
          <Pressable disabled={disabled} onPress={() => setOtherOpen(o => !o)} style={[ac.chip, otherOpen && ac.chipOn]}>
            <Text style={[ac.chipText, otherOpen && ac.chipTextOn]}>Other</Text>
          </Pressable>
        )}
      </ScrollView>
      )}

      {allowOther && otherOpen && (
        <View style={ac.customRow}>
          <TextInput
            value={custom} onChangeText={setCustom} autoFocus
            placeholder="Type your answer…" placeholderTextColor={colors.muted}
            style={ac.input}
            onSubmitEditing={submitCustom}
          />
          <SendBtn disabled={disabled || !custom.trim()} onPress={submitCustom} />
        </View>
      )}

      {template.skippable && <SkipBtn disabled={disabled} onPress={() => onSubmit(slotId, SKIP_VALUE, 'Skipped')} />}
    </View>
  );
}

function MultiChoiceControl({ template, disabled, onSubmit }: {
  template: Template; disabled: boolean;
  onSubmit: (slotId: string, value: any, display: string) => void;
}) {
  const slotId = template.slotId || '';
  const options: Option[] = Array.isArray(template.options) ? template.options : [];
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState('');

  const toggle = (v: string) => setSelected(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  const addCustom = () => { const v = custom.trim(); if (v && !selected.includes(v)) setSelected(prev => [...prev, v]); setCustom(''); };
  const send = () => { if (selected.length) onSubmit(slotId, selected, selected.join(', ')); };

  return (
    <View style={ac.bar}>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 180 }} contentContainerStyle={ac.chipsWrap}>
        {options.map((opt) => {
          const label = opt.label?.hi || opt.label?.en || String(opt.value);
          const on = selected.includes(opt.value);
          return (
            <Pressable key={opt.value} disabled={disabled} onPress={() => toggle(opt.value)} style={[ac.chip, on && ac.chipOn]}>
              <Text style={[ac.chipText, on && ac.chipTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
        {selected.filter(v => !options.some(o => o.value === v)).map(v => (
          <Pressable key={v} disabled={disabled} onPress={() => toggle(v)} style={[ac.chip, ac.chipOn]}>
            <Text style={[ac.chipText, ac.chipTextOn]}>{v}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {template.allowCustom && (
        <View style={ac.customRow}>
          <TextInput value={custom} onChangeText={setCustom} placeholder="Add another…" placeholderTextColor={colors.muted} style={ac.input} onSubmitEditing={addCustom} />
          <Pressable onPress={addCustom} disabled={disabled || !custom.trim()} style={[ac.addBtn, (!custom.trim()) && { opacity: 0.4 }]}><Plus size={18} color="#fff" /></Pressable>
        </View>
      )}

      <View style={ac.mcActions}>
        {template.skippable && <SkipBtn disabled={disabled} onPress={() => onSubmit(slotId, SKIP_VALUE, 'Skipped')} />}
        <Pressable onPress={send} disabled={disabled || !selected.length} style={[ac.doneBtn, (!selected.length) && { opacity: 0.4 }]}>
          <Check size={15} color="#fff" />
          <Text style={ac.doneText}>Done{selected.length ? ` (${selected.length})` : ''}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function NumberControl({ slotId, units, skippable, disabled, onSubmit }: {
  slotId: string; units: string[]; skippable: boolean; disabled: boolean;
  onSubmit: (slotId: string, value: any, display: string) => void;
}) {
  const [val, setVal] = useState('');
  const [unit, setUnit] = useState(units[0] || '');
  const send = () => {
    if (!val.trim()) return;
    const value = units.length ? { value: val.trim(), unit } : val.trim();
    const display = units.length ? `${val.trim()} ${unit}` : val.trim();
    onSubmit(slotId, value, display);
    setVal('');
  };
  return (
    <View style={ac.bar}>
      <View style={ac.inputRow}>
        <View style={ac.inputWrap}>
          <TextInput
            value={val} onChangeText={setVal}
            keyboardType="numeric" placeholder="Enter amount" placeholderTextColor={colors.muted}
            style={ac.input} onSubmitEditing={send}
          />
          {units.length > 0 && (
            <View style={ac.unitRow}>
              {units.map(u => (
                <Pressable key={u} onPress={() => setUnit(u)} style={[ac.unitBtn, unit === u && ac.unitBtnOn]}>
                  <Text style={[ac.unitText, unit === u && ac.unitTextOn]}>{u}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
        <SendBtn disabled={disabled || !val.trim()} onPress={send} />
      </View>
      {skippable && <SkipBtn disabled={disabled} onPress={() => onSubmit(slotId, SKIP_VALUE, 'Skipped')} />}
    </View>
  );
}

function PhoneControl({ slotId, prefill, disabled, onSubmit }: {
  slotId: string; prefill?: string; disabled: boolean;
  onSubmit: (slotId: string, value: any, display: string) => void;
}) {
  const [val, setVal] = useState(prefill || '');
  const send = () => { if (val.trim().length >= 10) onSubmit(slotId, val.trim(), val.trim()); };
  return (
    <View style={ac.bar}>
      <View style={ac.inputRow}>
        <View style={ac.inputWrap}>
          <Text style={ac.prefix}>+91</Text>
          <TextInput
            value={val} onChangeText={(t) => setVal(t.replace(/\D/g, '').slice(0, 10))}
            keyboardType="phone-pad" maxLength={10} placeholder="10-digit mobile" placeholderTextColor={colors.muted}
            style={[ac.input, { paddingLeft: 4 }]} onSubmitEditing={send}
          />
        </View>
        <SendBtn disabled={disabled || val.trim().length < 10} onPress={send} />
      </View>
      {prefill ? <Text style={ac.hint}>Aapke profile ka number bhara hai — badal sakte hain.</Text> : null}
    </View>
  );
}

function TextControl({ slotId, inputType, allowCustom, skippable, disabled, onSubmit }: {
  slotId: string; inputType?: string; allowCustom: boolean; skippable: boolean; disabled: boolean;
  onSubmit: (slotId: string, value: any, display: string) => void;
}) {
  const [val, setVal] = useState('');
  const isLocation = inputType === 'location';
  const send = () => { if (val.trim()) { onSubmit(slotId, val.trim(), val.trim()); setVal(''); } };
  return (
    <View style={ac.bar}>
      <View style={ac.inputRow}>
        <View style={ac.inputWrap}>
          {isLocation && <MapPin size={16} color={colors.brand} style={{ marginRight: 6 }} />}
          <TextInput
            value={val} onChangeText={setVal}
            placeholder={isLocation ? 'e.g. Manish Nagar' : 'Type your answer'} placeholderTextColor={colors.muted}
            style={ac.input} onSubmitEditing={send}
          />
        </View>
        <SendBtn disabled={disabled || !val.trim()} onPress={send} />
      </View>
      {skippable && <SkipBtn disabled={disabled} onPress={() => onSubmit(slotId, SKIP_VALUE, 'Skipped')} />}
    </View>
  );
}

function SendBtn({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[ac.sendBtn, disabled && { opacity: 0.4 }]}>
      <Send size={18} color="#fff" />
    </Pressable>
  );
}

// ═══════════ SUMMARY BUBBLE ═══════════
function SummaryBubble({ msg, onEdit, onConfirm, sending }: {
  msg: Msg; onEdit: (slotId: string) => void; onConfirm: () => void; sending: boolean;
}) {
  const values: { slotId: string; label: string; display: string }[] = msg.template?.options?.values || [];
  return (
    <View style={[mb.row, mb.rowThem]}>
      <View style={mb.avatar}><Text style={{ fontSize: 14 }}>🤖</Text></View>
      <View style={sm.card}>
        <View style={sm.head}>
          <CheckCircle2 size={18} color="#fff" />
          <View>
            <Text style={sm.headTitle}>Confirm your details</Text>
            <Text style={sm.headSub}>Review karke matches paayein</Text>
          </View>
        </View>
        <View>
          {values.map((v) => (
            <View key={v.slotId} style={sm.valueRow}>
              <View style={{ flex: 1 }}>
                <Text style={sm.valueLabel}>{v.label}</Text>
                <Text style={sm.valueDisplay}>{v.display}</Text>
              </View>
              <Pressable onPress={() => onEdit(v.slotId)} style={sm.editBtn}>
                <Pencil size={13} color={colors.brand} />
                <Text style={sm.editText}>Edit</Text>
              </Pressable>
            </View>
          ))}
        </View>
        <Pressable onPress={onConfirm} disabled={sending} style={[sm.confirmBtn, sending && { opacity: 0.6 }]}>
          {sending ? <ActivityIndicator color="#fff" size="small" /> : (
            <>
              <Text style={sm.confirmText}>Confirm & Find Matches</Text>
              <ArrowRight size={16} color="#fff" />
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ═══════════ RESULTS BUBBLE ═══════════
type MatchCard = { projectId: string; projectName: string; city?: string; location?: string; score: number; slug?: string };
function ResultsBubble({ msg, onAddToGroup }: { msg: Msg; onAddToGroup?: (m: MatchCard) => void }) {
  const matches: MatchCard[] =
    msg.template?.options?.matches || [];
  const hasMatches = matches.length > 0;
  return (
    <View style={[mb.row, mb.rowThem]}>
      <View style={mb.avatar}><Text style={{ fontSize: 14 }}>🤖</Text></View>
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[rs.headCard, hasMatches && rs.headCardMatch]}>
          <Text style={{ fontSize: 16 }}>{hasMatches ? '🎯' : '⏳'}</Text>
          <Text style={rs.headText}>{msg.content}</Text>
        </View>
        {matches.map((m) => (
          <View key={m.projectId} style={rs.cardCol}>
            <View style={rs.cardTop}>
              <View style={rs.icon}><Building2 size={22} color={colors.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={rs.name} numberOfLines={1}>{m.projectName || 'Project'}</Text>
                <Text style={rs.loc} numberOfLines={1}>📍 {[m.location, m.city].filter(Boolean).join(', ') || '—'}</Text>
              </View>
              <ScoreRing score={m.score} />
            </View>
            {/* Add to Group — shares this matched project into a group */}
            <Pressable onPress={() => onAddToGroup?.(m)} style={rs.addGroupBtn}>
              <UsersIcon size={14} color={colors.brand} />
              <Text style={rs.addGroupText}>Add to Group</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

function ScoreRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const color = clamped >= 75 ? colors.greenText : clamped >= 50 ? colors.brand : colors.slate;
  return (
    <View style={rs.ring}>
      <Text style={[rs.ringText, { color }]}>{clamped}%</Text>
    </View>
  );
}

// ═══════════ ACTIONS BUBBLE ═══════════
function ActionsBubble({ msg, onNewLead, onViewLeads, disabled }: {
  msg: Msg; onNewLead: () => void; onViewLeads?: () => void; disabled: boolean;
}) {
  const actions: { action: string; label: { en: string; hi: string }; icon?: string }[] = msg.template?.options?.actions || [];
  const handle = (action: string) => {
    if (action === 'new_lead') onNewLead();
    else if (action === 'view_leads') onViewLeads?.();
  };
  return (
    <View style={[mb.row, mb.rowThem]}>
      <View style={mb.avatar}><Text style={{ fontSize: 14 }}>🤖</Text></View>
      <View style={ab.card}>
        {msg.content ? <Text style={ab.text}>{msg.content}</Text> : null}
        <View style={ab.actions}>
          {actions.map((a) => {
            const primary = a.action === 'new_lead';
            return (
              <Pressable key={a.action} disabled={disabled} onPress={() => handle(a.action)} style={[ab.btn, primary ? ab.btnPrimary : ab.btnGhost]}>
                {a.icon === 'plus' ? <Plus size={15} color={primary ? '#fff' : colors.brand} /> : <ListIcon size={15} color={primary ? '#fff' : colors.brand} />}
                <Text style={[ab.btnText, { color: primary ? '#fff' : colors.brand }]}>{a.label?.hi || a.label?.en}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

// ═══════════ Styles ═══════════
const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  botBubble: { width: 60, height: 60, borderRadius: 18, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 10, fontSize: 12, color: colors.muted2 },
  endedNote: { alignItems: 'center', gap: 10, paddingVertical: 20 },
  endedNoteText: { fontSize: 12, color: colors.muted2, textAlign: 'center' },
  endedStartBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brand, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 14 },
  endedStartText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  progressWrap: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontSize: 9, fontWeight: '800', color: colors.muted, letterSpacing: 0.5, textTransform: 'uppercase' },
  progressPct: { fontSize: 10, fontWeight: '800', color: colors.brand },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.brand },
});

const mb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  rowMe: { justifyContent: 'flex-end' },
  rowThem: { justifyContent: 'flex-start' },
  avatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '80%', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 14, gap: 1 },
  bubbleMe: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 4 },
  text: { fontSize: 12.5, lineHeight: 17 },
  textMe: { color: '#fff' },
  textThem: { color: colors.ink },
  time: { fontSize: 8 },
  timeMe: { color: 'rgba(255,255,255,0.7)', textAlign: 'right' },
  timeThem: { color: colors.muted, textAlign: 'right' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.muted },
});

const ac = StyleSheet.create({
  bar: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 10 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, borderWidth: 1, borderColor: `${colors.brand}44`, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 12.5, fontWeight: '700', color: colors.brand },
  chipTextOn: { color: '#fff' },
  intentCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  intentIcon: { fontSize: 23 },
  intentLabel: { fontSize: 14, fontWeight: '800', color: colors.ink },
  intentSub: { fontSize: 10.5, color: colors.muted2, marginTop: 1 },
  // compact horizontal intent chips (used instead of intentCard for the slot === 'intent' row)
  intentRow: { flexDirection: 'row', gap: 7 },
  intentChip: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  intentChipIcon: { fontSize: 15 },
  intentChipLabel: { fontSize: 11, fontWeight: '800', color: colors.ink },
  intentChipSub: { fontSize: 8.5, color: colors.muted2, marginTop: 1 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, borderRadius: 22, paddingHorizontal: 14 },
  input: { flex: 1, paddingVertical: 10, fontSize: 13.5, color: colors.ink },
  prefix: { fontSize: 13.5, fontWeight: '700', color: colors.muted2, marginRight: 2 },
  unitRow: { flexDirection: 'row', gap: 4, marginLeft: 6 },
  unitBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: colors.line },
  unitBtnOn: { backgroundColor: colors.brand },
  unitText: { fontSize: 10.5, fontWeight: '800', color: colors.muted2 },
  unitTextOn: { color: '#fff' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  skipBtn: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line },
  skipText: { fontSize: 11.5, fontWeight: '700', color: colors.muted2 },
  mcActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  doneBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brand, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 14 },
  doneText: { fontSize: 12.5, fontWeight: '800', color: '#fff' },
  hint: { fontSize: 10, color: colors.muted2, marginLeft: 6 },
});

const sm = StyleSheet.create({
  card: { flex: 1, backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.night, paddingHorizontal: 14, paddingVertical: 12 },
  headTitle: { fontSize: 13, fontWeight: '800', color: '#fff' },
  headSub: { fontSize: 9.5, color: 'rgba(255,255,255,0.6)', marginTop: 1 },
  valueRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  valueLabel: { fontSize: 9, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  valueDisplay: { fontSize: 13, fontWeight: '700', color: colors.ink, marginTop: 2 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  editText: { fontSize: 11, fontWeight: '700', color: colors.brand },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.brand, margin: 12, paddingVertical: 13, borderRadius: 14 },
  confirmText: { fontSize: 13.5, fontWeight: '800', color: '#fff' },
});

const rs = StyleSheet.create({
  headCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 11 },
  headCardMatch: { backgroundColor: colors.greenBg, borderColor: colors.greenBorder },
  headText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.ink },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 12 },
  cardCol: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 12, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 13, fontWeight: '800', color: colors.ink },
  loc: { fontSize: 10.5, color: colors.muted2, marginTop: 2 },
  ring: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  ringText: { fontSize: 10, fontWeight: '800' },
  addGroupBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: `${colors.brand}55`, backgroundColor: colors.brandTint },
  addGroupText: { fontSize: 11.5, fontWeight: '800', color: colors.brand },
});

const atg = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  title: { fontSize: 15, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 11, color: colors.muted2, marginTop: 1 },
  closeBtn: { padding: 6, borderRadius: 10, backgroundColor: colors.slateBg },
  empty: { fontSize: 12, color: colors.muted2, textAlign: 'center', paddingVertical: 24, paddingHorizontal: 16, lineHeight: 18 },
  roomRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  roomIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  roomName: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.ink },
});

const ab = StyleSheet.create({
  card: { flex: 1, backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10 },
  text: { fontSize: 12.5, color: colors.muted2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 22 },
  btnPrimary: { backgroundColor: colors.brand },
  btnGhost: { backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}44` },
  btnText: { fontSize: 12, fontWeight: '800' },
});

// ── Chat controls (Undo/Redo/Restart/End) styles ──
const cc = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 7,
    backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line },
  btnEnd: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  btnDim: { opacity: 0.4 },
  btnText: { fontSize: 10.5, fontWeight: '700', color: colors.muted2 },
  resumeBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.brand, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 14, marginTop: 18 },
  resumeText: { fontSize: 13, fontWeight: '800', color: '#fff' },
});

// ── Persistent Chat Bar styles ──
const pcb = StyleSheet.create({
  wrap: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 26,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  rowLocked: {
    backgroundColor: '#f5f5f5',
    borderColor: colors.line,
    opacity: 0.75,
  },
  input: {
    flex: 1,
    fontSize: 13.5,
    color: colors.ink,
    paddingVertical: 9,
    maxHeight: 44,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDim: { opacity: 0.4 },
  lockIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontSize: 10,
    color: colors.muted,
    textAlign: 'center',
    paddingBottom: 2,
  },
});
