export type MetadataPathSegment = string | number;

export interface MetadataTreeNode {
  id: string;
  key: string | number;
  path: MetadataPathSegment[];
  parentId: string | null;
  value: unknown;
  children: MetadataTreeNode[];
}

export interface MetadataTreeRow {
  id: string;
  parentId: string | null;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  label: string;
  path: string;
  node: MetadataTreeNode;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toMetadataNodeId(path: MetadataPathSegment[]): string {
  return JSON.stringify(path);
}

function createNode(
  value: unknown,
  key: string | number,
  path: MetadataPathSegment[],
  parentId: string | null
): MetadataTreeNode {
  const id = toMetadataNodeId(path);
  const children: MetadataTreeNode[] = [];
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      children.push(createNode(value[index], index, [...path, index], id));
    }
  } else if (isPlainObject(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      children.push(createNode(childValue, childKey, [...path, childKey], id));
    }
  }
  return {
    id,
    key,
    path,
    parentId,
    value,
    children
  };
}

function formatScalar(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(value);
}

function formatContainerLabel(node: MetadataTreeNode, isExpanded: boolean): string {
  const marker = isExpanded ? "[-]" : "[+]";
  const keyLabel = typeof node.key === "number" ? `[${node.key}]` : node.key;
  if (Array.isArray(node.value)) {
    return `${marker} ${keyLabel} [${node.children.length}]`;
  }
  return `${marker} ${keyLabel} {${node.children.length}}`;
}

function formatLeafLabel(node: MetadataTreeNode): string {
  const keyLabel = typeof node.key === "number" ? `[${node.key}]` : node.key;
  return `${keyLabel}: ${formatScalar(node.value)}`;
}

export function buildMetadataTree(value: unknown, rootLabel = "root"): MetadataTreeNode {
  return createNode(value, rootLabel, [], null);
}

export function formatMetadataPath(path: MetadataPathSegment[]): string {
  if (path.length === 0) {
    return "(root)";
  }

  let output = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      output += `[${segment}]`;
      continue;
    }

    if (output.length === 0) {
      output = segment;
      continue;
    }

    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      output += `.${segment}`;
      continue;
    }

    output += `[${JSON.stringify(segment)}]`;
  }

  return output;
}

export function flattenMetadataTree(root: MetadataTreeNode, expanded: Set<string>): MetadataTreeRow[] {
  const rows: MetadataTreeRow[] = [];

  const visit = (node: MetadataTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expanded.has(node.id);
    const indent = "  ".repeat(depth);
    const label = hasChildren ? formatContainerLabel(node, isExpanded) : formatLeafLabel(node);
    rows.push({
      id: node.id,
      parentId: node.parentId,
      depth,
      hasChildren,
      isExpanded,
      label: `${indent}${label}`,
      path: formatMetadataPath(node.path),
      node
    });

    if (hasChildren && isExpanded) {
      for (const child of node.children) {
        visit(child, depth + 1);
      }
    }
  };

  visit(root, 0);
  return rows;
}

export function getLeafCopyPayload(node: MetadataTreeNode): string | null {
  if (node.children.length > 0) {
    return null;
  }
  if (typeof node.value === "string") {
    return node.value;
  }
  if (node.value === null) {
    return "null";
  }
  if (typeof node.value === "number" || typeof node.value === "boolean") {
    return String(node.value);
  }
  if (node.value === undefined) {
    return "undefined";
  }
  return JSON.stringify(node.value);
}

export function getPathCopyPayload(node: MetadataTreeNode): string {
  return formatMetadataPath(node.path);
}

export function getNodeJsonCopyPayload(node: MetadataTreeNode): string {
  return JSON.stringify(node.value, null, 2);
}
