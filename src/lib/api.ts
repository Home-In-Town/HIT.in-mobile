// API Service for HomeInTown Mobile (Expo)
// Ported from the web app's src/lib/api.ts.
// Key difference: web uses httpOnly cookies (credentials: 'include');
// mobile uses a JWT stored in SecureStore, sent via Authorization: Bearer.

import Constants from 'expo-constants';
import { tokenStorage } from './storage';

const API_URL =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  'https://sales-website-backend-624770114041.asia-south1.run.app/api';

export class ApiError extends Error {
  status: number;
  /**
   * Machine-readable error code from the response body, when the server sent
   * one (e.g. 'INCOMPLETE_REQUIREMENTS', 'NOT_QUALIFIED').
   */
  code?: string;
  /**
   * The full parsed response body. Needed for errors that carry structured
   * detail the UI must act on — e.g. the `missing` field list returned when a
   * lead cannot be qualified yet.
   */
  data?: any;
  /**
   * How long the caller should wait before retrying, in seconds. Only set on a
   * 429 — read from the server's Retry-After header so a screen can say "try
   * again in 45 seconds" instead of just failing.
   */
  retryAfterSeconds?: number;

  constructor(message: string | null | undefined, status: number, body?: any) {
    super(message ?? 'Unknown error');
    this.status = status;
    this.data = body ?? undefined;
    if (body && typeof body.error === 'string') this.code = body.error;
  }
}

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await tokenStorage.get();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extra || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// Fallback wait used when a 429 arrives with no usable hint at all. One minute
// is the shortest window the backend limiters use, so it never under-promises.
const RATE_LIMIT_FALLBACK_SECONDS = 60;

// express-rate-limit sends Retry-After in SECONDS (measured against the live
// backend: 'retry-after: 60'), and with standardHeaders 'draft-7' it also sends
// a combined 'ratelimit: limit=1, remaining=0, reset=60' whose reset is seconds
// too. Prefer Retry-After, fall back to that reset hint, then to a constant, so
// a 429 can always name a wait.
function parseRetryAfterSeconds(response: Response): number {
  const header = response.headers.get('Retry-After');
  const parsed = header ? parseInt(header, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  const reset = /reset\s*=\s*(\d+)/i.exec(response.headers.get('RateLimit') || '');
  const resetSeconds = reset ? parseInt(reset[1], 10) : NaN;
  if (Number.isFinite(resetSeconds) && resetSeconds > 0) return resetSeconds;

  return RATE_LIMIT_FALLBACK_SECONDS;
}

// Phrase a wait the way a person would say it. The general limiter's window is
// 15 minutes, and printing a bare "in 900 seconds" reads like a bug, so
// anything longer than a minute and a half is rounded to minutes.
function describeWait(seconds: number): string {
  if (seconds <= 90) return `in ${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.round(seconds / 60);
  return minutes <= 1 ? 'in about a minute' : `in about ${minutes} minutes`;
}

async function handleResponse<T>(response: Response): Promise<T> {
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    // Rate limiting gets its own path. Previously a 429 fell through to the
    // generic throw below, so it was indistinguishable from any other failure:
    // a call site could not tell "wait a moment" from "this is broken", and the
    // user only saw the server's bare sentence with no idea retrying would work.
    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfterSeconds(response);
      const err = new ApiError(
        `Too many requests. Please try again ${describeWait(retryAfterSeconds)}.`,
        429,
        body,
      );
      // The limiter's body is { error: 'Too many requests, please try again later.' },
      // so the inherited `code = body.error` would be that whole human sentence.
      // Force a stable code for 429 ONLY — every other status still takes code
      // from body.error, so checks like err.code === 'INCOMPLETE_REQUIREMENTS'
      // keep working untouched.
      err.code = 'RATE_LIMITED';
      err.retryAfterSeconds = retryAfterSeconds;
      throw err;
    }

    const message =
      typeof body?.message === 'string'
        ? body.message
        : typeof body?.error === 'string'
          ? body.error
          : `Request failed (${response.status})`;
    throw new ApiError(String(message), response.status, body);
  }
  return body as T;
}

// ── Auth types ──────────────────────────────────────────────
export interface AuthUser {
  id: string;
  _id?: string;
  name: string;
  email?: string;
  role: 'admin' | 'builder' | 'agent' | 'unassigned' | 'user' | 'employee' | 'captain';
  companyName?: string;
  phone: string;
  isActive: boolean;
  isVerified: boolean;
  isEmployerConfirmed?: boolean;
  businessLogoUrl?: string;
}

function transformUser(backendUser: any): AuthUser {
  return { ...backendUser, id: String(backendUser?.id || backendUser?._id || '') };
}

// ── Auth API ────────────────────────────────────────────────
export const authApi = {
  async login(phone: string, mpin: string): Promise<{ user: AuthUser; token?: string }> {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, mpin }),
    });
    const data = await handleResponse<{ user: AuthUser; token?: string }>(response);
    if (data.token) await tokenStorage.set(data.token);
    return { ...data, user: transformUser(data.user) };
  },

  async register(data: {
    name: string;
    phone: string;
    mpin: string;
    email?: string;
    role?: string;
    companyName?: string;
    businessAddress?: string;
    businessCity?: string;
    businessState?: string;
    businessPinCode?: string;
    businessLogoUrl?: string;
  }): Promise<{ message: string; bypassed?: boolean; token?: string }> {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await handleResponse<{ message: string; bypassed?: boolean; token?: string }>(response);
    if (result.token) await tokenStorage.set(result.token);
    return result;
  },

  async verifyOtp(phone: string, code: string): Promise<{ user: AuthUser; token?: string }> {
    const response = await fetch(`${API_URL}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    });
    const data = await handleResponse<{ user: AuthUser; token?: string }>(response);
    if (data.token) await tokenStorage.set(data.token);
    return { ...data, user: transformUser(data.user) };
  },

  async forgotMpin(phone: string): Promise<{ message: string }> {
    const response = await fetch(`${API_URL}/auth/forgot-mpin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    return handleResponse(response);
  },

  async resetMpin(phone: string, code: string, newMpin: string): Promise<{ message: string }> {
    const response = await fetch(`${API_URL}/auth/reset-mpin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code, newMpin }),
    });
    return handleResponse(response);
  },

  async logout(): Promise<void> {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: await authHeaders(),
      });
    } catch {
      // ignore network errors on logout
    }
    await tokenStorage.clear();
  },

  // Session check — sends token, falls back to /users/me.
  // `rateLimited` means "we could not ask, try again later" — NOT "logged out".
  async getSession(): Promise<{
    authenticated: boolean;
    user: AuthUser | null;
    rateLimited?: boolean;
    retryAfterSeconds?: number;
  }> {
    const token = await tokenStorage.get();
    if (!token) return { authenticated: false, user: null };
    try {
      const response = await fetch(`${API_URL}/auth/session`, { headers: await authHeaders() });
      if (!response.ok) {
        // A 429 means "ask again later", not "you are logged out". The old code
        // treated ANY !response.ok as a dead session: it fired a SECOND request
        // at /users/me — extra load on an already-exhausted bucket — and then
        // returned authenticated: false, which checkAuth turned into status
        // 'unauthenticated' and _layout.tsx turned into router.replace('/login').
        // That was the forced-logout symptom of the 429 bursts. Bail out before
        // the fallback and hand the wait back to the caller.
        if (response.status === 429) {
          return {
            authenticated: false,
            user: null,
            rateLimited: true,
            retryAfterSeconds: parseRetryAfterSeconds(response),
          };
        }
        // Fallback: try /users/me
        const meRes = await fetch(`${API_URL}/users/me`, { headers: await authHeaders() });
        if (!meRes.ok) return { authenticated: false, user: null };
        const me = await meRes.json();
        return { authenticated: true, user: transformUser(me) };
      }
      const data = await response.json();
      return {
        authenticated: !!data.authenticated,
        user: data.user ? transformUser(data.user) : null,
      };
    } catch {
      return { authenticated: false, user: null };
    }
  },
};

// ── Users / Employee ────────────────────────────────────────
export const employeeApi = {
  async submitLocation(latitude: number, longitude: number, placeName?: string | null): Promise<any> {
    const response = await fetch(`${API_URL}/employee/location`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ latitude, longitude, placeName }),
    });
    return handleResponse(response);
  },
};

// A shareable/downloadable project asset (photo, video or PDF)
export interface ProjectAsset {
  type: 'image' | 'video' | 'pdf';
  url: string;
  name: string;
}

export interface ProjectLite {
  id: string;
  name: string;
  assets: ProjectAsset[];
}

// Pull a usable URL out of a media entry that may be a string or { url, key }
function mediaUrl(m: any): string | null {
  if (!m) return null;
  if (typeof m === 'string') return m;
  return m.url || null;
}

// Collect all uploaded assets for a raw backend project into a flat list
function collectProjectAssets(p: any, name: string): ProjectAsset[] {
  const media = p.media || p;
  const assets: ProjectAsset[] = [];

  const cover = mediaUrl(media.coverImage);
  if (cover) assets.push({ type: 'image', url: cover, name: `${name} - Cover` });

  const gallery = media.galleryImages || [];
  gallery.forEach((g: any, i: number) => {
    const u = mediaUrl(g);
    if (u) assets.push({ type: 'image', url: u, name: `${name} - Photo ${i + 1}` });
  });

  const layout = mediaUrl(media.layoutImage);
  if (layout) assets.push({ type: 'image', url: layout, name: `${name} - Layout` });

  const videos = media.videos || [];
  videos.forEach((v: any, i: number) => {
    const u = mediaUrl(v);
    if (u) assets.push({ type: 'video', url: u, name: `${name} - Video ${i + 1}` });
  });

  const brochure = mediaUrl(media.brochurePdf);
  if (brochure) assets.push({ type: 'pdf', url: brochure, name: `${name} - Brochure` });

  return assets;
}

