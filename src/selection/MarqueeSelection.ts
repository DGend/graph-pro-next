import { GraphNode, GraphRenderer } from "../types";

export interface MarqueeCallback {
  onSelectionChanged: (selectedNodes: GraphNode[]) => void;
}

export class MarqueeSelectionManager {
  private containerEl: HTMLElement;
  private renderer: GraphRenderer;
  private callback: MarqueeCallback;
  private selectionBoxEl: HTMLElement | null = null;

  private isSelecting = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;

  private selectedNodeIds = new Set<string>();

  constructor(containerEl: HTMLElement, renderer: GraphRenderer, callback: MarqueeCallback) {
    this.containerEl = containerEl;
    this.renderer = renderer;
    this.callback = callback;
    this.initEvents();
  }

  private initEvents(): void {
    this.containerEl.addEventListener("mousedown", this.onMouseDown, true);
    window.addEventListener("mousemove", this.onMouseMove, true);
    window.addEventListener("mouseup", this.onMouseUp, true);
  }

  public destroy(): void {
    this.containerEl.removeEventListener("mousedown", this.onMouseDown, true);
    window.removeEventListener("mousemove", this.onMouseMove, true);
    window.removeEventListener("mouseup", this.onMouseUp, true);
    this.removeBox();
  }

  private onMouseDown = (evt: MouseEvent): void => {
    // Activate only when Shift is held down
    if (!evt.shiftKey || evt.button !== 0) return;

    const rect = this.containerEl.getBoundingClientRect();
    this.startX = evt.clientX - rect.left;
    this.startY = evt.clientY - rect.top;
    this.currentX = this.startX;
    this.currentY = this.startY;
    this.isSelecting = true;

    if (!evt.altKey) {
      this.selectedNodeIds.clear();
    }

    evt.preventDefault();
    evt.stopPropagation();

    this.createOrUpdateBox();
  };

  private onMouseMove = (evt: MouseEvent): void => {
    if (!this.isSelecting) return;

    const rect = this.containerEl.getBoundingClientRect();
    this.currentX = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
    this.currentY = Math.max(0, Math.min(rect.height, evt.clientY - rect.top));

    this.createOrUpdateBox();
    this.computeEnclosedNodes(evt.altKey);
  };

  private onMouseUp = (evt: MouseEvent): void => {
    if (!this.isSelecting) return;
    this.isSelecting = false;
    this.removeBox();

    // Finalize selection
    const allNodes = this.renderer.nodes || [];
    const selected = allNodes.filter((n) => this.selectedNodeIds.has(n.id));
    this.callback.onSelectionChanged(selected);
  };

  private createOrUpdateBox(): void {
    if (!this.selectionBoxEl) {
      this.selectionBoxEl = document.createElement("div");
      this.selectionBoxEl.className = "graph-pro-next-marquee";
      this.containerEl.appendChild(this.selectionBoxEl);
    }

    const xMin = Math.min(this.startX, this.currentX);
    const xMax = Math.max(this.startX, this.currentX);
    const yMin = Math.min(this.startY, this.currentY);
    const yMax = Math.max(this.startY, this.currentY);

    this.selectionBoxEl.style.left = `${xMin}px`;
    this.selectionBoxEl.style.top = `${yMin}px`;
    this.selectionBoxEl.style.width = `${xMax - xMin}px`;
    this.selectionBoxEl.style.height = `${yMax - yMin}px`;
  }

  private removeBox(): void {
    if (this.selectionBoxEl) {
      this.selectionBoxEl.remove();
      this.selectionBoxEl = null;
    }
  }

  /**
   * Transforms screen selection coordinates into Graph World space ONCE.
   * Compares world coordinates directly with node.x and node.y (Zero Allocations).
   */
  private computeEnclosedNodes(isDeselecting: boolean): void {
    const scale = this.renderer.scale || 1;
    const panX = this.renderer.panX || 0;
    const panY = this.renderer.panY || 0;
    const dpr = window.devicePixelRatio || 1;

    const xMin = Math.min(this.startX, this.currentX);
    const xMax = Math.max(this.startX, this.currentX);
    const yMin = Math.min(this.startY, this.currentY);
    const yMax = Math.max(this.startY, this.currentY);

    // Inverse Matrix Projection: Screen -> Graph World
    const worldXMin = (xMin * dpr - panX) / scale;
    const worldXMax = (xMax * dpr - panX) / scale;
    const worldYMin = (yMin * dpr - panY) / scale;
    const worldYMax = (yMax * dpr - panY) / scale;

    const allNodes = this.renderer.nodes || [];

    for (const node of allNodes) {
      const inside =
        node.x >= worldXMin &&
        node.x <= worldXMax &&
        node.y >= worldYMin &&
        node.y <= worldYMax;

      if (inside) {
        if (isDeselecting) {
          this.selectedNodeIds.delete(node.id);
        } else {
          this.selectedNodeIds.add(node.id);
        }
      }
    }

    const selected = allNodes.filter((n) => this.selectedNodeIds.has(n.id));
    this.callback.onSelectionChanged(selected);
  }

  public getSelectedNodeIds(): Set<string> {
    return this.selectedNodeIds;
  }

  public clearSelection(): void {
    this.selectedNodeIds.clear();
    const allNodes = this.renderer.nodes || [];
    this.callback.onSelectionChanged([]);
  }
}
