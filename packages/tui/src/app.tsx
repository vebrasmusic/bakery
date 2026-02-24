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
import { FooterHelp } from "./components/FooterHelp.js";
import { colors } from "./theme.js";
import { buildSliceSnapshots, detectSliceLifecycleEvents, filterSuppressedSliceEvents } from "./slice-events.js";
import {
  buildMetadataTree,
  flattenMetadataTree,
  getLeafCopyPayload,
  getNodeJsonCopyPayload,
  getPathCopyPayload,
  type MetadataTreeNode
} from "./slice-metadata-tree.js";

type CommandPromptState =
  | { kind: "pie-name" }
  | { kind: "pie-rm-confirm"; pieId: string }
  | { kind: "slice-pie" }
  | { kind: "slice-numresources"; pieId: string };

type FocusPane = "slices" | "output";

type RowActionId =
  | "view-slice-metadata"
  | "copy-slice-url"
  | "stop-slice"
  | "remove-slice"
  | "copy-pie-id"
  | "create-slice"
  | "remove-pie";

interface RowAction {
  id: RowActionId;
  label: string;
  destructive?: boolean;
}

type ActiveModal =
  | { kind: "none" }
  | { kind: "create-pie"; name: string }
  | { kind: "create-slice"; pieId: string; numResources: string }
  | { kind: "confirm-delete"; target: "pie" | "slice"; id: string }
  | { kind: "create-options"; pieId?: string; selected: number; options: Array<"create-slice" | "create-pie"> }
  | { kind: "command-entry"; value: string }
  | { kind: "command-prompt"; prompt: CommandPromptState; value: string }
  | {
      kind: "row-actions";
      rowType: "pie" | "slice";
      id: string;
      actions: RowAction[];
      selected: number;
      confirmActionId?: RowActionId;
    }
  | {
      kind: "slice-metadata";
      id: string;
      tree: MetadataTreeNode;
      selected: number;
      expanded: Set<string>;
      scrollOffset: number;
    };

function buildSliceRowActions(): RowAction[] {
  return [
    { id: "view-slice-metadata", label: "View metadata" },
    { id: "copy-slice-url", label: "Copy primary URL" },
    { id: "stop-slice", label: "Stop slice", destructive: true },
    { id: "remove-slice", label: "Remove slice", destructive: true }
  ];
}

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
  const panes: FocusPane[] = ["slices", "output"];
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

function buildSliceMetadataSnapshot(
  slice: ListSlicesResponse["slices"][number],
  routerPort: number
): {
  id: string;
  pieId: string;
  host: string;
  routerPort: number;
  url: string | null;
  allocatedPorts: number[];
  resources: ListSlicesResponse["slices"][number]["resources"];
} {
  const primaryHttpResource = slice.resources.find((resource) => resource.protocol === "http" && resource.expose === "primary");
  return {
    id: slice.id,
    pieId: slice.pieId,
    host: slice.host,
    routerPort,
    url: primaryHttpResource?.routeUrl ?? null,
    allocatedPorts: slice.resources.map((resource) => resource.allocatedPort),
    resources: slice.resources
  };
}

function fitModalLine(line: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  const chars = Array.from(line);
  if (chars.length >= width) {
    return chars.slice(0, width).join("");
  }
  return line + " ".repeat(width - chars.length);
}

function commandPromptLabel(prompt: CommandPromptState): { title: string; defaultValue?: string } {
  if (prompt.kind === "pie-name") {
    return { title: "Pie name" };
  }
  if (prompt.kind === "pie-rm-confirm") {
    return { title: `Type yes to delete pie ${prompt.pieId}` };
  }
  if (prompt.kind === "slice-pie") {
    return { title: "Pie (id or slug)" };
  }
  return { title: "Num resources", defaultValue: "3" };
}