// ── Shared /public/projects cache ───────────────────────────
// Five screens load this list (PropertyReels, CRM, Marketplace in two places,
// HumanLeadManager) through TWO wrappers that shape it differently. Opening the
// dashboard fired four identical requests inside 700ms, each returning the whole
// project list.
//
// Caching the RAW response — rather than either wrapper's output — is what lets
// both shapes share one network call. Every consumer maps the raw array into its
// own objects, so handing out the same array is safe.
const PUBLIC_PROJECTS_TTL_MS = 60_000;
let publicProjectsCache: { at: number; data: any[] } | null = null;
let publicProjectsInFlight: Promise<any[]> | null = null;

export async function fetchPublicProjectsRaw(force = false): Promise<any[]> {
  if (!force) {
    if (publicProjectsCache && Date.now() - publicProjectsCache.at < PUBLIC_PROJECTS_TTL_MS) {
      return publicProjectsCache.data;
    }
    // Concurrent callers (the common case: several screens mounting together)
    // await the same request instead of starting their own.
    if (publicProjectsInFlight) return publicProjectsInFlight;
  }

  const request = (async () => {
    const response = await fetch(`${API_URL}/public/projects`, { headers: await authHeaders() });
    const data = await handleResponse<any[]>(response);
    publicProjectsCache = { at: Date.now(), data };
    return data;
  })();

  publicProjectsInFlight = request;
  try {
    return await request;
  } finally {
    // Cleared even on failure, so one error doesn't wedge every later caller.
    publicProjectsInFlight = null;
  }
}

function invalidatePublicProjects() {
  publicProjectsCache = null;
  publicProjectsInFlight = null;
}

// ── Projects (for lead form project dropdown + sales journey assets) ───────────────
export const projectsApi = {
  async getAllPublic(): Promise<ProjectLite[]> {
    const data = await fetchPublicProjectsRaw();
    return data.map((p) => {
      const name = p.projectName || p.name || 'Untitled';
      return {
        id: String(p.id || p._id || ''),
        name,
        assets: collectProjectAssets(p, name),
      };
    });
  },
};

// ── CRM Bridge types ────────────────────────────────────────
export interface CrmLead {
  id: string;
  first_name: string;
  last_name?: string;
  phone_number: string;
  email?: string;
  status: 'HOT' | 'WARM' | 'COLD' | 'CREATED';
  score: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrmAnalytics {
  total: number;
  hot: number;
  warm: number;
  cold: number;
  engagementRate: number;
  avgScore: number;
  recentActivity: Array<Pick<CrmLead, 'id' | 'first_name' | 'last_name' | 'status' | 'score' | 'updatedAt'>>;
}

export interface CrmLeadsParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

export interface CrmLeadsResponse {
  leads: CrmLead[];
  total: number;
  page: number;
  pages: number;
}

export interface CrmStatus {
  linked: boolean;
  degraded?: boolean;
}

// ── CRM Bridge API ──────────────────────────────────────────
export const crmBridgeApi = {
  async getStatus(): Promise<CrmStatus> {
    const response = await fetch(`${API_URL}/crm-bridge/status`, { headers: await authHeaders() });
    return handleResponse<CrmStatus>(response);
  },

  async autoLink(): Promise<{ linked: boolean }> {
    const response = await fetch(`${API_URL}/crm-bridge/auto-link`, {
      method: 'POST',
      headers: await authHeaders(),
    });
    return handleResponse(response);
  },

  async getAnalytics(): Promise<CrmAnalytics> {
    const response = await fetch(`${API_URL}/crm-bridge/analytics`, { headers: await authHeaders() });
    return handleResponse<CrmAnalytics>(response);
  },

  async getLeads(params?: CrmLeadsParams): Promise<CrmLeadsResponse> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.status) query.set('status', params.status);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString() ? `?${query.toString()}` : '';
    const response = await fetch(`${API_URL}/crm-bridge/leads${qs}`, { headers: await authHeaders() });
    return handleResponse<CrmLeadsResponse>(response);
  },

  async getLeadById(leadId: string): Promise<CrmLead> {
    const response = await fetch(`${API_URL}/crm-bridge/leads/${encodeURIComponent(leadId)}`, {
      headers: await authHeaders(),
    });
    return handleResponse<CrmLead>(response);
  },

  async getJourney(leadId: string): Promise<any> {
    const response = await fetch(`${API_URL}/crm-bridge/journey/${encodeURIComponent(leadId)}`, {
      headers: await authHeaders(),
    });
    return handleResponse<any>(response);
  },

  async advanceStage(leadId: string, data: { stage: string; notes?: string }): Promise<any> {
    const response = await fetch(`${API_URL}/crm-bridge/journey/${encodeURIComponent(leadId)}/advance`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },
};

// ── Referrals ("Learn to Get Leads Faster" course unlock) ────────────
export interface ReferralEntry {
  id: string;
  name: string;
  phone: string;   // masked
  role: string;
  joined: boolean;
  joinedAt: string;
}

export interface ReferralInfo {
  referralCode: string;
  referralLink: string;
  goal: number;
  count: number;
  remaining: number;
  courseUnlocked: boolean;
  referrals: ReferralEntry[];
}

export const referralsApi = {
  async getMine(): Promise<ReferralInfo> {
    const response = await fetch(`${API_URL}/referrals/me`, { headers: await authHeaders() });
    return handleResponse<ReferralInfo>(response);
  },
};

// ── Human Lead Manager (team-scoped leads with ownership/assignment) ──────────
export interface LeadPerson {
  id: string;
  name: string;
  role: string;
}

/**
 * The CRM pipeline stages, mirroring HumanLead.STAGES on the backend.
 * Typed as a union rather than `string` so a stage typo is a compile error
 * instead of a silently failing request.
 */
export type LeadStage =
  | 'New Lead'
  | 'Contacted'
  | 'Qualified'
  | 'Site Visit Scheduled'
  | 'Site Visit Done'
  | 'Negotiation'
  | 'Booking'
  | 'Won'
  | 'Lost';

/** The stage at which a lead becomes eligible for property matching. */
export const QUALIFIED_STAGE: LeadStage = 'Qualified';

/**
 * Structured requirements used for real property matching.
 *
 * UNITS MATTER — these mirror the backend exactly:
 *   budget / budgetMax : LAKHS            (₹50,00,000 → 50)
 *   rentBudgetMonthly  : RUPEES PER MONTH (rent leads only)
 *   area               : SQFT (always, normalised server-side)
 *   areaInput          : the number the agent actually typed, in `areaUnit`
 *
 * The client may send a loose value (e.g. budget as "50-60L"); the server
 * normalises and is the source of truth for what gets stored.
 */
export interface LeadRequirements {
  transactionType?: 'buy' | 'rent';
  bhkType?: string | null;
  propertyType?: string | null;
  budget?: number | null;
  budgetMax?: number | null;
  rentBudgetMonthly?: number | null;
  area?: number | null;
  areaUnit?: 'sqft' | 'acres' | null;
  areaInput?: number | null;
  locationRaw?: string | null;
  city?: string | null;
  locationCanonical?: string | null;
  possessionNeeded?: 'immediate' | '6months' | '1year' | '2year' | 'ready' | 'under_construction' | null;
  loanRequired?: boolean;
}

/** What the client may send when writing requirements (accepts loose input). */
export interface LeadRequirementsInput
  extends Omit<LeadRequirements, 'budget' | 'budgetMax' | 'rentBudgetMonthly' | 'area'> {
  budget?: number | string | null;
  budgetMax?: number | string | null;
  rentBudgetMonthly?: number | string | null;
  area?: number | string | null;
}

/** Why matching did not run for a lead. */
export type MatchingSkippedReason = 'rent_not_supported' | 'incomplete_requirements';

/**
 * A real property matched to a lead. Every field comes from the Projects
 * collection — there is no mock data on this path.
 */
export interface MatchedProperty {
  /** LeadPropertyMatch row id — needed to dismiss this specific match. */
  matchId?: string;
  /** Stable Project id — the Lead → Property relationship. */
  projectId: string;
  projectName: string;
  slug: string;
  city: string;
  location: string;
  propertyType: string;
  projectStatus: string;

  startingPrice: number;
  bankLoanAvailable: boolean;
  bhkOptions: string[];
  carpetAreaRange: string;
  plotSizeRange: string;

  coverImageUrl: string;

  reraApproved: boolean;
  reraNumber: string;

  builderName: string;
  builderCompany: string;
  isVerifiedBuilder: boolean;
  builderRating: number;

  score: number;
  confidence?: number;
  matchedOn: string[];
  matchQuality?: 'exact' | 'close' | 'nearest';
  matchSource?: 'qualification' | 'project_published' | 'manual_rematch';
  firstMatchedAt?: string;
  lastScoredAt?: string;
  dismissed?: boolean;
}

/** Outcome of a match run, returned alongside a qualification or rematch. */
export interface MatchingRunResult {
  ran: boolean;
  skippedReason: MatchingSkippedReason | null;
  missing: string[];
  matches: MatchedProperty[];
  newCount: number;
  total: number;
  error: string | null;
}

/** Response of GET /human-leads/:id/matches */
export interface LeadMatchesResponse {
  matches: MatchedProperty[];
  total: number;
  qualified: boolean;
  matchingEnabled: boolean;
  matchingSkippedReason: MatchingSkippedReason | null;
  lastMatchRunAt: string | null;
  requirementsComplete: boolean;
  requirementsMissing: string[];
}

