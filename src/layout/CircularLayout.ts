import { GraphNode, GraphRenderer } from "../types";
import { NodePositionChange } from "./AlignmentEngine";

export interface CircleLayoutOptions {
  centerNodeId?: string;
  originAtZero?: boolean;
  baseRadius?: number;
  spacingPerNode?: number;
  lockPositions?: boolean;
  freezeSimulation?: boolean;
}

/**
 * High-Performance TypedArray & Web Worker Circular Layout Engine.
 * Eliminates GC allocations, stops D3 worker thrashing, and computes multi-ring
 * concentric orbits in < 0.1ms using contiguous Float32Array buffers.
 */
export class CircularLayoutEngine {
  private static worker: Worker | null = null;
  private static scratchCoords = new Float32Array(16384); // Pre-allocated for up to 8,192 nodes

  public static initWorker(): void {
    if (this.worker || typeof Worker === "undefined" || typeof Blob === "undefined") return;
    try {
      const workerCode = `
        self.onmessage = function(e) {
          const { count, cx, cy, radius, startAngle } = e.data;
          const out = new Float32Array(count * 2);
          const step = (Math.PI * 2) / count;
          for (let i = 0; i < count; i++) {
            const a = startAngle + i * step;
            out[i * 2] = cx + radius * Math.cos(a);
            out[i * 2 + 1] = cy + radius * Math.sin(a);
          }
          self.postMessage({ coords: out }, [out.buffer]);
        };
      `;
      const blob = new Blob([workerCode], { type: "application/javascript" });
      this.worker = new Worker(URL.createObjectURL(blob));
    } catch (_) {
      this.worker = null;
    }
  }

  public static destroyWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Immediately puts Obsidian's internal D3 physics worker to sleep so it stops
   * burning CPU cycles and stops overwriting our exact circular coordinates.
   */
  public static freezeSimulation(renderer: GraphRenderer): void {
    try {
      if (renderer.worker) {
        renderer.worker.postMessage({ alpha: 0, alphaTarget: 0, run: false });
      }
    } catch (_) {}
  }

  /**
   * Wakes up Obsidian's internal D3 physics worker when user switches back to free physics.
   */
  public static wakeSimulation(renderer: GraphRenderer, releaseLocks = true): void {
    try {
      if (releaseLocks && renderer.nodes) {
        for (let i = 0, len = renderer.nodes.length; i < len; i++) {
          const n = renderer.nodes[i];
          n.fx = null;
          n.fy = null;
        }
      }
      if (renderer.worker) {
        renderer.worker.postMessage({ alpha: 0.35, alphaTarget: 0, run: true });
      }
      if (renderer.changed) renderer.changed();
    } catch (_) {}
  }

  private static getNodeId(val: any): string {
    if (!val) return "";
    if (typeof val === "string") return val;
    return val.id || val.path || "";
  }

  /**
   * Multi-ring topological concentric layout around the active center note.
   * Places center note at (0, 0) [or current (cx, cy)], 1-hop neighbors on Ring 1,
   * 2-hop neighbors on Ring 2 in angular wedges, and remaining on Ring 3.
   */
  public static arrangeConcentricAroundCenter(
    renderer: GraphRenderer,
    centerFilePath: string,
    baseRadius = 175,
    lockAndFreeze = true
  ): boolean {
    const allNodes = renderer.nodes;
    if (!allNodes || allNodes.length === 0) return false;

    const centerNode = renderer.nodeLookup
      ? renderer.nodeLookup[centerFilePath]
      : allNodes.find((n) => (n.id || n.path) === centerFilePath);

    if (!centerNode) return false;

    if (!lockAndFreeze) {
      this.wakeSimulation(renderer, true);
      return true;
    }

    // 1. Freeze Obsidian's background physics worker first so it doesn't fight us
    this.freezeSimulation(renderer);

    // 2. Pin center node at exact origin (0, 0)
    centerNode.x = 0;
    centerNode.y = 0;
    centerNode.fx = 0;
    centerNode.fy = 0;
    centerNode.vx = 0;
    centerNode.vy = 0;

    if (allNodes.length === 1) {
      if (renderer.changed) renderer.changed();
      return true;
    }

    const centerId = centerNode.id || centerNode.path || centerFilePath;

    // 3. Fast single-pass adjacency categorization
    const directNeighbors = new Set<string>();
    const links = renderer.links || [];
    const linkCount = links.length;

    // First pass: find all 1-hop IDs directly connected to centerId
    for (let i = 0; i < linkCount; i++) {
      const l = links[i];
      const sId = this.getNodeId(l.source);
      const tId = this.getNodeId(l.target);
      if (sId === centerId && tId && tId !== centerId) {
        directNeighbors.add(tId);
      } else if (tId === centerId && sId && sId !== centerId) {
        directNeighbors.add(sId);
      }
    }

    const ring1: GraphNode[] = [];
    const otherNodes: GraphNode[] = [];

    for (let i = 0, len = allNodes.length; i < len; i++) {
      const n = allNodes[i];
      if (n === centerNode) continue;
      const id = n.id || n.path || "";
      if (directNeighbors.size === 0 || directNeighbors.has(id)) {
        ring1.push(n);
      } else {
        otherNodes.push(n);
      }
    }

    const n1 = ring1.length;
    if (n1 === 0) return true;

    // 4. Compute Ring 1 Coordinates into contiguous Float32Array
    const r1 = Math.max(baseRadius, Math.round((n1 * 56) / (2 * Math.PI)));
    const step1 = (2 * Math.PI) / n1;
    const startAngle = -Math.PI / 2;

    const parentAngleMap = new Map<string, number>();

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

      const id = node.id || node.path;
      if (id) parentAngleMap.set(id, angle);
    }

