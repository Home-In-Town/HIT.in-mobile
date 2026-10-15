// Post-view option lists and display mappers lifted out of
// GroupChatEmbedded.tsx. Pure — the only runtime dependencies are the shared
// money formatters. AiPostDraft is `import type` so the AiAssistant component
// is not pulled in at runtime, and the api imports are types only because
// src/lib/api.ts pulls expo-constants in at module scope.
import { fmtLakhs, fmtMoney } from './formatting';
import type { AiPostDraft } from '../../components/AiAssistant';
import type { InventoryCard, OwnerPortfolioProject } from '../api';

export type PostMode = 'text' | 'requirement' | 'inventory';

export const BHK_TYPES = ['1BHK', '2BHK', '3BHK', '4BHK', 'Plot', 'Shop'];
export const POSSESSION_NEEDED = [
  { v: 'immediate', l: 'Immediate' }, { v: '6months', l: '6 Months' }, { v: '1year', l: '1 Year' },
];
export const URGENCY = [
  { v: 'normal', l: 'Normal' }, { v: 'urgent', l: 'Urgent' }, { v: 'very_urgent', l: 'Very Urgent' },
];
export const POSSESSION_STATUS = [
  { v: 'ready', l: 'Ready to Move' }, { v: '6months', l: '6 Months' }, { v: '1year', l: '1 Year' }, { v: '2year+', l: '2+ Years' },
];

// Per-property "Post to Group" cooldown (8 hours). After posting, the button is
// disabled/faded until this elapses, then returns to normal.
export const POST_COOLDOWN_MS = 8 * 60 * 60 * 1000;

// Map a backend ExtractedLead (sell/rent) into the shape PostCard renders.
// This is what makes the Post list survive a reinstall — the data comes from
// the server, not from local storage.
export function leadToDisplay(lead: any) {
  const p = lead?.params || {};
  const bhk = p.bhkType || '';
  const type = p.propertyType || '';
  const areaTxt = p.area ? `${p.area} ${p.areaUnit || 'sqft'}` : '';

  const fields: { label: string; value: string }[] = [];
  const push = (label: string, value: any) => {
    if (value === null || value === undefined || value === '' ) return;
    fields.push({ label, value: String(value) });
  };
  push('Listing For', lead?.direction === 'rent' || p.transactionType === 'rent' ? 'Rent' : 'Sale');
  push('Property Type', type);
  push('BHK', bhk);
  push('Area', areaTxt);
  push('Location', p.location || p.locationRaw);
  push('City', p.city);
  push('Full Address', p.formattedAddress);
  push('State', p.state);
  push('Postal Code', p.postalCode);
  push('Category', p.category);
  push('Construction Status', p.projectStatus);
  const minPrice = p.expectedPrice ?? p.budget;
  const maxPrice = p.budgetMax;
  push('Expected Price', minPrice ? `${fmtLakhs(minPrice)}${maxPrice ? ` - ${fmtLakhs(maxPrice)}` : ''}` : '');
  push('Possession Needed', p.possessionNeeded);
  push('Loan Required', p.loanRequired === true ? 'Yes' : p.loanRequired === false ? 'No' : '');
  push('RERA Approved', p.reraApproved === true ? 'Yes' : p.reraApproved === false ? 'No' : '');
  push('RERA Number', p.reraNumber);
  push('Bank Loan Available', p.bankLoanAvailable === true ? 'Yes' : p.bankLoanAvailable === false ? 'No' : '');
  push('Amenities', Array.isArray(p.amenities) && p.amenities.length ? p.amenities.join(', ') : '');
  push('Urgency', p.urgency);
  if (p.latitude && p.longitude) push('Coordinates', `${p.latitude}, ${p.longitude}`);

  return {
    id: String(lead?._id || lead?.id || ''),
    leadId: String(lead?._id || lead?.id || ''),
    title: [bhk, type].filter(Boolean).join(' ') || 'Property',
    subtitle: [p.location || p.locationRaw, p.city].filter(Boolean).join(', '),
    price: fmtLakhs(p.expectedPrice ?? p.budget),
    tags: [lead?.direction === 'rent' ? 'Rent' : 'Sale', bhk, areaTxt, type].filter(Boolean),
    fields,
    direction: lead?.direction || 'sell',
    createdAt: lead?.createdAt,
    source: 'lead',
  };
}

