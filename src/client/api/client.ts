const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Universes
export const getUniverses = () => request<any[]>("/universes");
export const getUniverse = (id: string) => request<any>(`/universes/${id}`);
export const createUniverse = (data: any) =>
  request<any>("/universes", { method: "POST", body: JSON.stringify(data) });

// Characters
export const getCharacters = (universeId: string) =>
  request<any[]>(`/characters?universeId=${universeId}`);
export const createCharacter = (data: any) =>
  request<any>("/characters", { method: "POST", body: JSON.stringify(data) });

// Stories
export const getStories = (universeId: string) =>
  request<any[]>(`/stories?universeId=${universeId}`);
export const getStory = (id: string) => request<any>(`/stories/${id}`);
export const generateStory = (data: any) =>
  request<any>("/stories/generate", {
    method: "POST",
    body: JSON.stringify(data),
  });

// Timeline
export const getTimeline = (universeId: string) =>
  request<any[]>(`/timeline?universeId=${universeId}`);
