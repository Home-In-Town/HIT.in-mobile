import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, Linking, ActivityIndicator, Share, StyleSheet } from 'react-native';
import { CreditCard, Users, Check, ChevronDown, BookOpen, Sparkles, RefreshCw } from 'lucide-react-native';
import { useToast } from '../Toast';
import { referralsApi, ReferralInfo } from '../../lib/api';
import { colors } from '../../theme';

interface Chapter {
  id: number;
  title: string;
  subtitle: string;
  readTime: string;
  sections: { heading: string; body: string }[];
  keyTakeaways: string[];
}

// The step-wise "book" — the playbook to get leads faster
const CHAPTERS: Chapter[] = [
  {
    id: 1,
    title: 'Foundation — Kaun sa lead chahiye',
    subtitle: 'Define your ideal buyer before you chase anyone',
    readTime: '6 min',
    sections: [
      { heading: 'Ideal Customer Profile (ICP)', body: 'Har project ke liye clear buyer profile banao — budget, family size, intent (self-use vs investment) aur location. Clear ICP se har message relevant lagta hai.' },
      { heading: 'Kahan milega ye buyer', body: 'ICP ke hisaab se channel choose karo. Investors LinkedIn/referral se, end-users Meta/Google/walk-in se. Ek channel pe 30 din focus karo.' },
    ],
    keyTakeaways: ['Ek project = ek buyer profile', 'Budget, intent, location define karo', 'Channel ko ICP se match karo'],
  },
  {
    id: 2,
    title: 'Lead Magnets — Log khud aayenge',
    subtitle: 'Create irresistible reasons for buyers to raise their hand',
    readTime: '8 min',
    sections: [
      { heading: 'Value-first offer', body: 'Direct pitch chalta nahi. Free value do — price comparison PDF ya EMI calculator. Log value ke liye number dete hain.' },
      { heading: 'Landing page + WhatsApp funnel', body: 'Simple landing page + instant WhatsApp auto-reply. Pehle 90 second sabse important — 5x zyada conversion.' },
    ],
    keyTakeaways: ['Pitch se pehle value do', 'Free PDF/calculator = number', '90 second mein respond'],
  },
  {
    id: 3,
    title: 'Outreach Engine — Roz naye leads',
    subtitle: 'A repeatable daily system so leads never dry up',
    readTime: '10 min',
    sections: [
      { heading: 'Daily 3-touch rule', body: 'Roz 10 cold + 10 warm follow-up + 5 referral ask. Consistency deta hai — ek din 100 karke band karna kaam nahi karta.' },
      { heading: 'Script + timing', body: 'Har touchpoint ka script rakho, best time pe bhejo (10-11 subah, 6-8 shaam). Naam aur project se personalize karo.' },
    ],
    keyTakeaways: ['Roz 10 cold + 10 warm + 5 referral', 'Consistency > intensity', 'Sahi time + personalized script'],
  },
  {
    id: 4,
    title: 'Referral Machine — Leads multiply karo',
    subtitle: 'Turn every happy client into 3 new leads',
    readTime: '7 min',
    sections: [
      { heading: 'Referral loop', body: 'Deal close hote hi referral maango, jab khushi peak pe ho. "Aapke jaise 2 aur log?" — simple ask, right timing.' },
      { heading: 'Incentivize karo', body: 'Referral dene wale ko gift/cashback do. Trackable link do taaki attribution clear rahe.' },
    ],
    keyTakeaways: ['Deal close hote hi ask', 'Peak-happiness pe maango', 'Incentive + trackable link'],
  },
  {
    id: 5,
    title: 'Convert Faster — Lead se deal tak',
    subtitle: 'Shorten the journey from enquiry to booking',
    readTime: '9 min',
    sections: [
      { heading: 'Speed-to-lead', body: 'Jitni jaldi respond, utni jaldi close. Site visit 48 ghante ke andar fix karo — momentum tabhi peak pe hota hai.' },
      { heading: 'Objection handling', body: 'Top 5 objections (price, location, loan, timing, trust) ke ready answers rakho, har ek ke saath proof point.' },
    ],
    keyTakeaways: ['Site visit 48 ghante mein', 'Top 5 objections ready', 'Har jawab ke saath proof'],
  },
];