export interface HumanLead {
  id: string;
  name: string;
  phone: string;
  altPhone?: string;
  email?: string;
  /** Legacy free-text fields — display only. `requirements` is authoritative. */
  budget?: string;
  homeType?: string;
  buyingType?: string;
  location?: string;
  project: string;
  source: string;
  leadType: 'inbound' | 'outbound';
  stage: LeadStage;
  siteVisitDate?: string;
  siteVisitTime?: string;
  date: string;
  createdBy: LeadPerson | null;
  owningCaptain: LeadPerson | null;
  assignedAgent: LeadPerson | null;

  // ── Property matching ──
  requirements: LeadRequirements;
  /** False when the lead cannot be qualified yet. */
  requirementsComplete: boolean;
  /** Which requirement fields still need filling in. */
  requirementsMissing: string[];
  /** Requirement values inferred from the legacy free-text fields. */
  requirementsDerivedFrom: string[];
  qualifiedAt: string | null;
  matchingEnabled: boolean;
  matchingSkippedReason: MatchingSkippedReason | null;
  lastMatchRunAt: string | null;
  matchCount: number;
  bestMatchScore: number;
}

export interface CreateHumanLeadInput {
  name: string;
  phone: string;
  altPhone?: string;
  email?: string;
  budget?: string;
  homeType?: string;
  buyingType?: string;
  location?: string;
  projectName?: string;
  source?: string;
  leadType?: 'inbound' | 'outbound';
  stage?: LeadStage;
  assignedAgent?: string | null;
  requirements?: LeadRequirementsInput;
}

