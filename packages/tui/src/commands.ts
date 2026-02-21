import path from "node:path";
import type {
  CreatePieRequest,
  CreateSliceRequest,
  ListPiesResponse,
  ListSlicesResponse,
  StatusResponse
} from "@bakery/shared";

export type TuiCommand =
  | { kind: "help" }
  | { kind: "quit" }
  | { kind: "status" }
  | { kind: "pie-list" }
  | { kind: "pie-create-prompt" }
  | { kind: "pie-create"; name: string; repoPath?: string }
  | { kind: "slice-list"; pieId?: string; all: boolean }
  | { kind: "slice-create-prompt" }
  | { kind: "slice-create"; pieId: string; worktreePath: string; branch: string; resources: string[] }
  | { kind: "slice-stop"; id: string }
  | { kind: "slice-rm"; id: string }
  | { kind: "unknown"; reason: string };

export interface TuiCommandApi {
  fetchStatus: () => Promise<StatusResponse>;
  listPies: () => Promise<ListPiesResponse>;
  createPie: (input: CreatePieRequest) => Promise<{ pie: { id: string; slug: string } }>;
  listSlices: (query: { pieId?: string; all?: boolean }) => Promise<ListSlicesResponse>;
  createSlice: (input: CreateSliceRequest) => Promise<{ slice: { id: string; host: string; status: string; resources: unknown[] } }>;
  stopSlice: (sliceId: string) => Promise<void>;
  removeSlice: (sliceId: string) => Promise<void>;
}

export interface TuiCommandResult {
  output: string;
  quit?: boolean;
  refresh?: boolean;
}

function unquote(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"') && token.length >= 2) ||
    (token.startsWith("'") && token.endsWith("'") && token.length >= 2)
  ) {
    return token.slice(1, -1);
  }
  return token;
}

export function tokenizeCommand(input: string): string[] {
  const tokens = input.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return tokens.map(unquote);
}

export function parseCommand(input: string): TuiCommand {
  const tokens = tokenizeCommand(input.trim());
  if (tokens.length === 0) {
    return { kind: "help" };
  }

  const [head, ...rest] = tokens;
  if (head === "help") {
    return { kind: "help" };
  }
  if (head === "quit" || head === "exit") {
    return { kind: "quit" };
  }
  if (head === "status" || head === "refresh") {
    return { kind: "status" };
  }
  if (head === "pie") {
    const [sub, ...args] = rest;
    if (sub === "ls") {
      return { kind: "pie-list" };
    }
    if (sub === "create" && args.length === 0) {
      return { kind: "pie-create-prompt" };
    }
    if (sub === "create" && args.length >= 1 && args[0]) {
      return args[1]
        ? { kind: "pie-create", name: args[0], repoPath: args[1] }
        : { kind: "pie-create", name: args[0] };
    }
    return { kind: "unknown", reason: "Usage: pie create [<name> [repoPath]] | pie ls" };
  }
  if (head === "slice") {
    const [sub, ...args] = rest;
    if (sub === "ls") {
      if (args.length === 0) {
        return { kind: "slice-list", all: false };
      }
      if (args[0] === "--all") {
        return { kind: "slice-list", all: true };
      }
      if (args[0] === "--pie" && args[1]) {
        return { kind: "slice-list", pieId: args[1], all: false };
      }
      return { kind: "unknown", reason: "Usage: slice ls [--all | --pie <id-or-slug>]" };
    }
    if (sub === "create" && args.length === 0) {
      return { kind: "slice-create-prompt" };
    }
    if (sub === "create" && args.length >= 4) {
      return {
        kind: "slice-create",
        pieId: args[0]!,
        worktreePath: args[1]!,
        branch: args[2]!,
        resources: args[3]!.split(",").map((x) => x.trim()).filter(Boolean)
      };
    }
    if ((sub === "stop" || sub === "rm") && args[0]) {
      if (sub === "stop") {
        return { kind: "slice-stop", id: args[0] };
      }
      return { kind: "slice-rm", id: args[0] };
    }
    return {
      kind: "unknown",
      reason: "Usage: slice create <pie> <worktreePath> <branch> <key:protocol:expose[,..]> | slice ls [--all|--pie <id>] | slice stop <id> | slice rm <id>"
    };
  }

  return { kind: "unknown", reason: `Unknown command: ${head}` };
}

