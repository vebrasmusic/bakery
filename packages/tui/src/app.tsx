import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { ListPiesResponse, ListSlicesResponse, StatusResponse } from "@bakery/shared";
import { toSliceCreateOutput } from "@bakery/shared";
import { buildDefaultResources, executeCommand, parseCommand } from "./commands.js";
import type { TuiCommandApi } from "./commands.js";
import { buildSlicePaneRows, buildStatusSummary } from "./view-model.js";
import type { SlicePaneRow, StatusSummary } from "./view-model.js";
import { AnimatedBanner } from "./components/AnimatedBanner.js";
import { StatusBar } from "./components/StatusBar.js";
import { PieCardList } from "./components/PieCardList.js";
import { OutputLog, flattenOutputEntries } from "./components/OutputLog.js";
import type { OutputEntry, OutputLevel } from "./components/OutputLog.js";
import { CommandInput } from "./components/CommandInput.js";
import type { PromptFieldInfo } from "./components/CommandInput.js";
import { FooterHelp } from "./components/FooterHelp.js";
import { colors } from "./theme.js";
import { buildSliceSnapshots, detectSliceLifecycleEvents, filterSuppressedSliceEvents } from "./slice-events.js";

type PromptState =
  | { kind: "none" }
  | { kind: "pie-name" }
  | { kind: "pie-repo"; name: string }
  | { kind: "pie-rm-confirm"; pieId: string }
  | { kind: "slice-pie" }
  | { kind: "slice-worktree"; pieId: string }
  | { kind: "slice-branch"; pieId: string; worktreePath: string }
  | { kind: "slice-numresources"; pieId: string; worktreePath: string; branch: string };

type FocusPane = "slices" | "output" | "command";

type RowActionId = "copy-slice-url" | "stop-slice" | "remove-slice" | "copy-pie-id" | "create-slice" | "remove-pie";

interface RowAction {
  id: RowActionId;
  label: string;
  destructive?: boolean;
}

type ActiveModal =
  | { kind: "none" }
  | {
      kind: "row-actions";
      rowType: "pie" | "slice";
      id: string;
      actions: RowAction[];
      selected: number;
      confirmActionId?: RowActionId;
    };

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

function clamp(value: number, minimum: number, maximum: number): number {
  if (value < minimum) {
    return minimum;
  }
  if (value > maximum) {
    return maximum;
  }
  return value;
}

function cyclePane(current: FocusPane, direction: "next" | "previous"): FocusPane {
  const panes: FocusPane[] = ["slices", "output", "command"];
  const index = panes.indexOf(current);
  const offset = direction === "next" ? 1 : -1;
  return panes[(index + offset + panes.length) % panes.length]!;
}

function ensureVisible(index: number, currentOffset: number, viewport: number): number {
  if (index < currentOffset) {
    return index;
  }
  if (index >= currentOffset + viewport) {
    return index - viewport + 1;
  }
  return currentOffset;
}

function toSuppressionKey(event: "created" | "removed" | "status-changed", sliceId: string, status?: string): string {
  return event === "status-changed" ? `${event}:${sliceId}:${status ?? ""}` : `${event}:${sliceId}`;
}

function copyToClipboard(text: string): boolean {
  try {
    const encoded = Buffer.from(text, "utf8").toString("base64");
    process.stdout.write(`\u001b]52;c;${encoded}\u0007`);
    return true;
  } catch {
    return false;
  }
}

