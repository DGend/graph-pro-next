import { GraphNode, GraphRenderer } from "../types";
import { NodePositionChange } from "./AlignmentEngine";

export interface CircleLayoutOptions {
  centerNodeId?: string;
  baseRadius?: number;
  spacingPerNode?: number;
  lockPositions?: boolean;
}

/**
 * System-wide master index hubs that link to thousands of notes.
 * Excluding these when arranging a regular note's neighborhood prevents pulling
 * 8,000+ global links into the local circular orbit.
 */
export const SUPER_HUB_PATTERNS = [
  "_Papers_Dashboard",
  "_Review_Ledger",
  "_Papers_Graph_Hub",
  "_Topics_Hub",
  "_Idea_Ledger",
  "_Ideas_Dashboard",
  "_AI_Dual_Frontier_8_Domains_Grand_Dashboard",
];

export function isSuperHubPath(pathOrId: string): boolean {
  if (!pathOrId) return false;
  for (let i = 0; i < SUPER_HUB_PATTERNS.length; i++) {
    if (pathOrId.includes(SUPER_HUB_PATTERNS[i])) return true;
  }
  return false;
}

export class CircularLayoutEngine {
  /**
   * Syncs a small batch of pinned/unpinned nodes to Obsidian's Web Worker and
   * settles the worker in 1 single tick (alpha = 0.0015 -> below alphaMin in 1 tick).
   */
  public static syncNodesToWorker(
    renderer: GraphRenderer,
    nodes: GraphNode[],
    lock: boolean
  ): void {
    try {
      const worker = renderer.worker;
      if (!worker) return;

      for (let i = 0, len = nodes.length; i < len; i++) {
        const n = nodes[i];
        worker.postMessage({
          forceNode: {
            id: n.id,
            x: n.x,
            y: n.y,
            fx: lock ? n.x : null,
            fy: lock ? n.y : null,
          },
        });
      }

      // alpha: 0.0015 runs exactly 1 tick in D3-force to flush the Float32Array buffer
      // back to the main thread, then immediately halts (alpha < alphaMin 0.001).
      worker.postMessage({
        run: true,
        alpha: lock ? 0.0015 : 0.25,
        alphaTarget: 0,
      });
    } catch (_) {}
  }

  public static releaseAllLocks(renderer: GraphRenderer): void {
    const allNodes = renderer.nodes || [];
    const released: GraphNode[] = [];
    for (let i = 0, len = allNodes.length; i < len; i++) {
      const n = allNodes[i];
      if (n.fx != null || n.fy != null) {
        n.fx = null;
        n.fy = null;
        released.push(n);
      }
    }
    if (released.length > 0) {
      this.syncNodesToWorker(renderer, released, false);
    }
    if (renderer.changed) renderer.changed();
  }

  private static getNodeId(val: any): string {
    if (!val) return "";
    if (typeof val === "string") return val;
    return val.id || val.path || "";
  }

  /**
   * Fast O(degree) neighborhood lookup using Obsidian's built-in node.forward / node.reverse maps,
   * with fallback to renderer.links. Excludes global 4,000-link super-hubs unless the center node
   * itself is a super-hub.
   */
  public static getCleanNeighborhood(
    renderer: GraphRenderer,
    centerNode: GraphNode,
    centerId: string,
    maxNeighbors = 80
  ): GraphNode[] {
    const centerIsHub = isSuperHubPath(centerId);
    const neighbors: GraphNode[] = [];
    const seen = new Set<string>([centerId]);

    const addById = (id: string) => {
      if (!id || seen.has(id)) return;
      if (!centerIsHub && isSuperHubPath(id)) return; // Skip 4,000-link master ledgers
      seen.add(id);
      const target = renderer.nodeLookup ? renderer.nodeLookup[id] : undefined;
      if (target) neighbors.push(target);
    };

    // Fast path: Obsidian GraphNode objects maintain `forward` and `reverse` link dictionaries
    const fwd = (centerNode as any).forward;
    const rev = (centerNode as any).reverse;
    if (fwd && typeof fwd === "object") {
      const keys = Object.keys(fwd);
      for (let i = 0; i < keys.length && neighbors.length < maxNeighbors; i++) {
        addById(keys[i]);
      }
    }
    if (rev && typeof rev === "object") {
      const keys = Object.keys(rev);
      for (let i = 0; i < keys.length && neighbors.length < maxNeighbors; i++) {
        addById(keys[i]);
      }
    }

    // Fallback if forward/reverse wasn't populated
    if (neighbors.length === 0 && renderer.links) {
      const links = renderer.links;
      for (let i = 0, len = links.length; i < len && neighbors.length < maxNeighbors; i++) {
        const l = links[i];
        const sId = this.getNodeId(l.source);
        const tId = this.getNodeId(l.target);
        if (sId === centerId) addById(tId);
        else if (tId === centerId) addById(sId);
      }
    }

    return [centerNode, ...neighbors];
  }

