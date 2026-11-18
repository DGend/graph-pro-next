import { GraphNode, GraphRenderer, NodePositionChange } from "../types";

export interface CircleLayoutOptions {
  centerNodeId?: string;
  baseRadius?: number;
  spacingPerNode?: number;
  lockPositions?: boolean;
  startAngle?: number;
  endAngle?: number;
}

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
   * Hooks the renderer's worker message stream once so that any node with
   * `_pinnedX / _pinnedY` set by our layout engines is never overwritten by
   * Obsidian's background D3 force worker.
   */
  public static ensureRendererPinHook(renderer: GraphRenderer): void {
    if (!renderer || renderer._graphProHooked) return;
    renderer._graphProHooked = true;

    const enforcePins = () => {
      const nodes = renderer.nodes;
      if (!nodes) return;
      for (let i = 0, len = nodes.length; i < len; i++) {
        const n = nodes[i];
        if (n._pinnedX !== undefined && n._pinnedY !== undefined) {
          n.x = n._pinnedX;
          n.y = n._pinnedY;
          n.fx = n._pinnedX;
          n.fy = n._pinnedY;
        }
      }
    };

    if (renderer.worker && typeof renderer.worker.addEventListener === "function") {
      renderer.worker.addEventListener("message", () => {
        enforcePins();
      });
    }

    if (typeof renderer.changed === "function") {
      const origChanged = renderer.changed.bind(renderer);
      renderer.changed = () => {
        enforcePins();
        return origChanged();
      };
    }
  }

  public static applyPin(node: GraphNode, targetX: number, targetY: number, lock = true): NodePositionChange {
    const change: NodePositionChange = {
      id: node.id,
      prevX: node.x,
      prevY: node.y,
      prevPinnedX: node._pinnedX,
      prevPinnedY: node._pinnedY,
      newX: targetX,
      newY: targetY,
      newPinnedX: lock ? targetX : undefined,
      newPinnedY: lock ? targetY : undefined,
    };

    node.x = targetX;
    node.y = targetY;
    node.vx = 0;
    node.vy = 0;

    if (lock) {
      node.fx = targetX;
      node.fy = targetY;
      node._pinnedX = targetX;
      node._pinnedY = targetY;
    } else {
      node.fx = null;
      node.fy = null;
      node._pinnedX = undefined;
      node._pinnedY = undefined;
    }

    return change;
  }

  public static syncNodesToWorker(renderer: GraphRenderer, nodes: GraphNode[], lock: boolean): void {
    this.ensureRendererPinHook(renderer);
    try {
      const worker = renderer.worker;
      if (!worker) return;

      const limit = Math.min(nodes.length, 80);
      for (let i = 0; i < limit; i++) {
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

      worker.postMessage({
        run: true,
        alpha: lock ? 0.0015 : 0.3,
        alphaTarget: 0,
      });
    } catch (_) {}
  }

  public static releaseAllLocks(renderer: GraphRenderer): NodePositionChange[] {
    const allNodes = renderer.nodes || [];
    const changes: NodePositionChange[] = [];
    const released: GraphNode[] = [];

    for (let i = 0, len = allNodes.length; i < len; i++) {
      const n = allNodes[i];
      if (n._pinnedX !== undefined || n.fx != null || n.fy != null) {
        changes.push({
          id: n.id,
          prevX: n.x,
          prevY: n.y,
          prevPinnedX: n._pinnedX,
          prevPinnedY: n._pinnedY,
          newX: n.x,
          newY: n.y,
          newPinnedX: undefined,
          newPinnedY: undefined,
        });
        n._pinnedX = undefined;
        n._pinnedY = undefined;
        n.fx = null;
        n.fy = null;
        released.push(n);
      }
    }

    if (released.length > 0) {
      this.syncNodesToWorker(renderer, released, false);
    } else if (renderer.worker) {
      try {
        renderer.worker.postMessage({ run: true, alpha: 0.3, alphaTarget: 0 });
      } catch (_) {}
    }

    if (renderer.changed) renderer.changed();
    return changes;
  }

  private static getNodeId(val: any): string {
    if (!val) return "";
    if (typeof val === "string") return val;
    return val.id || val.path || "";
  }

  /**
   * Resolves target nodes for layout actions (`수평`, `수직`, `그리드`, `선택원형`).
   * If user has selected >= 2 nodes, returns those.
   * Otherwise automatically returns the active page + its connected 1-hop neighbors!
   */
  public static resolveTargetNodes(
    renderer: GraphRenderer,
    selectedNodes: GraphNode[],
    activeFilePath: string | null,
    viewType: string
  ): GraphNode[] {
    if (selectedNodes && selectedNodes.length >= 2) {
      return selectedNodes;
    }

    const allNodes = renderer.nodes || [];
    if (allNodes.length === 0) return [];

    if (viewType === "localgraph" && allNodes.length <= 120) {
      return [...allNodes];
    }

    if (activeFilePath) {
      const centerNode = renderer.nodeLookup
        ? renderer.nodeLookup[activeFilePath]
        : allNodes.find((n) => (n.id || n.path) === activeFilePath);
      if (centerNode) {
        const clean = this.getCleanNeighborhood(renderer, centerNode, activeFilePath, 60);
        if (clean.length >= 2) return clean;
      }
    }

    return allNodes.slice(0, Math.min(allNodes.length, 40));
  }

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
      if (!centerIsHub && isSuperHubPath(id)) return;
      seen.add(id);
      const target = renderer.nodeLookup ? renderer.nodeLookup[id] : undefined;
      if (target) neighbors.push(target);
    };

    const fwd = centerNode.forward;
    const rev = centerNode.reverse;
    if (fwd && typeof fwd === "object") {
      for (const k of Object.keys(fwd)) {
        if (neighbors.length >= maxNeighbors) break;
        addById(k);
      }
    }
    if (rev && typeof rev === "object") {
      for (const k of Object.keys(rev)) {
        if (neighbors.length >= maxNeighbors) break;
        addById(k);
      }
    }

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

  public static arrangeLocalGraphConcentric(
    renderer: GraphRenderer,
    centerFilePath: string,
    baseRadius = 175,
    lockPositions = true
  ): NodePositionChange[] {
    this.ensureRendererPinHook(renderer);
    const allNodes = renderer.nodes;
    if (!allNodes || allNodes.length === 0) return [];

    const centerNode = renderer.nodeLookup
      ? renderer.nodeLookup[centerFilePath]
      : allNodes.find((n) => (n.id || n.path) === centerFilePath);

    if (!centerNode) return [];

    if (!lockPositions) {
      return this.releaseAllLocks(renderer);
    }

    const changes: NodePositionChange[] = [];

    if (allNodes.length > 150) {
      changes.push(this.applyPin(centerNode, 0, 0, true));
      this.syncNodesToWorker(renderer, [centerNode], true);
      if (renderer.changed) renderer.changed();
      return changes;
    }

    changes.push(this.applyPin(centerNode, 0, 0, true));

    if (allNodes.length === 1) {
      this.syncNodesToWorker(renderer, [centerNode], true);
      if (renderer.changed) renderer.changed();
      return changes;
    }

    const centerId = centerNode.id || centerNode.path || centerFilePath;
    const directSet = new Set<string>();

    if (centerNode.forward && typeof centerNode.forward === "object") {
      for (const k of Object.keys(centerNode.forward)) directSet.add(k);
    }
    if (centerNode.reverse && typeof centerNode.reverse === "object") {
      for (const k of Object.keys(centerNode.reverse)) directSet.add(k);
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
        const angle = startAngle + i * step1;
        const nx = Math.round(r1 * Math.cos(angle) * 10) / 10;
        const ny = Math.round(r1 * Math.sin(angle) * 10) / 10;
        changes.push(this.applyPin(ring1[i], nx, ny, true));
      }
    }

    const n2 = ring2.length;
    if (n2 > 0) {
      const r2 = r1 + 145;
      const step2 = (2 * Math.PI) / n2;
      for (let j = 0; j < n2; j++) {
        const angle = startAngle + j * step2;
        const nx = Math.round(r2 * Math.cos(angle) * 10) / 10;
        const ny = Math.round(r2 * Math.sin(angle) * 10) / 10;
        changes.push(this.applyPin(ring2[j], nx, ny, true));
      }
    }

    this.syncNodesToWorker(renderer, allNodes, true);
    if (renderer.changed) renderer.changed();
    return changes;
  }

  public static arrangeInCircle(
    renderer: GraphRenderer,
    nodesToArrange: GraphNode[],
    options: CircleLayoutOptions = {}
  ): { changed: NodePositionChange[] } {
    this.ensureRendererPinHook(renderer);
    if (!renderer || !nodesToArrange || nodesToArrange.length <= 1) {
      return { changed: [] };
    }

    const {
      centerNodeId,
      baseRadius = 180,
      spacingPerNode = 55,
      lockPositions = true,
      startAngle = -Math.PI / 2,
      endAngle = startAngle + 2 * Math.PI,
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
    changes.push(this.applyPin(centerNode, cx, cy, lockPositions));

    const peripheral = nodesToArrange.filter((n) => n !== centerNode);
    const count = peripheral.length;
    if (count === 0) return { changed: changes };

    const totalArc = Math.abs(endAngle - startAngle);
    const isFullCircle = Math.abs(totalArc - 2 * Math.PI) < 0.01;
    const dynamicRadius = Math.max(baseRadius, Math.round((count * spacingPerNode) / totalArc));
    const angleStep = isFullCircle ? totalArc / count : count === 1 ? 0 : totalArc / (count - 1);

    for (let i = 0; i < count; i++) {
      const node = peripheral[i];
      const angle = count === 1 && !isFullCircle ? (startAngle + endAngle) / 2 : startAngle + i * angleStep;
      const targetX = Math.round((cx + dynamicRadius * Math.cos(angle)) * 10) / 10;
      const targetY = Math.round((cy + dynamicRadius * Math.sin(angle)) * 10) / 10;
      changes.push(this.applyPin(node, targetX, targetY, lockPositions));
    }

    this.syncNodesToWorker(renderer, nodesToArrange, lockPositions);
    if (renderer.changed) renderer.changed();
    return { changed: changes };
  }
}
