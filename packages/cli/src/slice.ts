import {
  createSlice,
  listSlices,
  removeSlice,
  stopSlice,
  toSliceCreateOutput,
  type CreateSliceResource,
  type ListSlicesResponse,
  type SliceCreateOutput
} from "@bakery/shared";

export interface SliceCliGlobalOptions {
  daemonUrl?: string;
}

export interface SliceListOptions {
  pie?: string;
  all?: boolean;
}

export function validateSliceListOptions(options: SliceListOptions): void {
  if (options.pie !== undefined && options.all === true) {
    throw new Error("Cannot combine --pie and --all");
  }
}

export function formatSliceList(slices: ListSlicesResponse["slices"]): string {
  if (slices.length === 0) {
    return "No slices found.";
  }

  const lines = [
    "Slices:",
    "ID                   Pie      Status    Host                                Resources",
    "----------------------------------------------------------------------------------------"
  ];

  for (const slice of slices) {
    const resourceSummary = slice.resources.map((resource) => `${resource.key}:${resource.allocatedPort}`).join(",");
    lines.push(
      `${slice.id.padEnd(20)} ${slice.pieId.slice(0, 7).padEnd(8)} ${slice.status.padEnd(9)} ${slice.host.padEnd(35)} ${resourceSummary}`
    );
  }
  return lines.join("\n");
}

export function parseResourceSpec(value: string): CreateSliceResource {
  const [keyRaw, protocolRaw, exposeRaw] = value.split(":");
  const key = keyRaw?.trim() ?? "";
  const protocol = (protocolRaw?.trim() ?? "") as CreateSliceResource["protocol"];
  const expose = (exposeRaw?.trim() ?? "") as CreateSliceResource["expose"];

  if (!key || !protocol || !expose) {
    throw new Error(`Invalid resource spec: ${value}. Expected key:protocol:expose`);
  }

  if (![
    "http",
    "tcp",
    "udp"
  ].includes(protocol)) {
    throw new Error(`Invalid protocol in resource spec ${value}`);
  }

  if (!["primary", "subdomain", "none"].includes(expose)) {
    throw new Error(`Invalid expose in resource spec ${value}`);
  }

  return {
    key,
    protocol,
    expose
  };
}

export function buildDefaultResources(numResources: number): CreateSliceResource[] {
  if (!Number.isInteger(numResources) || numResources < 1) {
    throw new Error("--numresources must be a positive integer");
  }

  const resources: CreateSliceResource[] = [];
  for (let index = 1; index <= numResources; index++) {
    if (index === 1) {
      resources.push({
        key: "r1",
        protocol: "http",
        expose: "primary"
      });
      continue;
    }

    resources.push({
      key: `r${index}`,
      protocol: "tcp",
      expose: "none"
    });
  }

  return resources;
}

export async function runSliceCreate(
  options: {
    pie: string;
    numResources: number;
    sliceName?: string;
  },
  globals: SliceCliGlobalOptions
): Promise<SliceCreateOutput> {
  const clientOptions: SliceCliGlobalOptions = {};
  if (globals.daemonUrl !== undefined) {
    clientOptions.daemonUrl = globals.daemonUrl;
  }

  const response = await createSlice(
    {
      pieId: options.pie,
      resources: buildDefaultResources(options.numResources)
    },
    clientOptions
  );

  return toSliceCreateOutput(response.slice);
}

export async function runSliceList(
  options: SliceListOptions,
  globals: SliceCliGlobalOptions
): Promise<ListSlicesResponse["slices"]> {
  validateSliceListOptions(options);

  const clientOptions: SliceCliGlobalOptions = {};
  if (globals.daemonUrl !== undefined) {
    clientOptions.daemonUrl = globals.daemonUrl;
  }

  const response = await listSlices(
    options.pie
      ? { pieId: options.pie }
      : options.all
        ? { all: true }
        : {},
    clientOptions
  );
  return response.slices;
}

export async function runSliceStop(options: { id: string }, globals: SliceCliGlobalOptions): Promise<void> {
  const clientOptions: SliceCliGlobalOptions = {};
  if (globals.daemonUrl !== undefined) {
    clientOptions.daemonUrl = globals.daemonUrl;
  }
  await stopSlice(options.id, clientOptions);
}

export async function runSliceRemove(options: { id: string }, globals: SliceCliGlobalOptions): Promise<void> {
  const clientOptions: SliceCliGlobalOptions = {};
  if (globals.daemonUrl !== undefined) {
    clientOptions.daemonUrl = globals.daemonUrl;
  }
  await removeSlice(options.id, clientOptions);
}
