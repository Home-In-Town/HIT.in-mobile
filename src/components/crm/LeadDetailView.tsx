import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Linking, Image, Modal, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { ChevronLeft, ChevronDown, Trash2, Plus, X, Image as ImageIcon, Video as VideoIcon, FileText, Download, Share2, FolderOpen } from 'lucide-react-native';
import { useAuth } from '../../lib/authContext';
import { useToast } from '../Toast';
import { DemoLead, stageColor, leadTypeColor } from './HumanLeadManager';
import { ProjectAsset } from '../../lib/api';
import { colors } from '../../theme';

// An attachment on a journey step (photo, video or PDF)
interface StepAsset {
  type: 'image' | 'video' | 'pdf';
  url: string;
  name: string;
}

interface JourneyStage {
  id: string;
  name: string;
  duration: string;
  description: string;
  touchPlan: string;
  nextStep: string;
  scriptMessage: string;
  photos: string[];
  assets?: StepAsset[];
}

interface Props {
  lead: DemoLead;
  onBack: () => void;
  stages: string[];
  onStageChange?: (newStage: string) => void;
  projectAssets?: ProjectAsset[];
}

type JourneyType = 'inbound' | 'outbound' | 'ai';

const INBOUND: JourneyStage[] = [
  { id: 'in-1', name: 'New Lead', duration: '1 din', description: 'Pehla contact 5 minute ke andar. Inbound lead ne khud form bhara hai — intent garam hai.', touchPlan: '0-90 sec: Pehla WhatsApp\n15 min: Call try\nDin 2: Dusre angle se WhatsApp', nextStep: 'Reply aaye to Contacted mein move karo', scriptMessage: 'Namaste {name} ji\n\n{project} ke liye aapki enquiry mili hai\n\nkhud ke liye ya investment ke liye dekh rahe hain?', photos: [] },
  { id: 'in-2', name: 'Contacted', duration: '2 din', description: 'Client ne reply kiya. Ab requirement samajhna hai — budget, BHK, timeline.', touchPlan: 'Din 1: Requirement call\nDin 2: Brochure + pricing', nextStep: 'Requirement clear to Qualified', scriptMessage: 'Hi {name} ji, {project} ke liye budget range kya hai?\n2BHK ya 3BHK?', photos: [] },
  { id: 'in-3', name: 'Qualified', duration: '3 din', description: 'Budget, BHK, location clear hai. Ab site visit fix karna hai.', touchPlan: 'Din 1: Visit offer\nDin 2: Reminder\nDin 3: Urgency', nextStep: 'Site visit fix to next stage', scriptMessage: '{name} ji, {project} perfect match hai.\nKal site visit ke liye aa sakte hain?', photos: [] },
  { id: 'in-4', name: 'Site Visit Scheduled', duration: '2 din', description: 'Visit schedule ho chuka. Confirm karna hai ki client aayega.', touchPlan: '1 din pehle: Confirm call\nVisit din: Morning reminder', nextStep: 'Visit complete to next stage', scriptMessage: '{name} ji, kal {project} ka site visit hai.\nMain gate pe milte hain.', photos: [] },
  { id: 'in-5', name: 'Site Visit Done', duration: '3 din', description: 'Client ne site dekh li. Feedback lena hai aur objections handle karne hain.', touchPlan: 'Same day: Feedback\nDin 2: Concerns\nDin 3: Price', nextStep: 'Interested to Negotiation', scriptMessage: '{name} ji, site visit kaisa laga?\nKoi sawaal ho to batayiye!', photos: [] },
  { id: 'in-6', name: 'Negotiation', duration: '5 din', description: 'Price discussion. Discount, payment plan, offers discuss karo.', touchPlan: 'Din 1: Offer\nDin 3: Follow-up\nDin 5: Final push', nextStep: 'Token commit to Booking', scriptMessage: '{name} ji, {project} mein special offer:\nToken sirf 1 lakh.', photos: [] },
  { id: 'in-7', name: 'Booking', duration: '7 din', description: 'Token commit. Documentation aur payment process.', touchPlan: 'Din 1: Token\nDin 3: Docs\nDin 7: Agreement', nextStep: 'Full payment to Won', scriptMessage: '{name} ji, booking confirm!\nDocuments ready rakhiye.', photos: [] },
  { id: 'in-8', name: 'Won', duration: '—', description: 'Deal close! Referral ask karo.', touchPlan: 'Congratulations\nReferral ask\nReview', nextStep: 'Referral lena mat bhoolna!', scriptMessage: 'Congratulations {name} ji!\n{project} book ho gaya!', photos: [] },
];

