/**
 * Typed client-side envelope transport for Voyage command/API endpoints.
 *
 * Every API endpoint answers with the same envelope shape
 * (`{ ok, data, error: { code, message } }`); before this module existed, each
 * caller hand-rolled its own fetch + `await response.json()` + error mapping,
 * duplicated ten times over, usually swallowing the failure reason with
 * `.catch(() => toast.error("..."))`.
 */

export class ApiError extends Error {
  constructor(message: string, public readonly code?: string, public readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** Standard envelope as answered by /api/voyage/* endpoints. */
export interface VoyageEnvelope<T> {
  ok?: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

/** Posts JSON and returns the parsed envelope; network failures keep a stable message. */
export async function postEnvelope<T>(url: string, body: unknown, options: { networkMessage?: string } = {}): Promise<VoyageEnvelope<T>> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return await response.json() as VoyageEnvelope<T>;
  } catch {
    throw new ApiError(options.networkMessage ?? "网络异常，请重试");
  }
}

/** Posts a runtime command and unwraps `data`, mapping failures to ApiError. */
export async function runCommand<T>(command: string, input: unknown, options: { networkMessage?: string; fallbackMessage?: string } = {}): Promise<T> {
  const envelope = await postEnvelope<T>("/api/voyage/command", { command, input }, options);
  if (!envelope.ok || envelope.data === undefined) {
    throw new ApiError(envelope.error?.message ?? options.fallbackMessage ?? "操作失败，请重试", envelope.error?.code);
  }
  return envelope.data;
}