  /**
   * Arranges a Local Graph in clean concentric rings around (0, 0) and syncs to worker in 1 tick.
   */
  public static arrangeLocalGraphConcentric(
    renderer: GraphRenderer,
    centerFilePath: string,
    baseRadius = 175,
    lockPositions = true
  ): boolean {
    const allNodes = renderer.nodes;
    if (!allNodes || allNodes.length === 0) return false;

    const centerNode = renderer.nodeLookup
      ? renderer.nodeLookup[centerFilePath]
      : allNodes.find((n) => (n.id || n.path) === centerFilePath);

    if (!centerNode) return false;

    if (!lockPositions) {
      this.releaseAllLocks(renderer);
      return true;
    }

    // Safety cap: if Local Graph has > 150 nodes (e.g. unfiltered hub), only pin center node
    if (allNodes.length > 150) {
      centerNode.x = 0;
      centerNode.y = 0;
      centerNode.fx = 0;
      centerNode.fy = 0;
      this.syncNodesToWorker(renderer, [centerNode], true);
      if (renderer.changed) renderer.changed();
      return true;
    }

    centerNode.x = 0;
    centerNode.y = 0;
    centerNode.fx = 0;
    centerNode.fy = 0;
    centerNode.vx = 0;
    centerNode.vy = 0;

    if (allNodes.length === 1) {
      this.syncNodesToWorker(renderer, [centerNode], true);
      if (renderer.changed) renderer.changed();
      return true;
    }

    const centerId = centerNode.id || centerNode.path || centerFilePath;
    const directSet = new Set<string>();

    const fwd = (centerNode as any).forward;
    const rev = (centerNode as any).reverse;
    if (fwd && typeof fwd === "object") {
      for (const k of Object.keys(fwd)) directSet.add(k);
    }
    if (rev && typeof rev === "object") {
      for (const k of Object.keys(rev)) directSet.add(k);
    }
    if (directSet.size === 0 && renderer.links) {
      for (let i = 0, len = renderer.links.length; i < len; i++) {
        const l = renderer.links[i];
        const sId = this.getNodeId(l.source);
        const tId = this.getNodeId(l.target);
        if (sId === centerId && tId !== centerId) directSet.add(tId);
        else if (tId === centerId && sId !== centerId) directSet.add(sId);
      }
    }

    const ring1: GraphNode[] = [];
    const ring2: GraphNode[] = [];

    for (let i = 0, len = allNodes.length; i < len; i++) {
      const n = allNodes[i];
      if (n === centerNode) continue;
      const id = n.id || n.path || "";
      if (directSet.size === 0 || directSet.has(id)) {
        ring1.push(n);
      } else {
        ring2.push(n);
      }
    }

    const n1 = ring1.length;
    const r1 = Math.max(baseRadius, Math.round((Math.max(n1, 1) * 56) / (2 * Math.PI)));
    const startAngle = -Math.PI / 2;

    if (n1 > 0) {
      const step1 = (2 * Math.PI) / n1;
      for (let i = 0; i < n1; i++) {
        const node = ring1[i];
        const angle = startAngle + i * step1;
        const nx = Math.round(r1 * Math.cos(angle) * 10) / 10;
        const ny = Math.round(r1 * Math.sin(angle) * 10) / 10;
        node.x = nx;
        node.y = ny;
        node.fx = nx;
        node.fy = ny;
        node.vx = 0;
        node.vy = 0;
      }
    }

    const n2 = ring2.length;
    if (n2 > 0) {
      const r2 = r1 + 145;
      const step2 = (2 * Math.PI) / n2;
      for (let j = 0; j < n2; j++) {
        const node = ring2[j];
        const angle = startAngle + j * step2;
        const nx = Math.round(r2 * Math.cos(angle) * 10) / 10;
        const ny = Math.round(r2 * Math.sin(angle) * 10) / 10;
        node.x = nx;
        node.y = ny;
        node.fx = nx;
        node.fy = ny;
        node.vx = 0;
        node.vy = 0;
      }
    }

    this.syncNodesToWorker(renderer, allNodes, true);
    if (renderer.changed) renderer.changed();
    return true;
  }

  /**
   * Arranges selected nodes (or active note neighborhood) in a circle and syncs to worker in 1 tick.
   */
  public static arrangeInCircle(
    renderer: GraphRenderer,
    nodesToArrange: GraphNode[],
    options: CircleLayoutOptions = {}
  ): { changed: NodePositionChange[] } {
    if (!renderer || !nodesToArrange || nodesToArrange.length <= 1) {
      return { changed: [] };
    }

    const {
      centerNodeId,
      baseRadius = 180,
      spacingPerNode = 55,
      lockPositions = true,
    } = options;

    const changes: NodePositionChange[] = [];

    let centerNode: GraphNode = nodesToArrange[0];
    if (centerNodeId) {
      const found = nodesToArrange.find((n) => (n.id || n.path) === centerNodeId);
      if (found) centerNode = found;
    } else {
      for (let i = 1, len = nodesToArrange.length; i < len; i++) {
        if ((nodesToArrange[i].weight || 0) > (centerNode.weight || 0)) {
          centerNode = nodesToArrange[i];
        }
      }
    }

    const cx = centerNode.x;
    const cy = centerNode.y;

    if (lockPositions) {
      centerNode.fx = cx;
      centerNode.fy = cy;
      centerNode.vx = 0;
      centerNode.vy = 0;
    }

    const peripheral = nodesToArrange.filter((n) => n !== centerNode);
    const count = peripheral.length;
    if (count === 0) return { changed: [] };

    const dynamicRadius = Math.max(baseRadius, Math.round((count * spacingPerNode) / (2 * Math.PI)));
    const angleStep = (2 * Math.PI) / count;
    const startAngle = -Math.PI / 2;

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

    this.syncNodesToWorker(renderer, nodesToArrange, lockPositions);
    if (renderer.changed) renderer.changed();
    return { changed: changes };
  }
}
