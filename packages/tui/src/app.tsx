import React, { useCallback, useEffect, useState } from "react";
import { Box, useApp, useInput } from "ink";
import type { ListPiesResponse, ListSlicesResponse, StatusResponse } from "@bakery/shared";
import {
  buildDefaultResources,
  executeCommand,
  parseCommand,
} from "./commands.js";
import type { TuiCommandApi } from "./commands.js";
import { buildDashboardViewModel, buildStatusSummary } from "./view-model.js";
import type { DashboardViewModel, StatusSummary } from "./view-model.js";
import { AnimatedBanner } from "./components/AnimatedBanner.js";
import { StatusBar } from "./components/StatusBar.js";
import { PieCardList } from "./components/PieCardList.js";
import { OutputLog } from "./components/OutputLog.js";
import type { OutputEntry, OutputLevel } from "./components/OutputLog.js";
import { CommandInput } from "./components/CommandInput.js";
import type { PromptFieldInfo } from "./components/CommandInput.js";
import { FooterHelp } from "./components/FooterHelp.js";

type PromptState =
  | { kind: "none" }
  | { kind: "pie-name" }
  | { kind: "pie-repo"; name: string }
  | { kind: "pie-rm-confirm"; pieId: string }
  | { kind: "slice-pie" }
  | { kind: "slice-worktree"; pieId: string }
  | { kind: "slice-branch"; pieId: string; worktreePath: string }
  | { kind: "slice-numresources"; pieId: string; worktreePath: string; branch: string };

export interface BakeryAppProps {
  api: TuiCommandApi;
  daemonUrl: string;
}

