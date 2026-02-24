import { describe, expect, it } from "vitest";
import {
  buildMetadataTree,
  flattenMetadataTree,
  formatMetadataPath,
  getLeafCopyPayload,
  getNodeJsonCopyPayload,
  getPathCopyPayload,
  toMetadataNodeId
} from "./slice-metadata-tree.js";

describe("slice-metadata-tree", () => {
  it("flattens tree with expandable nested structures", () => {
    const root = buildMetadataTree(
      {
        id: "s1",
        resources: [{ allocatedPort: 30001, protocol: "http" }]
      },
      "slice"
    );

    const collapsed = flattenMetadataTree(root, new Set([root.id]));
    expect(collapsed.map((row) => row.path)).toEqual(["(root)", "id", "resources"]);
    expect(collapsed[2]?.label).toContain("[+] resources [1]");

    const expanded = flattenMetadataTree(
      root,
      new Set([root.id, toMetadataNodeId(["resources"]), toMetadataNodeId(["resources", 0])])
    );
    expect(expanded.map((row) => row.path)).toContain("resources[0].allocatedPort");
    expect(expanded.find((row) => row.path === "resources[0]")?.label).toContain("[-] [0] {2}");
  });

  it("formats dotted and bracketed paths deterministically", () => {
    expect(formatMetadataPath(["resources", 0, "allocatedPort"])).toBe("resources[0].allocatedPort");
    expect(formatMetadataPath(["resources", 0, "route-url"])).toBe("resources[0][\"route-url\"]");
    expect(formatMetadataPath([])).toBe("(root)");
  });

  it("returns copy payloads for leaf, path, and subtree json", () => {
    const root = buildMetadataTree(
      {
        resources: [{ allocatedPort: 30001 }]
      },
      "slice"
    );
    const rows = flattenMetadataTree(
      root,
      new Set([root.id, toMetadataNodeId(["resources"]), toMetadataNodeId(["resources", 0])])
    );

    const leaf = rows.find((row) => row.path === "resources[0].allocatedPort");
    const container = rows.find((row) => row.path === "resources");
    expect(leaf).toBeTruthy();
    expect(container).toBeTruthy();

    expect(getLeafCopyPayload(leaf!.node)).toBe("30001");
    expect(getPathCopyPayload(leaf!.node)).toBe("resources[0].allocatedPort");
    expect(getLeafCopyPayload(container!.node)).toBeNull();
    expect(getNodeJsonCopyPayload(container!.node)).toContain("\"allocatedPort\": 30001");
  });
});
