import { GraphNode, GraphRenderer, NodePositionChange } from "../types";
import { CircularLayoutEngine } from "./CircularLayout";

export class AlignmentEngine {
  private static findCenterOrigin(nodes: GraphNode[], centerNodeId?: string | null): { cx: number; cy: number; centerNode: GraphNode } {
    let centerNode = nodes[0];
    if (centerNodeId) {
      const found = nodes.find((n) => (n.id || n.path) === centerNodeId);
      if (found) {
        return { cx: found.x, cy: found.y, centerNode: found };
      }
    }
    for (let i = 1; i < nodes.length; i++) {
      if ((nodes[i].weight || 0) > (centerNode.weight || 0)) {
        centerNode = nodes[i];
      }
    }
    return { cx: centerNode.x, cy: centerNode.y, centerNode };
  }

  /**
   * Arranges nodes in a clean, evenly-spaced Horizontal Row layout around the center node.
   */
  public static alignHorizontal(
    renderer: GraphRenderer,
    nodes: GraphNode[],
    centerNodeId?: string | null
  ): NodePositionChange[] {
    if (!nodes || nodes.length === 0) return [];
    CircularLayoutEngine.ensureRendererPinHook(renderer);

    const { cx, cy, centerNode } = this.findCenterOrigin(nodes, centerNodeId);
    const others = nodes.filter((n) => n !== centerNode);
    const changes: NodePositionChange[] = [];

    // Keep center node at (cx, cy) and place others along horizontal axis (or 2 rows if many)
    changes.push(CircularLayoutEngine.applyPin(centerNode, cx, cy, true));

    const count = others.length;
    const spacingX = 125;
    const maxPerRow = 12;

    for (let i = 0; i < count; i++) {
      const node = others[i];
      const row = Math.floor(i / maxPerRow);
      const idxInRow = i % maxPerRow;
      const side = idxInRow % 2 === 0 ? 1 : -1;
      const step = Math.floor(idxInRow / 2) + 1;

      const targetX = Math.round((cx + side * step * spacingX) * 10) / 10;
      const targetY = Math.round((cy + (row === 0 ? 0 : (row % 2 === 1 ? 1 : -1) * Math.ceil(row / 2) * 85)) * 10) / 10;

      changes.push(CircularLayoutEngine.applyPin(node, targetX, targetY, true));
    }

    CircularLayoutEngine.syncNodesToWorker(renderer, nodes, true);
    if (renderer.changed) renderer.changed();
    return changes;
  }

  /**
   * Arranges nodes in a clean, evenly-spaced Vertical Column layout around the center node.
   */
  public static alignVertical(
    renderer: GraphRenderer,
    nodes: GraphNode[],
    centerNodeId?: string | null
  ): NodePositionChange[] {
    if (!nodes || nodes.length === 0) return [];
    CircularLayoutEngine.ensureRendererPinHook(renderer);

    const { cx, cy, centerNode } = this.findCenterOrigin(nodes, centerNodeId);
    const others = nodes.filter((n) => n !== centerNode);
    const changes: NodePositionChange[] = [];

    changes.push(CircularLayoutEngine.applyPin(centerNode, cx, cy, true));

    const count = others.length;
    const spacingY = 75;
    const maxPerCol = 12;

    for (let i = 0; i < count; i++) {
      const node = others[i];
      const col = Math.floor(i / maxPerCol);
      const idxInCol = i % maxPerCol;
      const side = idxInCol % 2 === 0 ? 1 : -1;
      const step = Math.floor(idxInCol / 2) + 1;

      const targetX = Math.round((cx + (col === 0 ? 0 : (col % 2 === 1 ? 1 : -1) * Math.ceil(col / 2) * 160)) * 10) / 10;
      const targetY = Math.round((cy + side * step * spacingY) * 10) / 10;

      changes.push(CircularLayoutEngine.applyPin(node, targetX, targetY, true));
    }

    CircularLayoutEngine.syncNodesToWorker(renderer, nodes, true);
    if (renderer.changed) renderer.changed();
    return changes;
  }

  /**
   * Arranges nodes in a clean M x K Rectangular Grid Matrix centered around the active node.
   */
  public static snapToGrid(
    renderer: GraphRenderer,
    nodes: GraphNode[],
    centerNodeId?: string | null,
    colSpacing = 145,
    rowSpacing = 95
  ): NodePositionChange[] {
    if (!nodes || nodes.length === 0) return [];
    CircularLayoutEngine.ensureRendererPinHook(renderer);

    const { cx, cy, centerNode } = this.findCenterOrigin(nodes, centerNodeId);
    const total = nodes.length;
    const cols = Math.max(2, Math.ceil(Math.sqrt(total)));
    const rows = Math.ceil(total / cols);

    const ordered = [centerNode, ...nodes.filter((n) => n !== centerNode)];
    const changes: NodePositionChange[] = [];

    const offsetX = ((cols - 1) * colSpacing) / 2;
    const offsetY = ((rows - 1) * rowSpacing) / 2;

    for (let i = 0; i < total; i++) {
      const node = ordered[i];
      const r = Math.floor(i / cols);
      const c = i % cols;
      const targetX = Math.round((cx - offsetX + c * colSpacing) * 10) / 10;
      const targetY = Math.round((cy - offsetY + r * rowSpacing) * 10) / 10;

      changes.push(CircularLayoutEngine.applyPin(node, targetX, targetY, true));
    }

    CircularLayoutEngine.syncNodesToWorker(renderer, nodes, true);
    if (renderer.changed) renderer.changed();
    return changes;
  }
}
