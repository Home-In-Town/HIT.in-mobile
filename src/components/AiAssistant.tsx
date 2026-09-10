// AI Assistant (Lead Matching) — native port of the website's AiAssistantChat.
// Deterministic slot-filling chat: the backend drives the flow via message
// `template`s; this screen renders the right control for each template and
// posts answers. Mirrors web behavior: choice chips / intent cards, number+unit,
// phone (+91, prefill), text/location, skip, summary + edit, results cards,
// actions tray, progress bar, and a typing indicator.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  Send, Building2, MapPin, Check, Pencil, Plus, List as ListIcon,
  ArrowRight, CheckCircle2,
} from 'lucide-react-native';
import { leadChatApi } from '../lib/api';
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

export default function AiAssistant({ onViewLeads }: { onViewLeads?: () => void }) {
  const { user } = useAuth();
  const toast = useToast();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [flowState, setFlowState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const scrollDown = useCallback((delay = 80) => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), delay);
  }, []);

  // ── Open / resume ──
  const open = useCallback(async () => {
    setLoading(true);
    try {
      const res = await leadChatApi.open();
      sessionIdRef.current = res.sessionId;
      setFlowState(res.flowState);
      setMessages(res.messages || []);
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
  }, [sending, user?.id, reveal, scrollDown]);

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
  }, [sending, reveal]);

  // ── Start a fresh lead ──
  const newLead = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || sending) return;
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
  }, [sending, reveal]);

  // The active template = last system message that carries one.
  const lastAssistant = [...messages].reverse().find(m => m.messageType === 'system' && m.template);
  const activeTemplate = lastAssistant?.template;
  const progress = activeTemplate?.progress;
  const progressPct = progress && progress.total ? Math.round((progress.current / progress.total) * 100) : 0;

  const showAnswerBar = !typing && activeTemplate?.inputType &&
    !['summary', 'results', 'actions'].includes(activeTemplate.inputType);

  if (loading) {
    return (
      <View style={s.center}>
        <View style={s.botBubble}><Text style={{ fontSize: 25 }}>🤖</Text></View>
        <ActivityIndicator color={colors.brand} style={{ marginTop: 14 }} />
        <Text style={s.loadingText}>Assistant load ho raha hai…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.cream }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
            return <ResultsBubble key={msg._id} msg={msg} />;
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
function ResultsBubble({ msg }: { msg: Msg }) {
  const matches: { projectId: string; projectName: string; city?: string; location?: string; score: number; slug?: string }[] =
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
          <View key={m.projectId} style={rs.card}>
            <View style={rs.icon}><Building2 size={22} color={colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={rs.name} numberOfLines={1}>{m.projectName || 'Project'}</Text>
              <Text style={rs.loc} numberOfLines={1}>📍 {[m.location, m.city].filter(Boolean).join(', ') || '—'}</Text>
            </View>
            <ScoreRing score={m.score} />
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
  icon: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 13, fontWeight: '800', color: colors.ink },
  loc: { fontSize: 10.5, color: colors.muted2, marginTop: 2 },
  ring: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  ringText: { fontSize: 10, fontWeight: '800' },
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
