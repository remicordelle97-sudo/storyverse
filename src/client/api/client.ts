import { getAccessToken } from "../auth/AuthContext";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Admin
export const getAdminUsers = () => request<any[]>("/admin/users");
export const impersonateUser = (userId: string) =>
  request<{ accessToken: string; user: any }>(`/admin/impersonate/${userId}`, { method: "POST" });
export const resetUser = (userId: string) =>
  request<{ ok: boolean; storiesDeleted: number; universesDeleted: number }>(
    `/admin/users/${userId}/reset`,
    { method: "POST" }
  );
// Onboarding / custom universe builder share the same payload shape.
// Photos are uploaded directly to R2 via a presigned URL (see
// uploadPhoto below) and the returned `photoKey` is what gets sent
// in the universe payload — never the bytes themselves.
export interface CharacterPhoto {
  photoKey: string;
}

/** Two-step photo upload:
 *   1. POST /api/uploads/photo-url to get a presigned PUT URL + key.
 *   2. PUT the file blob directly to R2 using that URL.
 * Returns the key the caller should embed in the universe payload. */
export async function uploadPhoto(file: File): Promise<{ photoKey: string }> {
  const signed = await request<{ uploadUrl: string; key: string; expiresInSeconds: number }>(
    "/uploads/photo-url",
    {
      method: "POST",
      body: JSON.stringify({ mimeType: file.type, contentLength: file.size }),
    },
  );
  const putRes = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`Photo upload failed (HTTP ${putRes.status})`);
  }
  return { photoKey: signed.key };
}
export interface OnboardingPayload {
  universeName: string;
  themes: string[];
  hero: { name: string; species: string; traits: string[]; photo?: CharacterPhoto };
  supporting:
    | "auto"
    | { name: string; species: string; traits: string[]; photo?: CharacterPhoto }[];
}
// Async universe-creation endpoints. Both onboard (custom) and
// /universes/custom return 202 with { universeId, jobId } and the
// worker handles Claude + Gemini in the background. Clients should
// navigate to the library and rely on getUniverseStatus polling for
// the per-universe placeholder card.
export interface UniverseJobEnvelope {
  universeId: string;
  jobId: string;
}
export const completeOnboarding = (payload: OnboardingPayload) =>
  request<UniverseJobEnvelope>("/auth/onboard", {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const skipOnboarding = () =>
  request<{ ok: boolean }>("/auth/skip-onboarding", { method: "POST" });
export const completeOnboardingPreset = (templateUniverseId: string) =>
  request<{ universeId: string }>("/auth/onboard-preset", {
    method: "POST",
    body: JSON.stringify({ templateUniverseId }),
  });
export const getTemplateUniverses = () =>
  request<
    Array<{
      id: string;
      name: string;
      settingDescription: string;
      themes: string;
      styleReferenceUrl: string;
      characters: { id: string; name: string; role: string; referenceImageUrl: string }[];
    }>
  >("/universes/templates");
export const toggleUniverseTemplate = (id: string) =>
  request<{ isTemplate: boolean }>(`/universes/${id}/toggle-template`, { method: "POST" });
export const createCustomUniverse = (payload: OnboardingPayload) =>
  request<UniverseJobEnvelope>("/universes/custom", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export interface UniverseStatus {
  status: string; // queued | building | illustrating_assets | ready | failed
  assetsReady: number;
  totalAssets: number;
  job: {
    kind: string;
    status: string;
    step: string;
    progressPercent: number;
    lastError: string;
  } | null;
}
export const getUniverseStatus = (id: string) =>
  request<UniverseStatus>(`/universes/${id}/status`);

// Character rename — admin-only on the server. Regular users can only
// set the hero name once, during onboarding (handled inline by
// /api/auth/onboard).
export const renameCharacter = (characterId: string, name: string) =>
  request<any>(`/characters/${characterId}/rename`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

// Universes
// Billing
export const createCheckoutSession = () =>
  request<{ url: string }>("/billing/create-checkout", { method: "POST" });
export const createPortalSession = () =>
  request<{ url: string }>("/billing/create-portal", { method: "POST" });

export const toggleUniversePublic = (id: string) =>
  request<{ isPublic: boolean }>(`/universes/${id}/toggle-public`, { method: "POST" });
export const deleteUniverse = (id: string) =>
  request<{ ok: boolean }>(`/universes/${id}`, { method: "DELETE" });
export const getUniverseQuota = () =>
  request<{ allowed: boolean; used: number; limit: number; remaining: number }>("/universes/quota");
export interface UniversePage {
  items: any[];
  nextCursor: string | null;
}

// Cursor-paginated list of the user's own universes (templates live
// at GET /universes/templates and are returned uncoupled).
export const getMyUniverses = (cursor?: string | null, limit?: number) => {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return request<UniversePage>(`/universes/my${qs ? `?${qs}` : ""}`);
};
export const getUniverse = (id: string) => request<any>(`/universes/${id}`);
export const generateStyleReference = (universeId: string) =>
  request<any>(`/universes/${universeId}/generate-style-reference`, { method: "POST" });
// Characters
export const regenerateCharacterSheet = (characterId: string, poseCount: number = 8) =>
  request<any>(`/characters/${characterId}/regenerate-sheet`, { method: "POST", body: JSON.stringify({ poseCount }) });
export const generateAllCharacterSheets = (universeId: string, poseCount: number = 8) =>
  request<any>("/characters/generate-all-sheets", {
    method: "POST",
    body: JSON.stringify({ universeId, poseCount }),
  });
export const generateCharacters = (universeId: string) =>
  request<any[]>("/characters/generate", {
    method: "POST",
    body: JSON.stringify({ universeId }),
  });

// Stories
export interface QuotaStatus {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}
export const getStoryQuota = () =>
  request<{ illustrated: QuotaStatus; text: QuotaStatus }>("/stories/quota");
export interface StorySummary {
  id: string;
  title: string;
  isPublic: boolean;
  hasIllustrations: boolean;
  status: string;
  createdAt: string;
  universe: { id: string; name: string };
  scenesCount: number;
}
export interface StoryPage {
  items: StorySummary[];
  nextCursor: string | null;
}

// Stories scoped to a single universe — bounded by per-universe story
// growth so no pagination needed. Used by the universe-detail and
// story-builder pages.
export const getStoriesInUniverse = (universeId: string) =>
  request<StorySummary[]>(`/stories?universeId=${universeId}`);

// Cursor-paginated lists of the user's own stories vs the
// admin-curated featured shelf. Pass `cursor` from the previous
// page's `nextCursor` to fetch more; null means end-of-list.
export const getMyStories = (cursor?: string | null, limit?: number) => {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return request<StoryPage>(`/stories/my${qs ? `?${qs}` : ""}`);
};

export const getFeaturedStories = (cursor?: string | null, limit?: number) => {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return request<StoryPage>(`/stories/featured${qs ? `?${qs}` : ""}`);
};
export const getStory = (id: string) => request<any>(`/stories/${id}`);
export const getStoryDebug = (id: string) => request<any>(`/stories/${id}/debug`);
export interface StoryStatus {
  status: string; // queued | generating_text | illustrating | published | failed_text | failed_illustration
  hasIllustrations: boolean;
  imagesReady: number;
  totalPages: number;
  job: {
    kind: string;
    status: string;
    step: string;
    progressPercent: number;
    lastError: string;
  } | null;
}
export const getStoryStatus = (id: string) =>
  request<StoryStatus>(`/stories/${id}/status`);
export const toggleStoryPublic = (id: string) =>
  request<{ isPublic: boolean }>(`/stories/${id}/toggle-public`, { method: "POST" });
export const deleteStory = (id: string) =>
  request<{ ok: boolean }>(`/stories/${id}`, { method: "DELETE" });
// Async story-generation endpoints. Both return 202 with a job
// envelope; the client navigates to /reading/:storyId and the
// existing useQuery poll on /stories/:id/status drives the loading
// UI until status flips to "published" (or "failed_*").

export interface JobEnvelope {
  storyId: string;
  jobId: string;
}

export const generateStory = (data: any) =>
  request<JobEnvelope>("/stories/generate", { method: "POST", body: JSON.stringify(data) });

export const regenerateStoryImages = (storyId: string) =>
  request<JobEnvelope>(`/stories/${storyId}/regenerate-images`, { method: "POST" });

// === Print on Demand =========================================
export interface PrintShippingAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state_code: string;
  country_code: string; // ISO-3166-1 alpha-2, e.g. "US"
  postcode: string;
  phone_number: string;
}

export interface PrintQuote {
  pageCount: number;
  quantity: number;
  printCostCents: number;
  shippingCostCents: number;
  taxCostCents: number;
  luluTotalCostCents: number;
  customerPriceCents: number;
  shippingLevel: string;
}

export const getPrintQuote = (input: {
  storyId: string;
  shippingAddress: PrintShippingAddress;
  quantity?: number;
}) =>
  request<PrintQuote>("/print/quote", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const startPrintCheckout = (input: {
  storyId: string;
  shippingAddress: PrintShippingAddress;
  quantity?: number;
}) =>
  request<{ url: string; orderId: string }>("/print/checkout", {
    method: "POST",
    body: JSON.stringify(input),
  });

export interface PrintOrderSummary {
  id: string;
  status: string;
  storyId: string;
  storyTitle: string;
  customerPriceCents: number | null;
  luluTrackingUrl: string | null;
  rejectionReason: string;
  createdAt: string;
  updatedAt: string;
}

export const listPrintOrders = () =>
  request<{ items: PrintOrderSummary[] }>("/print/orders");

export interface PrintOrderDetail {
  order: PrintOrderSummary & {
    luluPrintCostCents?: number | null;
    luluShippingCostCents?: number | null;
    luluPrintJobId?: string | null;
    coverPdfUrl?: string;
    interiorPdfUrl?: string;
    shippingAddress: string;
  };
  luluStatus: { name?: string; messages?: string[] } | null;
  luluLineItems?: Array<{
    id?: number;
    status?: { name?: string; messages?: string[] | Record<string, string[]> };
    tracking_urls?: string[];
  }>;
}

export const getPrintOrder = (id: string) =>
  request<PrintOrderDetail>(`/print/orders/${id}`);
