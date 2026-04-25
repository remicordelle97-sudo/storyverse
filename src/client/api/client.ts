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
export const getStoryStatus = (id: string) =>
  request<{ status: string; hasIllustrations: boolean; imagesReady: number; totalPages: number }>(`/stories/${id}/status`);
export const toggleStoryPublic = (id: string) =>
  request<{ isPublic: boolean }>(`/stories/${id}/toggle-public`, { method: "POST" });
export const deleteStory = (id: string) =>
  request<{ ok: boolean }>(`/stories/${id}`, { method: "DELETE" });
/**
 * Shared SSE consumer for the story-generation endpoints. Both
 * /stories/generate and /stories/:id/regenerate-images stream
 * `data: {type, ...}` events: "progress" (forwarded to onProgress),
 * "complete" (resolves), and "error" (rejects).
 */
function streamSSE<T>(
  url: string,
  init: RequestInit,
  onProgress: ((step: string, detail?: string) => void) | undefined,
  onComplete: (event: any) => T
): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = getAccessToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) || {}),
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`${BASE}${url}`, { ...init, headers })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((body) => {
            throw new Error(body.error || `HTTP ${res.status}`);
          });
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";

        function read(): Promise<void> {
          return reader!.read().then(({ done, value }) => {
            if (done) {
              reject(new Error("Stream ended without completion"));
              return;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === "progress" && onProgress) {
                  onProgress(event.step, event.detail);
                } else if (event.type === "complete") {
                  resolve(onComplete(event));
                  return;
                } else if (event.type === "error") {
                  reject(new Error(event.error));
                  return;
                }
              } catch {
                // skip malformed events
              }
            }
            return read();
          });
        }

        return read();
      })
      .catch(reject);
  });
}

export function generateStory(
  data: any,
  onProgress?: (step: string, detail?: string) => void
): Promise<{ story: any }> {
  return streamSSE(
    "/stories/generate",
    { method: "POST", body: JSON.stringify(data) },
    onProgress,
    (event) => ({ story: event.story })
  );
}

export function regenerateStoryImages(
  storyId: string,
  onProgress?: (step: string, detail?: string) => void
): Promise<any> {
  return streamSSE(
    `/stories/${storyId}/regenerate-images`,
    { method: "POST" },
    onProgress,
    (event) => event.story
  );
}
