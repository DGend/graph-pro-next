import { GraphNode, GraphRenderer } from "../types";

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
      node.fy = avgY;
      node.vy = 0;
      changes.push({ id: node.id, prevX, prevY, newX: node.x, newY: avgY });
    }

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
      node.vx = 0;
      changes.push({ id: node.id, prevX, prevY, newX: avgX, newY: node.y });
    }

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

    if (renderer.changed) renderer.changed();
    return changes;
  }

  public static distributeHorizontally(renderer: GraphRenderer, nodes: GraphNode[]): NodePositionChange[] {
    if (!nodes || nodes.length <= 2) return [];

    const sorted = [...nodes].sort((a, b) => a.x - b.x);
    const minX = sorted[0].x;
    const maxX = sorted[sorted.length - 1].x;
    const step = (maxX - minX) / (sorted.length - 1);
    const changes: NodePositionChange[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const node = sorted[i];
      const prevX = node.x;
      const prevY = node.y;
      const targetX = Math.round((minX + i * step) * 10) / 10;

      node.x = targetX;
      node.fx = targetX;
      node.vx = 0;

      changes.push({ id: node.id, prevX, prevY, newX: targetX, newY: node.y });
    }

    if (renderer.changed) renderer.changed();
    return changes;
  }

  public static moveSelection(renderer: GraphRenderer, nodes: GraphNode[], dx: number, dy: number): NodePositionChange[] {
    if (!nodes || nodes.length === 0) return [];
    const changes: NodePositionChange[] = [];

    for (const node of nodes) {
      const prevX = node.x;
      const prevY = node.y;
      const nx = node.x + dx;
      const ny = node.y + dy;

      node.x = nx;
      node.y = ny;
      if (node.fx != null) node.fx = nx;
      if (node.fy != null) node.fy = ny;

      changes.push({ id: node.id, prevX, prevY, newX: nx, newY: ny });
    }

    if (renderer.changed) renderer.changed();
    return changes;
  }

  public static toggleLock(renderer: GraphRenderer, nodes: GraphNode[], lock: boolean): void {
    if (!nodes) return;
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
    if (renderer.changed) renderer.changed();
  }
}
