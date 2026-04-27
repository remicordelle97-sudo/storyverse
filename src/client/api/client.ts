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
export interface CharacterPhoto {
  mimeType: string;
  data: string; // raw base64 (no "data:..." prefix)
}
export interface OnboardingPayload {
  universeName: string;
  themes: string[];
  hero: { name: string; species: string; traits: string[]; photo?: CharacterPhoto };
  supporting:
    | "auto"
    | { name: string; species: string; traits: string[]; photo?: CharacterPhoto }[];
}
export const completeOnboarding = (payload: OnboardingPayload) =>
  request<{ universeId: string }>("/auth/onboard", {
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
  request<{ universeId: string }>("/universes/custom", {
    method: "POST",
    body: JSON.stringify(payload),
  });

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
export const getUniverses = () => request<any[]>("/universes");
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
export const getStories = (universeId?: string) =>
  request<StorySummary[]>(universeId ? `/stories?universeId=${universeId}` : "/stories");
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
