import { StatusResponseSchema, type StatusResponse } from "./schemas.js";

export const DEFAULT_DAEMON_URL = "http://127.0.0.1:47123";

export interface DaemonRequestOptions {
  daemonUrl?: string;
  fetchImpl?: typeof fetch;
}

function normalizeDaemonUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function resolveDaemonUrl(explicit?: string): string {
  return normalizeDaemonUrl(explicit ?? process.env.BAKERY_DAEMON_URL ?? DEFAULT_DAEMON_URL);
}

export async function fetchDaemonStatus(options: DaemonRequestOptions = {}): Promise<StatusResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const daemonUrl = resolveDaemonUrl(options.daemonUrl);
  const response = await fetchImpl(`${daemonUrl}/v1/status`, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    const detail = text.trim() || response.statusText || "unknown error";
    throw new Error(`Status request failed (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  return StatusResponseSchema.parse(payload);
}