const OUTBOUND: JourneyStage[] = [
  { id: 'out-1', name: 'New Lead', duration: '3 din', description: 'Cold lead — enquiry nahi ki. Value-first approach use karo.', touchPlan: 'Din 1: Value-first (no pitch)\nDin 2: 2nd angle\nDin 3: Call', nextStep: 'Reply/call to Contacted', scriptMessage: 'Hi {name} ji\nMain {project} area mein advisor hoon.\nPrices 15% badh gayi hain. Free consultation?', photos: [] },
  { id: 'out-2', name: 'Contacted', duration: '3 din', description: 'Cold se warm. Requirement samjho bina pushy hue.', touchPlan: 'Din 1: Casual\nDin 2: Insight\nDin 3: Soft ask', nextStep: 'Requirement to Qualified', scriptMessage: '{name} ji, baat karke acha laga.\n{project} fit karta hai. Brochure bhejun?', photos: [] },
  { id: 'out-3', name: 'Qualified', duration: '4 din', description: 'Trust zyada banana padta hai. Social proof use karo.', touchPlan: 'Din 1: Comparison\nDin 2: Testimonial\nDin 3: Visit push', nextStep: 'Visit fix to next stage', scriptMessage: '{name} ji, aapke budget mein 3 options.\nComparison bhej raha hoon. Visit kab?', photos: [] },
  { id: 'out-4', name: 'Site Visit Scheduled', duration: '2 din', description: 'No-show rate zyada. Double confirm + pickup offer.', touchPlan: '1 din pehle: Confirm\nVisit din: Cab offer', nextStep: 'Visit to next stage', scriptMessage: '{name} ji, kal {project} visit hai.\nPickup chahiye toh bata dijiye!', photos: [] },
  { id: 'out-5', name: 'Site Visit Done', duration: '4 din', description: 'Zyada time lagta hai decide karne mein. Patience rakho.', touchPlan: 'Same day: Kaisa laga?\nDin 2: Comparison\nDin 4: Family?', nextStep: 'Interest to Negotiation', scriptMessage: '{name} ji, {project} kaisa laga?\nFamily ko dikhana chahein?', photos: [] },
  { id: 'out-6', name: 'Negotiation', duration: '7 din', description: 'Lamba chalta hai. Patience + FOMO carefully.', touchPlan: 'Din 1: Special offer\nDin 3: Social proof\nDin 7: Last date', nextStep: 'Token to Booking', scriptMessage: '{name} ji, builder se special baat ki:\nDiscount + No EMI offer.', photos: [] },
  { id: 'out-7', name: 'Booking', duration: '7 din', description: 'Cold feet aata hai. Fast documentation.', touchPlan: 'Din 1: Token\nDin 4: Agreement\nDin 7: Signing', nextStep: 'Agreement to Won', scriptMessage: '{name} ji, booking confirmed!\nDocuments jaldi de dijiye.', photos: [] },
  { id: 'out-8', name: 'Won', duration: '—', description: 'Outbound convert! Referral chances high.', touchPlan: 'Congratulations\nReferral ask\nTestimonial', nextStep: 'Referral program', scriptMessage: 'Congratulations {name} ji!\nBahut acha decision liya.', photos: [] },
];

