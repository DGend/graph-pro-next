import { GraphNode, GraphRenderer, NodePositionChange } from "../types";
import { CircularLayoutEngine, isSuperHubPath } from "../layout/CircularLayout";

export class LinkExpansionEngine {
  private static getNodeId(val: any): string {
    if (!val) return "";
    if (typeof val === "string") return val;
    return val.id || val.path || "";
  }

  private static resolveBaseNodes(
    renderer: GraphRenderer,
    selectedNodes: GraphNode[],
    activeFilePath: string | null
  ): GraphNode[] {
    if (selectedNodes && selectedNodes.length > 0) return selectedNodes;
    const allNodes = renderer.nodes || [];
    if (activeFilePath) {
      const center = renderer.nodeLookup
        ? renderer.nodeLookup[activeFilePath]
        : allNodes.find((n) => (n.id || n.path) === activeFilePath);
      if (center) return [center];
    }
    return allNodes.length > 0 ? [allNodes[0]] : [];
  }

  /**
   * Finds all incoming backlinks pointing TO the base node(s), selects them,
   * and arranges them on a Left Semicircle Arc around the anchor node.
   */
  public static selectAndArrangeBacklinks(
    renderer: GraphRenderer,
    selectedNodes: GraphNode[],
    activeFilePath: string | null
  ): { nodes: GraphNode[]; changes: NodePositionChange[] } {
    if (!renderer) return { nodes: [], changes: [] };

    const baseNodes = this.resolveBaseNodes(renderer, selectedNodes, activeFilePath);
    if (baseNodes.length === 0) return { nodes: [], changes: [] };

    const anchor = baseNodes[0];
    const anchorId = anchor.id || anchor.path || activeFilePath || "";
    const anchorIsHub = isSuperHubPath(anchorId);

    const baseIds = new Set(baseNodes.map((n) => n.id || n.path || ""));
    const backlinkIds = new Set<string>();

    // 1. Check node.reverse dictionary on baseNodes
    for (const b of baseNodes) {
      if (b.reverse && typeof b.reverse === "object") {
        for (const srcId of Object.keys(b.reverse)) {
          if (!baseIds.has(srcId) && (anchorIsHub || !isSuperHubPath(srcId))) {
            backlinkIds.add(srcId);
          }
        }
      }
    }

    // 2. Also check renderer.links
    const links = renderer.links || [];
    for (let i = 0, len = links.length; i < len; i++) {
      const l = links[i];
      const sId = this.getNodeId(l.source);
      const tId = this.getNodeId(l.target);
      if (tId && baseIds.has(tId) && sId && !baseIds.has(sId)) {
        if (anchorIsHub || !isSuperHubPath(sId)) {
          backlinkIds.add(sId);
        }
      }
    }

    const allNodes = renderer.nodes || [];
    const backlinkNodes = allNodes.filter((n) => backlinkIds.has(n.id || n.path || ""));

    if (backlinkNodes.length === 0) {
      return { nodes: baseNodes, changes: [] };
    }

    // Arrange backlinks on the Left Arc (110 deg to 250 deg) around anchor
    const group = [anchor, ...backlinkNodes];
    const res = CircularLayoutEngine.arrangeInCircle(renderer, group, {
      centerNodeId: anchorId,
      baseRadius: 185,
      spacingPerNode: 58,
      lockPositions: true,
      startAngle: (110 * Math.PI) / 180,
      endAngle: (250 * Math.PI) / 180,
    });

    return { nodes: group, changes: res.changed };
  }

  /**
   * Finds all outgoing forward links FROM the base node(s), selects them,
   * and arranges them on a Right Semicircle Arc around the anchor node.
   */
  public static selectAndArrangeOutgoingLinks(
    renderer: GraphRenderer,
    selectedNodes: GraphNode[],
    activeFilePath: string | null
  ): { nodes: GraphNode[]; changes: NodePositionChange[] } {
    if (!renderer) return { nodes: [], changes: [] };

    const baseNodes = this.resolveBaseNodes(renderer, selectedNodes, activeFilePath);
    if (baseNodes.length === 0) return { nodes: [], changes: [] };

    const anchor = baseNodes[0];
    const anchorId = anchor.id || anchor.path || activeFilePath || "";
    const anchorIsHub = isSuperHubPath(anchorId);

    const baseIds = new Set(baseNodes.map((n) => n.id || n.path || ""));
    const outgoingIds = new Set<string>();

    // 1. Check node.forward dictionary on baseNodes
    for (const b of baseNodes) {
      if (b.forward && typeof b.forward === "object") {
        for (const dstId of Object.keys(b.forward)) {
          if (!baseIds.has(dstId) && (anchorIsHub || !isSuperHubPath(dstId))) {
            outgoingIds.add(dstId);
          }
        }
      }
    }

    // 2. Also check renderer.links
    const links = renderer.links || [];
    for (let i = 0, len = links.length; i < len; i++) {
      const l = links[i];
      const sId = this.getNodeId(l.source);
      const tId = this.getNodeId(l.target);
      if (sId && baseIds.has(sId) && tId && !baseIds.has(tId)) {
        if (anchorIsHub || !isSuperHubPath(tId)) {
          outgoingIds.add(tId);
        }
      }
    }

    const allNodes = renderer.nodes || [];
    const outgoingNodes = allNodes.filter((n) => outgoingIds.has(n.id || n.path || ""));

    if (outgoingNodes.length === 0) {
      return { nodes: baseNodes, changes: [] };
    }

    // Arrange outgoing links on the Right Arc (-70 deg to +70 deg) around anchor
    const group = [anchor, ...outgoingNodes];
    const res = CircularLayoutEngine.arrangeInCircle(renderer, group, {
      centerNodeId: anchorId,
      baseRadius: 185,
      spacingPerNode: 58,
      lockPositions: true,
      startAngle: (-70 * Math.PI) / 180,
      endAngle: (70 * Math.PI) / 180,
    });

    return { nodes: group, changes: res.changed };
  }
}