export function BakeryApp({ api, daemonUrl }: BakeryAppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [pies, setPies] = useState<ListPiesResponse["pies"]>([]);
  const [slices, setSlices] = useState<ListSlicesResponse["slices"]>([]);
  const [commandInput, setCommandInput] = useState<string>("");
  const [prompt, setPrompt] = useState<PromptState>({ kind: "none" });
  const [outputEntries, setOutputEntries] = useState<OutputEntry[]>([]);
  const [focusPane, setFocusPane] = useState<FocusPane>("command");
  const [outputScrollOffset, setOutputScrollOffset] = useState<number>(0);
  const [sliceScrollOffset, setSliceScrollOffset] = useState<number>(0);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(0);
  const [outputStickToBottom, setOutputStickToBottom] = useState<boolean>(true);
  const [activeModal, setActiveModal] = useState<ActiveModal>({ kind: "none" });
  const [viewport, setViewport] = useState<{ width: number; height: number }>({
    width: Math.max(stdout.columns ?? 120, 60),
    height: Math.max(stdout.rows ?? 30, 20)
  });

  const previousSliceSnapshotsRef = useRef<ReturnType<typeof buildSliceSnapshots> | null>(null);
  const suppressionRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const updateViewport = () => {
      setViewport({
        width: Math.max(stdout.columns ?? 120, 60),
        height: Math.max(stdout.rows ?? 30, 20)
      });
    };

    updateViewport();
    stdout.on("resize", updateViewport);
    return () => {
      stdout.off("resize", updateViewport);
    };
  }, [stdout]);

  const addOutput = useCallback((message: string, level: OutputLevel = "info") => {
    setOutputEntries((previous) => [...previous, createOutputEntry(message, level)]);
  }, []);

  const markLocalSuppression = useCallback((event: "created" | "removed" | "status-changed", sliceId: string, status?: string) => {
    const expiresAt = Date.now() + 5_000;
    suppressionRef.current.set(toSuppressionKey(event, sliceId, status), expiresAt);
  }, []);

  const refreshDashboard = useCallback(async () => {
    try {
      const [statusResult, piesResult, slicesResult] = await Promise.all([
        api.fetchStatus(),
        api.listPies(),
        api.listSlices({ all: true })
      ]);

      const nextSnapshots = buildSliceSnapshots(slicesResult.slices);
      const previousSnapshots = previousSliceSnapshotsRef.current;

      if (previousSnapshots !== null) {
        const now = Date.now();
        for (const [key, expiresAt] of suppressionRef.current) {
          if (expiresAt <= now) {
            suppressionRef.current.delete(key);
          }
        }

        const events = filterSuppressedSliceEvents(
          detectSliceLifecycleEvents(previousSnapshots, nextSnapshots),
          suppressionRef.current,
          now
        );
        for (const event of events) {
          if (event.event === "created") {
            addOutput(`[external] Slice ${event.sliceId} created (${event.host})`, "info");
            continue;
          }
          if (event.event === "removed") {
            addOutput(`[external] Slice ${event.sliceId} removed`, "info");
            continue;
          }
          addOutput(
            `[external] Slice ${event.sliceId} status ${event.previousStatus ?? "unknown"} -> ${event.status}`,
            "info"
          );
        }
      }

      previousSliceSnapshotsRef.current = nextSnapshots;
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

  const sliceRows: SlicePaneRow[] = useMemo(() => buildSlicePaneRows({ pies, slices }), [pies, slices]);
  const outputLines = useMemo(() => flattenOutputEntries(outputEntries), [outputEntries]);
  const statusSummary: StatusSummary | null = buildStatusSummary(status);

  const bannerHeight = 10;
  const statusHeight = 5;
  const commandHeight = 3;
  const footerHeight = 2;
  const middleHeight = Math.max(6, viewport.height - (bannerHeight + statusHeight + commandHeight + footerHeight));
  const paneViewportLines = Math.max(1, middleHeight - 3);
  const maxOutputOffset = Math.max(0, outputLines.length - paneViewportLines);
  const maxSliceOffset = Math.max(0, sliceRows.length - paneViewportLines);

  useEffect(() => {
    setOutputScrollOffset((current) => (outputStickToBottom ? maxOutputOffset : Math.min(current, maxOutputOffset)));
  }, [maxOutputOffset, outputStickToBottom]);

  useEffect(() => {
    if (sliceRows.length === 0) {
      if (selectedRowIndex !== 0) {
        setSelectedRowIndex(0);
      }
      if (sliceScrollOffset !== 0) {
        setSliceScrollOffset(0);
      }
      return;
    }

    const clampedIndex = clamp(selectedRowIndex, 0, sliceRows.length - 1);
    if (clampedIndex !== selectedRowIndex) {
      setSelectedRowIndex(clampedIndex);
      return;
    }

    const desiredOffset = clamp(ensureVisible(clampedIndex, sliceScrollOffset, paneViewportLines), 0, maxSliceOffset);
    if (desiredOffset !== sliceScrollOffset) {
      setSliceScrollOffset(desiredOffset);
    }
  }, [maxSliceOffset, paneViewportLines, selectedRowIndex, sliceRows.length, sliceScrollOffset]);

  useEffect(() => {
    if (prompt.kind !== "none") {
      setFocusPane("command");
    }
  }, [prompt.kind]);

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

  const openRowActionModal = useCallback(() => {
    if (sliceRows.length === 0) {
      return;
    }

    const selected = sliceRows[selectedRowIndex];
    if (!selected) {
      return;
    }

    if (selected.rowType === "slice") {
      setActiveModal({
        kind: "row-actions",
        rowType: "slice",
        id: selected.id,
        selected: 0,
        actions: [
          { id: "copy-slice-url", label: "Copy primary URL" },
          { id: "stop-slice", label: "Stop slice", destructive: true },
          { id: "remove-slice", label: "Remove slice", destructive: true }
        ]
      });
      return;
    }

    if (selected.id === "orphan-group") {
      return;
    }

    setActiveModal({
      kind: "row-actions",
      rowType: "pie",
      id: selected.id,
      selected: 0,
      actions: [
        { id: "copy-pie-id", label: "Copy pie id" },
        { id: "create-slice", label: "Create slice" },
        { id: "remove-pie", label: "Remove pie", destructive: true }
      ]
    });
  }, [selectedRowIndex, sliceRows]);

  const executeRowAction = useCallback(
    async (actionId: RowActionId, rowType: "pie" | "slice", id: string) => {
      try {
        if (rowType === "slice") {
          const selectedSlice = slices.find((slice) => slice.id === id);
          if (!selectedSlice) {
            addOutput(`Slice ${id} not found.`, "error");
            return;
          }

          if (actionId === "copy-slice-url") {
            const primary = selectedSlice.resources.find(
              (resource) => resource.protocol === "http" && resource.expose === "primary"
            );
            if (!primary?.routeUrl) {
              addOutput(`Slice ${id} has no primary route URL.`, "error");
              return;
            }
            const copied = copyToClipboard(primary.routeUrl);
            addOutput(copied ? `Copied URL: ${primary.routeUrl}` : `URL: ${primary.routeUrl}`, copied ? "success" : "info");
            return;
          }

          if (actionId === "stop-slice") {
            await api.stopSlice(id);
            markLocalSuppression("status-changed", id, "stopped");
            addOutput(`Stopped slice ${id}`, "success");
            void refreshDashboard();
            return;
          }

          if (actionId === "remove-slice") {
            await api.removeSlice(id);
            markLocalSuppression("removed", id);
            addOutput(`Removed slice ${id}`, "success");
            void refreshDashboard();
            return;
          }
        }

        if (rowType === "pie") {
          if (actionId === "copy-pie-id") {
            const copied = copyToClipboard(id);
            addOutput(copied ? `Copied pie id: ${id}` : `Pie id: ${id}`, copied ? "success" : "info");
            return;
          }

          if (actionId === "create-slice") {
            setPrompt({ kind: "slice-worktree", pieId: id });
            setFocusPane("command");
            addOutput(`Creating slice for pie ${id}`, "info");
            return;
          }

          if (actionId === "remove-pie") {
            await api.removePie(id);
            addOutput(`Removed pie ${id}`, "success");
            void refreshDashboard();
            return;
          }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        addOutput(`Error: ${errorMessage}`, "error");
      }
    },
    [addOutput, api, markLocalSuppression, refreshDashboard, slices]
  );

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
            branch
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
              resources: buildDefaultResources(numResources)
            });
            const output = toSliceCreateOutput(created.slice);
            markLocalSuppression("created", output.id);
            addOutput(`Created slice ${output.id} (${output.host})`, "success");
            addOutput(JSON.stringify(output, null, 2), "info");
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
    [prompt, api, addOutput, refreshDashboard, markLocalSuppression]
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
      const outputLevel: OutputLevel =
        result.output.toLowerCase().startsWith("error") || result.output.toLowerCase().startsWith("unknown")
          ? "error"
          : "success";
      addOutput(result.output, outputLevel);

      if (parsed.kind === "slice-stop") {
        markLocalSuppression("status-changed", parsed.id, "stopped");
      }
      if (parsed.kind === "slice-rm") {
        markLocalSuppression("removed", parsed.id);
      }
      if (parsed.kind === "slice-create") {
        const match = result.output.match(/Created slice ([^\s]+)/);
        if (match?.[1]) {
          markLocalSuppression("created", match[1]);
        }
      }

      if (result.refresh) {
        void refreshDashboard();
      }
    },
    [api, addOutput, exit, markLocalSuppression, refreshDashboard]
  );

  const scrollOutput = useCallback(
    (nextOffset: number) => {
      const clamped = clamp(nextOffset, 0, maxOutputOffset);
      setOutputScrollOffset(clamped);
      setOutputStickToBottom(clamped >= maxOutputOffset);
    },
    [maxOutputOffset]
  );

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (activeModal.kind !== "none") {
      if (key.escape) {
        if (activeModal.confirmActionId !== undefined) {
          setActiveModal({
            kind: "row-actions",
            rowType: activeModal.rowType,
            id: activeModal.id,
            actions: activeModal.actions,
            selected: activeModal.selected
          });
          return;
        }
        setActiveModal({ kind: "none" });
        return;
      }

      if (activeModal.confirmActionId !== undefined) {
        if (input.toLowerCase() === "y") {
          const selectedAction = activeModal.actions.find((action) => action.id === activeModal.confirmActionId);
          if (selectedAction) {
            void executeRowAction(selectedAction.id, activeModal.rowType, activeModal.id);
          }
          setActiveModal({ kind: "none" });
          return;
        }
        if (input.toLowerCase() === "n" || key.return) {
          setActiveModal({
            kind: "row-actions",
            rowType: activeModal.rowType,
            id: activeModal.id,
            actions: activeModal.actions,
            selected: activeModal.selected
          });
        }
        return;
      }

      if (key.upArrow || input === "k") {
        setActiveModal({
          ...activeModal,
          selected: clamp(activeModal.selected - 1, 0, activeModal.actions.length - 1)
        });
        return;
      }
      if (key.downArrow || input === "j") {
        setActiveModal({
          ...activeModal,
          selected: clamp(activeModal.selected + 1, 0, activeModal.actions.length - 1)
        });
        return;
      }
      if (key.return) {
        const action = activeModal.actions[activeModal.selected];
        if (!action) {
          return;
        }
        if (action.destructive) {
          setActiveModal({ ...activeModal, confirmActionId: action.id });
          return;
        }
        void executeRowAction(action.id, activeModal.rowType, activeModal.id);
        setActiveModal({ kind: "none" });
      }
      return;
    }

    if (key.tab) {
      setFocusPane((current) => cyclePane(current, key.shift ? "previous" : "next"));
      return;
    }

    if (prompt.kind === "none" && focusPane !== "command" && input === "h") {
      setFocusPane((current) => cyclePane(current, "previous"));
      return;
    }

    if (prompt.kind === "none" && focusPane !== "command" && input === "l") {
      setFocusPane((current) => cyclePane(current, "next"));
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

    if (focusPane === "slices" && prompt.kind === "none") {
      if ((key.upArrow || input === "k") && sliceRows.length > 0) {
        const nextIndex = clamp(selectedRowIndex - 1, 0, sliceRows.length - 1);
        setSelectedRowIndex(nextIndex);
        setSliceScrollOffset((current) => clamp(ensureVisible(nextIndex, current, paneViewportLines), 0, maxSliceOffset));
        return;
      }
      if ((key.downArrow || input === "j") && sliceRows.length > 0) {
        const nextIndex = clamp(selectedRowIndex + 1, 0, sliceRows.length - 1);
        setSelectedRowIndex(nextIndex);
        setSliceScrollOffset((current) => clamp(ensureVisible(nextIndex, current, paneViewportLines), 0, maxSliceOffset));
        return;
      }
      if (key.pageUp) {
        const nextIndex = clamp(selectedRowIndex - paneViewportLines, 0, Math.max(0, sliceRows.length - 1));
        setSelectedRowIndex(nextIndex);
        setSliceScrollOffset((current) => clamp(ensureVisible(nextIndex, current, paneViewportLines), 0, maxSliceOffset));
        return;
      }
      if (key.pageDown) {
        const nextIndex = clamp(selectedRowIndex + paneViewportLines, 0, Math.max(0, sliceRows.length - 1));
        setSelectedRowIndex(nextIndex);
        setSliceScrollOffset((current) => clamp(ensureVisible(nextIndex, current, paneViewportLines), 0, maxSliceOffset));
        return;
      }
      if (key.home || input === "g") {
        setSelectedRowIndex(0);
        setSliceScrollOffset(0);
        return;
      }
      if (key.end || (input === "G" && key.shift)) {
        const lastIndex = Math.max(0, sliceRows.length - 1);
        setSelectedRowIndex(lastIndex);
        setSliceScrollOffset(Math.max(0, sliceRows.length - paneViewportLines));
        return;
      }
      if (key.return) {
        openRowActionModal();
      }
      return;
    }

    if (focusPane === "output" && prompt.kind === "none") {
      if (key.upArrow || input === "k") {
        scrollOutput(outputScrollOffset - 1);
        return;
      }
      if (key.downArrow || input === "j") {
        scrollOutput(outputScrollOffset + 1);
        return;
      }
      if (key.pageUp) {
        scrollOutput(outputScrollOffset - paneViewportLines);
        return;
      }
      if (key.pageDown) {
        scrollOutput(outputScrollOffset + paneViewportLines);
        return;
      }
      if (key.home || input === "g") {
        scrollOutput(0);
        return;
      }
      if (key.end || (input === "G" && key.shift)) {
        scrollOutput(maxOutputOffset);
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

  const leftPaneWidth = Math.max(30, Math.floor(viewport.width * 0.58));

  return (
    <Box width={viewport.width} height={viewport.height} flexDirection="column" overflow="hidden">
      <Box height={bannerHeight} overflow="hidden" flexShrink={0}>
        <AnimatedBanner daemonUrl={daemonUrl} />
      </Box>
      <Box height={statusHeight} overflow="hidden" flexShrink={0}>
        <StatusBar summary={statusSummary} />
      </Box>

      <Box height={middleHeight} flexDirection="row" gap={1} overflow="hidden" flexShrink={0}>
        <Box width={leftPaneWidth} overflow="hidden">
          <PieCardList
            rows={sliceRows}
            focused={focusPane === "slices"}
            selectedIndex={selectedRowIndex}
            scrollOffset={sliceScrollOffset}
            height={middleHeight}
          />
        </Box>
        <Box flexGrow={1} overflow="hidden">
          <OutputLog
            entries={outputEntries}
            height={middleHeight}
            scrollOffset={outputScrollOffset}
            focused={focusPane === "output"}
          />
        </Box>
      </Box>

      <Box height={commandHeight} overflow="hidden" flexShrink={0}>
        <CommandInput value={commandInput} promptField={promptFieldInfo} focused={focusPane === "command"} />
      </Box>
      <Box height={footerHeight} overflow="hidden" flexShrink={0}>
        <FooterHelp />
      </Box>

      {activeModal.kind === "row-actions" && (
        <Box
          position="absolute"
          marginTop={Math.max(2, Math.floor(viewport.height / 3))}
          marginLeft={Math.max(2, Math.floor(viewport.width / 4))}
          width={Math.max(34, Math.floor(viewport.width / 2))}
          borderStyle="round"
          borderColor={colors.lemon}
          paddingX={1}
          flexDirection="column"
        >
          <Text color={colors.golden} bold>
            Actions: {activeModal.rowType} {activeModal.id}
          </Text>
          {activeModal.confirmActionId ? (
            <Text color={colors.coral} wrap="truncate-end">
              Confirm destructive action ({activeModal.confirmActionId})? Press `y` to confirm, `n` or Enter to cancel.
            </Text>
          ) : (
            activeModal.actions.map((action, index) => (
              <Text key={action.id} color={index === activeModal.selected ? colors.lemon : colors.cream} wrap="truncate-end">
                {`${index === activeModal.selected ? ">" : " "} ${action.label}${action.destructive ? " (destructive)" : ""}`}
              </Text>
            ))
          )}
        </Box>
      )}
    </Box>
  );
}