type UnlockMethod = 'pay' | 'refer';

const PRICE = 25000;

export default function LeadCourse() {
  const toast = useToast();
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [method, setMethod] = useState<UnlockMethod | null>(null);
  const [openChapter, setOpenChapter] = useState<number | null>(1);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await referralsApi.getMine();
      setInfo(data);
      if (!data.courseUnlocked) setMethod('refer');
    } catch {
      setLoadError('Could not load your referral details.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const unlocked = !!info?.courseUnlocked;
  const REFERRAL_GOAL = info?.goal ?? 10;
  const referralCount = info?.count ?? 0;

  const handleShare = async () => {
    if (!info?.referralLink) return;
    try {
      await Share.share({
        message: `Join me on HomeInTown — India's smart real-estate platform.\nSign up with my link: ${info.referralLink}`,
      });
    } catch {
      // user cancelled — ignore
    }
  };

  const handleWhatsApp = () => {
    if (!info?.referralLink) return;
    const msg = `Join me on HomeInTown 🏡\nSign up: ${info.referralLink}`;
    const wa = `whatsapp://send?text=${encodeURIComponent(msg)}`;
    Linking.canOpenURL(wa)
      .then((ok) => Linking.openURL(ok ? wa : `https://wa.me/?text=${encodeURIComponent(msg)}`))
      .catch(() => toast.error('WhatsApp not available'));
  };

  // ── Loading ──
  if (loading) {
    return (
      <View style={[s.card, { padding: 40, alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  // ── Error ──
  if (loadError) {
    return (
      <View style={[s.card, { padding: 32, alignItems: 'center' }]}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink, textAlign: 'center' }}>{loadError}</Text>
        <Pressable onPress={load} style={{ marginTop: 12 }}><Text style={s.brandBold}>Try again</Text></Pressable>
      </View>
    );
  }

  // ── Locked state ──
  if (!unlocked) {
    return (
      <View style={[s.card, { overflow: 'hidden' }]}>
        {/* Hero */}
        <View style={{ padding: 24, backgroundColor: colors.night }}>
          <View style={s.premiumBadge}>
            <Sparkles size={12} color="#F5C77E" />
            <Text style={{ fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', color: '#F5C77E', letterSpacing: 1 }}>Premium Course</Text>
          </View>
          <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#fff' }}>Learn How to Get Leads Faster</Text>
          <Text style={{ fontSize: 12, marginTop: 8, lineHeight: 18, color: 'rgba(255,255,255,0.7)' }}>
            A step-by-step playbook used by top agents — from building a lead magnet to closing 3x faster. Unlock the full book-style course below.
          </Text>
          <Text style={{ fontSize: 11, marginTop: 12, color: 'rgba(255,255,255,0.5)' }}>{CHAPTERS.length} chapters · Step-by-step · Scripts & templates</Text>
        </View>

        {/* Unlock options */}
        <View style={{ padding: 20 }}>
          <Text style={[s.sectionLabel, { textAlign: 'center', marginBottom: 16 }]}>Choose how to unlock</Text>

          <View style={{ gap: 12 }}>
            {/* Pay — coming soon */}
            <View style={[s.unlockCard, { borderColor: colors.line, opacity: 0.8 }]}>
              <View style={[s.rowBetween, { marginBottom: 8 }]}>
                <View style={s.unlockIcon}><CreditCard size={20} color={colors.brand} /></View>
                <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.line }}><Text style={{ fontSize: 9, fontWeight: 'bold', color: colors.muted2, textTransform: 'uppercase' }}>Coming soon</Text></View>
              </View>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: colors.ink }}>Pay ₹{PRICE.toLocaleString('en-IN')}</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>One-time payment for instant access. Online payment launching soon.</Text>
            </View>

            {/* Refer */}
            <Pressable onPress={() => setMethod('refer')} style={[s.unlockCard, method === 'refer' ? { borderColor: colors.brand, backgroundColor: colors.brandTint } : { borderColor: colors.line }]}>
              <View style={[s.rowBetween, { marginBottom: 8 }]}>
                <View style={s.unlockIcon}><Users size={20} color={colors.brand} /></View>
                {method === 'refer' && <Badge />}
              </View>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: colors.ink }}>Refer {REFERRAL_GOAL} people</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Invite {REFERRAL_GOAL} people to HomeInTown. Free access when all {REFERRAL_GOAL} join.</Text>
            </Pressable>
          </View>

          {method === 'refer' && info && (
            <View style={{ marginTop: 20, gap: 16 }}>
              {/* Progress */}
              <View style={[s.subCard, { backgroundColor: colors.cream }]}>
                <View style={[s.rowBetween, { marginBottom: 8 }]}>
                  <Text style={{ fontSize: 14, fontWeight: 'bold', color: colors.ink }}>Referral progress</Text>
                  <Text style={{ fontSize: 14, fontWeight: 'bold', color: colors.brand }}>{referralCount} / {REFERRAL_GOAL} joined</Text>
                </View>
                <View style={{ width: '100%', borderRadius: 999, backgroundColor: colors.line, overflow: 'hidden', marginBottom: 12, height: 10 }}>
                  <View style={{ height: '100%', backgroundColor: colors.brand, width: `${Math.min(100, (referralCount / REFERRAL_GOAL) * 100)}%` }} />
                </View>
                <Text style={{ fontSize: 11, color: colors.muted2 }}>
                  {info.remaining > 0
                    ? `${info.remaining} more ${info.remaining === 1 ? 'person needs' : 'people need'} to join to unlock for free.`
                    : 'Goal reached — unlocking your course…'}
                </Text>
              </View>

              {/* Share link */}
              <View style={[s.subCard, { backgroundColor: '#fff' }]}>
                <Text style={[s.sectionLabel, { marginBottom: 8 }]}>Your referral link</Text>
                <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, color: colors.muted2, fontFamily: 'monospace' }} numberOfLines={1}>{info.referralLink}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={handleShare} style={s.shareBtn}>
                    <Text style={{ fontSize: 12, fontWeight: 'bold', color: colors.muted2 }}>Share link</Text>
                  </Pressable>
                  <Pressable onPress={handleWhatsApp} style={s.waFullBtn}>
                    <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#fff' }}>WhatsApp</Text>
                  </Pressable>
                </View>
                <Text style={{ fontSize: 10, color: colors.muted, marginTop: 8 }}>Your code: <Text style={{ fontWeight: 'bold', color: colors.muted2 }}>{info.referralCode}</Text></Text>
              </View>

              {/* Referred people history */}
              <View style={[s.subCard, { backgroundColor: '#fff' }]}>
                <View style={[s.rowBetween, { marginBottom: 12 }]}>
                  <Text style={s.sectionLabel}>People you referred</Text>
                  <Pressable onPress={load} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><RefreshCw size={12} color={colors.brand} /><Text style={s.brandBold}>Refresh</Text></Pressable>
                </View>
                {info.referrals.length === 0 ? (
                  <Text style={{ fontSize: 12, color: colors.muted, fontStyle: 'italic', paddingVertical: 16, textAlign: 'center' }}>No referrals yet. Share your link to get started.</Text>
                ) : (
                  <View style={{ gap: 8 }}>
                    {info.referrals.map((r) => (
                      <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line }}>
                        <View style={{ width: 36, height: 36, borderRadius: 999, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 12, fontWeight: 'bold', color: colors.brand }}>{r.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: 'bold', color: colors.ink }} numberOfLines={1}>{r.name}</Text>
                          <Text style={{ fontSize: 11, color: colors.muted }}>{r.phone} · {new Date(r.joinedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</Text>
                        </View>
                        <View style={[{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 }, r.joined ? { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' } : { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
                          <Text style={{ fontSize: 9, fontWeight: 'bold', color: r.joined ? '#047857' : '#B45309' }}>{r.joined ? 'Joined' : 'Pending'}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>
          )}

          {!method && <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 20 }}>Select an option above to continue.</Text>}
        </View>
      </View>
    );
  }

  // ── Unlocked: the step-wise book ──
  return (
    <View style={[s.card, { overflow: 'hidden' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.line }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}><BookOpen size={22} color="#fff" /></View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: 'bold', color: colors.ink }}>Get Leads Faster — The Playbook</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>Read step by step. {CHAPTERS.length} chapters · unlocked</Text>
        </View>
      </View>

      <View style={{ padding: 16, gap: 12 }}>
        {CHAPTERS.map((ch) => {
          const isOpen = openChapter === ch.id;
          return (
            <View key={ch.id} style={[s.chapterCard, isOpen ? { borderColor: colors.brand + '4D', backgroundColor: colors.cream } : { borderColor: colors.line }]}>
              <Pressable onPress={() => setOpenChapter(isOpen ? null : ch.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                <View style={{ width: 32, height: 32, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>{ch.id}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: 'bold', color: colors.ink }}>{ch.title}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>{ch.subtitle}</Text>
                </View>
                <Text style={{ fontSize: 10, fontWeight: 'bold', color: colors.muted }}>{ch.readTime}</Text>
                <ChevronDown size={16} color={colors.muted} style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }} />
              </Pressable>

              {isOpen && (
                <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 16, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 16 }}>
                  {ch.sections.map((sec, i) => (
                    <View key={i}>
                      <Text style={{ fontSize: 14, fontWeight: 'bold', color: colors.ink, marginBottom: 4 }}>{sec.heading}</Text>
                      <Text style={{ fontSize: 14, color: colors.muted2, lineHeight: 20 }}>{sec.body}</Text>
                    </View>
                  ))}

                  <View style={{ borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, padding: 12 }}>
                    <Text style={[s.sectionLabel, { marginBottom: 8 }]}>Key takeaways</Text>
                    {ch.keyTakeaways.map((t, i) => (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                        <Check size={14} color={colors.brand} style={{ marginTop: 1 }} />
                        <Text style={{ fontSize: 12, color: colors.ink, flex: 1 }}>{t}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={[s.rowBetween, { paddingTop: 4 }]}>
                    <Pressable onPress={() => setOpenChapter(ch.id > 1 ? ch.id - 1 : ch.id)} disabled={ch.id === 1} style={[s.navBtn, { borderWidth: 1, borderColor: colors.line, opacity: ch.id === 1 ? 0.4 : 1 }]}>
                      <Text style={{ fontSize: 12, fontWeight: 'bold', color: colors.muted2 }}>← Previous</Text>
                    </Pressable>
                    <Pressable onPress={() => setOpenChapter(ch.id < CHAPTERS.length ? ch.id + 1 : ch.id)} disabled={ch.id === CHAPTERS.length} style={[s.navBtn, { backgroundColor: colors.brand, opacity: ch.id === CHAPTERS.length ? 0.4 : 1 }]}>
                      <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#fff' }}>Next chapter →</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Badge() {
  return (
    <View style={{ width: 24, height: 24, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
      <Check size={14} color="#fff" strokeWidth={3} />
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: colors.line },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { fontSize: 10, fontWeight: 'bold', color: colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  brandBold: { fontSize: 12, fontWeight: 'bold', color: colors.brand },
  premiumBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginBottom: 12, backgroundColor: 'rgba(180,83,9,0.2)' },
  unlockCard: { padding: 16, borderRadius: 16, borderWidth: 2 },
  unlockIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  subCard: { padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.line },
  shareBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.line, alignItems: 'center' },
  waFullBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: '#25D366' },
  chapterCard: { borderRadius: 12, borderWidth: 1 },
  navBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
});