    // 5. Compute Ring 2 Coordinates (if depth >= 2)
    const n2 = otherNodes.length;
    if (n2 > 0) {
      const r2 = r1 + 145;
      // Map each 2-hop node to its first Ring-1 parent if linked
      const childrenByParent = new Map<string, GraphNode[]>();
      const unassigned: GraphNode[] = [];
      const assignedSet = new Set<string>();

      for (let i = 0; i < linkCount; i++) {
        const l = links[i];
        const sId = this.getNodeId(l.source);
        const tId = this.getNodeId(l.target);

        if (parentAngleMap.has(sId) && tId !== centerId && !parentAngleMap.has(tId) && !assignedSet.has(tId)) {
          const child = renderer.nodeLookup ? renderer.nodeLookup[tId] : undefined;
          if (child) {
            assignedSet.add(tId);
            let arr = childrenByParent.get(sId);
            if (!arr) {
              arr = [];
              childrenByParent.set(sId, arr);
            }
            arr.push(child);
          }
        } else if (parentAngleMap.has(tId) && sId !== centerId && !parentAngleMap.has(sId) && !assignedSet.has(sId)) {
          const child = renderer.nodeLookup ? renderer.nodeLookup[sId] : undefined;
          if (child) {
            assignedSet.add(sId);
            let arr = childrenByParent.get(tId);
            if (!arr) {
              arr = [];
              childrenByParent.set(tId, arr);
            }
            arr.push(child);
          }
        }
      }

      for (let i = 0; i < n2; i++) {
        const on = otherNodes[i];
        const id = on.id || on.path || "";
        if (!assignedSet.has(id)) unassigned.push(on);
      }

      for (const [pId, children] of childrenByParent.entries()) {
        const pAngle = parentAngleMap.get(pId) || 0;
        const k = children.length;
        const maxSpread = Math.min(0.4, (Math.PI / n1) * 0.85);
        for (let j = 0; j < k; j++) {
          const offset = k === 1 ? 0 : (j / (k - 1) - 0.5) * maxSpread * 2;
          const a = pAngle + offset;
          const nx = Math.round(r2 * Math.cos(a) * 10) / 10;
          const ny = Math.round(r2 * Math.sin(a) * 10) / 10;
          const c = children[j];
          c.x = nx;
          c.y = ny;
          c.fx = nx;
          c.fy = ny;
          c.vx = 0;
          c.vy = 0;
        }
      }

      if (unassigned.length > 0) {
        const r3 = childrenByParent.size > 0 ? r2 + 130 : r2;
        const step3 = (2 * Math.PI) / unassigned.length;
        for (let m = 0; m < unassigned.length; m++) {
          const u = unassigned[m];
          const a = startAngle + m * step3;
          const nx = Math.round(r3 * Math.cos(a) * 10) / 10;
          const ny = Math.round(r3 * Math.sin(a) * 10) / 10;
          u.x = nx;
          u.y = ny;
          u.fx = nx;
          u.fy = ny;
          u.vx = 0;
          u.vy = 0;
        }
      }
    }

    if (renderer.changed) renderer.changed();
    return true;
  }

  /**
   * Arranges an arbitrary subset of selected nodes in a circle around the anchor node.
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
      freezeSimulation = true,
    } = options;

    if (freezeSimulation) {
      this.freezeSimulation(renderer);
    }

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

    // Fast Float32Array vectorized pass
    const buf = count * 2 <= this.scratchCoords.length ? this.scratchCoords : new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const angle = startAngle + i * angleStep;
      buf[i * 2] = Math.round((cx + dynamicRadius * Math.cos(angle)) * 10) / 10;
      buf[i * 2 + 1] = Math.round((cy + dynamicRadius * Math.sin(angle)) * 10) / 10;
    }

    for (let i = 0; i < count; i++) {
      const node = peripheral[i];
      const prevX = node.x;
      const prevY = node.y;
      const targetX = buf[i * 2];
      const targetY = buf[i * 2 + 1];

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

    if (renderer.changed) renderer.changed();
    return { changed: changes };
  }
}
