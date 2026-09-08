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
  constructor(message: string | null | undefined, status: number) {
    super(message ?? 'Unknown error');
    this.status = status;
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

async function handleResponse<T>(response: Response): Promise<T> {
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      typeof body?.message === 'string'
        ? body.message
        : typeof body?.error === 'string'
          ? body.error
          : `Request failed (${response.status})`;
    throw new ApiError(String(message), response.status);
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

  // Session check — sends token, falls back to /users/me
  async getSession(): Promise<{ authenticated: boolean; user: AuthUser | null }> {
    const token = await tokenStorage.get();
    if (!token) return { authenticated: false, user: null };
    try {
      const response = await fetch(`${API_URL}/auth/session`, { headers: await authHeaders() });
      if (!response.ok) {
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

// ── Projects (for lead form project dropdown + sales journey assets) ───────────────
export const projectsApi = {
  async getAllPublic(): Promise<ProjectLite[]> {
    const response = await fetch(`${API_URL}/public/projects`, { headers: await authHeaders() });
    const data = await handleResponse<any[]>(response);
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

export interface HumanLead {
  id: string;
  name: string;
  phone: string;
  altPhone?: string;
  email?: string;
  budget?: string;
  homeType?: string;
  buyingType?: string;
  location?: string;
  project: string;
  source: string;
  leadType: 'inbound' | 'outbound';
  stage: string;
  siteVisitDate?: string;
  siteVisitTime?: string;
  date: string;
  createdBy: LeadPerson | null;
  owningCaptain: LeadPerson | null;
  assignedAgent: LeadPerson | null;
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
  stage?: string;
  assignedAgent?: string | null;
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

  async updateStage(id: string, stage: string): Promise<HumanLead> {
    const response = await fetch(`${API_URL}/human-leads/${id}/stage`, {
      method: 'PUT',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    });
    const data = await handleResponse<{ lead: HumanLead }>(response);
    return data.lead;
  },

  async update(id: string, patch: Partial<CreateHumanLeadInput & { siteVisitDate: string; siteVisitTime: string }>): Promise<HumanLead> {
    const response = await fetch(`${API_URL}/human-leads/${id}`, {
      method: 'PUT',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await handleResponse<{ lead: HumanLead }>(response);
    return data.lead;
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

  async teamAgents(): Promise<{ id: string; name: string; role: string }[]> {
    const response = await fetch(`${API_URL}/human-leads/team-agents`, { headers: await authHeaders() });
    const data = await handleResponse<{ agents: { id: string; name: string; role: string }[] }>(response);
    return data.agents;
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
  bhkOptions: string[];
  carpetAreaRange?: string;
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
  brochureUrl?: any;
  amenities?: string[];
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
    bhkOptions: p?.configuration?.bhkOptions ?? p?.bhkOptions ?? [],
    carpetAreaRange: p?.configuration?.carpetAreaRange ?? p?.carpetAreaRange,
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
    brochureUrl: p?.media?.brochurePdf ?? p?.brochureUrl ?? null,
    amenities: p?.amenities ?? [],
    owner: p?.owner ? { ...p.owner, id: String(p.owner.id || p.owner._id || '') } : undefined,
    assignedAgent: p?.assignedAgent ? { ...p.assignedAgent, id: String(p.assignedAgent.id || p.assignedAgent._id || '') } : null,
    createdAt: p?.createdAt,
  };
}

export const projectsApiExtended = {
  async getAll(): Promise<Project[]> {
    const r = await fetch(`${API_URL}/projects`, { headers: await authHeaders() });
    const data = await handleResponse<any[]>(r);
    return data.map(transformProject);
  },
  // Public projects (all published) — returns properly-shaped Project[] with id, cover, price.
  async getAllPublic(): Promise<Project[]> {
    const r = await fetch(`${API_URL}/public/projects`, { headers: await authHeaders() });
    const data = await handleResponse<any[]>(r);
    return data.map(transformProject);
  },
  async getById(id: string): Promise<Project> {
    const r = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}`, { headers: await authHeaders() });
    const data = await handleResponse<any>(r);
    return transformProject(data);
  },
  async create(payload: any): Promise<Project> {
    const r = await fetch(`${API_URL}/projects`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(payload) });
    return transformProject(await handleResponse<any>(r));
  },
  async update(id: string, payload: any): Promise<Project> {
    const r = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}`, { method: 'PUT', headers: await authHeaders(), body: JSON.stringify(payload) });
    return transformProject(await handleResponse<any>(r));
  },
  async delete(id: string): Promise<void> {
    const r = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeaders() });
    await handleResponse(r);
  },
  async publish(id: string): Promise<{ trackableLink: string }> {
    const r = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}/publish`, { method: 'POST', headers: await authHeaders() });
    return handleResponse<{ trackableLink: string }>(r);
  },
  async assignCaptain(id: string, captainId: string): Promise<Project> {
    const r = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}/assign-captain`, { method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ captainId }) });
    return transformProject(await handleResponse<any>(r));
  },
  async assignAgent(id: string, agentId: string): Promise<Project> {
    const r = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}/assign-agent`, { method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ agentId }) });
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
  async matchCounts(projectIds: string[]): Promise<Record<string, number>> {
    try {
      const r = await fetch(`${API_URL}/lead-matching/match-counts`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ projectIds }) });
      const data = await handleResponse<{ counts: Record<string, number> }>(r);
      return data.counts || {};
    } catch { return {}; }
  },
};

// ── Media upload (cover / gallery / brochure) ───────────────
// Uploads a local file (from expo-image-picker/document-picker) to the backend,
// which streams it to R2 and saves the record. Returns { url, key }.
// NOTE: never set Content-Type manually for multipart — RN sets the boundary.
export const mediaApi = {
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
  roomType: 'project' | 'area' | 'universal';
  project?: { id: string; projectName: string; city?: string; slug?: string; pricing?: { startingPrice?: number }; media?: { coverImage?: { url: string } }; owner?: { name?: string; companyName?: string } };
  area?: { city: string; location: string };
  members: Array<{ user: { id: string; name: string; role: string; companyName?: string }; role: string }>;
  description: string;
  isUniversal?: boolean;
  canLeave?: boolean;
  lastActivity: string;
}

export interface GroupMessage {
  id: string;
  room: string;
  sender: { id: string; name: string; role: string; companyName?: string };
  messageType: 'text' | 'requirement_card' | 'inventory_card' | 'system';
  content: string;
  requirementCard?: any;
  inventoryCard?: any;
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
      owner: raw.project.owner ? { name: raw.project.owner.name, companyName: raw.project.owner.companyName } : undefined,
    } : undefined,
    area: raw?.area,
    members: (raw?.members || []).map((m: any) => ({
      user: { id: String(m?.user?._id || m?.user?.id || ''), name: m?.user?.name || '', role: m?.user?.role || '', companyName: m?.user?.companyName || '' },
      role: m?.role || 'member',
    })),
    description: raw?.description || '',
    isUniversal: !!raw?.isUniversal,
    canLeave: raw?.canLeave !== false,
    lastActivity: raw?.lastActivity || raw?.updatedAt || '',
  };
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
      sender: { id: String(m.sender?._id || m.sender?.id || ''), name: m.sender?.name || '', role: m.sender?.role || '', companyName: m.sender?.companyName },
      messageType: m.messageType || 'text',
      content: m.content || '',
      requirementCard: m.requirementCard,
      inventoryCard: m.inventoryCard,
      matchResults: m.matchResults,
      createdAt: m.createdAt || '',
    }));
  },
  async postMessage(roomId: string, data: { messageType: string; content?: string; requirementCard?: any; inventoryCard?: any }): Promise<any> {
    const r = await fetch(`${API_URL}/group-chat/rooms/${encodeURIComponent(roomId)}/messages`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(data) });
    return handleResponse<any>(r);
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
  async getLeads(params?: { page?: number; limit?: number; status?: string; source?: string }): Promise<{ leads: any[]; pagination: any }> {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.status) q.set('status', params.status);
    if (params?.source) q.set('source', params.source);
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