export const humanLeadsApi = {
  async list(params?: { stage?: string; search?: string }): Promise<HumanLead[]> {
    const query = new URLSearchParams();
    if (params?.stage) query.set('stage', params.stage);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString() ? `?${query.toString()}` : '';
    const response = await fetch(`${API_URL}/human-leads${qs}`, { headers: await authHeaders() });
    const data = await handleResponse<{ leads: HumanLead[] }>(response);
    return data.leads;
  },

  async create(input: CreateHumanLeadInput): Promise<HumanLead> {
    const response = await fetch(`${API_URL}/human-leads`, {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await handleResponse<{ lead: HumanLead }>(response);
    return data.lead;
  },

  /**
   * Move a lead to a new stage.
   *
   * Moving to 'Qualified' runs real property matching server-side, so the
   * response carries a `matching` block with the matched properties. It returns
   * the full response (not just the lead) because those matches are currently
   * the only way an agent learns a match was found.
   *
   * Throws with `INCOMPLETE_REQUIREMENTS` if the lead cannot be qualified yet.
   */
  async updateStage(id: string, stage: LeadStage): Promise<{ lead: HumanLead; matching: MatchingRunResult | null }> {
    const response = await fetch(`${API_URL}/human-leads/${id}/stage`, {
      method: 'PUT',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    });
    const data = await handleResponse<{ lead: HumanLead; matching: MatchingRunResult | null }>(response);
    return { lead: data.lead, matching: data.matching ?? null };
  },

  async update(
    id: string,
    patch: Partial<CreateHumanLeadInput & { siteVisitDate: string; siteVisitTime: string }>,
  ): Promise<{ lead: HumanLead; rematchRecommended: boolean }> {
    const response = await fetch(`${API_URL}/human-leads/${id}`, {
      method: 'PUT',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await handleResponse<{ lead: HumanLead; rematchRecommended?: boolean }>(response);
    return { lead: data.lead, rematchRecommended: !!data.rematchRecommended };
  },

  async assign(id: string, agentId: string | null): Promise<HumanLead> {
    const response = await fetch(`${API_URL}/human-leads/${id}/assign`, {
      method: 'PUT',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    });
    const data = await handleResponse<{ lead: HumanLead }>(response);
    return data.lead;
  },

  async teamAgents(): Promise<LeadPerson[]> {
    const response = await fetch(`${API_URL}/human-leads/team-agents`, { headers: await authHeaders() });
    const data = await handleResponse<{ agents: LeadPerson[] }>(response);
    return data.agents;
  },

  // ── Property matching ──────────────────────────────────────────────────────

  /**
   * Real matched properties for a lead, strongest first.
   * Also returns the context needed to explain an empty list (not qualified /
   * rent / missing requirement fields / genuinely nothing available yet).
   */
  async getMatches(id: string, opts?: { includeDismissed?: boolean }): Promise<LeadMatchesResponse> {
    const qs = opts?.includeDismissed ? '?includeDismissed=true' : '';
    const response = await fetch(`${API_URL}/human-leads/${id}/matches${qs}`, {
      headers: await authHeaders(),
    });
    return handleResponse<LeadMatchesResponse>(response);
  },

  /**
   * Re-run matching for an already-qualified lead, e.g. after editing its
   * requirements. Safe to call repeatedly — the server de-duplicates matches.
   */
  async rematch(id: string): Promise<{ lead: HumanLead; matching: MatchingRunResult | null }> {
    const response = await fetch(`${API_URL}/human-leads/${id}/rematch`, {
      method: 'POST',
      headers: await authHeaders(),
    });
    const data = await handleResponse<{ lead: HumanLead; matching: MatchingRunResult | null }>(response);
    return { lead: data.lead, matching: data.matching ?? null };
  },

  /** Hide a match the agent judged irrelevant. */
  async dismissMatch(id: string, matchId: string): Promise<{ matchCount: number; bestMatchScore: number }> {
    const response = await fetch(`${API_URL}/human-leads/${id}/matches/${matchId}/dismiss`, {
      method: 'PUT',
      headers: await authHeaders(),
    });
    return handleResponse<{ matchCount: number; bestMatchScore: number }>(response);
  },
};

// ── Users / Profile ─────────────────────────────────────────
export interface UpdateProfileInput {
  name?: string;
  email?: string;
  companyName?: string;
  businessLogoUrl?: string;
}

export const usersApi = {
  // Current user (protected). Returns the full user object.
  async getMe(): Promise<AuthUser> {
    const response = await fetch(`${API_URL}/users/me`, { headers: await authHeaders() });
    const data = await handleResponse<any>(response);
    // Backend may return { user } or the user directly.
    return transformUser(data?.user ?? data);
  },

  async updateProfile(patch: UpdateProfileInput): Promise<AuthUser> {
    const response = await fetch(`${API_URL}/users/profile`, {
      method: 'PATCH',
      headers: await authHeaders(),
      body: JSON.stringify(patch),
    });
    const data = await handleResponse<any>(response);
    return transformUser(data?.user ?? data);
  },
};

// ── Notifications ───────────────────────────────────────────
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  reference?: { model?: string; id?: string } | null;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
  unreadCount: number;
  page?: number;
  pages?: number;
  total?: number;
}

function transformNotification(n: any): AppNotification {
  return {
    id: String(n?.id || n?._id || ''),
    type: n?.type || 'system',
    title: n?.title || '',
    message: n?.message || '',
    read: !!n?.read,
    createdAt: n?.createdAt || n?.updatedAt || new Date().toISOString(),
    reference: n?.reference ?? null,
  };
}

export const notificationsApi = {
  async list(params?: { page?: number; limit?: number }): Promise<NotificationsResponse> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString() ? `?${query.toString()}` : '';
    const response = await fetch(`${API_URL}/notifications${qs}`, { headers: await authHeaders() });
    const data = await handleResponse<any>(response);
    const rawList: any[] = data?.notifications ?? data?.items ?? (Array.isArray(data) ? data : []);
    return {
      notifications: rawList.map(transformNotification),
      unreadCount: Number(data?.unreadCount ?? 0),
      page: data?.page,
      pages: data?.pages,
      total: data?.total,
    };
  },

  async markRead(id: string): Promise<void> {
    const response = await fetch(`${API_URL}/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PUT',
      headers: await authHeaders(),
    });
    await handleResponse(response);
  },

  async markAllRead(): Promise<void> {
    const response = await fetch(`${API_URL}/notifications/read-all`, {
      method: 'PUT',
      headers: await authHeaders(),
    });
    await handleResponse(response);
  },
};


// ── Analytics ────────────────────────────────────────────────
export interface ProjectAnalyticsOverview {
  projectId: string;
  projectName: string;
  city?: string;
  totalVisits: number;
  uniqueLeads: number;
  totalTimeSpent: number;
  totalCalls: number;
  totalWhatsApp: number;
  totalForms: number;
}

export interface ProjectAnalyticsDetail {
  projectId: string;
  projectName: string;
  totalVisits: number;
  uniqueLeads: number;
  totalTimeSpent: number;
  ctaClicks: Array<{ type: string; count: number }>;
  recentVisits: Array<{ date: string; visits: number; leads: number }>;
}

export const analyticsApi = {
  async overview(): Promise<ProjectAnalyticsOverview[]> {
    const r = await fetch(`${API_URL}/analytics/overview`, { headers: await authHeaders() });
    return handleResponse<ProjectAnalyticsOverview[]>(r);
  },
  async globalOverview(): Promise<any> {
    const r = await fetch(`${API_URL}/analytics/global-overview`, { headers: await authHeaders() });
    return handleResponse<any>(r);
  },
  async projectDetail(projectId: string): Promise<ProjectAnalyticsDetail> {
    const r = await fetch(`${API_URL}/analytics/projects/${encodeURIComponent(projectId)}`, { headers: await authHeaders() });
    return handleResponse<ProjectAnalyticsDetail>(r);
  },
  async ownerAnalytics(): Promise<any> {
    const r = await fetch(`${API_URL}/analytics/owner`, { headers: await authHeaders() });
    return handleResponse<any>(r);
  },
};

// ── Projects (full CRUD) ────────────────────────────────────
export interface Project {
  id: string;
  name: string;
  type: string;
  city: string;
  location: string;
  startingPrice: number;
  pricePerSqFt?: number;
  totalPriceRange?: string;
  paymentPlan?: string;
  gstPercentage?: number;
  stampDutyPercentage?: number;
  registrationCharges?: number;
  maintenanceCharges?: string;
  otherCharges?: string;
  bhkOptions: string[];
  carpetAreaRange?: string;
  floorRange?: string;
  plotSizeRange?: string;
  facingOptions?: string[];
  latitude?: number;
  longitude?: number;
  googleMapLink?: string;
  landmarks?: Array<{ name?: string; type?: string; address?: string }>;
  reraApproved: boolean;
  reraNumber?: string;
  projectStatus: string;
  category?: string;
  propertyType?: string;
  bankLoanAvailable: boolean;
  gatedCommunity: boolean;
  isPublished: boolean;
  slug?: string;
  coverImage?: { url: string } | string | null;
  galleryImages?: any[];
  videos?: any[];
  layoutImage?: { url: string } | string | null;
  brochureUrl?: any;
  amenities?: string[];
  cta?: { buttonText?: string; whatsappNumber?: string; callNumber?: string };
  owner?: { id: string; name: string; role: string; companyName?: string };
  assignedAgent?: { id: string; name: string; role: string } | null;
  createdAt?: string;
}

function transformProject(p: any): Project {
  return {
    id: String(p?.id || p?._id || ''),
    name: p?.projectName || p?.name || '',
    type: p?.projectType || p?.type || 'flat',
    city: p?.city || '',
    location: p?.location || '',
    startingPrice: p?.pricing?.startingPrice ?? p?.startingPrice ?? 0,
    pricePerSqFt: p?.pricing?.pricePerSqFt ?? p?.pricePerSqFt,
    totalPriceRange: p?.pricing?.totalPriceRange ?? p?.totalPriceRange,
    paymentPlan: p?.pricing?.paymentPlan ?? p?.paymentPlan,
    gstPercentage: p?.pricing?.gstPercentage ?? p?.gstPercentage,
    stampDutyPercentage: p?.pricing?.stampDutyPercentage ?? p?.stampDutyPercentage,
    registrationCharges: p?.pricing?.registrationCharges ?? p?.registrationCharges,
    maintenanceCharges: p?.pricing?.maintenanceCharges ?? p?.maintenanceCharges,
    otherCharges: p?.pricing?.otherCharges ?? p?.otherCharges,
    bhkOptions: p?.configuration?.bhkOptions ?? p?.bhkOptions ?? [],
    carpetAreaRange: p?.configuration?.carpetAreaRange ?? p?.carpetAreaRange,
    floorRange: p?.configuration?.floorRange ?? p?.floorRange,
    plotSizeRange: p?.configuration?.plotSizeRange ?? p?.plotSizeRange,
    facingOptions: p?.configuration?.facingOptions ?? p?.facingOptions ?? [],
    latitude: p?.latitude,
    longitude: p?.longitude,
    googleMapLink: p?.googleMapLink,
    landmarks: p?.landmarks ?? [],
    reraApproved: p?.reraApproved ?? false,
    reraNumber: p?.reraNumber,
    projectStatus: p?.projectStatus || 'pre-launch',
    category: p?.category,
    propertyType: p?.propertyType,
    bankLoanAvailable: p?.pricing?.bankLoanAvailable ?? p?.bankLoanAvailable ?? false,
    gatedCommunity: p?.configuration?.gatedCommunity ?? p?.gatedCommunity ?? false,
    isPublished: p?.status === 'published' || !!p?.isPublished,
    slug: p?.slug,
    coverImage: p?.media?.coverImage ?? p?.coverImage ?? null,
    galleryImages: p?.media?.galleryImages ?? p?.galleryImages ?? [],
    videos: p?.media?.videos ?? p?.videos ?? [],
    layoutImage: p?.media?.layoutImage ?? p?.layoutImage ?? null,
    brochureUrl: p?.media?.brochurePdf ?? p?.brochureUrl ?? null,
    amenities: p?.amenities ?? [],
    cta: p?.cta ? {
      buttonText: p.cta.buttonText,
      whatsappNumber: p.cta.whatsappNumber,
      callNumber: p.cta.callNumber,
    } : undefined,
    owner: p?.owner ? { ...p.owner, id: String(p.owner.id || p.owner._id || '') } : undefined,
    assignedAgent: p?.assignedAgent ? { ...p.assignedAgent, id: String(p.assignedAgent.id || p.assignedAgent._id || '') } : null,
    createdAt: p?.createdAt,
  };
}

// ── Project detail cache ────────────────────────────────────
// getById is hit repeatedly for the SAME project from independent places: an
// inventory card's Details button, its Call button (to read the CTA number), and
// AI match cards. On a phone network those were separate round-trips every time.
// A short TTL collapses the bursts, an in-flight map collapses concurrent calls,
// and every write path invalidates the entry so edits are never served stale.
const PROJECT_CACHE_TTL_MS = 60_000;
const projectCache = new Map<string, { at: number; project: Project }>();
const projectInFlight = new Map<string, Promise<Project>>();

// Buyer-match counts, keyed on the sorted project id list. See matchCounts().
const MATCH_COUNTS_TTL_MS = 60_000;
const matchCountsCache = new Map<string, { at: number; counts: Record<string, number> }>();
const matchCountsInFlight = new Map<string, Promise<Record<string, number>>>();

function invalidateProject(id?: string) {
  if (id) {
    projectCache.delete(String(id));
    projectInFlight.delete(String(id));
  } else {
    projectCache.clear();
    projectInFlight.clear();
  }
  // A project write also changes the public list and can change who matches it,
  // so those caches go too rather than serving a stale list for up to a minute.
  invalidatePublicProjects();
  matchCountsCache.clear();
  matchCountsInFlight.clear();
}

/** One property card inside a builder's company group. */
export interface OwnerPortfolioProject {
  id: string;
  name: string;
  slug?: string;
  city?: string;
  location?: string;
  propertyType?: string;
  projectStatus?: string;
  coverImage: string;
  startingPrice: number;
  bhkOptions: string[];
  carpetAreaRange: string;
}

export const projectsApiExtended = {
  /** Drops cached project details. Call after any out-of-band mutation. */
  invalidateProjectCache: invalidateProject,

  async getAll(): Promise<Project[]> {
    const r = await fetch(`${API_URL}/projects`, { headers: await authHeaders() });
    const data = await handleResponse<any[]>(r);
    return data.map(transformProject);
  },
  // Public projects (all published) — returns properly-shaped Project[] with id, cover, price.
  // Shares the cached raw list with projectsApi.getAllPublic().
  async getAllPublic(): Promise<Project[]> {
    const data = await fetchPublicProjectsRaw();
    return data.map(transformProject);
  },
  async getById(id: string, opts?: { force?: boolean }): Promise<Project> {
    const key = String(id);

    if (!opts?.force) {
      const cached = projectCache.get(key);
      if (cached && Date.now() - cached.at < PROJECT_CACHE_TTL_MS) return cached.project;

      const pending = projectInFlight.get(key);
      if (pending) return pending;
    }

    const request = (async () => {
      const r = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}`, { headers: await authHeaders() });
      const data = await handleResponse<any>(r);
      const project = transformProject(data);
      projectCache.set(key, { at: Date.now(), project });
      return project;
    })();

    projectInFlight.set(key, request);
    try {
      return await request;
    } finally {
      projectInFlight.delete(key);
    }
  },
  async create(payload: any): Promise<Project> {
    const r = await fetch(`${API_URL}/projects`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(payload) });
    return transformProject(await handleResponse<any>(r));
  },
  async update(id: string, payload: any): Promise<Project> {
    const r = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}`, { method: 'PUT', headers: await authHeaders(), body: JSON.stringify(payload) });
    invalidateProject(id);
    return transformProject(await handleResponse<any>(r));
  },
  async delete(id: string): Promise<void> {
    const r = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeaders() });
    invalidateProject(id);
    await handleResponse(r);
  },
  async publish(id: string): Promise<{ trackableLink: string }> {
    const r = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}/publish`, { method: 'POST', headers: await authHeaders() });
    invalidateProject(id);
    return handleResponse<{ trackableLink: string }>(r);
  },
  async assignCaptain(id: string, captainId: string): Promise<Project> {
    const r = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}/assign-captain`, { method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ captainId }) });
    invalidateProject(id);
    return transformProject(await handleResponse<any>(r));
  },
  async assignAgent(id: string, agentId: string): Promise<Project> {
    const r = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}/assign-agent`, { method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ agentId }) });
    invalidateProject(id);
    return transformProject(await handleResponse<any>(r));
  },
  async getCaptains(): Promise<{ id: string; name: string; companyName?: string }[]> {
    const r = await fetch(`${API_URL}/projects/captains`, { headers: await authHeaders() });
    const data = await handleResponse<any[]>(r);
    return data.map((c: any) => ({ id: String(c.id || c._id || ''), name: c.name || '', companyName: c.companyName }));
  },
  async getMyAgents(): Promise<{ id: string; name: string }[]> {
    const r = await fetch(`${API_URL}/projects/my-agents`, { headers: await authHeaders() });
    const data = await handleResponse<any[]>(r);
    return data.map((a: any) => ({ id: String(a.id || a._id || ''), name: a.name || '' }));
  },
  /**
   * Buyer-match counts per project.
   *
   * This is the slowest endpoint in the app — measured at 0.77s to 1.35s, roughly
   * ten times anything else — and four screens call it on mount (PropertyReels,
   * CRM, Marketplace, Projects), each with its own state. Moving between those
   * screens therefore paid ~1s again every time.
   *
   * Keyed on the sorted id list so the same set of projects hits the cache
   * regardless of the order a screen happens to pass them in. Failures are not
   * cached: the endpoint already degrades to {} and a transient error must not
   * pin empty counts for a minute.
   */
  /**
   * A builder's published properties, used for the cards inside their company
   * group. Public endpoint, so it also returns the builder's display identity.
   */
  async getOwnerPortfolio(ownerId: string): Promise<{
    builder: { id: string; name?: string; companyName?: string };
    projects: OwnerPortfolioProject[];
  }> {
    const r = await fetch(`${API_URL}/public/owners/${encodeURIComponent(ownerId)}/projects`, {
      headers: await authHeaders(),
    });
    const data = await handleResponse<{ builder: any; projects: any[] }>(r);
    return {
      builder: {
        id: String(data.builder?.id || data.builder?._id || ownerId),
        name: data.builder?.name,
        companyName: data.builder?.companyName,
      },
      projects: (data.projects || []).map((p: any) => ({
        id: String(p._id || p.id || ''),
        name: p.projectName || 'Property',
        slug: p.slug,
        city: p.city,
        location: p.location,
        propertyType: p.propertyType,
        projectStatus: p.projectStatus,
        coverImage: p.media?.coverImage?.url || '',
        startingPrice: Number(p.pricing?.startingPrice) || 0,
        bhkOptions: p.configuration?.bhkOptions || [],
        carpetAreaRange: p.configuration?.carpetAreaRange || '',
      })),
    };
  },
  async matchCounts(projectIds: string[]): Promise<Record<string, number>> {
    const ids = (projectIds || []).filter(Boolean).map(String);
    if (ids.length === 0) return {};

    const key = [...ids].sort().join(',');

    const cached = matchCountsCache.get(key);
    if (cached && Date.now() - cached.at < MATCH_COUNTS_TTL_MS) return cached.counts;

    const pending = matchCountsInFlight.get(key);
    if (pending) return pending;

    const request = (async () => {
      const r = await fetch(`${API_URL}/lead-matching/match-counts`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ projectIds: ids }) });
      const data = await handleResponse<{ counts: Record<string, number> }>(r);
      const counts = data.counts || {};
      matchCountsCache.set(key, { at: Date.now(), counts });
      return counts;
    })();

    matchCountsInFlight.set(key, request);
    try {
      return await request;
    } catch {
      return {};
    } finally {
      matchCountsInFlight.delete(key);
    }
  },
};

