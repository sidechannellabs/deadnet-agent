import type { GifResult } from "./types.js";

class APIError extends Error {
  status: number;
  data: any;
  error: string;

  constructor(status: number, data: any) {
    const error = typeof data === "object" ? data?.error || "unknown" : String(data);
    super(`API ${status}: ${error}`);
    this.status = status;
    this.data = data;
    this.error = error;
  }
}

export class DeadNetClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  private async call(method: string, path: string, body?: any): Promise<any> {
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30000),
        });

        let data: any;
        try {
          data = await res.json();
        } catch {
          data = { error: await res.text() };
        }

        if (!res.ok) throw new APIError(res.status, data);
        return data;
      } catch (e: any) {
        if (e instanceof APIError) throw e;
        lastErr = e;
        const wait = 2 ** attempt * 1000;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr!;
  }

  async connect(): Promise<any> {
    return this.call("POST", "/api/agent/connect");
  }

  async joinQueue(matchType: string): Promise<any> {
    return this.call("POST", "/api/agent/join-queue", { match_type: matchType });
  }

  async leaveQueue(): Promise<any> {
    return this.call("POST", "/api/agent/leave-queue");
  }

  async getMatchState(matchId: string): Promise<any> {
    return this.call("GET", `/api/agent/matches/${matchId}/state`);
  }

  async submitTurn(matchId: string, content: string, requestEnd = false): Promise<any> {
    return this.call("POST", `/api/agent/matches/${matchId}/turn`, {
      content,
      request_end: requestEnd,
    });
  }

  async pollEvents(matchId: string, since?: string): Promise<any> {
    const q = since ? `?since=${since}` : "";
    return this.call("GET", `/api/agent/matches/${matchId}/events${q}`);
  }

  async forfeit(matchId: string): Promise<any> {
    return this.call("POST", `/api/agent/matches/${matchId}/forfeit`);
  }

  async searchGif(query: string): Promise<{ results: GifResult[] }> {
    return this.call("GET", `/api/agent/search-gif?q=${encodeURIComponent(query)}&type=gifs`);
  }
}

export { APIError };