function formatTimestamp(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function createOutputEntry(message: string, level: OutputLevel = "info"): OutputEntry {
  return { timestamp: formatTimestamp(), message, level };
}

export function BakeryApp({ api, daemonUrl }: BakeryAppProps): React.ReactElement {
  const { exit } = useApp();

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [pies, setPies] = useState<ListPiesResponse["pies"]>([]);
  const [slices, setSlices] = useState<ListSlicesResponse["slices"]>([]);
  const [commandInput, setCommandInput] = useState<string>("");
  const [prompt, setPrompt] = useState<PromptState>({ kind: "none" });
  const [outputEntries, setOutputEntries] = useState<OutputEntry[]>([]);

  const addOutput = useCallback((message: string, level: OutputLevel = "info") => {
    setOutputEntries((previous) => [...previous, createOutputEntry(message, level)]);
  }, []);

  const refreshDashboard = useCallback(async () => {
    try {
      const [statusResult, piesResult, slicesResult] = await Promise.all([
        api.fetchStatus(),
        api.listPies(),
        api.listSlices({ all: true }),
      ]);
      setStatus(statusResult);
      setPies(piesResult.pies);
      setSlices(slicesResult.slices);
    } catch (fetchError: unknown) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : "Unknown error";
      addOutput(`Fetch error: ${errorMessage}`, "error");
    }
  }, [api, addOutput]);

  useEffect(() => {
    void refreshDashboard();
    const timer = setInterval(() => void refreshDashboard(), 2000);
    return () => clearInterval(timer);
  }, [refreshDashboard]);

  const handlePromptSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();

      switch (prompt.kind) {
        case "pie-name": {
          if (!trimmed) {
            addOutput("Pie create cancelled: name is required.", "error");
            setPrompt({ kind: "none" });
            break;
          }
          setPrompt({ kind: "pie-repo", name: trimmed });
          break;
        }
        case "pie-repo": {
          try {
            const repoPath = trimmed || undefined;
            const created = await api.createPie({ name: prompt.name, repoPath });
            addOutput(`Created pie ${created.pie.slug} (${created.pie.id})`, "success");
            void refreshDashboard();
          } catch (createError: unknown) {
            const errorMessage = createError instanceof Error ? createError.message : "Unknown error";
            addOutput(`Error: ${errorMessage}`, "error");
          }
          setPrompt({ kind: "none" });
          break;
        }
        case "pie-rm-confirm": {
          if (trimmed.toLowerCase() !== "yes") {
            addOutput("Pie rm cancelled.", "info");
            setPrompt({ kind: "none" });
            break;
          }
          try {
            await api.removePie(prompt.pieId);
            addOutput(`Removed pie ${prompt.pieId}`, "success");
            void refreshDashboard();
          } catch (removeError: unknown) {
            const errorMessage = removeError instanceof Error ? removeError.message : "Unknown error";
            addOutput(`Error: ${errorMessage}`, "error");
          }
          setPrompt({ kind: "none" });
          break;
        }
        case "slice-pie": {
          if (!trimmed) {
            addOutput("Slice create cancelled: pie is required.", "error");
            setPrompt({ kind: "none" });
            break;
          }
          setPrompt({ kind: "slice-worktree", pieId: trimmed });
          break;
        }
        case "slice-worktree": {
          const worktreePath = trimmed || ".";
          setPrompt({ kind: "slice-branch", pieId: prompt.pieId, worktreePath });
          break;
        }
        case "slice-branch": {
          const branch = trimmed || "main";
          setPrompt({
            kind: "slice-numresources",
            pieId: prompt.pieId,
            worktreePath: prompt.worktreePath,
            branch,
          });
          break;
        }
        case "slice-numresources": {
          const numResources = Number.parseInt(trimmed || "3", 10);
          if (!Number.isInteger(numResources) || numResources < 1) {
            addOutput("Must be a positive integer.", "error");
            setPrompt({ kind: "none" });
            break;
          }
          try {
            const created = await api.createSlice({
              pieId: prompt.pieId,
              worktreePath: prompt.worktreePath,
              branch: prompt.branch,
              resources: buildDefaultResources(numResources),
            });
            addOutput(`Created slice ${created.slice.id} (${created.slice.host})`, "success");
            void refreshDashboard();
          } catch (createError: unknown) {
            const errorMessage = createError instanceof Error ? createError.message : "Unknown error";
            addOutput(`Error: ${errorMessage}`, "error");
          }
          setPrompt({ kind: "none" });
          break;
        }
        default:
          break;
      }
    },
    [prompt, api, addOutput, refreshDashboard]
  );

  const handleCommandSubmit = useCallback(
    async (input: string) => {
      const parsed = parseCommand(input);

      if (parsed.kind === "pie-create-prompt") {
        setPrompt({ kind: "pie-name" });
        return;
      }
      if (parsed.kind === "slice-create-prompt") {
        setPrompt({ kind: "slice-pie" });
        return;
      }
      if (parsed.kind === "pie-rm") {
        setPrompt({ kind: "pie-rm-confirm", pieId: parsed.id });
        return;
      }
      if (parsed.kind === "quit") {
        addOutput("Goodbye.", "info");
        exit();
        return;
      }

      const result = await executeCommand(parsed, api);

      const outputLevel: OutputLevel = result.output.toLowerCase().startsWith("error")
        || result.output.toLowerCase().startsWith("unknown")
        ? "error"
        : "success";
      addOutput(result.output, outputLevel);

      if (result.refresh) {
        void refreshDashboard();
      }
    },
    [api, addOutput, exit, refreshDashboard]
  );

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (key.escape) {
      if (prompt.kind !== "none") {
        setPrompt({ kind: "none" });
        setCommandInput("");
        addOutput("Cancelled.", "info");
      }
      return;
    }

    if (key.return) {
      const currentValue = commandInput;
      setCommandInput("");
      if (prompt.kind !== "none") {
        void handlePromptSubmit(currentValue);
      } else {
        void handleCommandSubmit(currentValue);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setCommandInput((previous) => previous.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && input.length === 1) {
      setCommandInput((previous) => previous + input);
    }
  });

  const statusSummary: StatusSummary | null = buildStatusSummary(status);
  const dashboardViewModel: DashboardViewModel = buildDashboardViewModel({ pies, slices });

  const promptFieldInfo: PromptFieldInfo | null = (() => {
    switch (prompt.kind) {
      case "pie-name":
        return { label: "Pie name:" };
      case "pie-repo":
        return { label: "Repo path (optional):", defaultValue: "" };
      case "pie-rm-confirm":
        return { label: `Type yes to delete pie ${prompt.pieId}:` };
      case "slice-pie":
        return { label: "Pie (id or slug):" };
      case "slice-worktree":
        return { label: "Worktree path:", defaultValue: "." };
      case "slice-branch":
        return { label: "Branch:", defaultValue: "main" };
      case "slice-numresources":
        return { label: "Num resources:", defaultValue: "3" };
      default:
        return null;
    }
  })();

  return (
    <Box flexDirection="column">
      <AnimatedBanner daemonUrl={daemonUrl} />
      <StatusBar summary={statusSummary} />
      <PieCardList viewModel={dashboardViewModel} />
      <OutputLog entries={outputEntries} />
      <CommandInput value={commandInput} promptField={promptFieldInfo} />
      <FooterHelp />
    </Box>
  );
}