export function BakeryApp({ api, daemonUrl }: BakeryAppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [pies, setPies] = useState<ListPiesResponse["pies"]>([]);
  const [slices, setSlices] = useState<ListSlicesResponse["slices"]>([]);
  const [outputEntries, setOutputEntries] = useState<OutputEntry[]>([]);
  const [focusPane, setFocusPane] = useState<FocusPane>("slices");
  const [outputScrollOffset, setOutputScrollOffset] = useState<number>(0);
  const [sliceScrollOffset, setSliceScrollOffset] = useState<number>(0);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(0);
  const [outputStickToBottom, setOutputStickToBottom] = useState<boolean>(true);
  const [isOutputExpanded, setIsOutputExpanded] = useState<boolean>(false);
  const [collapsedPieIds, setCollapsedPieIds] = useState<Set<string>>(new Set());
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

  const allSliceRows: SlicePaneRow[] = useMemo(() => buildSlicePaneRows({ pies, slices }), [pies, slices]);
  const visibleSliceRows: SlicePaneRow[] = useMemo(() => {
    const rows: SlicePaneRow[] = [];
    for (const row of allSliceRows) {
      if (row.rowType === "pie") {
        rows.push(row);
        continue;
      }
      if (!collapsedPieIds.has(row.pieId)) {
        rows.push(row);
      }
    }
    return rows;
  }, [allSliceRows, collapsedPieIds]);
  const outputLines = useMemo(() => flattenOutputEntries(outputEntries), [outputEntries]);
  const statusSummary: StatusSummary | null = buildStatusSummary(status);

  const bannerHeight = 10;
  const statusHeight = 5;
  const footerHeight = 2;
  const middleHeight = Math.max(6, viewport.height - (bannerHeight + statusHeight + footerHeight));
  const paneViewportLines = Math.max(1, middleHeight - 3);
  const maxOutputOffset = Math.max(0, outputLines.length - paneViewportLines);
  const maxSliceOffset = Math.max(0, visibleSliceRows.length - paneViewportLines);

  useEffect(() => {
    const validPieIds = new Set(allSliceRows.filter((row) => row.rowType === "pie").map((row) => row.id));
    setCollapsedPieIds((current) => {
      const next = new Set<string>();
      for (const id of current) {
        if (validPieIds.has(id)) {
          next.add(id);
        }
      }
      if (next.size === current.size) {
        let unchanged = true;
        for (const id of next) {
          if (!current.has(id)) {
            unchanged = false;
            break;
          }
        }
        if (unchanged) {
          return current;
        }
      }
      return next;
    });
  }, [allSliceRows]);

  useEffect(() => {
    setOutputScrollOffset((current) => (outputStickToBottom ? maxOutputOffset : Math.min(current, maxOutputOffset)));
  }, [maxOutputOffset, outputStickToBottom]);

  useEffect(() => {
    if (visibleSliceRows.length === 0) {
      if (selectedRowIndex !== 0) {
        setSelectedRowIndex(0);
      }
      if (sliceScrollOffset !== 0) {
        setSliceScrollOffset(0);
      }
      return;
    }

    const clampedIndex = clamp(selectedRowIndex, 0, visibleSliceRows.length - 1);
    if (clampedIndex !== selectedRowIndex) {
      setSelectedRowIndex(clampedIndex);
      return;
    }

    const desiredOffset = clamp(ensureVisible(clampedIndex, sliceScrollOffset, paneViewportLines), 0, maxSliceOffset);
    if (desiredOffset !== sliceScrollOffset) {
      setSliceScrollOffset(desiredOffset);
    }
  }, [maxSliceOffset, paneViewportLines, selectedRowIndex, sliceScrollOffset, visibleSliceRows.length]);

  const openSliceActionModal = useCallback((sliceId: string, selected = 0) => {
    const actions = buildSliceRowActions();
    setActiveModal({
      kind: "row-actions",
      rowType: "slice",
      id: sliceId,
      selected: clamp(selected, 0, actions.length - 1),
      actions
    });
  }, []);

  const openRowActionModal = useCallback(() => {
    if (visibleSliceRows.length === 0) {
      return;
    }

    const selected = visibleSliceRows[selectedRowIndex];
    if (!selected) {
      return;
    }

    if (selected.rowType === "slice") {
      openSliceActionModal(selected.id, 0);
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
  }, [openSliceActionModal, selectedRowIndex, visibleSliceRows]);

  const openSliceMetadataModal = useCallback(
    (sliceId: string) => {
      const selectedSlice = slices.find((slice) => slice.id === sliceId);
      if (!selectedSlice) {
        addOutput(`Slice ${sliceId} not found.`, "error");
        return;
      }
      if (!status) {
        addOutput("Unable to open metadata: daemon status is unavailable.", "error");
        return;
      }

      const snapshot = buildSliceMetadataSnapshot(selectedSlice, status.daemon.routerPort);
      const tree = buildMetadataTree(snapshot, "slice");
      setActiveModal({
        kind: "slice-metadata",
        id: sliceId,
        tree,
        selected: 0,
        expanded: new Set([tree.id]),
        scrollOffset: 0
      });
    },
    [addOutput, slices, status]
  );

  const executeRowAction = useCallback(
    async (actionId: RowActionId, rowType: "pie" | "slice", id: string) => {
      try {
        if (rowType === "slice") {
          const selectedSlice = slices.find((slice) => slice.id === id);
          if (!selectedSlice) {
            addOutput(`Slice ${id} not found.`, "error");
            return;
          }

          if (actionId === "view-slice-metadata") {
            openSliceMetadataModal(id);
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
            setActiveModal({ kind: "create-slice", pieId: id, numResources: "" });
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
    [addOutput, api, markLocalSuppression, openSliceMetadataModal, refreshDashboard, slices]
  );

  const submitSliceCreateModal = useCallback(
    async (pieId: string, rawCount: string) => {
      const trimmed = rawCount.trim();
      const numResources = Number.parseInt(trimmed || "3", 10);
      if (!Number.isInteger(numResources) || numResources < 1) {
        addOutput("Must be a positive integer.", "error");
        setActiveModal({ kind: "none" });
        return;
      }

      try {
        const created = await api.createSlice({
          pieId,
          resources: buildDefaultResources(numResources)
        });
        const output = toSliceCreateOutput(created.slice);
        markLocalSuppression("created", output.id);
        addOutput(`Created slice ${output.id} (${output.host})`, "success");
        addOutput(JSON.stringify(output, null, 2), "info");
        setActiveModal({ kind: "none" });
        void refreshDashboard();
      } catch (createError: unknown) {
        const errorMessage = createError instanceof Error ? createError.message : "Unknown error";
        addOutput(`Error: ${errorMessage}`, "error");
        setActiveModal({ kind: "none" });
      }
    },
    [addOutput, api, markLocalSuppression, refreshDashboard]
  );

  const submitCreatePieModal = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        addOutput("Pie create cancelled: name is required.", "error");
        return;
      }

      try {
        const created = await api.createPie({ name: trimmed });
        addOutput(`Created pie ${created.pie.slug} (${created.pie.id})`, "success");
        setActiveModal({ kind: "none" });
        void refreshDashboard();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        addOutput(`Error: ${errorMessage}`, "error");
      }
    },
    [addOutput, api, refreshDashboard]
  );

  const executeDirectCommand = useCallback(
    async (parsed: ReturnType<typeof parseCommand>) => {
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

  const submitCommandPrompt = useCallback(
    async (promptState: CommandPromptState, value: string) => {
      const trimmed = value.trim();

      if (promptState.kind === "pie-name") {
        if (!trimmed) {
          addOutput("Pie create cancelled: name is required.", "error");
          setActiveModal({ kind: "none" });
          return;
        }
        await submitCreatePieModal(trimmed);
        return;
      }

      if (promptState.kind === "pie-rm-confirm") {
        if (trimmed.toLowerCase() !== "yes") {
          addOutput("Pie rm cancelled.", "info");
          setActiveModal({ kind: "none" });
          return;
        }
        try {
          await api.removePie(promptState.pieId);
          addOutput(`Removed pie ${promptState.pieId}`, "success");
          setActiveModal({ kind: "none" });
          void refreshDashboard();
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          addOutput(`Error: ${errorMessage}`, "error");
          setActiveModal({ kind: "none" });
        }
        return;
      }

      if (promptState.kind === "slice-pie") {
        if (!trimmed) {
          addOutput("Slice create cancelled: pie is required.", "error");
          setActiveModal({ kind: "none" });
          return;
        }
        setActiveModal({
          kind: "command-prompt",
          prompt: { kind: "slice-numresources", pieId: trimmed },
          value: ""
        });
        return;
      }

      await submitSliceCreateModal(promptState.pieId, trimmed);
    },
    [addOutput, api, refreshDashboard, submitCreatePieModal, submitSliceCreateModal]
  );

  const openCreateOptionsModal = useCallback((pieId?: string) => {
    const options: Array<"create-slice" | "create-pie"> = pieId ? ["create-slice", "create-pie"] : ["create-pie"];
    setActiveModal({
      kind: "create-options",
      selected: 0,
      options,
      ...(pieId ? { pieId } : {})
    });
  }, []);

  const confirmDelete = useCallback(
    async (target: "pie" | "slice", id: string) => {
      try {
        if (target === "slice") {
          await api.removeSlice(id);
          markLocalSuppression("removed", id);
          addOutput(`Removed slice ${id}`, "success");
          setActiveModal({ kind: "none" });
          void refreshDashboard();
          return;
        }

        await api.removePie(id);
        addOutput(`Removed pie ${id}`, "success");
        setActiveModal({ kind: "none" });
        void refreshDashboard();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        addOutput(`Error: ${errorMessage}`, "error");
        setActiveModal({ kind: "none" });
      }
    },
    [addOutput, api, markLocalSuppression, refreshDashboard]
  );

  const scrollOutput = useCallback(
    (nextOffset: number) => {
      const clamped = clamp(nextOffset, 0, maxOutputOffset);
      setOutputScrollOffset(clamped);
      setOutputStickToBottom(clamped >= maxOutputOffset);
    },
    [maxOutputOffset]
  );

  const metadataRows = useMemo(
    () => (activeModal.kind === "slice-metadata" ? flattenMetadataTree(activeModal.tree, activeModal.expanded) : []),
    [activeModal]
  );
  const modalMarginTop = Math.max(2, Math.floor(viewport.height / 3));
  const modalMarginLeft = Math.max(2, Math.floor(viewport.width / 4));
  const maxModalWidth = Math.max(20, viewport.width - modalMarginLeft - 2);
  const rowActionsModalWidth = Math.min(maxModalWidth, Math.max(34, Math.floor(viewport.width / 2)));
  const metadataModalWidth = Math.min(maxModalWidth, Math.max(60, Math.floor(viewport.width * 0.75)));
  const maxModalHeight = Math.max(8, viewport.height - modalMarginTop - 2);
  const metadataModalHeight = Math.min(maxModalHeight, Math.max(10, Math.floor(viewport.height * 0.55)));
  const metadataRowsPerPage = Math.max(1, metadataModalHeight - 4);
  const metadataMaxOffset = Math.max(0, metadataRows.length - metadataRowsPerPage);
  const metadataClampedOffset =
    activeModal.kind === "slice-metadata" ? clamp(activeModal.scrollOffset, 0, metadataMaxOffset) : 0;
  const metadataSelectedIndex =
    activeModal.kind === "slice-metadata" && metadataRows.length > 0
      ? clamp(activeModal.selected, 0, metadataRows.length - 1)
      : 0;
  const visibleMetadataRows = metadataRows.slice(metadataClampedOffset, metadataClampedOffset + metadataRowsPerPage);
  const rowActionLineCount =
    activeModal.kind === "row-actions" ? (activeModal.confirmActionId ? 1 : activeModal.actions.length) : 0;
  const rowActionsModalHeight = Math.max(4, Math.min(maxModalHeight, rowActionLineCount + 3));
  const createPieModalWidth = Math.min(maxModalWidth, Math.max(44, Math.floor(viewport.width * 0.6)));
  const createPieModalHeight = 6;
  const createSliceModalWidth = createPieModalWidth;
  const createSliceModalHeight = 6;
  const createOptionsModalWidth = Math.min(maxModalWidth, Math.max(36, Math.floor(viewport.width * 0.45)));
  const createOptionsModalHeight =
    activeModal.kind === "create-options" ? Math.max(5, Math.min(maxModalHeight, activeModal.options.length + 3)) : 5;
  const commandModalWidth = Math.min(maxModalWidth, Math.max(56, Math.floor(viewport.width * 0.7)));
  const commandModalHeight = 6;

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (activeModal.kind !== "none") {
      if (activeModal.kind === "row-actions") {
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
          if (action.id === "view-slice-metadata" && activeModal.rowType === "slice") {
            openSliceMetadataModal(activeModal.id);
            return;
          }
          void executeRowAction(action.id, activeModal.rowType, activeModal.id);
          setActiveModal({ kind: "none" });
        }
        return;
      }

      if (activeModal.kind === "create-options") {
        if (key.escape) {
          setActiveModal({ kind: "none" });
          return;
        }

        if (key.upArrow || input === "k") {
          setActiveModal({
            ...activeModal,
            selected: clamp(activeModal.selected - 1, 0, activeModal.options.length - 1)
          });
          return;
        }

        if (key.downArrow || input === "j") {
          setActiveModal({
            ...activeModal,
            selected: clamp(activeModal.selected + 1, 0, activeModal.options.length - 1)
          });
          return;
        }

        if (key.return) {
          const selectedOption = activeModal.options[activeModal.selected];
          if (selectedOption === "create-pie") {
            setActiveModal({ kind: "create-pie", name: "" });
            return;
          }
          if (selectedOption === "create-slice" && activeModal.pieId) {
            setActiveModal({ kind: "create-slice", pieId: activeModal.pieId, numResources: "" });
            return;
          }
          setActiveModal({ kind: "none" });
        }
        return;
      }

      if (activeModal.kind === "confirm-delete") {
        if (key.escape || input.toLowerCase() === "n" || key.return) {
          setActiveModal({ kind: "none" });
          return;
        }
        if (input.toLowerCase() === "y") {
          void confirmDelete(activeModal.target, activeModal.id);
        }
        return;
      }

      if (activeModal.kind === "create-pie") {
        if (key.escape) {
          setActiveModal({ kind: "none" });
          return;
        }

        if (key.return) {
          void submitCreatePieModal(activeModal.name);
          return;
        }

        if (key.backspace || key.delete) {
          setActiveModal((current) =>
            current.kind === "create-pie"
              ? { ...current, name: current.name.slice(0, -1) }
              : current
          );
          return;
        }

        if (!key.ctrl && !key.meta && input.length === 1) {
          setActiveModal((current) =>
            current.kind === "create-pie"
              ? { ...current, name: current.name + input }
              : current
          );
        }
        return;
      }

      if (activeModal.kind === "create-slice") {
        if (key.escape) {
          setActiveModal({ kind: "none" });
          return;
        }

        if (key.return) {
          void submitSliceCreateModal(activeModal.pieId, activeModal.numResources);
          return;
        }

        if (key.backspace || key.delete) {
          setActiveModal((current) =>
            current.kind === "create-slice"
              ? { ...current, numResources: current.numResources.slice(0, -1) }
              : current
          );
          return;
        }

        if (!key.ctrl && !key.meta && input.length === 1) {
          setActiveModal((current) =>
            current.kind === "create-slice"
              ? { ...current, numResources: current.numResources + input }
              : current
          );
        }
        return;
      }

      if (activeModal.kind === "command-entry") {
        if (key.escape) {
          setActiveModal({ kind: "none" });
          return;
        }

        if (key.return) {
          const parsed = parseCommand(activeModal.value);
          if (parsed.kind === "pie-create-prompt") {
            setActiveModal({
              kind: "command-prompt",
              prompt: { kind: "pie-name" },
              value: ""
            });
            return;
          }
          if (parsed.kind === "slice-create-prompt") {
            setActiveModal({
              kind: "command-prompt",
              prompt: { kind: "slice-pie" },
              value: ""
            });
            return;
          }
          if (parsed.kind === "pie-rm") {
            setActiveModal({
              kind: "command-prompt",
              prompt: { kind: "pie-rm-confirm", pieId: parsed.id },
              value: ""
            });
            return;
          }
          setActiveModal({ kind: "none" });
          void executeDirectCommand(parsed);
          return;
        }

        if (key.backspace || key.delete) {
          setActiveModal((current) =>
            current.kind === "command-entry"
              ? { ...current, value: current.value.slice(0, -1) }
              : current
          );
          return;
        }

        if (!key.ctrl && !key.meta && input.length === 1) {
          setActiveModal((current) =>
            current.kind === "command-entry"
              ? { ...current, value: current.value + input }
              : current
          );
        }
        return;
      }

      if (activeModal.kind === "command-prompt") {
        if (key.escape) {
          setActiveModal({ kind: "none" });
          return;
        }

        if (key.return) {
          void submitCommandPrompt(activeModal.prompt, activeModal.value);
          return;
        }

        if (key.backspace || key.delete) {
          setActiveModal((current) =>
            current.kind === "command-prompt"
              ? { ...current, value: current.value.slice(0, -1) }
              : current
          );
          return;
        }

        if (!key.ctrl && !key.meta && input.length === 1) {
          setActiveModal((current) =>
            current.kind === "command-prompt"
              ? { ...current, value: current.value + input }
              : current
          );
        }
        return;
      }

      if (activeModal.kind === "slice-metadata") {
        if (key.escape || key.backspace) {
          openSliceActionModal(activeModal.id, 0);
          return;
        }

        const rows = flattenMetadataTree(activeModal.tree, activeModal.expanded);
        if (rows.length === 0) {
          return;
        }

        const rowsPerPage = metadataRowsPerPage;
        const selectedIndex = clamp(activeModal.selected, 0, rows.length - 1);
        const maxOffset = Math.max(0, rows.length - rowsPerPage);
        const selectedRow = rows[selectedIndex];
        if (!selectedRow) {
          return;
        }

        const moveSelection = (nextIndex: number) => {
          const clamped = clamp(nextIndex, 0, rows.length - 1);
          setActiveModal({
            ...activeModal,
            selected: clamped,
            scrollOffset: clamp(ensureVisible(clamped, activeModal.scrollOffset, rowsPerPage), 0, maxOffset)
          });
        };

        if (key.upArrow || input === "k") {
          moveSelection(selectedIndex - 1);
          return;
        }
        if (key.downArrow || input === "j") {
          moveSelection(selectedIndex + 1);
          return;
        }

        if (key.leftArrow || input === "h") {
          if (selectedRow.hasChildren && selectedRow.isExpanded) {
            const expanded = new Set(activeModal.expanded);
            expanded.delete(selectedRow.id);
            const rowsAfter = flattenMetadataTree(activeModal.tree, expanded);
            const nextMaxOffset = Math.max(0, rowsAfter.length - rowsPerPage);
            setActiveModal({
              ...activeModal,
              expanded,
              selected: selectedIndex,
              scrollOffset: clamp(ensureVisible(selectedIndex, activeModal.scrollOffset, rowsPerPage), 0, nextMaxOffset)
            });
            return;
          }

          if (selectedRow.parentId !== null) {
            const parentIndex = rows.findIndex((row) => row.id === selectedRow.parentId);
            if (parentIndex >= 0) {
              moveSelection(parentIndex);
            }
          }
          return;
        }

        if (key.rightArrow || input === "l") {
          if (selectedRow.hasChildren && !selectedRow.isExpanded) {
            const expanded = new Set(activeModal.expanded);
            expanded.add(selectedRow.id);
            const rowsAfter = flattenMetadataTree(activeModal.tree, expanded);
            const nextMaxOffset = Math.max(0, rowsAfter.length - rowsPerPage);
            setActiveModal({
              ...activeModal,
              expanded,
              selected: selectedIndex,
              scrollOffset: clamp(ensureVisible(selectedIndex, activeModal.scrollOffset, rowsPerPage), 0, nextMaxOffset)
            });
          }
          return;
        }

        if (key.return) {
          const leafPayload = getLeafCopyPayload(selectedRow.node);
          if (leafPayload === null) {
            addOutput(`Cannot copy non-leaf value at ${selectedRow.path}. Use C to copy JSON subtree.`, "error");
            return;
          }
          const copied = copyToClipboard(leafPayload);
          addOutput(
            copied ? `Copied value (${selectedRow.path}): ${leafPayload}` : `Value (${selectedRow.path}): ${leafPayload}`,
            copied ? "success" : "info"
          );
          return;
        }

        if (input === "C" || (input === "c" && key.shift)) {
          const jsonPayload = getNodeJsonCopyPayload(selectedRow.node);
          const copied = copyToClipboard(jsonPayload);
          addOutput(
            copied ? `Copied JSON subtree for ${selectedRow.path}` : `JSON subtree for ${selectedRow.path}:\n${jsonPayload}`,
            copied ? "success" : "info"
          );
          return;
        }

        if (input === "c") {
          const pathPayload = getPathCopyPayload(selectedRow.node);
          const copied = copyToClipboard(pathPayload);
          addOutput(
            copied ? `Copied path: ${pathPayload}` : `Path: ${pathPayload}`,
            copied ? "success" : "info"
          );
          return;
        }
      }
      return;
    }

    if (!key.ctrl && !key.meta && (input === "/" || input === "?")) {
      setActiveModal({ kind: "command-entry", value: "" });
      return;
    }

    if (key.tab) {
      if (isOutputExpanded) {
        setIsOutputExpanded(false);
      }
      setFocusPane((current) => cyclePane(current, key.shift ? "previous" : "next"));
      return;
    }

    if (key.escape) {
      if (isOutputExpanded) {
        setIsOutputExpanded(false);
      }
      return;
    }

    if (focusPane === "slices") {
      const selectedRow = visibleSliceRows[selectedRowIndex];

      if (!key.ctrl && !key.meta && !key.shift && input === "c") {
        if (pies.length === 0) {
          setActiveModal({ kind: "create-pie", name: "" });
          return;
        }
        if (!selectedRow) {
          openCreateOptionsModal(undefined);
          return;
        }
        if (selectedRow.rowType === "slice") {
          openCreateOptionsModal(selectedRow.pieId);
          return;
        }
        if (selectedRow.id === "orphan-group") {
          openCreateOptionsModal(undefined);
          return;
        }
        openCreateOptionsModal(selectedRow.id);
        return;
      }

      if (!key.ctrl && !key.meta && !key.shift && input === "d") {
        if (!selectedRow) {
          return;
        }
        if (selectedRow.rowType === "slice") {
          setActiveModal({ kind: "confirm-delete", target: "slice", id: selectedRow.id });
          return;
        }
        if (selectedRow.id === "orphan-group") {
          addOutput("Cannot delete orphan group row.", "error");
          return;
        }
        setActiveModal({ kind: "confirm-delete", target: "pie", id: selectedRow.id });
        return;
      }

      if ((key.upArrow || input === "k") && visibleSliceRows.length > 0) {
        const nextIndex = clamp(selectedRowIndex - 1, 0, visibleSliceRows.length - 1);
        setSelectedRowIndex(nextIndex);
        setSliceScrollOffset((current) => clamp(ensureVisible(nextIndex, current, paneViewportLines), 0, maxSliceOffset));
        return;
      }
      if ((key.downArrow || input === "j") && visibleSliceRows.length > 0) {
        const nextIndex = clamp(selectedRowIndex + 1, 0, visibleSliceRows.length - 1);
        setSelectedRowIndex(nextIndex);
        setSliceScrollOffset((current) => clamp(ensureVisible(nextIndex, current, paneViewportLines), 0, maxSliceOffset));
        return;
      }
      if (key.pageUp) {
        const nextIndex = clamp(selectedRowIndex - paneViewportLines, 0, Math.max(0, visibleSliceRows.length - 1));
        setSelectedRowIndex(nextIndex);
        setSliceScrollOffset((current) => clamp(ensureVisible(nextIndex, current, paneViewportLines), 0, maxSliceOffset));
        return;
      }
      if (key.pageDown) {
        const nextIndex = clamp(selectedRowIndex + paneViewportLines, 0, Math.max(0, visibleSliceRows.length - 1));
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
        const lastIndex = Math.max(0, visibleSliceRows.length - 1);
        setSelectedRowIndex(lastIndex);
        setSliceScrollOffset(Math.max(0, visibleSliceRows.length - paneViewportLines));
        return;
      }
      if ((key.leftArrow || input === "h") && selectedRow?.rowType === "pie") {
        setCollapsedPieIds((current) => {
          if (current.has(selectedRow.id)) {
            return current;
          }
          const next = new Set(current);
          next.add(selectedRow.id);
          return next;
        });
        return;
      }
      if ((key.rightArrow || input === "l") && selectedRow?.rowType === "pie") {
        setCollapsedPieIds((current) => {
          if (!current.has(selectedRow.id)) {
            return current;
          }
          const next = new Set(current);
          next.delete(selectedRow.id);
          return next;
        });
        return;
      }
      if (key.return) {
        openRowActionModal();
      }
      return;
    }

    if (focusPane === "output") {
      if (key.return && !isOutputExpanded) {
        setIsOutputExpanded(true);
        return;
      }
      if (input === "h" && !key.ctrl && !key.meta) {
        setFocusPane("slices");
        return;
      }
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
  });

  const outputPaneWidth = Math.min(
    Math.max(44, Math.floor(viewport.width * 0.38)),
    Math.max(32, viewport.width - 24)
  );

  return (
    <Box width={viewport.width} height={viewport.height} flexDirection="column" overflow="hidden">
      <Box height={bannerHeight} overflow="hidden" flexShrink={0}>
        <AnimatedBanner daemonUrl={daemonUrl} />
      </Box>
      <Box height={statusHeight} overflow="hidden" flexShrink={0}>
        <StatusBar summary={statusSummary} />
      </Box>

      <Box height={middleHeight} flexDirection="row" gap={isOutputExpanded ? 0 : 1} overflow="hidden" flexShrink={0}>
        {!isOutputExpanded && (
          <Box flexGrow={1} flexBasis={0} overflow="hidden">
            <PieCardList
              rows={visibleSliceRows}
              focused={focusPane === "slices"}
              selectedIndex={selectedRowIndex}
              scrollOffset={sliceScrollOffset}
              height={middleHeight}
              collapsedPieIds={collapsedPieIds}
            />
          </Box>
        )}
        <Box
          overflow="hidden"
          flexGrow={isOutputExpanded ? 1 : 0}
          flexBasis={isOutputExpanded ? 0 : undefined}
          width={isOutputExpanded ? undefined : outputPaneWidth}
          minWidth={isOutputExpanded ? undefined : 32}
        >
          <OutputLog
            entries={outputEntries}
            height={middleHeight}
            scrollOffset={outputScrollOffset}
            focused={focusPane === "output"}
          />
        </Box>
      </Box>

      <Box height={footerHeight} overflow="hidden" flexShrink={0}>
        <FooterHelp />
      </Box>

      {activeModal.kind !== "none" && (
        <Box
          position="absolute"
          marginTop={modalMarginTop}
          marginLeft={modalMarginLeft}
          width={
            activeModal.kind === "slice-metadata"
              ? metadataModalWidth
              : activeModal.kind === "create-pie"
                ? createPieModalWidth
                : activeModal.kind === "create-slice"
                  ? createSliceModalWidth
                  : activeModal.kind === "create-options"
                    ? createOptionsModalWidth
                    : activeModal.kind === "confirm-delete"
                      ? createOptionsModalWidth
                      : activeModal.kind === "command-entry" || activeModal.kind === "command-prompt"
                        ? commandModalWidth
                        : rowActionsModalWidth
          }
          height={
            activeModal.kind === "slice-metadata"
              ? metadataModalHeight
              : activeModal.kind === "create-pie"
                ? createPieModalHeight
                : activeModal.kind === "create-slice"
                  ? createSliceModalHeight
                  : activeModal.kind === "create-options"
                    ? createOptionsModalHeight
                    : activeModal.kind === "confirm-delete"
                      ? 5
                      : activeModal.kind === "command-entry" || activeModal.kind === "command-prompt"
                        ? commandModalHeight
                        : rowActionsModalHeight
          }
          borderStyle="round"
          borderColor={colors.lemon}
          paddingX={1}
          flexDirection="column"
        >
          {activeModal.kind === "row-actions" ? (
            <>
              {(() => {
                const innerWidth = Math.max(1, rowActionsModalWidth - 4);
                const actionLines = activeModal.confirmActionId
                  ? [
                      `Confirm destructive action (${activeModal.confirmActionId})? Press y to confirm, n or Enter to cancel.`
                    ]
                  : activeModal.actions.map(
                      (action, index) =>
                        `${index === activeModal.selected ? ">" : " "} ${action.label}${action.destructive ? " (destructive)" : ""}`
                    );
                const fillerCount = Math.max(0, rowActionsModalHeight - 3 - actionLines.length);
                return (
                  <>
                    <Text color={colors.golden} bold>
                      {fitModalLine(`Actions: ${activeModal.rowType} ${activeModal.id}`, innerWidth)}
                    </Text>
                    {actionLines.map((line, index) => (
                      <Text
                        key={`row-action-line-${index}`}
                        color={
                          activeModal.confirmActionId
                            ? colors.coral
                            : index === activeModal.selected
                              ? colors.lemon
                              : colors.cream
                        }
                      >
                        {fitModalLine(line, innerWidth)}
                      </Text>
                    ))}
                    {Array.from({ length: fillerCount }, (_, index) => (
                      <Text key={`row-action-filler-${index}`}>{fitModalLine("", innerWidth)}</Text>
                    ))}
                  </>
                );
              })()}
            </>
          ) : activeModal.kind === "create-options" ? (
            <>
              {(() => {
                const innerWidth = Math.max(1, createOptionsModalWidth - 4);
                const lines = activeModal.options.map((option, index) => {
                  const label = option === "create-slice" ? "Create slice" : "Create pie";
                  return `${index === activeModal.selected ? ">" : " "} ${label}`;
                });
                const fillerCount = Math.max(0, createOptionsModalHeight - 3 - lines.length);
                return (
                  <>
                    <Text color={colors.golden} bold>
                      {fitModalLine("Create options", innerWidth)}
                    </Text>
                    {lines.map((line, index) => (
                      <Text key={`create-option-${index}`} color={index === activeModal.selected ? colors.lemon : colors.cream}>
                        {fitModalLine(line, innerWidth)}
                      </Text>
                    ))}
                    {Array.from({ length: fillerCount }, (_, index) => (
                      <Text key={`create-option-filler-${index}`}>{fitModalLine("", innerWidth)}</Text>
                    ))}
                  </>
                );
              })()}
            </>
          ) : activeModal.kind === "confirm-delete" ? (
            <>
              {(() => {
                const innerWidth = Math.max(1, createOptionsModalWidth - 4);
                const targetLabel = `${activeModal.target} ${activeModal.id}`;
                return (
                  <>
                    <Text color={colors.coral} bold>
                      {fitModalLine("Confirm delete", innerWidth)}
                    </Text>
                    <Text color={colors.cream}>
                      {fitModalLine(`Delete ${targetLabel}? Press y to confirm, n/Enter/Esc to cancel.`, innerWidth)}
                    </Text>
                    <Text>{fitModalLine("", innerWidth)}</Text>
                  </>
                );
              })()}
            </>
          ) : activeModal.kind === "create-pie" ? (
            <>
              {(() => {
                const innerWidth = Math.max(1, createPieModalWidth - 4);
                return (
                  <>
                    <Text color={colors.golden} bold>
                      {fitModalLine("Create pie", innerWidth)}
                    </Text>
                    <Text color={colors.dimmed}>
                      {fitModalLine("Type name and press Enter. Esc to cancel.", innerWidth)}
                    </Text>
                    <Text color={colors.cream}>{fitModalLine(`Name: ${activeModal.name}|`, innerWidth)}</Text>
                    <Text>{fitModalLine("", innerWidth)}</Text>
                  </>
                );
              })()}
            </>
          ) : activeModal.kind === "create-slice" ? (
            <>
              {(() => {
                const innerWidth = Math.max(1, createSliceModalWidth - 4);
                return (
                  <>
                    <Text color={colors.golden} bold>
                      {fitModalLine(`Create slice for pie ${activeModal.pieId}`, innerWidth)}
                    </Text>
                    <Text color={colors.dimmed}>
                      {fitModalLine("Num resources (default 3). Enter to submit, Esc to cancel.", innerWidth)}
                    </Text>
                    <Text color={colors.cream}>
                      {fitModalLine(`Num resources: ${activeModal.numResources}| [3]`, innerWidth)}
                    </Text>
                    <Text>{fitModalLine("", innerWidth)}</Text>
                  </>
                );
              })()}
            </>
          ) : activeModal.kind === "command-entry" ? (
            <>
              {(() => {
                const innerWidth = Math.max(1, commandModalWidth - 4);
                return (
                  <>
                    <Text color={colors.golden} bold>
                      {fitModalLine("Command", innerWidth)}
                    </Text>
                    <Text color={colors.dimmed}>
                      {fitModalLine("Type command and press Enter. Esc to close.", innerWidth)}
                    </Text>
                    <Text color={colors.cream}>{fitModalLine(`/${activeModal.value}|`, innerWidth)}</Text>
                    <Text>{fitModalLine("", innerWidth)}</Text>
                  </>
                );
              })()}
            </>
          ) : activeModal.kind === "command-prompt" ? (
            <>
              {(() => {
                const innerWidth = Math.max(1, commandModalWidth - 4);
                const meta = commandPromptLabel(activeModal.prompt);
                const suffix = meta.defaultValue ? ` [${meta.defaultValue}]` : "";
                return (
                  <>
                    <Text color={colors.golden} bold>
                      {fitModalLine("Command prompt", innerWidth)}
                    </Text>
                    <Text color={colors.dimmed}>{fitModalLine(`${meta.title}${suffix}`, innerWidth)}</Text>
                    <Text color={colors.cream}>{fitModalLine(`${activeModal.value}|`, innerWidth)}</Text>
                    <Text>{fitModalLine("", innerWidth)}</Text>
                  </>
                );
              })()}
            </>
          ) : (
            <>
              {(() => {
                const innerWidth = Math.max(1, metadataModalWidth - 4);
                const bodyLines =
                  visibleMetadataRows.length === 0
                    ? [{ key: "empty", color: colors.dimmed, line: "No metadata available." }]
                    : visibleMetadataRows.map((row, index) => {
                        const absoluteIndex = metadataClampedOffset + index;
                        const selected = absoluteIndex === metadataSelectedIndex;
                        return {
                          key: `${row.id}-${absoluteIndex}`,
                          color: selected ? colors.lemon : colors.cream,
                          line: `${selected ? ">" : " "} ${row.label}`
                        };
                      });
                const fillerCount = Math.max(0, metadataRowsPerPage - bodyLines.length);
                return (
                  <>
                    <Text color={colors.golden} bold>
                      {fitModalLine(`Metadata: slice ${activeModal.id}`, innerWidth)}
                    </Text>
                    <Text color={colors.dimmed}>
                      {fitModalLine(
                        "j/k or arrows: move · h/l or arrows: collapse/expand · Enter: copy value · c: path · C: JSON · Esc/Backspace: back",
                        innerWidth
                      )}
                    </Text>
                    {bodyLines.map((entry) => (
                      <Text key={entry.key} color={entry.color}>
                        {fitModalLine(entry.line, innerWidth)}
                      </Text>
                    ))}
                    {Array.from({ length: fillerCount }, (_, index) => (
                      <Text key={`metadata-filler-${index}`}>{fitModalLine("", innerWidth)}</Text>
                    ))}
                  </>
                );
              })()}
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
