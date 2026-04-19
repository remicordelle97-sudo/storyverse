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
export const getAdminUniverses = () => request<any[]>("/admin/universes");
export const toggleUniverseTemplate = (id: string) =>
  request<{ isTemplate: boolean }>(`/admin/universes/${id}/toggle-template`, { method: "POST" });

// Onboarding
export const getTemplateUniverses = () => request<any[]>("/universes/templates");
export const completeOnboarding = (templateUniverseId: string, mainCharacterName: string) =>
  request<{ universeId: string }>("/auth/onboard", {
    method: "POST",
    body: JSON.stringify({ templateUniverseId, mainCharacterName }),
  });

// Character rename (user-allowed update)
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
export const createUniverse = (data: any) =>
  request<any>("/universes", { method: "POST", body: JSON.stringify(data) });
export const generateUniverseConcept = (data: any) =>
  request<any>("/universes/generate-concept", {
    method: "POST",
    body: JSON.stringify(data),
  });
export const generateStyleReference = (universeId: string) =>
  request<any>(`/universes/${universeId}/generate-style-reference`, { method: "POST" });
// Characters
export const getCharacters = (universeId: string) =>
  request<any[]>(`/characters?universeId=${universeId}`);
export const createCharacter = (data: any) =>
  request<any>("/characters", { method: "POST", body: JSON.stringify(data) });
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
export const getStoryQuota = () =>
  request<{ allowed: boolean; used: number; limit: number; remaining: number }>("/stories/quota");
export const getStories = (universeId?: string) =>
  request<any[]>(universeId ? `/stories?universeId=${universeId}` : "/stories");
export const getStory = (id: string) => request<any>(`/stories/${id}`);
export const getStoryDebug = (id: string) => request<any>(`/stories/${id}/debug`);
export const getStoryStatus = (id: string) =>
  request<{ status: string; hasIllustrations: boolean; imagesReady: number; totalPages: number }>(`/stories/${id}/status`);
export const toggleStoryPublic = (id: string) =>
  request<{ isPublic: boolean }>(`/stories/${id}/toggle-public`, { method: "POST" });
export const deleteStory = (id: string) =>
  request<{ ok: boolean }>(`/stories/${id}`, { method: "DELETE" });
export function generateStory(
  data: any,
  onProgress?: (step: string, detail?: string) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    const token = getAccessToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    fetch(`${BASE}/stories/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((body) => {
            throw new Error(body.error || `HTTP ${res.status}`);
          });
        }

        const reader = res.body?.getReader();
        if (!reader) {
          throw new Error("No response stream");
        }

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
              if (line.startsWith("data: ")) {
                try {
                  const event = JSON.parse(line.slice(6));
                  if (event.type === "progress" && onProgress) {
                    onProgress(event.step, event.detail);
                  } else if (event.type === "complete") {
                    resolve({ story: event.story });
                    return;
                  } else if (event.type === "error") {
                    reject(new Error(event.error));
                    return;
                  }
                } catch {
                  // skip malformed events
                }
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

export function regenerateStoryImages(
  storyId: string,
  onProgress?: (step: string, detail?: string) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    const token = getAccessToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    fetch(`${BASE}/stories/${storyId}/regenerate-images`, {
      method: "POST",
      headers,
    })
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
              if (line.startsWith("data: ")) {
                try {
                  const event = JSON.parse(line.slice(6));
                  if (event.type === "progress" && onProgress) {
                    onProgress(event.step, event.detail);
                  } else if (event.type === "complete") {
                    resolve(event.story);
                    return;
                  } else if (event.type === "error") {
                    reject(new Error(event.error));
                    return;
                  }
                } catch {
                  // skip malformed events
                }
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
