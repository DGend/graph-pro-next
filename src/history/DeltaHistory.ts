import { GraphNode, GraphRenderer } from "../types";
import { NodePositionChange } from "../layout/AlignmentEngine";
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

  public undo(renderer: GraphRenderer): boolean {
    const action = this.undoStack.pop();
    if (!action || !renderer || !renderer.nodeLookup) return false;

    const updatedNodes: GraphNode[] = [];
    for (const change of action) {
      const node = renderer.nodeLookup[change.id];
      if (node) {
        node.x = change.prevX;
        node.y = change.prevY;
        if (node.fx != null) node.fx = change.prevX;
        if (node.fy != null) node.fy = change.prevY;
        updatedNodes.push(node);
      }
    }

    this.redoStack.push(action);
    CircularLayoutEngine.syncNodesToWorker(renderer, updatedNodes, true);
    if (renderer.changed) renderer.changed();
    return true;
  }

  public redo(renderer: GraphRenderer): boolean {
    const action = this.redoStack.pop();
    if (!action || !renderer || !renderer.nodeLookup) return false;

    const updatedNodes: GraphNode[] = [];
    for (const change of action) {
      const node = renderer.nodeLookup[change.id];
      if (node) {
        node.x = change.newX;
        node.y = change.newY;
        if (node.fx != null) node.fx = change.newX;
        if (node.fy != null) node.fy = change.newY;
        updatedNodes.push(node);
      }
    }

    this.undoStack.push(action);
    CircularLayoutEngine.syncNodesToWorker(renderer, updatedNodes, true);
    if (renderer.changed) renderer.changed();
    return true;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
