import { GraphNode, GraphRenderer, NodePositionChange } from "../types";
import { CircularLayoutEngine, isMassLedgerPath, isTagNode } from "../layout/CircularLayout";

export class LinkExpansionEngine {
  private static getNodeId(val: any): string {
    if (!val) return "";
    if (typeof val === "string") return val;
    return val.id || val.path || "";
  }

  private static getBaseName(pathOrId: string): string {
    if (!pathOrId) return "";
    const base = pathOrId.split("/").pop() || pathOrId;
    return base.replace(/\.md$/i, "").trim();
  }

  private static resolveBaseNodes(
    renderer: GraphRenderer,
    selectedNodes: GraphNode[],
    activeFilePath: string | null
  ): GraphNode[] {
    if (selectedNodes && selectedNodes.length > 0) return selectedNodes;
    const allNodes = renderer.nodes || [];
    if (activeFilePath) {
      const center = CircularLayoutEngine.findCenterNode(renderer, activeFilePath);
      if (center) return [center];
    }
    return allNodes.length > 0 ? [allNodes[0]] : [];
  }

  public static selectAndArrangeBacklinks(
    renderer: GraphRenderer,
    selectedNodes: GraphNode[],
    activeFilePath: string | null,
    resolvedLinks?: Record<string, Record<string, number>>
  ): { nodes: GraphNode[]; changes: NodePositionChange[] } {
    if (!renderer) return { nodes: [], changes: [] };

    const baseNodes = this.resolveBaseNodes(renderer, selectedNodes, activeFilePath);
    if (baseNodes.length === 0) return { nodes: [], changes: [] };

    const anchor = baseNodes[0];
    const anchorId = anchor.id || anchor.path || activeFilePath || "";
    const anchorBase = this.getBaseName(anchorId);

    const baseIds = new Set(baseNodes.map((n) => n.id || n.path || ""));
    const baseBases = new Set(baseNodes.map((n) => this.getBaseName(n.id || n.path || "")));
    const backlinkBases = new Set<string>();

    for (const b of baseNodes) {
      if (b.reverse && typeof b.reverse === "object") {
        for (const srcId of Object.keys(b.reverse)) {
          if (!baseIds.has(srcId) && !isMassLedgerPath(srcId) && !isTagNode(srcId)) {
            backlinkBases.add(this.getBaseName(srcId));
          }
        }
      }
    }

    const links = renderer.links || [];
    for (let i = 0, len = links.length; i < len; i++) {
      const l = links[i];
      const sId = this.getNodeId(l.source);
      const tId = this.getNodeId(l.target);
      const sBase = this.getBaseName(sId);
      const tBase = this.getBaseName(tId);
      if ((baseIds.has(tId) || baseBases.has(tBase)) && sId && !baseIds.has(sId) && !baseBases.has(sBase)) {
        if (!isMassLedgerPath(sId) && !isTagNode(sId)) {
          backlinkBases.add(sBase);
        }
      }
    }

    if (resolvedLinks) {
      for (const [srcPath, targets] of Object.entries(resolvedLinks)) {
        if (isMassLedgerPath(srcPath)) continue;
        for (const tPath of Object.keys(targets)) {
          if (baseIds.has(tPath) || baseBases.has(this.getBaseName(tPath)) || this.getBaseName(tPath) === anchorBase) {
            const sBase = this.getBaseName(srcPath);
            if (!baseBases.has(sBase)) backlinkBases.add(sBase);
          }
        }
      }
    }

    const allNodes = renderer.nodes || [];
    const backlinkNodes = allNodes.filter((n) => {
      if (isTagNode(n)) return false;
      const b = this.getBaseName(n.id || n.path || "");
      return backlinkBases.has(b);
    });

    if (backlinkNodes.length === 0) {
      return { nodes: baseNodes, changes: [] };
    }

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

  public static selectAndArrangeOutgoingLinks(
    renderer: GraphRenderer,
    selectedNodes: GraphNode[],
    activeFilePath: string | null,
    resolvedLinks?: Record<string, Record<string, number>>
  ): { nodes: GraphNode[]; changes: NodePositionChange[] } {
    if (!renderer) return { nodes: [], changes: [] };

    const baseNodes = this.resolveBaseNodes(renderer, selectedNodes, activeFilePath);
    if (baseNodes.length === 0) return { nodes: [], changes: [] };

    const anchor = baseNodes[0];
    const anchorId = anchor.id || anchor.path || activeFilePath || "";

    const baseIds = new Set(baseNodes.map((n) => n.id || n.path || ""));
    const baseBases = new Set(baseNodes.map((n) => this.getBaseName(n.id || n.path || "")));
    const outgoingBases = new Set<string>();

    for (const b of baseNodes) {
      if (b.forward && typeof b.forward === "object") {
        for (const dstId of Object.keys(b.forward)) {
          if (!baseIds.has(dstId) && !isMassLedgerPath(dstId) && !isTagNode(dstId)) {
            outgoingBases.add(this.getBaseName(dstId));
          }
        }
      }
    }

    const links = renderer.links || [];
    for (let i = 0, len = links.length; i < len; i++) {
      const l = links[i];
      const sId = this.getNodeId(l.source);
      const tId = this.getNodeId(l.target);
      const sBase = this.getBaseName(sId);
      const tBase = this.getBaseName(tId);
      if ((baseIds.has(sId) || baseBases.has(sBase)) && tId && !baseIds.has(tId) && !baseBases.has(tBase)) {
        if (!isMassLedgerPath(tId) && !isTagNode(tId)) {
          outgoingBases.add(tBase);
        }
      }
    }

    if (resolvedLinks && activeFilePath && resolvedLinks[activeFilePath]) {
      for (const dstPath of Object.keys(resolvedLinks[activeFilePath])) {
        if (!isMassLedgerPath(dstPath)) {
          const dBase = this.getBaseName(dstPath);
          if (!baseBases.has(dBase)) outgoingBases.add(dBase);
        }
      }
    }

    const allNodes = renderer.nodes || [];
    const outgoingNodes = allNodes.filter((n) => {
      if (isTagNode(n)) return false;
      const b = this.getBaseName(n.id || n.path || "");
      return outgoingBases.has(b);
    });

    if (outgoingNodes.length === 0) {
      return { nodes: baseNodes, changes: [] };
    }

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
