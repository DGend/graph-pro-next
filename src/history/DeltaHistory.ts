import { GraphNode, GraphRenderer, NodePositionChange } from "../types";
import { CircularLayoutEngine } from "../layout/CircularLayout";

export class DeltaHistoryManager {
  private undoStack: NodePositionChange[][] = [];
  private redoStack: NodePositionChange[][] = [];
  private maxDepth: number;

  constructor(maxDepth = 30) {
    this.maxDepth = maxDepth;
  }

  public recordChange(changes: NodePositionChange[]): void {
    if (!changes || changes.length === 0) return;
    this.undoStack.push(changes);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public getUndoCount(): number {
    return this.undoStack.length;
  }

  public undo(renderer: GraphRenderer): boolean {
    const action = this.undoStack.pop();
    if (!action || !renderer) return false;

    const allNodes = renderer.nodes || [];
    const updatedNodes: GraphNode[] = [];

    for (const change of action) {
      const node = renderer.nodeLookup
        ? renderer.nodeLookup[change.id]
        : allNodes.find((n) => (n.id || n.path) === change.id);
      if (node) {
        node.x = change.prevX;
        node.y = change.prevY;
        node._pinnedX = change.prevPinnedX;
        node._pinnedY = change.prevPinnedY;
        node.fx = change.prevPinnedX !== undefined ? change.prevPinnedX : null;
        node.fy = change.prevPinnedY !== undefined ? change.prevPinnedY : null;
        updatedNodes.push(node);
      }
    }

    this.redoStack.push(action);
    const hasLocked = updatedNodes.some((n) => n._pinnedX !== undefined);
    CircularLayoutEngine.syncNodesToWorker(renderer, updatedNodes, hasLocked);
    if (renderer.changed) renderer.changed();
    return true;
  }

  public redo(renderer: GraphRenderer): boolean {
    const action = this.redoStack.pop();
    if (!action || !renderer) return false;

    const allNodes = renderer.nodes || [];
    const updatedNodes: GraphNode[] = [];

    for (const change of action) {
      const node = renderer.nodeLookup
        ? renderer.nodeLookup[change.id]
        : allNodes.find((n) => (n.id || n.path) === change.id);
      if (node) {
        node.x = change.newX;
        node.y = change.newY;
        node._pinnedX = change.newPinnedX;
        node._pinnedY = change.newPinnedY;
        node.fx = change.newPinnedX !== undefined ? change.newPinnedX : null;
        node.fy = change.newPinnedY !== undefined ? change.newPinnedY : null;
        updatedNodes.push(node);
      }
    }

    this.undoStack.push(action);
    const hasLocked = updatedNodes.some((n) => n._pinnedX !== undefined);
    CircularLayoutEngine.syncNodesToWorker(renderer, updatedNodes, hasLocked);
    if (renderer.changed) renderer.changed();
    return true;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