// ── Media upload (cover / gallery / brochure) ───────────────
// Uploads a local file (from expo-image-picker/document-picker) to the backend,
// which streams it to R2 and saves the record. Returns { url, key }.
// NOTE: never set Content-Type manually for multipart — RN sets the boundary.
export const mediaApi = {
  /**
   * Upload a chat attachment to a group-scoped R2 key. Unlike uploadAndSave,
   * this does not require or mutate a Project, so it works in universal and
   * area groups too.
   */
  async uploadGroupAttachment(opts: {
    roomId: string;
    uri: string;
    name: string;
    mimeType: string;
    kind: 'image' | 'file';
  }): Promise<{
    url: string;
    key: string;
    attachment: { name: string; mimeType: string; size: number; key: string };
  }> {
    const token = await tokenStorage.get();
    const form = new FormData();
    form.append('file', {
      uri: opts.uri,
      name: opts.name,
      type: opts.mimeType,
    } as any);
    form.append('kind', opts.kind);

    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(
      `${API_URL}/group-chat/rooms/${encodeURIComponent(opts.roomId)}/attachments`,
      { method: 'POST', headers, body: form },
    );
    const data = await handleResponse<{
      fileUrl: string;
      fileKey: string;
      attachment: { name: string; mimeType: string; size: number; key: string };
    }>(response);
    return { url: data.fileUrl, key: data.fileKey, attachment: data.attachment };
  },

  async uploadAndSave(opts: {
    uri: string;
    name: string;
    mimeType: string;
    projectId: string;
    type: 'cover' | 'gallery' | 'video' | 'brochure' | 'layout';
  }): Promise<{ url: string; key: string }> {
    const token = await tokenStorage.get();
    const form = new FormData();
    // React Native FormData file shape
    form.append('file', {
      uri: opts.uri,
      name: opts.name,
      type: opts.mimeType,
    } as any);
    form.append('projectId', opts.projectId);
    form.append('type', opts.type);

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const r = await fetch(`${API_URL}/files/proxy-upload`, {
      method: 'POST',
      headers, // no Content-Type — let RN set multipart boundary
      body: form,
    });
    const data = await handleResponse<{ fileUrl?: string; fileKey?: string; url?: string; key?: string }>(r);
    return {
      url: String(data.fileUrl ?? data.url ?? ''),
      key: String(data.fileKey ?? data.key ?? ''),
    };
  },
};

// ── Chat (1:1) ───────────────────────────────────────────────
export interface ChatSession {
  id: string;
  participants: Array<{ id: string; name: string; role: string }>;
  lastMessage?: string;
  unreadCount: number;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sender: { id: string; name: string; role: string };
  content: string;
  messageType: 'text' | 'image' | 'file' | 'system';
  createdAt: string;
}

function transformChatSession(s: any): ChatSession {
  return {
    id: String(s?._id || s?.id || ''),
    participants: (s?.participants || []).map((p: any) => ({
      id: String(p?.user?._id || p?.user?.id || p?._id || p?.id || ''),
      name: p?.user?.name || p?.name || '',
      role: p?.user?.role || p?.role || '',
    })),
    // Backend stores lastMessage as an object { content, sender, timestamp }.
    // Older/other shapes may send a plain string — handle both.
    lastMessage:
      typeof s?.lastMessage === 'string'
        ? s.lastMessage
        : (s?.lastMessage?.content ?? ''),
    unreadCount: Number(s?.unreadCount || 0),
    updatedAt: s?.updatedAt || '',
  };
}

export const chatApi = {
  async getContacts(): Promise<{ id: string; name: string; role: string; phone: string }[]> {
    const r = await fetch(`${API_URL}/chat/contacts`, { headers: await authHeaders() });
    const data = await handleResponse<{ contacts: any[] }>(r);
    return (data.contacts || []).map((c: any) => ({ id: String(c._id || c.id || ''), name: c.name || '', role: c.role || '', phone: c.phone || '' }));
  },
  async getSessions(): Promise<ChatSession[]> {
    const r = await fetch(`${API_URL}/chat/sessions`, { headers: await authHeaders() });
    const data = await handleResponse<{ sessions: any[] }>(r);
    return (data.sessions || []).map(transformChatSession);
  },
  async getMessages(sessionId: string, page = 1): Promise<ChatMessage[]> {
    const r = await fetch(`${API_URL}/chat/sessions/${encodeURIComponent(sessionId)}/messages?page=${page}`, { headers: await authHeaders() });
    const data = await handleResponse<{ messages: any[] }>(r);
    return (data.messages || []).map((m: any) => ({
      id: String(m._id || m.id || ''),
      sender: { id: String(m.sender?._id || m.sender?.id || ''), name: m.sender?.name || '', role: m.sender?.role || '' },
      content: m.content || '',
      messageType: m.messageType || 'text',
      createdAt: m.createdAt || '',
    }));
  },
  async qualify(data: { partnerId: string; projectId?: string; qualificationData: Record<string, string> }): Promise<ChatSession> {
    const r = await fetch(`${API_URL}/chat/qualify`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(data) });
    const res = await handleResponse<{ session: any }>(r);
    return transformChatSession(res.session);
  },
  async markRead(sessionId: string): Promise<void> {
    const r = await fetch(`${API_URL}/chat/sessions/${encodeURIComponent(sessionId)}/read`, { method: 'PUT', headers: await authHeaders() });
    await handleResponse(r);
  },
  async getBuildersNetwork(params?: { search?: string; limit?: number }): Promise<any> {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.limit) q.set('limit', String(params.limit));
    const r = await fetch(`${API_URL}/chat/builders-network${q.toString() ? '?' + q.toString() : ''}`, { headers: await authHeaders() });
    return handleResponse<any>(r);
  },
};

// ── Lead Chat (AI slot-filling assistant) ───────────────────
// ── Places (Google autocomplete, proxied by our backend) ────────────────────
// The API key lives only on the server, so the app never carries it.
export interface PlacePrediction {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
  types: string[];
}

export interface PlaceDetails {
  placeId: string;
  name: string;
  formattedAddress: string;
  latitude: number | null;
  longitude: number | null;
  locality: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  types: string[];
}

export const placesApi = {
  // kind: 'city' → cities only · 'area' → localities. lat/lng bias area results
  // to the already-chosen city. Never throws — returns [] so typing still works.
  async autocomplete(opts: {
    input: string;
    kind?: 'city' | 'area';
    lat?: number | null;
    lng?: number | null;
    sessionToken?: string;
  }): Promise<PlacePrediction[]> {
    const q = new URLSearchParams({ input: opts.input });
    if (opts.kind) q.set('kind', opts.kind);
    if (opts.lat != null && opts.lng != null) { q.set('lat', String(opts.lat)); q.set('lng', String(opts.lng)); }
    if (opts.sessionToken) q.set('sessionToken', opts.sessionToken);
    try {
      const r = await fetch(`${API_URL}/places/autocomplete?${q.toString()}`, { headers: await authHeaders() });
      const data = await handleResponse<{ predictions?: PlacePrediction[] }>(r);
      return data.predictions || [];
    } catch {
      return [];
    }
  },

  // Resolves a prediction into a storable address + coordinates.
  async details(placeId: string, sessionToken?: string): Promise<PlaceDetails | null> {
    const q = new URLSearchParams({ placeId });
    if (sessionToken) q.set('sessionToken', sessionToken);
    try {
      const r = await fetch(`${API_URL}/places/details?${q.toString()}`, { headers: await authHeaders() });
      const data = await handleResponse<{ place?: PlaceDetails }>(r);
      return data.place || null;
    } catch {
      return null;
    }
  },
};