export function helpText(): string {
  return [
    "Commands:",
    "  status",
    "  pie ls",
    "  pie create [<name> [repoPath]]",
    "  slice ls [--all | --pie <id-or-slug>]",
    "  slice create [<pie> <worktreePath> <branch> <key:protocol:expose[,..]>]",
    "  slice stop <sliceId>",
    "  slice rm <sliceId>",
    "  help",
    "  quit"
  ].join("\n");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function parseResourceSpec(value: string): { key: string; protocol: "http" | "tcp" | "udp"; expose: "primary" | "subdomain" | "none" } {
  const [keyRaw, protocolRaw, exposeRaw] = value.split(":");
  const key = keyRaw?.trim() ?? "";
  const protocol = (protocolRaw?.trim() ?? "") as "http" | "tcp" | "udp";
  const expose = (exposeRaw?.trim() ?? "") as "primary" | "subdomain" | "none";

  if (!key || !["http", "tcp", "udp"].includes(protocol) || !["primary", "subdomain", "none"].includes(expose)) {
    throw new Error(`Invalid resource: ${value}`);
  }

  return { key, protocol, expose };
}

export async function executeCommand(command: TuiCommand, api: TuiCommandApi): Promise<TuiCommandResult> {
  if (command.kind === "help") {
    return { output: helpText() };
  }
  if (command.kind === "quit") {
    return { output: "Goodbye.", quit: true };
  }
  if (command.kind === "unknown") {
    return { output: command.reason };
  }
  if (command.kind === "pie-create-prompt" || command.kind === "slice-create-prompt") {
    return { output: "Interactive prompts are handled in the TUI loop." };
  }

  try {
    if (command.kind === "status") {
      const [status, pies, slices] = await Promise.all([api.fetchStatus(), api.listPies(), api.listSlices({ all: true })]);
      return {
        output: [
          `Daemon: ${status.daemon.status} (${status.daemon.host}:${status.daemon.port})`,
          `Router: ${status.daemon.host}:${status.daemon.routerPort}`,
          `Pies: ${pies.pies.length}`,
          `Slices: ${slices.slices.length}`
        ].join("\n"),
        refresh: true
      };
    }

    if (command.kind === "pie-list") {
      const response = await api.listPies();
      const names = response.pies.map((pie: ListPiesResponse["pies"][number]) => `${pie.slug} (${pie.id})`);
      return { output: names.length ? names.join("\n") : "No pies found." };
    }

    if (command.kind === "pie-create") {
      const created = await api.createPie({
        name: command.name,
        repoPath: command.repoPath ? path.resolve(command.repoPath) : undefined
      });
      return { output: `Created pie ${created.pie.slug} (${created.pie.id})`, refresh: true };
    }

    if (command.kind === "slice-list") {
      const response = await api.listSlices(command.pieId ? { pieId: command.pieId } : command.all ? { all: true } : {});
      const rows = response.slices.map((slice: ListSlicesResponse["slices"][number]) => `${slice.id} ${slice.status} ${slice.host}`);
      return { output: rows.length ? rows.join("\n") : "No slices found." };
    }

    if (command.kind === "slice-create") {
      const created = await api.createSlice({
        pieId: command.pieId,
        worktreePath: path.resolve(command.worktreePath),
        branch: command.branch,
        resources: command.resources.map(parseResourceSpec)
      });
      return { output: `Created slice ${created.slice.id} (${created.slice.host})`, refresh: true };
    }

    if (command.kind === "slice-stop") {
      await api.stopSlice(command.id);
      return { output: `Stopped slice ${command.id}`, refresh: true };
    }

    if (command.kind === "slice-rm") {
      await api.removeSlice(command.id);
      return { output: `Removed slice ${command.id}`, refresh: true };
    }
  } catch (error) {
    return { output: toErrorMessage(error) };
  }

  return { output: "Unsupported command" };
}
