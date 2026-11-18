import { GraphNode, GraphRenderer } from "../types";

export class LinkExpansionEngine {
  private static getNodeId(val: any): string | null {
    if (!val) return null;
    if (typeof val === "string") return val;
    return val.id || val.path || null;
  }

  public static selectBacklinks(renderer: GraphRenderer, selectedNodes: GraphNode[]): GraphNode[] {
    if (!renderer || !renderer.links || !selectedNodes || selectedNodes.length === 0) return selectedNodes;

    const selectedIds = new Set(selectedNodes.map((n) => n.id));
    const resultIds = new Set(selectedIds);

    for (const link of renderer.links) {
      const sId = this.getNodeId(link.source);
      const tId = this.getNodeId(link.target);
      if (tId && selectedIds.has(tId) && sId) {
        resultIds.add(sId);
      }
    }

    const allNodes = renderer.nodes || [];
    return allNodes.filter((n) => resultIds.has(n.id));
  }

  public static selectOutgoingLinks(renderer: GraphRenderer, selectedNodes: GraphNode[]): GraphNode[] {
    if (!renderer || !renderer.links || !selectedNodes || selectedNodes.length === 0) return selectedNodes;

    const selectedIds = new Set(selectedNodes.map((n) => n.id));
    const resultIds = new Set(selectedIds);

    for (const link of renderer.links) {
      const sId = this.getNodeId(link.source);
      const tId = this.getNodeId(link.target);
      if (sId && selectedIds.has(sId) && tId) {
        resultIds.add(tId);
      }
    }

    const allNodes = renderer.nodes || [];
    return allNodes.filter((n) => resultIds.has(n.id));
  }

  public static selectRelated(renderer: GraphRenderer, selectedNodes: GraphNode[], depth = 1): GraphNode[] {
    if (!renderer || !renderer.links || !selectedNodes || selectedNodes.length === 0) return selectedNodes;

    const resultIds = new Set(selectedNodes.map((n) => n.id));
    let currentFrontier = new Set(resultIds);

    for (let d = 0; d < depth; d++) {
      const nextFrontier = new Set<string>();
      for (const link of renderer.links) {
        const sId = this.getNodeId(link.source);
        const tId = this.getNodeId(link.target);
        if (sId && currentFrontier.has(sId) && tId && !resultIds.has(tId)) {
          resultIds.add(tId);
          nextFrontier.add(tId);
        }
        if (tId && currentFrontier.has(tId) && sId && !resultIds.has(sId)) {
          resultIds.add(sId);
          nextFrontier.add(sId);
        }
      }
      currentFrontier = nextFrontier;
      if (currentFrontier.size === 0) break;
    }

    const allNodes = renderer.nodes || [];
    return allNodes.filter((n) => resultIds.has(n.id));
  }
}