export const leadChatApi = {
  async open(): Promise<any> {
    const r = await fetch(`${API_URL}/lead-chat/open`, { method: 'POST', headers: await authHeaders() });
    return handleResponse<any>(r);
  },
  async answer(data: { sessionId: string; slotId: string; value: any }): Promise<any> {
    const r = await fetch(`${API_URL}/lead-chat/answer`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(data) });
    return handleResponse<any>(r);
  },
  // Re-open a previously answered slot for editing (from the summary card).
  async edit(data: { sessionId: string; slotId: string }): Promise<any> {
    const r = await fetch(`${API_URL}/lead-chat/edit`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(data) });
    return handleResponse<any>(r);
  },
  async confirm(sessionId: string): Promise<any> {
    const r = await fetch(`${API_URL}/lead-chat/confirm`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ sessionId }) });
    return handleResponse<any>(r);
  },
  async newLead(sessionId: string): Promise<any> {
    const r = await fetch(`${API_URL}/lead-chat/new`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ sessionId }) });
    return handleResponse<any>(r);
  },
};

// ── Group Chat ───────────────────────────────────────────────
export interface GroupRoom {
  id: string;
  name: string;
  roomType: 'project' | 'builder' | 'area' | 'universal';
  /**
   * Set on builder rooms — the company-level group. The Groups list is organised
   * by company, so this is what the row shows.
   */
  builder?: {
    id: string;
    name?: string;
    companyName?: string;
    role?: string;
    isVerified?: boolean;
  };
  // Fully populated by GET /group-chat/rooms and POST .../join so a property
  // group can render every available detail of its linked project.
  project?: {
    id: string;
    projectName: string;
    projectType?: string;
    category?: string;
    propertyType?: string;
    city?: string;
    location?: string;
    latitude?: number;
    longitude?: number;
    googleMapLink?: string;
    slug?: string;
    status?: string;
    projectStatus?: string;
    reraApproved?: boolean;
    reraNumber?: string;
    amenities?: string[];
    pricing?: {
      startingPrice?: number;
      pricePerSqFt?: number;
      totalPriceRange?: string;
      paymentPlan?: string;
      bankLoanAvailable?: boolean;
      maintenanceCharges?: string;
    };
    configuration?: {
      bhkOptions?: string[];
      carpetAreaRange?: string;
      floorRange?: string;
      plotSizeRange?: string;
      facingOptions?: string[];
      gatedCommunity?: boolean;
    };
    media?: {
      coverImage?: { url: string };
      galleryImages?: Array<{ url: string }>;
      brochurePdf?: { url: string };
      layoutImage?: { url: string };
    };
    /**
     * `isVerified` was always on the wire — ROOM_PROJECT_POPULATE in
     * groupChatController.js selects `name companyName role isVerified
     * verificationStatus` — but transformGroupRoom narrowed the owner down to
     * `{ id, name, companyName }` and threw the flag away, so the client had no
     * way to tell a verified owner from an unverified one on a project room even
     * though a builder room right next to it could. The loss was in the
     * transform, not the API; no backend change was needed to recover it.
     */
    owner?: { id: string; name?: string; companyName?: string; isVerified?: boolean };
  };
  area?: { city: string; location: string };
  createdBy?: { id: string; name?: string };
  /**
   * Builder rooms only — how many PUBLISHED projects that builder has. Supplied
   * by the server from a single aggregation over the whole room list, never a
   * count per room (that would be an N+1 on a list that routinely holds dozens
   * of groups). Optional because the server field lands in the backend phase:
   * until then the client simply omits the segment that renders it.
   */
  projectCount?: number;
  /**
   * `phone` is only sent for rooms where the member list is a contact list —
   * builder and project groups. The server strips it everywhere else (universal
   * and area rooms), so the client must treat it as "may be absent" and only
   * render Call / WhatsApp when it is actually present.
   */
  members: Array<{ user: { id: string; name: string; role: string; companyName?: string; phone?: string }; role: string; joinedAt?: string }>;
  description: string;
  isUniversal?: boolean;
  canLeave?: boolean;
  isAutoCreated?: boolean;
  lastActivity: string;
  /**
   * Messages in this room the user has not read yet. Sent by the backend for
   * joined rooms only (discoverable rooms are always 0) and cleared by
   * `markRoomRead`.
   */
  unreadCount?: number;
}

export interface InventoryCard {
  /** Populated project object on reads, ObjectId string on freshly posted cards. */
  project?: string | {
    _id?: string;
    id?: string;
    projectName?: string;
    slug?: string;
    media?: { coverImage?: { url?: string } };
  };
  projectName?: string;
  propertyType?: string;
  carpetAreaRange?: string;
  bhkOptions?: string[];
  /** Price is stored in lakhs, matching the existing inventory form. */
  priceRange?: { min?: number; max?: number };
  /** Locality / area name, not floor area. */
  area?: string;
  city?: string;
  possessionStatus?: string;
  urgency?: 'normal' | 'urgent' | 'very_urgent';
  bankLoanAvailable?: boolean;
  commissionPercent?: number;
  callNumber?: string;
  description?: string;

  // AI-shared match variant
  aiMatch?: boolean;
  score?: number;
}

export interface GroupMessage {
  id: string;
  room: string;
  sender: {
    id: string;
    name: string;
    role: string;
    companyName?: string;
    isVerified?: boolean;
    verificationStatus?: { builder?: string };
    /**
     * Only sent for inventory cards — it powers the card's Call button, which
     * dials whoever posted the property. Absent on every other message type.
     */
    phone?: string;
  };
  messageType: 'text' | 'requirement_card' | 'inventory_card' | 'system' | 'image' | 'file';
  content: string;
  attachment?: { name?: string; mimeType?: string; size?: number; key?: string };
  requirementCard?: any;
  inventoryCard?: InventoryCard;
  matchResults?: any[];
  createdAt: string;
}

function transformGroupRoom(raw: any): GroupRoom {
  return {
    id: String(raw?._id || raw?.id || ''),
    name: raw?.name || '',
    roomType: raw?.roomType || 'area',
    project: raw?.project ? {
      ...raw.project,
      id: String(raw.project._id || raw.project.id || ''),
      owner: raw.project.owner
        ? (typeof raw.project.owner === 'object'
          ? {
            id: String(raw.project.owner._id || raw.project.owner.id || ''),
            name: raw.project.owner.name,
            companyName: raw.project.owner.companyName,
            // Compared against `true` the same way builder.isVerified is below,
            // so a missing field reads as "not verified" rather than undefined
            // and every caller gets a plain boolean.
            isVerified: raw.project.owner.isVerified === true,
          }
          : { id: String(raw.project.owner) })
        : undefined,
    } : undefined,
    builder: raw?.builder
      ? (typeof raw.builder === 'object'
        ? {
          id: String(raw.builder._id || raw.builder.id || ''),
          name: raw.builder.name,
          companyName: raw.builder.companyName,
          role: raw.builder.role,
          isVerified: raw.builder.isVerified === true,
        }
        : { id: String(raw.builder) })
      : undefined,
    area: raw?.area,
    createdBy: raw?.createdBy
      ? (typeof raw.createdBy === 'object'
        ? { id: String(raw.createdBy._id || raw.createdBy.id || ''), name: raw.createdBy.name }
        : { id: String(raw.createdBy) })
      : undefined,
    members: (raw?.members || []).map((m: any) => ({
      // phone is left undefined when the server did not send one, so a member row
      // can distinguish "no number available" from an empty string.
      user: { id: String(m?.user?._id || m?.user?.id || ''), name: m?.user?.name || '', role: m?.user?.role || '', companyName: m?.user?.companyName || '', phone: m?.user?.phone || undefined },
      role: m?.role || 'member',
      joinedAt: m?.joinedAt,
    })),
    description: raw?.description || '',
    isUniversal: !!raw?.isUniversal,
    canLeave: raw?.canLeave !== false,
    isAutoCreated: !!raw?.isAutoCreated,
    lastActivity: raw?.lastActivity || raw?.updatedAt || '',
    unreadCount: Number(raw?.unreadCount) || 0,
    // undefined (not 0) when the server has not sent the field, so the UI can
    // omit the segment entirely instead of rendering a misleading "0 projects".
    projectCount: Number(raw?.projectCount) || undefined,
  };
}

/**
 * One photo / document shared in a group. Returned by the room-media endpoint,
 * which the group-info sheet reads — the thread itself still renders media from
 * the message list.
 */
export interface GroupMedia {
  id: string;
  messageType: 'image' | 'file';
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
  sender?: { id: string; name: string; role?: string };
}

/** A link someone pasted into a group's chat. */
export interface GroupLink {
  id: string;
  url: string;
  createdAt: string;
  sender?: { id: string; name: string; role?: string };
}

