// Add Project — native port of HIT_Frontend's ProjectForm.tsx (single-scroll, 7 sections).
// Full parity with the website form: custom property type, lat/lng, custom amenities,
// additional charges, gallery/videos/brochure media, Save Draft + Publish.
//
// Create flow:
//   1) projectsApiExtended.create(payload with empty media) -> get id
//   2) upload cover / gallery / videos / brochure via mediaApi.uploadAndSave
//   3) projectsApiExtended.update(id, { media: {...} })
//   4) if publishing: projectsApiExtended.publish(id)
// Backend nested shape: pricing{}, configuration{}, media{}, cta{}, amenities[] top-level.

import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable,
  StyleSheet, ActivityIndicator, Image, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  ChevronLeft, Check, ImagePlus, Building2, ScrollText,
  Sparkles, SlidersHorizontal, IndianRupee, Phone, Plus, X,
  Film, FileText, Save,
} from 'lucide-react-native';
import { projectsApiExtended, mediaApi } from '../../src/lib/api';
import { useToast } from '../../src/components/Toast';
import { colors } from '../../src/theme';

// ── Options (mirror HIT_Frontend propertyConfig + project.ts) ──
const CATEGORIES = ['Residential', 'Commercial', 'Mixed Use'];

const CATEGORY_PROPERTY_TYPES: Record<string, string[]> = {
  Residential: ['Apartment / Flat', 'Villa', 'Independent House', 'Row House', 'Township', 'Residential Plot', 'Farm House', 'Farm Land', 'Studio Apartment', 'Penthouse', 'Duplex', 'Serviced Apartment', 'Other'],
  Commercial: ['Office Space', 'Retail', 'Showroom', 'Commercial Plot / Land', 'Industry', 'Co-working Space', 'Warehouse / Storage', 'Hospitality', 'Other'],
  'Mixed Use': ['Residential + Retail', 'Residential + Office', 'Residential + Commercial Complex', 'Mixed-Use Tower', 'Mixed-Use Township', 'Residential + Hospitality', 'Residential + Commercial Plot', 'Integrated Development', 'Other'],
};

const PROJECT_STATUS = [
  { value: 'pre-launch', label: '🚀 Pre-Launch' },
  { value: 'under-construction', label: '🏗️ Under Construction' },
  { value: 'ready-to-move', label: '✅ Ready to Move' },
];

const BHK_OPTIONS = ['1BHK', '2BHK', '3BHK', '4BHK', '5BHK'];
const FACING_OPTIONS = ['East', 'West', 'North', 'South', 'North-East', 'North-West', 'South-East', 'South-West'];

// Full amenities list (matches HIT_Frontend AMENITIES)
const AMENITIES = [
  'Lift', 'Parking', 'Power Backup', 'Gym', 'Swimming Pool', 'Garden', 'Club House', 'Security',
  'Children Play Area', 'Jogging Track', 'Community Hall', 'Fire Safety', 'CCTV Surveillance',
  'Gated Community', 'Visitor Parking', 'Intercom Facility', '24x7 Water Supply', 'Rain Water Harvesting',
  'Sewage Treatment Plant', 'Waste Management', 'Solar Power', 'EV Charging Station', 'Indoor Games Room',
  'Outdoor Sports Court', 'Tennis Court', 'Basketball Court', 'Badminton Court', 'Cricket Pitch',
  'Multipurpose Hall', 'Amphitheatre', 'Yoga Deck', 'Meditation Area', 'Senior Citizen Zone', 'Pet Park',
  'Library', 'Business Center', 'Conference Room', 'Co-working Space', 'High-Speed Internet',
  'Shopping Complex', 'ATM', 'Restaurant / Cafeteria', 'Pharmacy', 'Medical Center', 'School / Day Care',
  'Guest Rooms', 'Terrace Garden', 'Landscape Garden', 'Water Features', 'BBQ Area', 'Open Air Theatre',
  'Golf Course', 'Lake View', 'Temple / Prayer Hall', 'Banquet Hall', 'Concierge Services',
  'Car Wash Area', 'Salon / Spa', 'Music Room', 'Dance Studio', 'Virtual Reality Room', 'Game Zone',
  'Arcade', 'Karaoke Room',
];
const AMENITIES_PREVIEW = 10; // "See more" reveals the rest (matches website)

