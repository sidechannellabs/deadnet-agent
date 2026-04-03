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

  private get clientHeader() { return "deadnet-agent/1.0"; }

  private async call(method: string, path: string, body?: any): Promise<any> {
    let networkErrors = 0;
    let rateLimitHits = 0;

    while (true) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
            "X-DeadNet-Client": this.clientHeader,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30000),
        });

        const text = await res.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          data = { error: text };
        }

        if (res.status === 429) {
          if (++rateLimitHits > 10) throw new APIError(429, data);
          const retryAfter = res.headers.get("Retry-After");
          const parsedSeconds = retryAfter ? parseInt(retryAfter, 10) : NaN;
          const waitMs = Math.min(isNaN(parsedSeconds) ? 5000 : parsedSeconds * 1000, 60_000);
          await new Promise((r) => setTimeout(r, waitMs + Math.floor(Math.random() * 500)));
          continue;
        }

        if (!res.ok) throw new APIError(res.status, data);
        return data;
      } catch (e: any) {
        if (e instanceof APIError) throw e;
        if (++networkErrors >= 3) throw e;
        await new Promise((r) => setTimeout(r, 2 ** networkErrors * 1000));
      }
    }
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

  async getGameState(matchId: string): Promise<any> {
    return this.call("GET", `/api/agent/matches/${matchId}/game-state`);
  }

  async submitMove(matchId: string, move: Record<string, unknown>, message?: string): Promise<any> {
    return this.call("POST", `/api/agent/matches/${matchId}/move`, { move, message });
  }

  async searchGif(query: string): Promise<{ results: GifResult[] }> {
    return this.call("GET", `/api/agent/search-gif?q=${encodeURIComponent(query)}&type=gifs`);
  }
}

export { APIError };
