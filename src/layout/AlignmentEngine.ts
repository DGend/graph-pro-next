import { GraphNode, GraphRenderer } from "../types";
import { CircularLayoutEngine } from "./CircularLayout";

export interface NodePositionChange {
  id: string;
  prevX: number;
  prevY: number;
  newX: number;
  newY: number;
}

export class AlignmentEngine {
  public static alignHorizontal(renderer: GraphRenderer, nodes: GraphNode[]): NodePositionChange[] {
    if (!nodes || nodes.length <= 1) return [];

    const sumY = nodes.reduce((acc, n) => acc + n.y, 0);
    const avgY = Math.round((sumY / nodes.length) * 10) / 10;
    const changes: NodePositionChange[] = [];

    for (const node of nodes) {
      const prevX = node.x;
      const prevY = node.y;
      node.y = avgY;
      node.fx = node.x;
      node.fy = avgY;
      node.vy = 0;
      changes.push({ id: node.id, prevX, prevY, newX: node.x, newY: avgY });
    }

    CircularLayoutEngine.syncNodesToWorker(renderer, nodes, true);
    if (renderer.changed) renderer.changed();
    return changes;
  }

  public static alignVertical(renderer: GraphRenderer, nodes: GraphNode[]): NodePositionChange[] {
    if (!nodes || nodes.length <= 1) return [];

    const sumX = nodes.reduce((acc, n) => acc + n.x, 0);
    const avgX = Math.round((sumX / nodes.length) * 10) / 10;
    const changes: NodePositionChange[] = [];

    for (const node of nodes) {
      const prevX = node.x;
      const prevY = node.y;
      node.x = avgX;
      node.fx = avgX;
      node.fy = node.y;
      node.vx = 0;
      changes.push({ id: node.id, prevX, prevY, newX: avgX, newY: node.y });
    }

    CircularLayoutEngine.syncNodesToWorker(renderer, nodes, true);
    if (renderer.changed) renderer.changed();
    return changes;
  }

  public static snapToGrid(renderer: GraphRenderer, nodes: GraphNode[], gridSize = 50): NodePositionChange[] {
    if (!nodes || nodes.length === 0) return [];
    const changes: NodePositionChange[] = [];

    for (const node of nodes) {
      const prevX = node.x;
      const prevY = node.y;
      const snappedX = Math.round(node.x / gridSize) * gridSize;
      const snappedY = Math.round(node.y / gridSize) * gridSize;

      node.x = snappedX;
      node.y = snappedY;
      node.fx = snappedX;
      node.fy = snappedY;
      node.vx = 0;
      node.vy = 0;

      changes.push({ id: node.id, prevX, prevY, newX: snappedX, newY: snappedY });
    }

    CircularLayoutEngine.syncNodesToWorker(renderer, nodes, true);
    if (renderer.changed) renderer.changed();
    return changes;
  }

  public static toggleLock(renderer: GraphRenderer, nodes: GraphNode[], lock: boolean): void {
    if (!nodes || nodes.length === 0) return;
    for (const node of nodes) {
      if (lock) {
        node.fx = node.x;
        node.fy = node.y;
        node.vx = 0;
        node.vy = 0;
      } else {
        node.fx = null;
        node.fy = null;
      }
    }
    CircularLayoutEngine.syncNodesToWorker(renderer, nodes, lock);
    if (renderer.changed) renderer.changed();
  }
}
