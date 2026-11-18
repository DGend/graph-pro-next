import { GraphNode, GraphRenderer } from "../types";

export interface CircleLayoutOptions {
  centerNodeId?: string;
  baseRadius?: number;
  spacingPerNode?: number;
  lockPositions?: boolean;
}

export class CircularLayoutEngine {
  /**
   * Arranges selected nodes in an analytical circular or concentric multi-ring layout.
   * Runs in O(N) time with zero iterative physics simulation delay.
   */
  public static arrangeInCircle(
    renderer: GraphRenderer,
    nodesToArrange: GraphNode[],
    options: CircleLayoutOptions = {}
  ): { changed: Array<{ id: string; prevX: number; prevY: number; newX: number; newY: number }> } {
    if (!renderer || !nodesToArrange || nodesToArrange.length <= 1) {
      return { changed: [] };
    }

    const {
      centerNodeId,
      baseRadius = 180,
      spacingPerNode = 55,
      lockPositions = true,
    } = options;

    const changes: Array<{ id: string; prevX: number; prevY: number; newX: number; newY: number }> = [];

    // 1. Identify Center Anchor Node
    let centerNode: GraphNode = nodesToArrange[0];
    if (centerNodeId) {
      const found = nodesToArrange.find((n) => n.id === centerNodeId);
      if (found) centerNode = found;
    } else {
      // Choose node with highest weight or highest degree
      for (let i = 1; i < nodesToArrange.length; i++) {
        if ((nodesToArrange[i].weight || 0) > (centerNode.weight || 0)) {
          centerNode = nodesToArrange[i];
        }
      }
    }

    const cx = centerNode.x;
    const cy = centerNode.y;

    // Anchor center node
    if (lockPositions) {
      centerNode.fx = cx;
      centerNode.fy = cy;
      centerNode.vx = 0;
      centerNode.vy = 0;
    }

    const peripheral = nodesToArrange.filter((n) => n.id !== centerNode.id);
    const count = peripheral.length;
    if (count === 0) return { changed: [] };

    // 2. Dynamic Radius Calculation to guarantee label legibility
    const circumference = count * spacingPerNode;
    const dynamicRadius = Math.max(baseRadius, Math.round(circumference / (2 * Math.PI)));

    // 3. Mathematical Equidistant Distribution
    const angleStep = (2 * Math.PI) / count;
    const startAngle = -Math.PI / 2; // Start from 12 o'clock position

    for (let i = 0; i < count; i++) {
      const node = peripheral[i];
      const prevX = node.x;
      const prevY = node.y;

      const angle = startAngle + i * angleStep;
      const targetX = Math.round((cx + dynamicRadius * Math.cos(angle)) * 10) / 10;
      const targetY = Math.round((cy + dynamicRadius * Math.sin(angle)) * 10) / 10;

      node.x = targetX;
      node.y = targetY;
      if (lockPositions) {
        node.fx = targetX;
        node.fy = targetY;
        node.vx = 0;
        node.vy = 0;
      }

      changes.push({
        id: node.id,
        prevX,
        prevY,
        newX: targetX,
        newY: targetY,
      });
    }

    if (typeof renderer.changed === "function") {
      renderer.changed();
    }

    return { changed: changes };
  }
}