// WhatsApp-style disappearing-message durations for the AI Assist chat.
export const DISAPPEAR_OPTIONS: { label: string; ms: number }[] = [
  { label: '6 hours', ms: 6 * 3600000 },
  { label: '12 hours', ms: 12 * 3600000 },
  { label: '1 day', ms: 24 * 3600000 },
  { label: '7 days', ms: 7 * 24 * 3600000 },
  { label: '1 month', ms: 30 * 24 * 3600000 },
  { label: 'Never', ms: 0 },
];
export const disappearLabel = (ms: number) => DISAPPEAR_OPTIONS.find(o => o.ms === ms)?.label || 'Never';

// A backend project → the common display shape used by PostCard / View Property.
// Every non-empty field comes from the real Project document. Raw AI prompts and
// questionnaire text are never included.
export function projectToDisplay(p: any) {
  const mediaUrl = (m: any): string => typeof m === 'string' ? m : (m?.url || '');
  const fields: { label: string; value: string }[] = [];
  const push = (label: string, value: any) => {
    if (value === null || value === undefined || value === '') return;
    fields.push({ label, value: String(value) });
  };

  push('Listing Status', p.isPublished ? 'Published' : 'Draft');
  push('Property Type', p.propertyType || p.type);
  push('Category', p.category);
  push('BHK / Configuration', p.bhkOptions?.length ? p.bhkOptions.join(', ') : '');
  push('Carpet Area', p.carpetAreaRange);
  push('Plot Size', p.plotSizeRange);
  push('Floor Range', p.floorRange);
  push('Facing', p.facingOptions?.length ? p.facingOptions.join(', ') : '');
  push('Location', p.location);
  push('City', p.city);
  push('Starting Price', fmtMoney(p.startingPrice));
  push('Price per sq.ft', p.pricePerSqFt ? `₹${Number(p.pricePerSqFt).toLocaleString('en-IN')}` : '');
  push('Total Price Range', p.totalPriceRange);
  push('Payment Plan', p.paymentPlan);
  push('Bank Loan', p.bankLoanAvailable ? 'Available' : 'Not available');
  push('GST', p.gstPercentage != null ? `${p.gstPercentage}%` : '');
  push('Stamp Duty', p.stampDutyPercentage != null ? `${p.stampDutyPercentage}%` : '');
  push('Registration Charges', p.registrationCharges ? `₹${Number(p.registrationCharges).toLocaleString('en-IN')}` : '');
  push('Maintenance Charges', p.maintenanceCharges);
  push('Other Charges', p.otherCharges);
  push('Construction Status', p.projectStatus);
  push('RERA Approved', p.reraApproved ? 'Yes' : 'No');
  push('RERA Number', p.reraNumber);
  push('Gated Community', p.gatedCommunity ? 'Yes' : 'No');
  push('Amenities', p.amenities?.length ? p.amenities.join(', ') : '');
  push('Landmarks', p.landmarks?.length ? p.landmarks.map((l: any) => l.name || l.address).filter(Boolean).join(', ') : '');
  push('Google Map', p.googleMapLink);
  if (p.latitude && p.longitude) push('Coordinates', `${p.latitude}, ${p.longitude}`);
  push('Call Number', p.cta?.callNumber);
  push('WhatsApp Number', p.cta?.whatsappNumber);
  push('Contact Button', p.cta?.buttonText);
  push('Owner', p.owner?.companyName || p.owner?.name);
  push('Gallery Photos', p.galleryImages?.length || '');
  push('Videos', p.videos?.length || '');
  push('Brochure PDF', mediaUrl(p.brochureUrl));
  push('Created', p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-IN') : '');

  return {
    id: String(p.id || ''),
    projectId: String(p.id || ''),
    title: p.name || 'Property',
    subtitle: [p.location, p.city].filter(Boolean).join(', '),
    price: fmtMoney(p.startingPrice),
    image: mediaUrl(p.coverImage),
    galleryImages: (p.galleryImages || []).map(mediaUrl).filter(Boolean),
    videos: (p.videos || []).map(mediaUrl).filter(Boolean),
    brochureUrl: mediaUrl(p.brochureUrl),
    layoutImage: mediaUrl(p.layoutImage),
    tags: [
      ...(Array.isArray(p.bhkOptions) && p.bhkOptions.length ? [p.bhkOptions.join(', ')] : []),
      p.carpetAreaRange || p.plotSizeRange || '',
      p.propertyType || p.category || p.type || '',
    ].filter(Boolean),
    fields,
    direction: 'sell',
    source: 'project',
    posted: true,
    postedAt: p.createdAt ? new Date(p.createdAt).getTime() : 0,
  };
}

// Map an AI-collected sell draft (labeled fields) → a real project create payload
// (same shape as add-project) + a group inventory card. Price is normalized to
// full rupees so the property matches correctly.
export function buildProjectFromDraft(draft: AiPostDraft): { payload: any; card: any } {
  const get = (re: RegExp) => draft.fields.find(f => re.test(f.label))?.value || '';
  const propType = get(/property type|^type$/i) || 'Apartment / Flat';
  const bhk = get(/bhk/i);
  const location = get(/location/i) || get(/area/i);
  const city = get(/city/i) || 'Nagpur';
  const category = get(/category/i) || 'Residential';
  const statusRaw = get(/status|possession|construction/i);
  const rera = /yes|haan|approved/i.test(get(/rera/i));
  const loan = /yes|haan|available/i.test(get(/loan/i));

  // Price → full rupees. AI collects price in lakh (unit 'lakh'); handle cr too.
  const priceStr = get(/price|budget/i);
  const priceNum = Number((priceStr.match(/[\d.]+/) || [])[0]) || 0;
  const isCr = /cr|crore/i.test(priceStr);
  const priceRupees = Math.round(priceNum * (isCr ? 10000000 : 100000));

  const isPlot = /plot|land|zameen/i.test(propType);
  const projectStatus = /ready/i.test(statusRaw) ? 'ready-to-move'
    : /under|construction/i.test(statusRaw) ? 'under-construction'
    : 'ready-to-move';

  // Auto project name: "{BHK} {PropertyType} - {Location}"
  const namePieces = [bhk, propType].filter(Boolean).join(' ');
  const projectName = [namePieces, location].filter(Boolean).join(' - ') || (draft.title || 'Property');

  const payload = {
    projectName,
    projectType: isPlot ? 'plot' : 'flat',
    city: city.trim(),
    location: location.trim(),
    latitude: 0,
    longitude: 0,
    googleMapLink: '',
    category,
    propertyType: propType,
    reraApproved: rera,
    reraNumber: '',
    projectStatus,
    amenities: (get(/amenit/i) || '').split(',').map(s => s.trim()).filter(Boolean),
    pricing: {
      startingPrice: priceRupees, // full rupees
      totalPriceRange: '',
      paymentPlan: '',
      bankLoanAvailable: loan,
    },
    configuration: {
      bhkOptions: bhk ? [bhk] : [],
      carpetAreaRange: get(/area/i) || '',
      floorRange: '',
      plotSizeRange: '',
      facingOptions: [],
      gatedCommunity: false,
    },
    cta: { buttonText: '', whatsappNumber: '', callNumber: '' },
  };

  const card = {
    projectName,
    propertyType: propType,
    carpetAreaRange: get(/area/i) || '',
    bhkOptions: bhk ? [bhk] : [],
    priceRange: { min: Math.round(priceRupees / 100000), max: 0 }, // card shows lakhs
    area: location,
    city,
    possessionStatus: /ready/i.test(statusRaw) ? 'ready' : (statusRaw || 'ready'),
    urgency: 'normal' as const,
    bankLoanAvailable: loan,
    commissionPercent: 0,
    description: draft.fields.map(f => `${f.label}: ${f.value}`).join(' • '),
  };

  return { payload, card };
}

/**
 * Adapts a builder card's thin OwnerPortfolioProject to the InventoryCard shape
 * handlePropertyViewDetails already accepts as its fallback.
 *
 * Needed because the card's Details now goes through a project fetch instead of
 * building a sheet synchronously: with no fallback, a deleted or unpublished
 * project — or just an offline device — opened NO sheet at all, only a "Could not
 * load property details" toast. That is the same dead-button behaviour
 * ("card pr click kiya to detail nahi dhikhti") this change set out to remove, so
 * the card's own data stands in whenever the fetch cannot answer.
 *
 * priceRange is in LAKHS on InventoryCard (the inventory form's unit) while
 * startingPrice is in rupees, hence the divide.
 */
export const portfolioFallback = (p: OwnerPortfolioProject): InventoryCard => ({
  projectName: p.name,
  area: p.location,
  city: p.city,
  propertyType: p.propertyType,
  possessionStatus: p.projectStatus,
  carpetAreaRange: p.carpetAreaRange,
  bhkOptions: p.bhkOptions,
  priceRange: p.startingPrice ? { min: p.startingPrice / 100000 } : undefined,
});