const AI_GUIDE: JourneyStage[] = [
  { id: 'ai-1', name: 'New Lead', duration: 'Instant', description: 'AI auto-responds 30 sec mein. Intent capture, quality score, priority assign.', touchPlan: '0-30 sec: AI auto-reply\n2 min: AI questions\n5 min: Scored + assigned', nextStep: 'AI qualifies to auto-Contacted', scriptMessage: '[AI Auto]\nHi {name}! Thanks for interest in {project}.\nLooking for: 1.Self-use 2.Investment 3.Exploring', photos: [] },
  { id: 'ai-2', name: 'Contacted', duration: '1 din', description: 'AI qualified. Human agent takes over with AI-suggested points.', touchPlan: 'Immediate: AI summary\n30 min: Agent calls', nextStep: 'Agent confirms to Qualified', scriptMessage: '[AI Brief]\nLead: {name}\nProject: {project}\nIntent: [Detected]', photos: [] },
  { id: 'ai-3', name: 'Qualified', duration: '2 din', description: 'AI generates personalized content — comparisons, virtual tours.', touchPlan: 'Immediate: AI brochure\nDin 1: Virtual tour\nDin 2: Visit slots', nextStep: 'Response to Site Visit', scriptMessage: '[AI Auto-sends]\n{name} ji, personalized report ready.\nVisit slots: [AI-SUGGESTED]', photos: [] },
  { id: 'ai-4', name: 'Site Visit Scheduled', duration: '1 din', description: 'AI handles reminders, rescheduling, pre-visit content.', touchPlan: 'Booking: AI invite\n24hr: Reminder\nNo-show: Auto-reschedule', nextStep: 'AI tracks arrival to Visit Done', scriptMessage: '[AI Sequence]\nCalendar invite sent\nMaps link sent\nReminders active', photos: [] },
  { id: 'ai-5', name: 'Site Visit Done', duration: '2 din', description: 'AI captures feedback via survey. Sentiment analysis.', touchPlan: '2hr: AI survey\nSame day: Analysis\nDin 1: Targeted content', nextStep: 'Positive to Negotiation', scriptMessage: '[AI Survey]\n{name} ji, 3 quick questions.\nSentiment: [SCORE]', photos: [] },
  { id: 'ai-6', name: 'Negotiation', duration: '4 din', description: 'AI monitors competitors, suggests optimal offer, predicts close.', touchPlan: 'Immediate: AI offer\nDin 3: Urgency\nDin 4: Final offer', nextStep: 'High probability to push', scriptMessage: '[AI Intel]\nClose probability: [X]%\nSuggested offer: optimal', photos: [] },
  { id: 'ai-7', name: 'Booking', duration: '5 din', description: 'AI streamlines docs — auto-fills, checklists, OCR verification.', touchPlan: 'Day 1: Doc checklist\nDay 2: OCR verify\nDay 5: Completion', nextStep: 'All verified to Won', scriptMessage: '[AI Doc Bot]\n{name} ji, upload: Aadhar, PAN, 2 Photos.\nStatus: [X/4]', photos: [] },
  { id: 'ai-8', name: 'Won', duration: '—', description: 'AI auto-triggers referral campaigns, review requests, cross-sell.', touchPlan: 'Day 1: Referral\nWeek 1: Review\nMonth 1: Cross-sell', nextStep: 'AI tracks referrals', scriptMessage: '[AI Post-Sale]\nReferral link generated\nReview link sent', photos: [] },
];

const fill = (t: string, lead: DemoLead) => t.replace(/\{name\}/g, lead.name.split(' ')[0]).replace(/\{project\}/g, lead.project);