export const groupChatApi = {
  async getRooms(params?: { search?: string }): Promise<{ myRooms: GroupRoom[]; discoverRooms: GroupRoom[] }> {
    const q = params?.search ? `?search=${encodeURIComponent(params.search)}` : '';
    const r = await fetch(`${API_URL}/group-chat/rooms${q}`, { headers: await authHeaders() });
    const data = await handleResponse<{ myRooms: any[]; discoverRooms: any[] }>(r);
    return { myRooms: (data.myRooms || []).map(transformGroupRoom), discoverRooms: (data.discoverRooms || []).map(transformGroupRoom) };
  },
  async createRoom(data: { name: string; roomType: 'project' | 'area'; projectId?: string; area?: { city: string; location: string }; description?: string }): Promise<GroupRoom> {
    const r = await fetch(`${API_URL}/group-chat/rooms`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(data) });
    const res = await handleResponse<{ room: any }>(r);
    return transformGroupRoom(res.room);
  },
  async joinRoom(roomId: string): Promise<GroupRoom> {
    const r = await fetch(`${API_URL}/group-chat/rooms/${encodeURIComponent(roomId)}/join`, { method: 'POST', headers: await authHeaders() });
    const res = await handleResponse<{ room: any }>(r);
    return transformGroupRoom(res.room);
  },
  /**
   * Join the group of a property when all we have is its projectId — the case
   * for every inventory card, which never carries a roomId. Also returns the
   * room when the user is already a member, so the caller can just open it.
   */
  async joinProjectRoom(projectId: string): Promise<{ room: GroupRoom; joined: boolean }> {
    const r = await fetch(`${API_URL}/group-chat/projects/${encodeURIComponent(projectId)}/join`, { method: 'POST', headers: await authHeaders() });
    const res = await handleResponse<{ room: any; joined?: boolean }>(r);
    return { room: transformGroupRoom(res.room), joined: res.joined !== false };
  },
  /**
   * Clears this room's unread badge for the caller. Fired when a room is opened;
   * failures are not surfaced to the user because a stale badge is harmless.
   */
  async markRoomRead(roomId: string): Promise<void> {
    const r = await fetch(`${API_URL}/group-chat/rooms/${encodeURIComponent(roomId)}/read`, { method: 'POST', headers: await authHeaders() });
    await handleResponse(r);
  },
  async leaveRoom(roomId: string): Promise<void> {
    const r = await fetch(`${API_URL}/group-chat/rooms/${encodeURIComponent(roomId)}/leave`, { method: 'POST', headers: await authHeaders() });
    await handleResponse(r);
  },
  async getMessages(roomId: string): Promise<GroupMessage[]> {
    const r = await fetch(`${API_URL}/group-chat/rooms/${encodeURIComponent(roomId)}/messages`, { headers: await authHeaders() });
    const data = await handleResponse<{ messages: any[] }>(r);
    return (data.messages || []).map((m: any) => ({
      id: String(m._id || m.id || ''),
      room: String(m.room || roomId),
      sender: {
        id: String(m.sender?._id || m.sender?.id || ''),
        name: m.sender?.name || '',
        role: m.sender?.role || '',
        companyName: m.sender?.companyName,
        isVerified: m.sender?.isVerified === true,
        verificationStatus: m.sender?.verificationStatus,
        phone: m.sender?.phone,
      },
      messageType: m.messageType || 'text',
      content: m.content || '',
      attachment: m.attachment,
      requirementCard: m.requirementCard,
      inventoryCard: m.inventoryCard,
      matchResults: m.matchResults,
      createdAt: m.createdAt || '',
    }));
  },
  /**
   * Photos / documents / links shared in a room, for the group-info sheet.
   *
   * The endpoint itself is added in the backend phase of this feature, so a 404
   * here is expected on current production. Callers MUST treat any failure as
   * "no media yet" (empty section) rather than surfacing an error — the sheet's
   * other sections are useful on their own.
   */
  async getRoomMedia(roomId: string, params?: { page?: number; limit?: number }): Promise<{ media: GroupMedia[]; links: GroupLink[]; page: number; limit: number }> {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.limit) q.set('limit', String(params.limit));
    const r = await fetch(
      `${API_URL}/group-chat/rooms/${encodeURIComponent(roomId)}/media${q.toString() ? `?${q.toString()}` : ''}`,
      { headers: await authHeaders() },
    );
    const data = await handleResponse<{ media?: any[]; links?: any[]; page?: number; limit?: number }>(r);
    const sender = (s: any) => (s ? { id: String(s._id || s.id || ''), name: s.name || '', role: s.role } : undefined);
    return {
      media: (data.media || []).map((m: any) => ({
        id: String(m._id || m.id || ''),
        messageType: m.messageType === 'file' ? 'file' : 'image',
        url: m.attachment?.url || m.content || '',
        name: m.attachment?.name,
        mimeType: m.attachment?.mimeType,
        size: m.attachment?.size,
        createdAt: m.createdAt || '',
        sender: sender(m.sender),
      })),
      links: (data.links || []).map((l: any) => ({
        id: String(l._id || l.id || ''),
        // The server sends the whole text message; the first URL in it is the link.
        url: (String(l.content || '').match(/https?:\/\/\S+/i) || [''])[0],
        createdAt: l.createdAt || '',
        sender: sender(l.sender),
      })),
      page: Number(data.page) || 1,
      limit: Number(data.limit) || 30,
    };
  },
  async postMessage(roomId: string, data: {
    messageType: string;
    content?: string;
    attachment?: { name?: string; mimeType?: string; size?: number; key?: string };
    requirementCard?: any;
    inventoryCard?: any;
  }): Promise<any> {
    const r = await fetch(`${API_URL}/group-chat/rooms/${encodeURIComponent(roomId)}/messages`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(data) });
    return handleResponse<any>(r);
  },
  /**
   * Removes a message from a group. Allowed for the sender, and for whoever owns
   * the group (their company group / their property group). Media messages also
   * have their stored file deleted server-side.
   */
  async deleteMessage(roomId: string, messageId: string): Promise<void> {
    const r = await fetch(
      `${API_URL}/group-chat/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'DELETE', headers: await authHeaders() },
    );
    await handleResponse(r);
  },
  async showInterest(data: { projectId: string; messageId: string; roomId?: string }): Promise<any> {
    const r = await fetch(`${API_URL}/group-chat/interested`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(data) });
    return handleResponse<any>(r);
  },
  // Delete (deactivate) a room — allowed for room creator, room-admin, or platform admin.
  async deleteRoom(roomId: string): Promise<void> {
    const r = await fetch(`${API_URL}/group-chat/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE', headers: await authHeaders() });
    await handleResponse(r);
  },
};

// ── Lead Matching (NLP) ─────────────────────────────────────
export const leadMatchingApi = {
  async getLeads(params?: { page?: number; limit?: number; status?: string; source?: string; mineOnly?: boolean }): Promise<{ leads: any[]; pagination: any }> {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.status) q.set('status', params.status);
    if (params?.source) q.set('source', params.source);
    if (params?.mineOnly) q.set('mineOnly', 'true');
    const r = await fetch(`${API_URL}/lead-matching/leads${q.toString() ? '?' + q.toString() : ''}`, { headers: await authHeaders() });
    return handleResponse<any>(r);
  },
  async getStats(): Promise<any> {
    const r = await fetch(`${API_URL}/lead-matching/stats`, { headers: await authHeaders() });
    return handleResponse<any>(r);
  },
  async extract(text: string): Promise<any> {
    const r = await fetch(`${API_URL}/lead-matching/extract`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ text }) });
    return handleResponse<any>(r);
  },
  async confirm(payload: any): Promise<any> {
    const r = await fetch(`${API_URL}/lead-matching/confirm`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(payload) });
    return handleResponse<any>(r);
  },
  async updateStatus(id: string, status: string): Promise<any> {
    const r = await fetch(`${API_URL}/lead-matching/leads/${encodeURIComponent(id)}/status`, { method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ status }) });
    return handleResponse<any>(r);
  },
  async testMatch(text: string): Promise<any> {
    const r = await fetch(`${API_URL}/lead-matching/test-match`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ text }) });
    return handleResponse<any>(r);
  },
  async matchRequirement(params: any): Promise<any> {
    // Convert AI-collected params into a search query text for matching
    const parts: string[] = [];
    if (params.bhkType) parts.push(params.bhkType);
    if (params.propertyType) parts.push(params.propertyType);
    if (params.location || params.locationRaw) parts.push(`near ${params.location || params.locationRaw}`);
    if (params.city) parts.push(params.city);
    if (params.budget) parts.push(`${params.budget} lakh budget`);
    
    const text = parts.join(' ');
    const r = await fetch(`${API_URL}/lead-matching/test-match`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ text }) });
    return handleResponse<any>(r);
  },
};

// ── Marketplace ─────────────────────────────────────────────
export interface MarketplaceListing {
  id: string;
  project?: { id: string; projectName: string; city?: string; pricing?: { startingPrice?: number }; media?: { coverImage?: { url: string } }; configuration?: { bhkOptions?: string[] } };
  listedBy: { id: string; name: string; companyName?: string; role: string };
  listingType: 'selling' | 'buying';
  commissionType: 'percentage' | 'fixed';
  commissionValue: number;
  description: string;
  status: 'Active' | 'Paused' | 'Closed' | 'Sold';
  expectedValue: number;
  createdAt: string;
}

function transformListing(l: any): MarketplaceListing {
  return {
    id: String(l?._id || l?.id || ''),
    project: l?.project ? { ...l.project, id: String(l.project._id || l.project.id || '') } : undefined,
    listedBy: { id: String(l?.listedBy?._id || l?.listedBy?.id || ''), name: l?.listedBy?.name || '', companyName: l?.listedBy?.companyName, role: l?.listedBy?.role || '' },
    listingType: l?.listingType || 'selling',
    commissionType: l?.commissionType || 'percentage',
    commissionValue: Number(l?.commissionValue || 0),
    description: l?.description || '',
    status: l?.status || 'Active',
    expectedValue: Number(l?.expectedValue || 0),
    createdAt: l?.createdAt || '',
  };
}

