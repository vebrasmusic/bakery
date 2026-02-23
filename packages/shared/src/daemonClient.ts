import {
  CreateSliceRequestSchema,
  CreateSliceResponseSchema,
  CreatePieRequestSchema,
  CreatePieResponseSchema,
  ListSlicesResponseSchema,
  ListPiesResponseSchema,
  MutationOkResponseSchema,
  type CreateSliceRequest,
  type CreateSliceResponse,
  type CreatePieRequest,
  type CreatePieResponse,
  type ListSlicesResponse,
  type ListPiesResponse,
  type MutationOkResponse
} from "./schemas.js";
import { resolveDaemonUrl, type DaemonRequestOptions } from "./statusClient.js";

export interface SliceListQuery {
  pieId?: string;
  all?: boolean;
}

async function parseError(response: Response): Promise<string> {
  const bodyText = await response.text();
  if (!bodyText.trim()) {
    return response.statusText || "unknown error";
  }
  try {
    const parsed = JSON.parse(bodyText) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error;
    }
  } catch {
    // fall through to plain text
  }
  return bodyText;
}

async function requestJson(
  path: string,
  init: RequestInit,
  options: DaemonRequestOptions = {}
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const daemonUrl = resolveDaemonUrl(options.daemonUrl);
  const response = await fetchImpl(`${daemonUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${await parseError(response)}`);
  }
  return response.json();
}

export async function listPies(options: DaemonRequestOptions = {}): Promise<ListPiesResponse> {
  const payload = await requestJson(
    "/v1/pies",
    {
      method: "GET",
      headers: { accept: "application/json" }
    },
    options
  );
  return ListPiesResponseSchema.parse(payload);
}

export async function createPie(
  input: CreatePieRequest,
  options: DaemonRequestOptions = {}
): Promise<CreatePieResponse> {
  const payload = await requestJson(
    "/v1/pies",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify(CreatePieRequestSchema.parse(input))
    },
    options
  );
  return CreatePieResponseSchema.parse(payload);
}

export async function removePie(
  pieIdentifier: string,
  options: DaemonRequestOptions = {}
): Promise<MutationOkResponse> {
  const normalizedPieIdentifier = pieIdentifier.trim();
  if (!normalizedPieIdentifier) {
    throw new Error("Pie identifier is required");
  }

  const payload = await requestJson(
    `/v1/pies/${encodeURIComponent(normalizedPieIdentifier)}`,
    {
      method: "DELETE",
      headers: { accept: "application/json" }
    },
    options
  );
  return MutationOkResponseSchema.parse(payload);
}

export async function listSlices(
  query: SliceListQuery = {},
  options: DaemonRequestOptions = {}
): Promise<ListSlicesResponse> {
  if (query.pieId !== undefined && query.all === true) {
    throw new Error("Cannot combine pieId with all=true");
  }

  const params = new URLSearchParams();
  if (query.pieId !== undefined && query.pieId.trim()) {
    params.set("pieId", query.pieId.trim());
  }
  if (query.all === true) {
    params.set("all", "true");
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";

  const payload = await requestJson(
    `/v1/slices${suffix}`,
    {
      method: "GET",
      headers: { accept: "application/json" }
    },
    options
  );
  return ListSlicesResponseSchema.parse(payload);
}

export async function createSlice(
  input: CreateSliceRequest,
  options: DaemonRequestOptions = {}
): Promise<CreateSliceResponse> {
  const payload = await requestJson(
    "/v1/slices",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify(CreateSliceRequestSchema.parse(input))
    },
    options
  );
  return CreateSliceResponseSchema.parse(payload);
}

export async function stopSlice(
  sliceId: string,
  options: DaemonRequestOptions = {}
): Promise<MutationOkResponse> {
  const normalizedSliceId = sliceId.trim();
  if (!normalizedSliceId) {
    throw new Error("Slice id is required");
  }

  const payload = await requestJson(
    `/v1/slices/${encodeURIComponent(normalizedSliceId)}/stop`,
    {
      method: "POST",
      headers: { accept: "application/json" }
    },
    options
  );
  return MutationOkResponseSchema.parse(payload);
}

export async function removeSlice(
  sliceId: string,
  options: DaemonRequestOptions = {}
): Promise<MutationOkResponse> {
  const normalizedSliceId = sliceId.trim();
  if (!normalizedSliceId) {
    throw new Error("Slice id is required");
  }

  const payload = await requestJson(
    `/v1/slices/${encodeURIComponent(normalizedSliceId)}`,
    {
      method: "DELETE",
      headers: { accept: "application/json" }
    },
    options
  );
  return MutationOkResponseSchema.parse(payload);
}