export default function LeadDetailView({ lead, onBack, stages, onStageChange, projectAssets = [] }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  // Admin and captain can edit the sales journey playbook
  const canEditJourney = user?.role === 'admin' || user?.role === 'captain';
  // Stage whose "View Assets" modal is open (null = closed)
  const [assetsModalStageId, setAssetsModalStageId] = useState<string | null>(null);

  const [journeyType, setJourneyType] = useState<JourneyType>(lead.leadType === 'outbound' ? 'outbound' : 'inbound');
  const [journeys, setJourneys] = useState<Record<JourneyType, JourneyStage[]>>({ inbound: INBOUND, outbound: OUTBOUND, ai: AI_GUIDE });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [showNote, setShowNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [notes, setNotes] = useState<Record<string, { text: string; date: string }[]>>({});
  const [showReminder, setShowReminder] = useState<string | null>(null);
  const [reminderText, setReminderText] = useState('');
  const [reminderDate, setReminderDate] = useState('');
  const [reminders, setReminders] = useState<Record<string, { text: string; date: string }[]>>({});

  const currentStages = journeys[journeyType];
  const currentStep = Math.max(1, stages.indexOf(lead.stage) + 1);
  const sc = stageColor(lead.stage);

  // Only offer the journey tab matching the lead's type (inbound or outbound), plus AI Guide.
  const availableJourneyTypes: JourneyType[] =
    lead.leadType === 'outbound' ? ['outbound', 'ai'] : ['inbound', 'ai'];

  const editField = (stageId: string, field: keyof JourneyStage, value: string) => {
    setJourneys((prev) => ({ ...prev, [journeyType]: prev[journeyType].map((st) => (st.id === stageId ? { ...st, [field]: value } : st)) }));
  };

  const addStage = () => {
    const id = `${journeyType}-${currentStages.length + 1}`;
    setJourneys((prev) => ({ ...prev, [journeyType]: [...prev[journeyType], { id, name: 'New Stage', duration: '—', description: 'Add description...', touchPlan: 'Define touch plan...', nextStep: 'Define next step...', scriptMessage: 'Add script...', photos: [] }] }));
    setExpanded(id);
  };

  const deleteStage = (id: string) => {
    setJourneys((prev) => ({ ...prev, [journeyType]: prev[journeyType].filter((st) => st.id !== id) }));
    if (expanded === id) setExpanded(null);
  };

  const appendAsset = (stageId: string, asset: StepAsset) => {
    setJourneys((prev) => ({ ...prev, [journeyType]: prev[journeyType].map((st) => (st.id === stageId ? { ...st, assets: [...(st.assets || []), asset] } : st)) }));
  };

  // Pick a photo or video from the library and attach it to the step
  const uploadMedia = async (stageId: string, kind: 'image' | 'video') => {
    if (!canEditJourney) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast.error('Media permission denied'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'image' ? ImagePicker.MediaTypeOptions.Images : ImagePicker.MediaTypeOptions.Videos,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      appendAsset(stageId, { type: kind, url: a.uri, name: a.fileName || `${kind}-${Date.now()}` });
      toast.success(`${kind === 'image' ? 'Photo' : 'Video'} added`);
    }
  };

  // Pick a PDF document and attach it to the step
  const uploadPdf = async (stageId: string) => {
    if (!canEditJourney) return;
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (!result.canceled && result.assets?.[0]) {
      const a = result.assets[0];
      appendAsset(stageId, { type: 'pdf', url: a.uri, name: a.name || `document-${Date.now()}.pdf` });
      toast.success('PDF added');
    }
  };

  const deleteAsset = (stageId: string, idx: number) => {
    if (!canEditJourney) return;
    setJourneys((prev) => ({ ...prev, [journeyType]: prev[journeyType].map((st) => (st.id === stageId ? { ...st, assets: (st.assets || []).filter((_, i) => i !== idx) } : st)) }));
  };

  // Combine legacy photos + typed assets for display
  const stageAssets = (st: JourneyStage): StepAsset[] => [
    ...st.photos.map((p, i) => ({ type: 'image' as const, url: p, name: `Photo ${i + 1}` })),
    ...(st.assets || []),
  ];

  // Open an asset URL (image/video/pdf) in the device's default viewer/browser
  const openAsset = (asset: { url: string; name: string }) => {
    Linking.openURL(asset.url).catch(() => toast.error('Could not open asset'));
  };

  // Share an asset link via WhatsApp (falls back to the OS share sheet)
  const shareAssetToWhatsApp = async (asset: { url: string; name: string }) => {
    const phone = lead.phone.replace(/[^0-9]/g, '');
    const message = `${asset.name}\n${asset.url}`;
    const waUrl = phone
      ? `whatsapp://send?phone=${phone}&text=${encodeURIComponent(message)}`
      : `whatsapp://send?text=${encodeURIComponent(message)}`;
    const canOpen = await Linking.canOpenURL(waUrl).catch(() => false);
    if (canOpen) {
      Linking.openURL(waUrl).catch(() => toast.error('Could not open WhatsApp'));
    } else {
      const web = phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
        : `https://wa.me/?text=${encodeURIComponent(message)}`;
      Linking.openURL(web).catch(() => toast.error('WhatsApp not available'));
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
      {/* Header */}
      <View style={s.rowBetween}>
        <Pressable onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ChevronLeft size={16} color={colors.muted2} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.muted2 }}>Client Dashboard</Text>
        </Pressable>
        {canEditJourney && (
          <Pressable onPress={() => setIsEditing(!isEditing)} style={[s.editBtn, isEditing ? { backgroundColor: colors.brand } : { borderWidth: 1, borderColor: colors.line }]}>
            <Text style={{ fontSize: 11, fontWeight: 'bold', color: isEditing ? '#fff' : colors.muted2 }}>{isEditing ? 'Done' : 'Edit'}</Text>
          </Pressable>
        )}
      </View>

      {/* Client card */}
      <View style={s.clientCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={s.clientAvatar}>
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>{lead.name.split(' ').map((n) => n[0]).join('')}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 15, fontWeight: 'bold', color: '#fff' }}>{lead.name}</Text>
            <Text style={{ fontSize: 11, color: colors.brand }}>{lead.phone}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          <Tag text={lead.project} dark />
          <Tag text={lead.source} dark />
          {(() => { const lt = leadTypeColor(lead.leadType); return (
            <View style={{ backgroundColor: lt.bg, borderColor: lt.border, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
              <Text style={{ color: lt.text, fontSize: 9, fontWeight: '700', textTransform: 'uppercase' }}>{lead.leadType}</Text>
            </View>
          ); })()}
          <View style={{ backgroundColor: sc.bg, borderColor: sc.border, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
            <Text style={{ color: sc.text, fontSize: 9, fontWeight: '700' }}>{lead.stage}</Text>
          </View>
        </View>
      </View>

      {/* Stage change */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.sectionLabel}>Current Stage</Text>
          <View style={{ alignSelf: 'flex-start', backgroundColor: sc.bg, borderColor: sc.border, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
            <Text style={{ color: sc.text, fontSize: 11, fontWeight: '700' }}>{lead.stage}</Text>
          </View>
        </View>
      </View>

      {/* Move to — stage buttons */}
      {onStageChange && (
        <View>
          <Text style={[s.sectionLabel, { marginBottom: 6 }]}>Move to Stage</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {stages.map((st) => {
                const active = lead.stage === st;
                return (
                  <Pressable key={st} onPress={() => { onStageChange(st); toast.success(`Moved to ${st}`); }} style={[s.pill, active ? s.pillActive : s.pillInactive]}>
                    <Text style={[s.pillText, { color: active ? '#fff' : colors.muted2 }]}>{st}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>
      )}

      {/* Pipeline progress */}
      <View>
        <View style={[s.rowBetween, { marginBottom: 8 }]}>
          <Text style={s.sectionLabel}>Pipeline</Text>
          <Text style={{ fontSize: 11, fontWeight: 'bold', color: colors.brand }}>Step {currentStep} of {stages.length}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {stages.map((_, i) => (
            <View key={i} style={{ flex: 1, borderRadius: 999, height: 6, backgroundColor: i < currentStep ? colors.brand : colors.line }} />
          ))}
        </View>
      </View>

      {/* Sales Journey */}
      <View>
        <View style={[s.rowBetween, { marginBottom: 12 }]}>
          <Text style={{ fontSize: 13, fontWeight: 'bold', color: colors.ink }}>Sales Journey</Text>
          <Text style={{ fontSize: 11, fontWeight: 'bold', color: colors.brand }}>Step {currentStep} / {currentStages.length}</Text>
        </View>

        {/* Journey type toggle */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {availableJourneyTypes.map((t) => {
            const active = journeyType === t;
            return (
              <Pressable key={t} onPress={() => { setJourneyType(t); setExpanded(null); }} style={[s.journeyTab, active ? { backgroundColor: colors.night } : { backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line }]}>
                <Text style={{ fontSize: 11, fontWeight: 'bold', color: active ? '#fff' : colors.muted2 }}>{t === 'inbound' ? 'Inbound' : t === 'outbound' ? 'Outbound' : 'AI Guide'}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={{ fontSize: 11, color: colors.muted, fontStyle: 'italic', marginBottom: 12 }}>
          {journeyType === 'inbound' && 'Inbound rasta ~23 din. Client ne khud enquiry ki hai.'}
          {journeyType === 'outbound' && 'Outbound rasta 30+ din. Cold leads — trust build karo pehle.'}
          {journeyType === 'ai' && 'AI-assisted — fastest close ~15 din.'}
        </Text>

        {/* Stages */}
        <View style={{ gap: 8 }}>
          {currentStages.map((stage, idx) => {
            const isOpen = expanded === stage.id;
            const done = idx < currentStep;
            return (
              <View key={stage.id} style={[s.stageCard, { borderColor: isOpen ? colors.brand + '4D' : colors.line, backgroundColor: done ? '#fff' : colors.cream }]}>
                <Pressable onPress={() => setExpanded(isOpen ? null : stage.id)} style={s.stageHeader}>
                  <View style={[s.stageNum, { backgroundColor: done ? colors.brand : colors.line }]}>
                    <Text style={{ color: done ? '#fff' : colors.muted, fontWeight: '700', fontSize: 11 }}>{idx + 1}</Text>
                  </View>
                  <Text style={{ flex: 1, fontSize: 13, fontWeight: 'bold', color: colors.ink }}>{stage.name}</Text>
                  <Text style={{ fontSize: 9, fontWeight: 'bold', color: colors.brand }}>{stage.duration}</Text>
                  {isEditing && (
                    <Pressable onPress={() => deleteStage(stage.id)} style={{ padding: 4 }}><Trash2 size={16} color="#F87171" /></Pressable>
                  )}
                  <ChevronDown size={16} color={colors.muted} style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }} />
                </Pressable>

                {isOpen && (
                  <View style={s.stageBody}>
                    {/* Description */}
                    {isEditing ? (
                      <TextInput multiline value={stage.description} onChangeText={(v) => editField(stage.id, 'description', v)} style={s.editArea} />
                    ) : (
                      <Text style={{ fontSize: 13, color: colors.muted2, lineHeight: 20 }}>{stage.description}</Text>
                    )}

                    {/* View project assets */}
                    <Pressable onPress={() => setAssetsModalStageId(stage.id)} style={s.viewAssetsBtn}>
                      <FolderOpen size={15} color="#fff" />
                      <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#fff' }}>View Assets</Text>
                      {projectAssets.length > 0 && (
                        <View style={s.assetCountBadge}><Text style={{ fontSize: 8, fontWeight: 'bold', color: '#fff' }}>{projectAssets.length}</Text></View>
                      )}
                    </Pressable>

                    {/* Step attachments */}
                    {(stageAssets(stage).length > 0 || canEditJourney) && (
                      <View style={s.attachBox}>
                        <View style={[s.rowBetween, { marginBottom: 8 }]}>
                          <Text style={s.sectionLabel}>Attachments</Text>
                          {canEditJourney && (
                            <View style={{ flexDirection: 'row', gap: 6 }}>
                              <Pressable onPress={() => uploadMedia(stage.id, 'image')} style={s.attachChip}>
                                <ImageIcon size={12} color={colors.muted2} /><Text style={s.attachChipText}>Photo</Text>
                              </Pressable>
                              <Pressable onPress={() => uploadMedia(stage.id, 'video')} style={s.attachChip}>
                                <VideoIcon size={12} color={colors.muted2} /><Text style={s.attachChipText}>Video</Text>
                              </Pressable>
                              <Pressable onPress={() => uploadPdf(stage.id)} style={s.attachChip}>
                                <FileText size={12} color={colors.muted2} /><Text style={s.attachChipText}>PDF</Text>
                              </Pressable>
                            </View>
                          )}
                        </View>
                        {stageAssets(stage).length > 0 ? (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {stageAssets(stage).map((asset, aIdx) => {
                              const legacyCount = stage.photos.length;
                              const typedIndex = aIdx - legacyCount;
                              return (
                                <Pressable key={aIdx} onPress={() => openAsset(asset)} style={{ borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, position: 'relative', width: 90, height: 70 }}>
                                  {asset.type === 'image' ? (
                                    <Image source={{ uri: asset.url }} style={{ width: 90, height: 70 }} />
                                  ) : (
                                    <View style={{ width: 90, height: 70, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                                      {asset.type === 'video' ? <VideoIcon size={22} color={colors.brand} /> : <FileText size={22} color={colors.brand} />}
                                      <Text style={{ color: '#fff', fontSize: 8, fontWeight: '700', textTransform: 'uppercase' }}>{asset.type}</Text>
                                    </View>
                                  )}
                                  {canEditJourney && typedIndex >= 0 && (
                                    <Pressable onPress={() => deleteAsset(stage.id, typedIndex)} style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: 9, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center' }}>
                                      <X size={12} color="#fff" strokeWidth={2.5} />
                                    </Pressable>
                                  )}
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : (
                          <Text style={{ fontSize: 9, color: colors.muted, fontStyle: 'italic' }}>No attachments added yet</Text>
                        )}
                      </View>
                    )}

                    {/* Touch Plan */}
                    <InfoBlock label="Touch Plan" value={stage.touchPlan} editing={isEditing} onChange={(v) => editField(stage.id, 'touchPlan', v)} mono />
                    {/* Next Step */}
                    <InfoBlock label="Aage Kab" value={stage.nextStep} editing={isEditing} onChange={(v) => editField(stage.id, 'nextStep', v)} />
                    {/* Script */}
                    <View style={s.scriptBox}>
                      <Text style={[s.sectionLabel, { marginBottom: 6 }]}>Script / Message</Text>
                      {isEditing ? (
                        <TextInput multiline value={stage.scriptMessage} onChangeText={(v) => editField(stage.id, 'scriptMessage', v)} style={s.editAreaSm} />
                      ) : (
                        <Text style={{ fontSize: 11, color: colors.ink }}>{fill(stage.scriptMessage, lead)}</Text>
                      )}
                    </View>

                    {/* Actions */}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable onPress={() => Linking.openURL(`tel:${lead.phone.replace(/\s/g, '')}`)} style={s.callBtn}>
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>Call karo</Text>
                      </Pressable>
                      <Pressable onPress={() => Linking.openURL(`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(fill(stage.scriptMessage, lead))}`)} style={[s.waBtn]}>
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>WhatsApp bhejo</Text>
                      </Pressable>
                    </View>

                    {/* Note / Reminder toggles */}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable onPress={() => { setShowNote(showNote === stage.id ? null : stage.id); setShowReminder(null); }} style={[s.toggleChip, showNote === stage.id ? { borderColor: colors.brand, backgroundColor: colors.brandTint } : { borderColor: colors.line }]}>
                        <Text style={{ fontSize: 11, fontWeight: 'bold', color: showNote === stage.id ? colors.brand : colors.muted2 }}>Note</Text>
                      </Pressable>
                      <Pressable onPress={() => { setShowReminder(showReminder === stage.id ? null : stage.id); setShowNote(null); }} style={[s.toggleChip, showReminder === stage.id ? { borderColor: colors.brand, backgroundColor: colors.brandTint } : { borderColor: colors.line }]}>
                        <Text style={{ fontSize: 11, fontWeight: 'bold', color: showReminder === stage.id ? colors.brand : colors.muted2 }}>Reminder</Text>
                      </Pressable>
                    </View>

                    {/* Note input */}
                    {showNote === stage.id && (
                      <View style={s.inputCard}>
                        <TextInput multiline placeholder="Add a note..." placeholderTextColor={colors.muted} value={noteText} onChangeText={setNoteText} style={s.editAreaSm} />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <Pressable onPress={() => { if (noteText.trim()) { setNotes((p) => ({ ...p, [stage.id]: [...(p[stage.id] || []), { text: noteText, date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) }] })); setNoteText(''); setShowNote(null); toast.success('Note saved'); } }} style={s.saveChip}><Text style={{ color: '#fff', fontSize: 9, fontWeight: 'bold' }}>Save Note</Text></Pressable>
                          <Pressable onPress={() => { setShowNote(null); setNoteText(''); }} style={s.cancelChip}><Text style={{ color: colors.muted2, fontSize: 9, fontWeight: 'bold' }}>Cancel</Text></Pressable>
                        </View>
                      </View>
                    )}

                    {/* Reminder input */}
                    {showReminder === stage.id && (
                      <View style={s.inputCard}>
                        <TextInput placeholder="Reminder message..." placeholderTextColor={colors.muted} value={reminderText} onChangeText={setReminderText} style={s.editAreaSm} />
                        <TextInput placeholder="When (e.g. 25 Aug 3PM)" placeholderTextColor={colors.muted} value={reminderDate} onChangeText={setReminderDate} style={s.editAreaSm} />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <Pressable onPress={() => { if (reminderText.trim() && reminderDate) { setReminders((p) => ({ ...p, [stage.id]: [...(p[stage.id] || []), { text: reminderText, date: reminderDate }] })); setReminderText(''); setReminderDate(''); setShowReminder(null); toast.success('Reminder set'); } }} style={s.saveChip}><Text style={{ color: '#fff', fontSize: 9, fontWeight: 'bold' }}>Set Reminder</Text></Pressable>
                          <Pressable onPress={() => { setShowReminder(null); setReminderText(''); setReminderDate(''); }} style={s.cancelChip}><Text style={{ color: colors.muted2, fontSize: 9, fontWeight: 'bold' }}>Cancel</Text></Pressable>
                        </View>
                      </View>
                    )}

                    {/* Saved notes */}
                    {notes[stage.id]?.map((n, i) => (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 8, borderRadius: 8, backgroundColor: '#FEFCE8', borderColor: '#FEF08A', borderWidth: 1 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 9, color: colors.ink }}>{n.text}</Text>
                          <Text style={{ fontSize: 8, color: colors.muted, marginTop: 2 }}>{n.date}</Text>
                        </View>
                      </View>
                    ))}
                    {/* Saved reminders */}
                    {reminders[stage.id]?.map((r, i) => (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 8, borderRadius: 8, backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 9, color: colors.ink }}>{r.text}</Text>
                          <Text style={{ fontSize: 8, marginTop: 2, color: '#2563EB' }}>{r.date}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}

          {isEditing && (
            <Pressable onPress={addStage} style={s.addStageBtn}>
              <Plus size={16} color={colors.brand} strokeWidth={2.5} />
              <Text style={{ color: colors.brand, fontSize: 11, fontWeight: 'bold' }}>Add Journey Stage</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Activity */}
      <View>
        <Text style={{ fontSize: 13, fontWeight: 'bold', color: colors.ink, marginBottom: 12 }}>Full Activity</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ borderRadius: 999, backgroundColor: colors.brand, marginTop: 6, width: 10, height: 10 }} />
          <View>
            <Text style={{ fontSize: 9, color: colors.muted }}>{lead.date}</Text>
            <Text style={{ fontSize: 11, fontWeight: '500', color: colors.ink }}>Lead Added - {lead.source}</Text>
          </View>
        </View>
      </View>

      {/* View Assets modal */}
      <Modal visible={!!assetsModalStageId} transparent animationType="slide" onRequestClose={() => setAssetsModalStageId(null)}>
        <View style={s.modalOverlayBottom}>
          <View style={[s.sheet, { maxHeight: '88%' }]}>
            <View style={s.sheetHeader}>
              <View>
                <Text style={{ fontSize: 15, fontWeight: 'bold', color: colors.ink }}>Property Assets</Text>
                <Text style={{ fontSize: 9, color: colors.muted, marginTop: 2 }}>{lead.project} — open or share on WhatsApp</Text>
              </View>
              <Pressable onPress={() => setAssetsModalStageId(null)}><X size={22} color={colors.muted} /></Pressable>
            </View>
            {projectAssets.length === 0 ? (
              <View style={{ paddingVertical: 64, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: colors.muted }}>No assets uploaded for this project yet.</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
                {projectAssets.map((asset, i) => (
                  <View key={i} style={{ borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', backgroundColor: colors.cream }}>
                    <View style={{ height: 150, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' }}>
                      {asset.type === 'image' ? (
                        <Image source={{ uri: asset.url }} style={{ width: '100%', height: 150 }} resizeMode="cover" />
                      ) : asset.type === 'video' ? (
                        <View style={{ alignItems: 'center', gap: 8 }}><VideoIcon size={34} color={colors.brand} /><Text style={{ color: '#fff', fontSize: 9, fontWeight: 'bold' }}>Video</Text></View>
                      ) : (
                        <View style={{ alignItems: 'center', gap: 8 }}><FileText size={34} color={colors.brand} /><Text style={{ color: '#fff', fontSize: 9, fontWeight: 'bold' }}>Brochure PDF</Text></View>
                      )}
                    </View>
                    <View style={{ padding: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line }}><Text style={{ fontSize: 8, fontWeight: 'bold', color: colors.muted2, textTransform: 'uppercase' }}>{asset.type}</Text></View>
                        <Text style={{ fontSize: 11, fontWeight: '600', color: colors.ink, flex: 1 }} numberOfLines={1}>{asset.name}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Pressable onPress={() => openAsset(asset)} style={s.assetOpenBtn}>
                          <Download size={14} color="#fff" /><Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>Open</Text>
                        </Pressable>
                        <Pressable onPress={() => shareAssetToWhatsApp(asset)} style={s.assetWaBtn}>
                          <Share2 size={14} color="#fff" /><Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>WhatsApp</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Tag({ text, dark }: { text: string; dark?: boolean }) {
  return (
    <View style={{ backgroundColor: dark ? colors.night2 : '#F5F5F4', borderColor: dark ? colors.muted2 : colors.line, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ color: dark ? '#fff' : colors.muted2, fontSize: 9, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

function InfoBlock({ label, value, editing, onChange, mono }: { label: string; value: string; editing: boolean; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <View style={{ borderRadius: 8, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, padding: 12 }}>
      <Text style={[s.sectionLabel, { marginBottom: 6 }]}>{label}</Text>
      {editing ? (
        <TextInput multiline value={value} onChangeText={onChange} style={[s.editAreaSm, mono ? { fontFamily: 'monospace' } : null]} />
      ) : (
        <Text style={[{ fontSize: 11, color: colors.ink, fontWeight: '500' }, mono ? { fontFamily: 'monospace' } : null]}>{value}</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  clientCard: { borderRadius: 16, backgroundColor: colors.night, padding: 16 },
  clientAvatar: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.muted2, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { fontSize: 9, fontWeight: 'bold', color: colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  pillActive: { backgroundColor: colors.brand },
  pillInactive: { backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line },
  pillText: { fontSize: 10, fontWeight: 'bold' },
  journeyTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
  stageCard: { borderRadius: 12, borderWidth: 1 },
  stageHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  stageNum: { width: 28, height: 28, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  stageBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 12, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 },
  editArea: { fontSize: 13, color: colors.muted2, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10 },
  editAreaSm: { fontSize: 11, color: colors.ink, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 8 },
  viewAssetsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.night, alignSelf: 'flex-start' },
  assetCountBadge: { marginLeft: 2, paddingHorizontal: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)' },
  attachBox: { borderRadius: 8, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, padding: 12 },
  attachChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line },
  attachChipText: { fontSize: 9, fontWeight: 'bold', color: colors.muted2 },
  scriptBox: { borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', padding: 12 },
  callBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.night, alignItems: 'center' },
  waBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: '#25D366' },
  toggleChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  inputCard: { borderRadius: 8, borderWidth: 1, borderColor: colors.brand + '33', backgroundColor: colors.brandTint, padding: 12, gap: 8 },
  saveChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.brand },
  cancelChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.line },
  addStageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.brand + '4D' },
  modalOverlayBottom: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.line },
  assetOpenBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.night },
  assetWaBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 8, backgroundColor: '#25D366' },
});
