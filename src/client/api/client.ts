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

// Universes
export const getUniverses = () => request<any[]>("/universes");
export const getUniverse = (id: string) => request<any>(`/universes/${id}`);
export const createUniverse = (data: any) =>
  request<any>("/universes", { method: "POST", body: JSON.stringify(data) });
export const generateUniverseConcept = (data: any) =>
  request<any>("/universes/generate-concept", {
    method: "POST",
    body: JSON.stringify(data),
  });
export const getLoraStatus = (universeId: string) =>
  request<any>(`/universes/${universeId}/lora-status`);

// Characters
export const getCharacters = (universeId: string) =>
  request<any[]>(`/characters?universeId=${universeId}`);
export const createCharacter = (data: any) =>
  request<any>("/characters", { method: "POST", body: JSON.stringify(data) });
export const regenerateCharacterSheet = (characterId: string) =>
  request<any>(`/characters/${characterId}/regenerate-sheet`, { method: "POST" });
export const generateCharacters = (universeId: string, trainLora?: boolean) =>
  request<any[]>("/characters/generate", {
    method: "POST",
    body: JSON.stringify({ universeId, trainLora }),
  });

// Stories
export const getStories = (universeId?: string) =>
  request<any[]>(universeId ? `/stories?universeId=${universeId}` : "/stories");
export const getStory = (id: string) => request<any>(`/stories/${id}`);
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

// Timeline
export const getTimeline = (universeId: string) =>
  request<any[]>(`/timeline?universeId=${universeId}`);
