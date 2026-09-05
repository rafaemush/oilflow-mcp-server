/**
 * OilFlow MCP server — minimal HTTP client.
 *
 * Self-contained (no dependency on the unpublished @oilflow/sdk) so the MCP
 * server installs and runs standalone. Mirrors the SDK's behaviour: Bearer
 * auth, jittered exponential backoff on 429 + 5xx (Retry-After respected),
 * per-request timeout, and unwrapping of the `{ ok, data }` response envelope.
 *
 * KEYLESS IS A VALID STATE. The api key is optional: OilFlow's public
 * endpoints (the free pre-deal verdict, the receipt verifier, sandbox-key
 * issuance) take no Authorization header at all, and this client is what serves
 * them. When no key is configured the header is OMITTED rather than sent empty:
 * `Authorization: Bearer ` is a malformed credential, and an auth gate that
 * sees one answers 401 instead of treating the caller as anonymous.
 */
import { SERVER_VERSION } from "./version.js";

const DEFAULT_BASE_URL = "https://oilflow.us";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_BASE_RETRY_DELAY_MS = 250;

export class OilFlowApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string | null;
  public readonly requestId: string | null;

  constructor(opts: {
    message: string;
    statusCode: number;
    errorCode: string | null;
    requestId: string | null;
  }) {
    super(opts.message);
    this.name = "OilFlowApiError";
    this.statusCode = opts.statusCode;
    this.errorCode = opts.errorCode;
    this.requestId = opts.requestId;
  }
}

export interface RequestOptions {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}

export interface ClientOptions {
  /** Omit or pass "" to run keyless: only the public endpoints will answer. */
  apiKey?: string;
  baseUrl?: string;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  timeoutMs?: number;
}

function jitter(baseMs: number, attempt: number): number {
  const exp = baseMs * Math.pow(2, attempt);
  const cap = Math.min(exp, 30_000);
  // Deterministic-ish full-jitter; Math.random is fine here (not in a workflow).
  return Math.floor(cap / 2 + Math.random() * (cap / 2));
}

function isRetriable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class OilFlowHttpClient {
  private apiKey: string;
  /** True when a key is configured. The tool layer gates keyed tools on this. */
  public get hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }
  private baseUrl: string;
  private maxRetries: number;
  private baseRetryDelayMs: number;
  private timeoutMs: number;

  constructor(opts: ClientOptions = {}) {
    // No throw on a missing key: see the keyless note in the header. The tool
    // layer decides per tool whether a key is required, because it is the only
    // layer that knows which endpoint the tool calls.
    this.apiKey = opts.apiKey ?? "";
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseRetryDelayMs = opts.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Dispatch a request and return the unwrapped `data` payload. The OilFlow
   * API wraps successes as `{ ok: true, data }`; on `{ ok: false, error }`
   * (or any non-2xx) this throws an OilFlowApiError the tool layer renders.
   */
  async request<T = unknown>(opts: RequestOptions): Promise<T> {
    const url = new URL(opts.path, this.baseUrl);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v == null) continue;
        url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      // Derived from the single version constant, so this string can never
      // again name a release that is not the one running.
      "User-Agent": `oilflow-mcp/${SERVER_VERSION}`,
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    let body: string | undefined;
    if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers["Content-Type"] = "application/json";
    }

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url.toString(), {
          method: opts.method,
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);

        let parsed: unknown = null;
        try {
          if (res.status !== 204) parsed = await res.json();
        } catch {
          // non-JSON body; leave parsed null
        }

        if (res.ok) {
          // Unwrap the `{ ok, data }` envelope when present.
          if (parsed && typeof parsed === "object" && "data" in (parsed as Record<string, unknown>)) {
            return (parsed as { data: T }).data;
          }
          return parsed as T;
        }

        // Error path — extract code + message from the envelope.
        let errorCode: string | null = null;
        let errorMessage = `HTTP ${res.status}`;
        const maybe = parsed as { error?: { code?: string; message?: string } | string } | null;
        if (maybe && typeof maybe.error === "object" && maybe.error) {
          errorCode = maybe.error.code ?? null;
          errorMessage = maybe.error.message ?? errorMessage;
        } else if (maybe && typeof maybe.error === "string") {
          errorMessage = maybe.error;
        }

        if (isRetriable(res.status) && attempt < this.maxRetries) {
          const retryAfter = res.headers.get("retry-after");
          const delayMs = retryAfter
            ? Math.max(0, parseInt(retryAfter, 10) * 1000)
            : jitter(this.baseRetryDelayMs, attempt);
          await sleep(delayMs);
          continue;
        }

        throw new OilFlowApiError({
          message: errorMessage,
          statusCode: res.status,
          errorCode,
          requestId: res.headers.get("x-request-id"),
        });
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof OilFlowApiError) throw e;
        lastError = e;
        if (attempt < this.maxRetries) {
          await sleep(jitter(this.baseRetryDelayMs, attempt));
          continue;
        }
        throw lastError;
      }
    }
    throw lastError ?? new Error("OilFlow MCP: retry budget exhausted");
  }
}