const PLOT_TYPES = ['Residential Plot', 'Commercial Plot / Land', 'Residential + Commercial Plot'];
function isPlotType(pt: string): boolean {
  if (!pt) return false;
  if (PLOT_TYPES.includes(pt)) return true;
  const l = pt.toLowerCase();
  return l.includes('plot') || l.includes('land');
}

// File-size limits (mobile — 10 MB for images, generous for video/brochure)
const IMG_MAX_BYTES = 10 * 1024 * 1024;     // cover + gallery: 10 MB
const BROCHURE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;    // 50 MB
const MAX_VIDEOS = 2;

// Parse the lower-bound sqft number from an area range string ("650 - 1200 sqft").
function parseAreaLowerBoundSqFt(str: string): number | null {
  if (!str) return null;
  const lower = str.toLowerCase();
  if (/(acre|hectare|guntha|bigha)/.test(lower)) return null;
  const m = lower.match(/\d[\d,]*/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return isNaN(n) || n <= 0 ? null : n;
}

type Media = { uri: string; name: string; mimeType: string };

export default function AddProjectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();

  // Section 1 — Basic
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [customType, setCustomType] = useState('');
  const [city, setCity] = useState('');
  const [location, setLocation] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [googleMapLink, setGoogleMapLink] = useState('');

  // Section 2 — Legal & Trust
  const [reraApproved, setReraApproved] = useState(false);
  const [reraNumber, setReraNumber] = useState('');
  const [projectStatus, setProjectStatus] = useState('under-construction');

  // Section 3 — Amenities
  const [amenities, setAmenities] = useState<string[]>([]);
  const [showAllAmenities, setShowAllAmenities] = useState(false);
  const [customAmenity, setCustomAmenity] = useState('');

  // Section 4 — Configuration
  const [bhkOptions, setBhkOptions] = useState<string[]>([]);
  const [carpetAreaRange, setCarpetAreaRange] = useState('');
  const [floorRange, setFloorRange] = useState('');
  const [plotSizeRange, setPlotSizeRange] = useState('');
  const [gatedCommunity, setGatedCommunity] = useState(false);
  const [facingOptions, setFacingOptions] = useState<string[]>([]);

  // Section 5 — Pricing
  const [startingPrice, setStartingPrice] = useState('');
  const [priceRange, setPriceRange] = useState('');
  const [paymentPlan, setPaymentPlan] = useState('');
  const [bankLoanAvailable, setBankLoanAvailable] = useState(false);
  // Additional charges (optional)
  const [gstPercentage, setGstPercentage] = useState('');
  const [stampDutyPercentage, setStampDutyPercentage] = useState('');
  const [registrationCharges, setRegistrationCharges] = useState('');
  const [maintenanceCharges, setMaintenanceCharges] = useState('');
  const [otherCharges, setOtherCharges] = useState('');

  // Section 6 — Media
  const [coverImage, setCoverImage] = useState<Media | null>(null);
  const [galleryImages, setGalleryImages] = useState<Media[]>([]);
  const [videos, setVideos] = useState<Media[]>([]);
  const [brochure, setBrochure] = useState<Media | null>(null);

  // Section 7 — CTA
  const [ctaButtonText, setCtaButtonText] = useState('Book Site Visit');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [callNumber, setCallNumber] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState('');

  // Effective property type (custom overrides dropdown when "Other")
  const effectiveType = propertyType === 'Other' ? customType.trim() : propertyType;
  const isPlot = useMemo(() => isPlotType(effectiveType), [effectiveType]);
  const isMixed = category === 'Mixed Use';
  const propertyTypes = category ? (CATEGORY_PROPERTY_TYPES[category] || []) : [];
  const visibleAmenities = showAllAmenities ? AMENITIES : AMENITIES.slice(0, AMENITIES_PREVIEW);

  const toggleIn = (arr: string[], val: string, setter: (v: string[]) => void) => {
    setter(arr.includes(val) ? arr.filter((a) => a !== val) : [...arr, val]);
  };

  // ── Media pickers ──
  // On Android 13+ the system photo picker doesn't need runtime storage permission,
  // so we don't hard-block on it — we only request, then try to open the picker and
  // surface any real error. This fixes "cover image add nahi ho raha".
  const ensurePhotoPerm = async (): Promise<boolean> => {
    try {
      const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (perm.granted) return true;
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (req.granted) return true;
      // Not granted, but on modern Android the picker may still work — let it try.
      return true;
    } catch {
      return true; // still attempt to open the picker
    }
  };

  const pickCover = async () => {
    try {
      await ensurePhotoPerm();
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0];
      if (a.fileSize && a.fileSize > IMG_MAX_BYTES) { toast.show('Cover image too large (max 10 MB)', 'error'); return; }
      setCoverImage({ uri: a.uri, name: a.fileName || `cover-${Date.now()}.jpg`, mimeType: a.mimeType || 'image/jpeg' });
    } catch (e: any) {
      toast.show(e?.message || 'Could not open image picker', 'error');
    }
  };

  const pickGallery = async () => {
    try {
      await ensurePhotoPerm();
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: true });
      if (res.canceled || !res.assets?.length) return;
      const picked: Media[] = [];
      for (const a of res.assets) {
        if (a.fileSize && a.fileSize > IMG_MAX_BYTES) continue; // skip oversized
        picked.push({ uri: a.uri, name: a.fileName || `photo-${Date.now()}-${picked.length}.jpg`, mimeType: a.mimeType || 'image/jpeg' });
      }
      if (picked.length < res.assets.length) toast.show('Some photos skipped (over 10 MB)', 'info');
      setGalleryImages((prev) => [...prev, ...picked]);
    } catch (e: any) {
      toast.show(e?.message || 'Could not open image picker', 'error');
    }
  };

  const pickVideo = async () => {
    if (videos.length >= MAX_VIDEOS) { toast.show(`Max ${MAX_VIDEOS} videos`, 'error'); return; }
    try {
      await ensurePhotoPerm();
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 0.7 });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0];
      if (a.fileSize && a.fileSize > VIDEO_MAX_BYTES) { toast.show('Video too large (max 50 MB)', 'error'); return; }
      setVideos((prev) => [...prev, { uri: a.uri, name: a.fileName || `video-${Date.now()}.mp4`, mimeType: a.mimeType || 'video/mp4' }]);
    } catch (e: any) {
      toast.show(e?.message || 'Could not open video picker', 'error');
    }
  };

  const pickBrochure = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0];
      if (a.size && a.size > BROCHURE_MAX_BYTES) { toast.show('Brochure too large (max 10 MB)', 'error'); return; }
      setBrochure({ uri: a.uri, name: a.name || `brochure-${Date.now()}.pdf`, mimeType: a.mimeType || 'application/pdf' });
    } catch (e: any) {
      toast.show(e?.message || 'Could not open file picker', 'error');
    }
  };

  const addCustomAmenity = () => {
    const v = customAmenity.trim();
    if (!v) return;
    if (!amenities.includes(v)) setAmenities((prev) => [...prev, v]);
    setCustomAmenity('');
  };

  function validate(): string | null {
    if (!name.trim()) return 'Project name is required';
    if (!category) return 'Select a category';
    if (!effectiveType) return propertyType === 'Other' ? 'Enter a custom property type' : 'Select a property type';
    if (!city.trim()) return 'City is required';
    if (!location.trim()) return 'Location is required';
    if (!googleMapLink.trim()) return 'Google Map link is required';
    if (reraApproved && !reraNumber.trim()) return 'RERA number is required when RERA approved';
    const price = Number(startingPrice);
    if (!price || price <= 0) return 'Enter a valid starting price';

    if (isPlot) {
      if (!plotSizeRange.trim() || parseAreaLowerBoundSqFt(plotSizeRange) === null) return 'Enter a valid plot size in sqft';
    } else if (isMixed) {
      if (parseAreaLowerBoundSqFt(carpetAreaRange) === null && parseAreaLowerBoundSqFt(plotSizeRange) === null) return 'Enter carpet area or plot size in sqft';
    } else {
      if (!carpetAreaRange.trim() || parseAreaLowerBoundSqFt(carpetAreaRange) === null) return 'Enter a valid carpet area in sqft';
    }

    if (!isPlot && !isMixed && bhkOptions.length === 0) return 'Select at least one BHK option';
    if (amenities.length === 0) return 'Select at least one amenity';
    if (!coverImage) return 'Cover image is required';
    if (!ctaButtonText.trim()) return 'CTA button text is required';
    if (whatsappNumber.replace(/\D/g, '').length < 10) return 'Enter a valid WhatsApp number (10+ digits)';
    if (callNumber.replace(/\D/g, '').length < 10) return 'Enter a valid call number (10+ digits)';
    return null;
  }

  // Derived pricePerSqFt (round(price / lower-bound-of-area))
  const derivedPricePerSqFt = useMemo(() => {
    const price = Number(startingPrice);
    if (!price) return undefined;
    const area = parseAreaLowerBoundSqFt(isPlot ? plotSizeRange : carpetAreaRange);
    if (!area) return undefined;
    return Math.round(price / area);
  }, [startingPrice, carpetAreaRange, plotSizeRange, isPlot]);

  const numOrUndef = (v: string) => {
    const n = Number(v);
    return v.trim() && !isNaN(n) ? n : undefined;
  };

  function buildPayload() {
    return {
      projectName: name.trim(),
      projectType: isPlot ? 'plot' : 'flat',
      city: city.trim(),
      location: location.trim(),
      latitude: numOrUndef(latitude) ?? 0,
      longitude: numOrUndef(longitude) ?? 0,
      googleMapLink: googleMapLink.trim(),
      category,
      propertyType: effectiveType,
      reraApproved,
      reraNumber: reraApproved ? reraNumber.trim() : '',
      projectStatus,
      amenities,
      pricing: {
        startingPrice: Number(startingPrice),
        pricePerSqFt: derivedPricePerSqFt,
        totalPriceRange: priceRange.trim(),
        paymentPlan: paymentPlan.trim(),
        bankLoanAvailable,
        gstPercentage: numOrUndef(gstPercentage),
        stampDutyPercentage: numOrUndef(stampDutyPercentage),
        registrationCharges: numOrUndef(registrationCharges),
        maintenanceCharges: maintenanceCharges.trim(),
        otherCharges: otherCharges.trim(),
      },
      configuration: {
        bhkOptions,
        carpetAreaRange: carpetAreaRange.trim(),
        floorRange: floorRange.trim(),
        plotSizeRange: plotSizeRange.trim(),
        facingOptions,
        gatedCommunity,
      },
      cta: {
        buttonText: ctaButtonText.trim(),
        whatsappNumber: whatsappNumber.replace(/\D/g, ''),
        callNumber: callNumber.replace(/\D/g, ''),
      },
    };
  }

  const submit = async (publish: boolean) => {
    const err = validate();
    if (err) { toast.show(err, 'error'); return; }
    setSubmitting(true);
    try {
      // 1) Create project (no media yet) → id
      setProgress('Creating project…');
      const created = await projectsApiExtended.create(buildPayload());
      const id = created.id;
      if (!id) throw new Error('Project created but no id returned');

      // 2) Upload media. The backend /files/proxy-upload persists each item to the
      // project doc itself ($set cover/brochure, $push gallery/videos), so no extra
      // linking update is needed afterwards.
      if (coverImage) {
        setProgress('Uploading cover…');
        await mediaApi.uploadAndSave({ ...coverImage, projectId: id, type: 'cover' });
      }

      if (galleryImages.length) {
        for (let i = 0; i < galleryImages.length; i++) {
          setProgress(`Uploading photo ${i + 1}/${galleryImages.length}…`);
          await mediaApi.uploadAndSave({ ...galleryImages[i], projectId: id, type: 'gallery' });
        }
      }

      if (videos.length) {
        for (let i = 0; i < videos.length; i++) {
          setProgress(`Uploading video ${i + 1}/${videos.length}…`);
          await mediaApi.uploadAndSave({ ...videos[i], projectId: id, type: 'video' });
        }
      }

      if (brochure) {
        setProgress('Uploading brochure…');
        await mediaApi.uploadAndSave({ ...brochure, projectId: id, type: 'brochure' });
      }

      // 3) Publish if requested
      if (publish) {
        setProgress('Publishing…');
        await projectsApiExtended.publish(id);
      }

      toast.show(publish ? 'Project published' : 'Draft saved', 'success');
      router.replace('/(dashboard)/projects' as any);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to create project', 'error');
    } finally {
      setSubmitting(false);
      setProgress('');
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.cream }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={s.backBtn}>
          <ChevronLeft size={24} color={colors.ink} />
        </Pressable>
        <Text style={s.headerTitle}>Create New Project</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Section 1 — Basic Details */}
        <Section icon={<Building2 size={16} color={colors.brand} />} title="Basic Details" n={1}>
          <Field label="Project Name" required>
            <TextInput style={s.input} value={name} onChangeText={setName} placeholder="e.g. Green Valley Residency" placeholderTextColor={colors.muted} />
          </Field>

          <Field label="Category" required>
            <Chips options={CATEGORIES} selected={category ? [category] : []} onToggle={(v) => { setCategory(v); setPropertyType(''); setCustomType(''); }} single />
          </Field>

          {category ? (
            <Field label="Property Type" required>
              <Chips options={propertyTypes} selected={propertyType ? [propertyType] : []} onToggle={(v) => setPropertyType(v)} single />
              {propertyType === 'Other' ? (
                <TextInput style={[s.input, { marginTop: 8 }]} value={customType} onChangeText={setCustomType} placeholder="Enter custom property type" placeholderTextColor={colors.muted} />
              ) : null}
            </Field>
          ) : null}

          <Field label="City" required>
            <TextInput style={s.input} value={city} onChangeText={setCity} placeholder="e.g. Pune" placeholderTextColor={colors.muted} />
          </Field>

          <Field label="Location / Area" required>
            <TextInput style={s.input} value={location} onChangeText={setLocation} placeholder="e.g. Baner" placeholderTextColor={colors.muted} />
          </Field>

          <View style={s.row2}>
            <View style={{ flex: 1 }}>
              <Field label="Latitude">
                <TextInput style={s.input} value={latitude} onChangeText={setLatitude} placeholder="18.5204" placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Longitude">
                <TextInput style={s.input} value={longitude} onChangeText={setLongitude} placeholder="73.8567" placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" />
              </Field>
            </View>
          </View>

          <Field label="Google Map Link" required>
            <TextInput style={s.input} value={googleMapLink} onChangeText={setGoogleMapLink} placeholder="https://maps.google.com/..." placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="url" />
          </Field>
        </Section>

        {/* Section 2 — Legal & Trust */}
        <Section icon={<ScrollText size={16} color={colors.brand} />} title="Legal & Trust" n={2}>
          <View style={s.toggleRow}>
            <Text style={s.toggleLabel}>RERA Approved</Text>
            <Switch value={reraApproved} onValueChange={setReraApproved} trackColor={{ true: colors.brand }} thumbColor="#fff" />
          </View>
          {reraApproved ? (
            <Field label="RERA Number" required>
              <TextInput style={s.input} value={reraNumber} onChangeText={setReraNumber} placeholder="e.g. P52100012345" placeholderTextColor={colors.muted} autoCapitalize="characters" />
            </Field>
          ) : null}

          <Field label="Project Status" required>
            <Chips
              options={PROJECT_STATUS.map((p) => p.label)}
              selected={[PROJECT_STATUS.find((p) => p.value === projectStatus)?.label || '']}
              onToggle={(label) => { const f = PROJECT_STATUS.find((p) => p.label === label); if (f) setProjectStatus(f.value); }}
              single
            />
          </Field>
        </Section>

        {/* Section 3 — Amenities */}
        <Section icon={<Sparkles size={16} color={colors.brand} />} title="Amenities" n={3}>
          <Field label="Select Amenities" required>
            <Chips options={visibleAmenities} selected={amenities} onToggle={(v) => toggleIn(amenities, v, setAmenities)} />
            <Pressable onPress={() => setShowAllAmenities((p) => !p)} style={s.seeMore}>
              <Text style={s.seeMoreText}>{showAllAmenities ? 'See less' : `See more (${AMENITIES.length - AMENITIES_PREVIEW})`}</Text>
            </Pressable>
            {/* custom amenities that aren't in the standard list */}
            {amenities.filter((a) => !AMENITIES.includes(a)).length ? (
              <View style={[s.chipsWrap, { marginTop: 8 }]}>
                {amenities.filter((a) => !AMENITIES.includes(a)).map((a) => (
                  <Pressable key={a} onPress={() => toggleIn(amenities, a, setAmenities)} style={[s.chip, s.chipOn]}>
                    <Text style={[s.chipText, s.chipTextOn]}>{a}</Text>
                    <X size={12} color="#fff" />
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={s.addRow}>
              <TextInput style={[s.input, { flex: 1 }]} value={customAmenity} onChangeText={setCustomAmenity} placeholder="Add custom amenity" placeholderTextColor={colors.muted} onSubmitEditing={addCustomAmenity} />
              <Pressable onPress={addCustomAmenity} style={s.addBtn}><Plus size={18} color="#fff" /></Pressable>
            </View>
          </Field>
        </Section>

        {/* Section 4 — Configuration */}
        {effectiveType ? (
          <Section icon={<SlidersHorizontal size={16} color={colors.brand} />} title="Configuration" n={4}>
            {(!isPlot || isMixed) ? (
              <>
                <Field label="BHK Options" required={!isPlot && !isMixed}>
                  <Chips options={BHK_OPTIONS} selected={bhkOptions} onToggle={(v) => toggleIn(bhkOptions, v, setBhkOptions)} />
                </Field>
                <Field label="Carpet Area Range" required={!isPlot && !isMixed}>
                  <TextInput style={s.input} value={carpetAreaRange} onChangeText={setCarpetAreaRange} placeholder="e.g. 650 - 1200 sqft" placeholderTextColor={colors.muted} />
                </Field>
                <Field label="Floor Range">
                  <TextInput style={s.input} value={floorRange} onChangeText={setFloorRange} placeholder="e.g. 1 - 25" placeholderTextColor={colors.muted} />
                </Field>
              </>
            ) : null}

            {(isPlot || isMixed) ? (
              <>
                <Field label="Plot Size Range (sqft)" required={isPlot}>
                  <TextInput style={s.input} value={plotSizeRange} onChangeText={setPlotSizeRange} placeholder="e.g. 1000 - 2500 sqft" placeholderTextColor={colors.muted} />
                </Field>
                <View style={s.toggleRow}>
                  <Text style={s.toggleLabel}>Gated Community</Text>
                  <Switch value={gatedCommunity} onValueChange={setGatedCommunity} trackColor={{ true: colors.brand }} thumbColor="#fff" />
                </View>
              </>
            ) : null}

            <Field label="Direction / Facing">
              <Chips options={FACING_OPTIONS} selected={facingOptions} onToggle={(v) => toggleIn(facingOptions, v, setFacingOptions)} />
            </Field>
          </Section>
        ) : null}

        {/* Section 5 — Pricing */}
        <Section icon={<IndianRupee size={16} color={colors.brand} />} title="Pricing & Payment" n={5}>
          <Field label="Starting Price (₹)" required>
            <TextInput style={s.input} value={startingPrice} onChangeText={setStartingPrice} placeholder="e.g. 5500000" placeholderTextColor={colors.muted} keyboardType="numeric" />
          </Field>
          {derivedPricePerSqFt ? (
            <Text style={s.hint}>Price / sq ft (auto): ₹{derivedPricePerSqFt.toLocaleString('en-IN')}</Text>
          ) : null}
          <Field label="Price Range">
            <TextInput style={s.input} value={priceRange} onChangeText={setPriceRange} placeholder="e.g. 85L - 1.5Cr" placeholderTextColor={colors.muted} />
          </Field>
          <Field label="Payment Plan">
            <TextInput style={s.input} value={paymentPlan} onChangeText={setPaymentPlan} placeholder="e.g. 10:80:10" placeholderTextColor={colors.muted} />
          </Field>
          <View style={s.toggleRow}>
            <Text style={s.toggleLabel}>Bank Loan Available</Text>
            <Switch value={bankLoanAvailable} onValueChange={setBankLoanAvailable} trackColor={{ true: colors.brand }} thumbColor="#fff" />
          </View>

          <Text style={s.subHeading}>Additional Charges (optional)</Text>
          <View style={s.row2}>
            <View style={{ flex: 1 }}>
              <Field label="GST (%)">
                <TextInput style={s.input} value={gstPercentage} onChangeText={setGstPercentage} placeholder="5" placeholderTextColor={colors.muted} keyboardType="numeric" />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Stamp Duty (%)">
                <TextInput style={s.input} value={stampDutyPercentage} onChangeText={setStampDutyPercentage} placeholder="6" placeholderTextColor={colors.muted} keyboardType="numeric" />
              </Field>
            </View>
          </View>
          <Field label="Registration Charges (₹)">
            <TextInput style={s.input} value={registrationCharges} onChangeText={setRegistrationCharges} placeholder="e.g. 30000" placeholderTextColor={colors.muted} keyboardType="numeric" />
          </Field>
          <Field label="Maintenance Charges">
            <TextInput style={s.input} value={maintenanceCharges} onChangeText={setMaintenanceCharges} placeholder="e.g. ₹3/sq ft/month" placeholderTextColor={colors.muted} />
          </Field>
          <Field label="Other Charges">
            <TextInput style={s.input} value={otherCharges} onChangeText={setOtherCharges} placeholder="Any other charges" placeholderTextColor={colors.muted} />
          </Field>
        </Section>

        {/* Section 6 — Media */}
        <Section icon={<ImagePlus size={16} color={colors.brand} />} title="Media & Brochure" n={6}>
          <Field label="Cover Image" required>
            {coverImage ? (
              <Pressable onPress={pickCover} style={s.coverWrap}>
                <Image source={{ uri: coverImage.uri }} style={s.coverImg} resizeMode="cover" />
                <View style={s.coverOverlay}><Text style={s.coverOverlayText}>Tap to change</Text></View>
              </Pressable>
            ) : (
              <Pressable onPress={pickCover} style={s.uploadBox}>
                <ImagePlus size={26} color={colors.brand} />
                <Text style={s.uploadBoxText}>Tap to select cover image</Text>
                <Text style={s.uploadBoxSub}>JPG / PNG · max 10 MB</Text>
              </Pressable>
            )}
          </Field>

          <Field label="Gallery Images">
            {galleryImages.length ? (
              <View style={s.thumbRow}>
                {galleryImages.map((g, i) => (
                  <View key={i} style={s.thumb}>
                    <Image source={{ uri: g.uri }} style={s.thumbImg} resizeMode="cover" />
                    <Pressable onPress={() => setGalleryImages((prev) => prev.filter((_, idx) => idx !== i))} style={s.thumbX}>
                      <X size={12} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
            <Pressable onPress={pickGallery} style={s.smallUpload}>
              <ImagePlus size={16} color={colors.brand} />
              <Text style={s.smallUploadText}>Add photos</Text>
            </Pressable>
          </Field>

          <Field label="Project Videos">
            {videos.length ? (
              <View style={{ gap: 6, marginBottom: 8 }}>
                {videos.map((v, i) => (
                  <View key={i} style={s.fileChip}>
                    <Film size={14} color={colors.brand} />
                    <Text style={s.fileChipText} numberOfLines={1}>{v.name}</Text>
                    <Pressable onPress={() => setVideos((prev) => prev.filter((_, idx) => idx !== i))} hitSlop={6}><X size={14} color={colors.muted} /></Pressable>
                  </View>
                ))}
              </View>
            ) : null}
            {videos.length < MAX_VIDEOS ? (
              <Pressable onPress={pickVideo} style={s.smallUpload}>
                <Film size={16} color={colors.brand} />
                <Text style={s.smallUploadText}>Add video (max 50 MB)</Text>
              </Pressable>
            ) : null}
          </Field>

          <Field label="Brochure (PDF)">
            {brochure ? (
              <View style={s.fileChip}>
                <FileText size={14} color={colors.brand} />
                <Text style={s.fileChipText} numberOfLines={1}>{brochure.name}</Text>
                <Pressable onPress={() => setBrochure(null)} hitSlop={6}><X size={14} color={colors.muted} /></Pressable>
              </View>
            ) : (
              <Pressable onPress={pickBrochure} style={s.smallUpload}>
                <FileText size={16} color={colors.brand} />
                <Text style={s.smallUploadText}>Attach PDF (max 10 MB)</Text>
              </Pressable>
            )}
          </Field>
        </Section>

        {/* Section 7 — Contact / CTA */}
        <Section icon={<Phone size={16} color={colors.brand} />} title="Contact Configuration" n={7}>
          <Field label="CTA Button Text" required>
            <TextInput style={s.input} value={ctaButtonText} onChangeText={setCtaButtonText} placeholder="Book Site Visit" placeholderTextColor={colors.muted} />
          </Field>
          <Field label="WhatsApp Number" required>
            <TextInput style={s.input} value={whatsappNumber} onChangeText={setWhatsappNumber} placeholder="10-digit number" placeholderTextColor={colors.muted} keyboardType="phone-pad" />
          </Field>
          <Field label="Call Number" required>
            <TextInput style={s.input} value={callNumber} onChangeText={setCallNumber} placeholder="10-digit number" placeholderTextColor={colors.muted} keyboardType="phone-pad" />
          </Field>
        </Section>

        {progress ? <Text style={s.progress}>{progress}</Text> : null}

        {/* Save Draft + Publish (matches website's two actions) */}
        <View style={s.actionRow}>
          <Pressable style={[s.draftBtn, submitting && { opacity: 0.6 }]} onPress={() => submit(false)} disabled={submitting}>
            {submitting ? <ActivityIndicator color={colors.brand} /> : <><Save size={18} color={colors.brand} /><Text style={s.draftText}>Save Draft</Text></>}
          </Pressable>
          <Pressable style={[s.publishBtn, submitting && { opacity: 0.6 }]} onPress={() => submit(true)} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <><Check size={18} color="#fff" strokeWidth={2.5} /><Text style={s.publishText}>Publish</Text></>}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Sub-components ──
function Section({ icon, title, n, children }: { icon: React.ReactNode; title: string; n: number; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <View style={s.sectionIcon}>{icon}</View>
        <Text style={s.sectionTitle}>{title}</Text>
        <View style={s.sectionNum}><Text style={s.sectionNumText}>{n}</Text></View>
      </View>
      {children}
    </View>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}{required ? <Text style={{ color: colors.red }}> *</Text> : null}</Text>
      {children}
    </View>
  );
}

function Chips({ options, selected, onToggle, single }: { options: string[]; selected: string[]; onToggle: (v: string) => void; single?: boolean }) {
  return (
    <View style={s.chipsWrap}>
      {options.map((opt) => {
        const on = selected.includes(opt);
        return (
          <Pressable key={opt} onPress={() => onToggle(opt)} style={[s.chip, on && s.chipOn]}>
            <Text style={[s.chipText, on && s.chipTextOn]}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 10,
    backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  backBtn: { padding: 2 },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },

  section: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.ink },
  sectionNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  sectionNumText: { fontSize: 11, fontWeight: '800', color: colors.muted2 },

  field: { marginBottom: 14 },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted2, marginBottom: 7 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.ink, backgroundColor: colors.white },
  hint: { fontSize: 12, color: colors.brand, fontWeight: '700', marginTop: -6, marginBottom: 12 },
  row2: { flexDirection: 'row', gap: 12 },
  subHeading: { fontSize: 12, fontWeight: '800', color: colors.muted2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 2 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  toggleLabel: { fontSize: 13.5, fontWeight: '700', color: colors.ink },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 12.5, fontWeight: '700', color: colors.muted2 },
  chipTextOn: { color: '#fff' },
  seeMore: { marginTop: 8 },
  seeMoreText: { fontSize: 12.5, fontWeight: '800', color: colors.brand },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  addBtn: { width: 42, height: 42, borderRadius: 10, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },

  uploadBox: { borderWidth: 1.5, borderColor: colors.line, borderStyle: 'dashed', borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 28, gap: 6 },
  uploadBoxText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  uploadBoxSub: { fontSize: 11, color: colors.muted },
  coverWrap: { borderRadius: 12, overflow: 'hidden', height: 180 },
  coverImg: { width: '100%', height: '100%' },
  coverOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)', paddingVertical: 6, alignItems: 'center' },
  coverOverlayText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  thumb: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  thumbImg: { width: '100%', height: '100%' },
  thumbX: { position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  smallUpload: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', borderWidth: 1, borderColor: `${colors.brand}44`, backgroundColor: '#FFF8F0', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  smallUploadText: { fontSize: 12.5, fontWeight: '800', color: colors.brand },
  fileChip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.cream },
  fileChipText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.ink },

  progress: { fontSize: 13, fontWeight: '700', color: colors.brand, textAlign: 'center', marginBottom: 10 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  draftBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: colors.brand, borderRadius: 14, paddingVertical: 14 },
  draftText: { color: colors.brand, fontSize: 14.5, fontWeight: '800' },
  publishBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.brand, borderRadius: 14, paddingVertical: 14 },
  publishText: { color: '#fff', fontSize: 14.5, fontWeight: '800' },
});
