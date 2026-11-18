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

export function isTagNode(nodeOrId: GraphNode | string): boolean {
  if (typeof nodeOrId === "string") {
    return nodeOrId.startsWith("#");
  }
  return nodeOrId.type === "tag" || (nodeOrId.id || "").startsWith("#");
}

export class CircularLayoutEngine {
  /**
   * Hooks renderer's renderCallback, changed, and worker messages so that:
   * 1) Pinned coordinates (`_pinnedX, _pinnedY`) are never overwritten by D3 worker.
   * 2) Hop visibility filtering (`_hopVisible`, `_linkVisible`) is strictly enforced
   *    before every WebGL frame draw so out-of-hop pages NEVER appear on screen.
   */
  public static ensureRendererPinHook(renderer: GraphRenderer): void {
    if (!renderer || renderer._graphProHooked) return;
    renderer._graphProHooked = true;

    const enforcePinsAndVisibility = () => {
      const nodes = renderer.nodes;
      if (!nodes) return;
      const filterActive = Boolean(renderer._hopFilterActive);

      for (let i = 0, len = nodes.length; i < len; i++) {
        const n = nodes[i];
        if (n._pinnedX !== undefined && n._pinnedY !== undefined) {
          n.x = n._pinnedX;
          n.y = n._pinnedY;
          n.fx = n._pinnedX;
          n.fy = n._pinnedY;
        }
        if (filterActive && n._hopVisible !== undefined) {
          const vis = n._hopVisible;
          if (n.circle) {
            n.circle.visible = vis;
            n.circle.renderable = vis;
          }
          if (n.text) {
            n.text.visible = vis;
            n.text.renderable = vis;
          }
        }
      }

      if (filterActive && renderer.links) {
        const links = renderer.links;
        for (let i = 0, len = links.length; i < len; i++) {
          const l = links[i];
          if (l._linkVisible !== undefined) {
            const lVis = l._linkVisible;
            if (l.line) {
              l.line.visible = lVis;
              l.line.renderable = lVis;
            }
            if (l.px) {
              l.px.visible = lVis;
              l.px.renderable = lVis;
            }
            if (l.arrow) {
              l.arrow.visible = lVis;
              l.arrow.renderable = lVis;
            }
          }
        }
      }
    };

    if (renderer.worker && typeof renderer.worker.addEventListener === "function") {
      renderer.worker.addEventListener("message", () => {
        enforcePinsAndVisibility();
      });
    }

    if (typeof renderer.renderCallback === "function") {
      const origRenderCb = renderer.renderCallback.bind(renderer);
      renderer.renderCallback = (...args: any[]) => {
        enforcePinsAndVisibility();
        const res = origRenderCb(...args);
        enforcePinsAndVisibility();
        return res;
      };
    }

    if (renderer.px?.renderer?.on) {
      renderer.px.renderer.on("prerender", () => {
        enforcePinsAndVisibility();
      });
    }

    if (typeof renderer.changed === "function") {
      const origChanged = renderer.changed.bind(renderer);
      renderer.changed = () => {
        enforcePinsAndVisibility();
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

      const limit = Math.min(nodes.length, 100);
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

  public static showAllNodes(renderer: GraphRenderer): void {
    renderer._hopFilterActive = false;
    const nodes = renderer.nodes || [];
    for (let i = 0, len = nodes.length; i < len; i++) {
      const n = nodes[i];
      n._hopVisible = true;
      if (n.circle) {
        n.circle.visible = true;
        n.circle.renderable = true;
      }
      if (n.text) {
        n.text.visible = true;
        n.text.renderable = true;
      }
    }
    const links = renderer.links || [];
    for (let i = 0, len = links.length; i < len; i++) {
      const l = links[i];
      l._linkVisible = true;
      if (l.line) {
        l.line.visible = true;
        l.line.renderable = true;
      }
      if (l.px) {
        l.px.visible = true;
        l.px.renderable = true;
      }
      if (l.arrow) {
        l.arrow.visible = true;
        l.arrow.renderable = true;
      }
    }
    if (renderer.changed) renderer.changed();
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
   * Only operates on currently visible (`_hopVisible !== false`) nodes!
   */
  public static resolveTargetNodes(
    renderer: GraphRenderer,
    selectedNodes: GraphNode[],
    activeFilePath: string | null,
    _viewType: string
  ): GraphNode[] {
    if (selectedNodes && selectedNodes.length >= 2) {
      return selectedNodes;
    }

    const allNodes = renderer.nodes || [];
    if (allNodes.length === 0) return [];

    // If hop filter is active, return all currently visible hop nodes
    if (renderer._hopFilterActive) {
      const visible = allNodes.filter((n) => n._hopVisible === true);
      if (visible.length >= 2) return visible;
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

    return allNodes.filter((n) => !isTagNode(n)).slice(0, Math.min(allNodes.length, 40));
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
      if (!id || seen.has(id) || isTagNode(id)) return;
      if (!centerIsHub && isSuperHubPath(id)) return;
      seen.add(id);
      const target = renderer.nodeLookup ? renderer.nodeLookup[id] : undefined;
      if (target && !isTagNode(target)) neighbors.push(target);
    };

    if (centerNode.forward && typeof centerNode.forward === "object") {
      for (const k of Object.keys(centerNode.forward)) {
        if (neighbors.length >= maxNeighbors) break;
        addById(k);
      }
    }
    if (centerNode.reverse && typeof centerNode.reverse === "object") {
      for (const k of Object.keys(centerNode.reverse)) {
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

  /**
   * Strict BFS Hop Filtering & Multi-Ring Concentric Layout (1홉 / 2홉 / 3홉 / 전체).
   * - Hop 1 (`maxHop = 1`): ONLY shows current page + 1-hop directly connected pages on Ring 1!
   * - Hop 2 (`maxHop = 2`): Shows current page + Ring 1 (1-hop) + Ring 2 (2-hop)!
   * - Hop 3 (`maxHop = 3`): Shows current page + Ring 1 (1-hop) + Ring 2 (2-hop) + Ring 3 (3-hop)!
   * - All other pages (> maxHop, unconnected pages, tag pseudo-nodes, master ledgers) are HIDDEN!
   */
  public static arrangeAndFilterByHopDepth(
    renderer: GraphRenderer,
    centerFilePath: string,
    maxHop: number,
    baseRadius = 175,
    lockPositions = true
  ): { changes: NodePositionChange[]; visibleNodes: GraphNode[] } {
    this.ensureRendererPinHook(renderer);
    const allNodes = renderer.nodes;
    if (!allNodes || allNodes.length === 0) return { changes: [], visibleNodes: [] };

    if (maxHop <= 0) {
      this.showAllNodes(renderer);
      return { changes: [], visibleNodes: allNodes };
    }

    const centerNode = renderer.nodeLookup
      ? renderer.nodeLookup[centerFilePath]
      : allNodes.find((n) => (n.id || n.path) === centerFilePath);

    if (!centerNode) return { changes: [], visibleNodes: [] };

    const centerId = centerNode.id || centerNode.path || centerFilePath;
    const centerIsHub = isSuperHubPath(centerId);

    // 1. Build fast adjacency map across renderer nodes (excluding tags & global ledgers)
    const adj = new Map<string, Set<string>>();
    const nodeById = new Map<string, GraphNode>();

    for (let i = 0, len = allNodes.length; i < len; i++) {
      const n = allNodes[i];
      const id = n.id || n.path || "";
      if (!id) continue;
      nodeById.set(id, n);
      if (id !== centerId && (isTagNode(n) || (!centerIsHub && isSuperHubPath(id)))) {
        continue;
      }
      adj.set(id, new Set<string>());
    }

    const addEdge = (a: string, b: string) => {
      if (!a || !b || a === b) return;
      const setA = adj.get(a);
      const setB = adj.get(b);
      if (setA && setB) {
        setA.add(b);
        setB.add(a);
      }
    };

    // Populate edges from both node.forward/reverse and renderer.links
    for (const [id, n] of nodeById.entries()) {
      if (!adj.has(id)) continue;
      if (n.forward && typeof n.forward === "object") {
        for (const dst of Object.keys(n.forward)) addEdge(id, dst);
      }
      if (n.reverse && typeof n.reverse === "object") {
        for (const src of Object.keys(n.reverse)) addEdge(id, src);
      }
    }

    const links = renderer.links || [];
    for (let i = 0, len = links.length; i < len; i++) {
      const l = links[i];
      addEdge(this.getNodeId(l.source), this.getNodeId(l.target));
    }

    // 2. Exact BFS from centerId up to maxHop (1, 2, or 3)
    const hopMap = new Map<string, number>();
    const parentMap = new Map<string, string>();
    hopMap.set(centerId, 0);

    const hopRings: GraphNode[][] = [[centerNode], [], [], []]; // Index 0, 1, 2, 3
    let frontier: string[] = [centerId];

    for (let hop = 1; hop <= Math.min(maxHop, 3); hop++) {
      const nextFrontier: string[] = [];
      const maxNodesInRing = hop === 1 ? 80 : hop === 2 ? 100 : 120;

      for (let f = 0; f < frontier.length; f++) {
        const currId = frontier[f];
        // If a 1-hop or 2-hop neighbor is itself a massive Topic Hub (> 40 links), cap expansion per parent
        const neighbors = adj.get(currId);
        if (!neighbors) continue;

        let addedFromParent = 0;
        const maxPerParent = hop === 1 ? 80 : 15;

        for (const nbId of neighbors) {
          if (hopMap.has(nbId)) continue;
          const nbNode = nodeById.get(nbId);
          if (!nbNode) continue;

          hopMap.set(nbId, hop);
          parentMap.set(nbId, currId);
          hopRings[hop].push(nbNode);
          nextFrontier.push(nbId);

          addedFromParent++;
          if (hopRings[hop].length >= maxNodesInRing || addedFromParent >= maxPerParent) break;
        }
        if (hopRings[hop].length >= maxNodesInRing) break;
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    // 3. Strictly Hide all nodes with hop > maxHop (or not in hopMap)
    renderer._hopFilterActive = true;
    const visibleNodes: GraphNode[] = [];

    for (let i = 0, len = allNodes.length; i < len; i++) {
      const n = allNodes[i];
      const id = n.id || n.path || "";
      const hop = hopMap.get(id);
      const isVis = hop !== undefined && hop <= maxHop;

      n._hopVisible = isVis;
      n._hopLevel = hop ?? 99;

      if (isVis) {
        visibleNodes.push(n);
      } else {
        // Release any stale pin on hidden nodes
        n._pinnedX = undefined;
        n._pinnedY = undefined;
        n.fx = null;
        n.fy = null;
      }

      if (n.circle) {
        n.circle.visible = isVis;
        n.circle.renderable = isVis;
      }
      if (n.text) {
        n.text.visible = isVis;
        n.text.renderable = isVis;
      }
    }

    // 4. Strictly Hide all links where either endpoint is hidden or jumps across non-adjacent rings
    for (let i = 0, len = links.length; i < len; i++) {
      const l = links[i];
      const sId = this.getNodeId(l.source);
      const tId = this.getNodeId(l.target);
      const sHop = hopMap.get(sId);
      const tHop = hopMap.get(tId);

      const lVis =
        sHop !== undefined &&
        tHop !== undefined &&
        sHop <= maxHop &&
        tHop <= maxHop;

      l._linkVisible = lVis;
      if (l.line) {
        l.line.visible = lVis;
        l.line.renderable = lVis;
      }
      if (l.px) {
        l.px.visible = lVis;
        l.px.renderable = lVis;
      }
      if (l.arrow) {
        l.arrow.visible = lVis;
        l.arrow.renderable = lVis;
      }
    }

    if (!lockPositions) {
      const released = this.releaseAllLocks(renderer);
      return { changes: released, visibleNodes };
    }

    // 5. Place Hop 0 at Center (0, 0), Hop 1 on Ring 1, Hop 2 on Ring 2, Hop 3 on Ring 3
    const changes: NodePositionChange[] = [];
    changes.push(this.applyPin(centerNode, 0, 0, true));

    const angleByNodeId = new Map<string, number>();
    const startAngle = -Math.PI / 2;

    // Ring 1 (1홉: 직접 연결된 페이지들)
    const ring1 = hopRings[1];
    const n1 = ring1.length;
    const r1 = Math.max(baseRadius, Math.round((Math.max(n1, 1) * 58) / (2 * Math.PI)));

    if (n1 > 0) {
      const step1 = (2 * Math.PI) / n1;
      for (let i = 0; i < n1; i++) {
        const node = ring1[i];
        const id = node.id || node.path || "";
        const angle = startAngle + i * step1;
        angleByNodeId.set(id, angle);

        const nx = Math.round(r1 * Math.cos(angle) * 10) / 10;
        const ny = Math.round(r1 * Math.sin(angle) * 10) / 10;
        changes.push(this.applyPin(node, nx, ny, true));
      }
    }

    // Ring 2 (2홉: 1홉 노드에 연결된 페이지들)
    const ring2 = hopRings[2];
    const n2 = ring2.length;
    const r2 = r1 + 170;

    if (n2 > 0 && maxHop >= 2) {
      // Sort Ring 2 nodes by their Ring 1 parent's angle so edges never cross!
      ring2.sort((a, b) => {
        const pA = parentMap.get(a.id || a.path || "") || "";
        const pB = parentMap.get(b.id || b.path || "") || "";
        return (angleByNodeId.get(pA) ?? 0) - (angleByNodeId.get(pB) ?? 0);
      });

      const step2 = (2 * Math.PI) / n2;
      for (let j = 0; j < n2; j++) {
        const node = ring2[j];
        const id = node.id || node.path || "";
        const pId = parentMap.get(id) || "";
        const pAngle = angleByNodeId.get(pId);
        const angle = n2 <= 4 && pAngle !== undefined
          ? pAngle + (j - (n2 - 1) / 2) * 0.25
          : startAngle + j * step2;

        angleByNodeId.set(id, angle);
        const nx = Math.round(r2 * Math.cos(angle) * 10) / 10;
        const ny = Math.round(r2 * Math.sin(angle) * 10) / 10;
        changes.push(this.applyPin(node, nx, ny, true));
      }
    }

    // Ring 3 (3홉: 2홉 노드에 연결된 페이지들)
    const ring3 = hopRings[3];
    const n3 = ring3.length;
    const r3 = r2 + 170;

    if (n3 > 0 && maxHop >= 3) {
      ring3.sort((a, b) => {
        const pA = parentMap.get(a.id || a.path || "") || "";
        const pB = parentMap.get(b.id || b.path || "") || "";
        return (angleByNodeId.get(pA) ?? 0) - (angleByNodeId.get(pB) ?? 0);
      });

      const step3 = (2 * Math.PI) / n3;
      for (let k = 0; k < n3; k++) {
        const node = ring3[k];
        const angle = startAngle + k * step3;
        const nx = Math.round(r3 * Math.cos(angle) * 10) / 10;
        const ny = Math.round(r3 * Math.sin(angle) * 10) / 10;
        changes.push(this.applyPin(node, nx, ny, true));
      }
    }

    this.syncNodesToWorker(renderer, visibleNodes, true);
    if (renderer.changed) renderer.changed();
    return { changes, visibleNodes };
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