export const marketplaceApi = {
  async getListings(filters?: { listingType?: string; status?: string; search?: string }): Promise<MarketplaceListing[]> {
    const q = new URLSearchParams();
    if (filters?.listingType) q.set('listingType', filters.listingType);
    if (filters?.status) q.set('status', filters.status);
    if (filters?.search) q.set('search', filters.search);
    const r = await fetch(`${API_URL}/marketplace/listings${q.toString() ? '?' + q.toString() : ''}`, { headers: await authHeaders() });
    const data = await handleResponse<{ listings: any[] }>(r);
    return (data.listings || []).map(transformListing);
  },
  async getMyListings(): Promise<MarketplaceListing[]> {
    const r = await fetch(`${API_URL}/marketplace/listings/my`, { headers: await authHeaders() });
    const data = await handleResponse<{ listings: any[] }>(r);
    return (data.listings || []).map(transformListing);
  },
  async createListing(data: { project?: string; listingType: 'selling' | 'buying'; commissionType: 'percentage' | 'fixed'; commissionValue: number; description?: string; expectedValue?: number }): Promise<MarketplaceListing> {
    const r = await fetch(`${API_URL}/marketplace/listings`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(data) });
    const res = await handleResponse<{ listing: any }>(r);
    return transformListing(res.listing);
  },
  async doAction(listingId: string, actionType: string): Promise<any> {
    const r = await fetch(`${API_URL}/marketplace/listings/${encodeURIComponent(listingId)}/action`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ actionType }) });
    return handleResponse<any>(r);
  },
  async getMyCommissions(): Promise<any[]> {
    const r = await fetch(`${API_URL}/marketplace/commissions`, { headers: await authHeaders() });
    const data = await handleResponse<any>(r);
    return data.commissions || data.actions || [];
  },
  async getAdminActions(): Promise<any[]> {
    const r = await fetch(`${API_URL}/marketplace/admin/actions`, { headers: await authHeaders() });
    const data = await handleResponse<{ actions: any[] }>(r);
    return data.actions || [];
  },
  async updateActionStatus(actionId: string, status: 'approved' | 'rejected'): Promise<any> {
    const r = await fetch(`${API_URL}/marketplace/admin/actions/${encodeURIComponent(actionId)}/status`, { method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ status }) });
    return handleResponse<any>(r);
  },
};

// ── Organizations ────────────────────────────────────────────
export interface Organization {
  id: string;
  name: string;
  description?: string;
  projects: Array<{ id: string; name: string; city?: string; status?: string }>;
  agents: Array<{ id: string; name: string; role: string }>;
  createdBy?: { id: string; name: string };
}

function transformOrg(o: any): Organization {
  return {
    id: String(o?._id || o?.id || ''),
    name: o?.name || '',
    description: o?.description,
    projects: (o?.projects || []).map((p: any) => ({ id: String(p._id || p.id || ''), name: p.projectName || p.name || '', city: p.city, status: p.status })),
    agents: (o?.agents || []).map((a: any) => ({ id: String(a._id || a.id || ''), name: a.name || '', role: a.role || '' })),
    createdBy: o?.createdBy ? { id: String(o.createdBy._id || o.createdBy.id || ''), name: o.createdBy.name || '' } : undefined,
  };
}

export const organizationsApi = {
  async getAll(type?: 'all' | 'assigned' | 'created'): Promise<Organization[]> {
    const q = type ? `?type=${type}` : '';
    const r = await fetch(`${API_URL}/organizations${q}`, { headers: await authHeaders() });
    const data = await handleResponse<any>(r);
    const list = Array.isArray(data) ? data : (data.organizations || []);
    return list.map(transformOrg);
  },
  async create(data: { name: string; description?: string; projects?: string[]; agents?: string[] }): Promise<Organization> {
    const r = await fetch(`${API_URL}/organizations`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(data) });
    const res = await handleResponse<any>(r);
    return transformOrg(res.organization || res);
  },
  async update(id: string, data: any): Promise<Organization> {
    const r = await fetch(`${API_URL}/organizations/${encodeURIComponent(id)}`, { method: 'PUT', headers: await authHeaders(), body: JSON.stringify(data) });
    const res = await handleResponse<any>(r);
    return transformOrg(res.organization || res);
  },
  async delete(id: string): Promise<void> {
    const r = await fetch(`${API_URL}/organizations/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeaders() });
    await handleResponse(r);
  },
};

// ── Captain Team ─────────────────────────────────────────────
export interface CaptainPartner {
  id: string;
  name: string;
  companyName?: string;
  phone?: string;
  businessCity?: string;
  status?: 'none' | 'partner' | 'incoming' | 'outgoing';
}

export const captainTeamApi = {
  async getMyTeam(): Promise<{ partners: CaptainPartner[]; incoming: CaptainPartner[]; outgoing: CaptainPartner[] }> {
    const r = await fetch(`${API_URL}/captain-team/me`, { headers: await authHeaders() });
    return handleResponse<any>(r);
  },
  async listCaptains(search?: string): Promise<CaptainPartner[]> {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    const r = await fetch(`${API_URL}/captain-team/captains${q}`, { headers: await authHeaders() });
    const data = await handleResponse<{ captains: any[] }>(r);
    return (data.captains || []).map((c: any) => ({ id: String(c._id || c.id || ''), name: c.name || '', companyName: c.companyName, phone: c.phone, businessCity: c.businessCity, status: c.status }));
  },
  async request(captainId: string): Promise<any> {
    const r = await fetch(`${API_URL}/captain-team/request`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ captainId }) });
    return handleResponse<any>(r);
  },
  async accept(captainId: string): Promise<any> {
    const r = await fetch(`${API_URL}/captain-team/accept`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ captainId }) });
    return handleResponse<any>(r);
  },
  async decline(captainId: string): Promise<any> {
    const r = await fetch(`${API_URL}/captain-team/decline`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ captainId }) });
    return handleResponse<any>(r);
  },
  async remove(captainId: string): Promise<any> {
    const r = await fetch(`${API_URL}/captain-team/remove`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ captainId }) });
    return handleResponse<any>(r);
  },
};

// ── Employee (extended) ─────────────────────────────────────
export interface EmployeeListItem {
  id: string;
  name: string;
  phone: string;
  role: string;
  isEmployerConfirmed: boolean;
}

export const employeeApiExtended = {
  async searchByPhone(phone: string): Promise<any> {
    const r = await fetch(`${API_URL}/employee/search?phone=${encodeURIComponent(phone)}`, { headers: await authHeaders() });
    return handleResponse<any>(r);
  },
  async requestAssignment(employeeId: string): Promise<any> {
    const r = await fetch(`${API_URL}/employee/request-assignment`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ employeeId }) });
    return handleResponse<any>(r);
  },
  async confirmAssignment(employerId: string): Promise<any> {
    const r = await fetch(`${API_URL}/employee/confirm-assignment`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ employerId }) });
    return handleResponse<any>(r);
  },
  async getMyEmployees(): Promise<EmployeeListItem[]> {
    const r = await fetch(`${API_URL}/employee/my-employees`, { headers: await authHeaders() });
    const data = await handleResponse<{ employees: any[] }>(r);
    return (data.employees || []).map((e: any) => ({ id: String(e._id || e.id || ''), name: e.name || '', phone: e.phone || '', role: e.role || '', isEmployerConfirmed: !!e.isEmployerConfirmed }));
  },
  async getHistory(employeeId: string): Promise<{ locations: any[]; meetings: any[] }> {
    const r = await fetch(`${API_URL}/employee/history/${encodeURIComponent(employeeId)}`, { headers: await authHeaders() });
    return handleResponse<any>(r);
  },
};

// ── Share ────────────────────────────────────────────────────
export const shareApi = {
  async generateToken(projectId: string, type: 'link' | 'pdf' | 'qr'): Promise<{ token: string; shareUrl: string }> {
    const r = await fetch(`${API_URL}/share/generate`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ projectId, type }) });
    return handleResponse<{ token: string; shareUrl: string }>(r);
  },
  async getMyContact(): Promise<any> {
    const r = await fetch(`${API_URL}/share/my-contact`, { headers: await authHeaders() });
    const data = await handleResponse<{ contactInfo: any }>(r);
    return data.contactInfo;
  },
  async getMyShares(): Promise<any[]> {
    const r = await fetch(`${API_URL}/share/my-shares`, { headers: await authHeaders() });
    const data = await handleResponse<{ shares: any[] }>(r);
    return data.shares || [];
  },
  // The authenticated gallery-ZIP endpoint + the current bearer token, so the
  // caller can download it with expo-file-system (which supports auth headers).
  async galleryDownload(projectId: string): Promise<{ url: string; token: string | null }> {
    const token = await tokenStorage.get();
    return { url: `${API_URL}/share/gallery/${encodeURIComponent(projectId)}`, token };
  },
};

// ── Admin Users ──────────────────────────────────────────────
export const adminApi = {
  async getUsers(role?: string): Promise<any[]> {
    const q = role ? `?role=${encodeURIComponent(role)}` : '';
    const r = await fetch(`${API_URL}/users${q}`, { headers: await authHeaders() });
    const data = await handleResponse<any>(r);
    return Array.isArray(data) ? data : (data.users || []);
  },
  async setRole(userId: string, role: string): Promise<any> {
    const r = await fetch(`${API_URL}/users/${encodeURIComponent(userId)}/role`, { method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ role }) });
    return handleResponse<any>(r);
  },
  async setVerified(userId: string, verified: boolean): Promise<any> {
    const r = await fetch(`${API_URL}/users/${encodeURIComponent(userId)}/verify`, { method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ verified }) });
    return handleResponse<any>(r);
  },
};

export { API_URL };
