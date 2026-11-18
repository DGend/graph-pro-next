import { GraphNode, GraphRenderer } from "../types";

export interface MarqueeCallback {
  onSelectionChanged: (selectedNodes: GraphNode[], isFinal: boolean) => void;
}

export class MarqueeSelectionManager {
  private containerEl: HTMLElement;
  private renderer: GraphRenderer;
  private callback: MarqueeCallback;
  private selectionBoxEl: HTMLElement | null = null;

  private isSelecting = false;
  private isDeselectMode = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;
  private containerRect: DOMRect | null = null;
  private rafId: number | null = null;

  // Flat contiguous Float32Array spatial cache built once per drag start
  private cachedCoords: Float32Array = new Float32Array(0);
  private cachedNodes: GraphNode[] = [];
  private selectedIndices = new Set<number>();
  private lastSelectionHash = -1;

  constructor(containerEl: HTMLElement, renderer: GraphRenderer, callback: MarqueeCallback) {
    this.containerEl = containerEl;
    this.renderer = renderer;
    this.callback = callback;
    this.containerEl.addEventListener("mousedown", this.onMouseDown, true);
  }

  public destroy(): void {
    this.containerEl.removeEventListener("mousedown", this.onMouseDown, true);
    this.detachDragListeners();
    this.removeBox();
  }

  private detachDragListeners(): void {
    window.removeEventListener("mousemove", this.onMouseMove, true);
    window.removeEventListener("mouseup", this.onMouseUp, true);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private onMouseDown = (evt: MouseEvent): void => {
    if (!evt.shiftKey || evt.button !== 0) return;

    this.containerRect = this.containerEl.getBoundingClientRect();
    this.startX = evt.clientX - this.containerRect.left;
    this.startY = evt.clientY - this.containerRect.top;
    this.currentX = this.startX;
    this.currentY = this.startY;
    this.isSelecting = true;
    this.isDeselectMode = evt.altKey;
    this.lastSelectionHash = -1;

    // Build flat Float32Array spatial cache ONCE at drag start
    const nodes = this.renderer.nodes || [];
    const len = nodes.length;
    this.cachedNodes = nodes;
    if (this.cachedCoords.length < len * 2) {
      this.cachedCoords = new Float32Array(len * 2);
    }
    for (let i = 0; i < len; i++) {
      this.cachedCoords[i * 2] = nodes[i].x;
      this.cachedCoords[i * 2 + 1] = nodes[i].y;
    }

    if (!this.isDeselectMode) {
      this.selectedIndices.clear();
    }

    evt.preventDefault();
    evt.stopPropagation();

    this.createOrUpdateBox();

    // Only attach global move/up listeners while actively dragging
    window.addEventListener("mousemove", this.onMouseMove, true);
    window.addEventListener("mouseup", this.onMouseUp, true);
  };

  private onMouseMove = (evt: MouseEvent): void => {
    if (!this.isSelecting || !this.containerRect) return;

    this.currentX = Math.max(0, Math.min(this.containerRect.width, evt.clientX - this.containerRect.left));
    this.currentY = Math.max(0, Math.min(this.containerRect.height, evt.clientY - this.containerRect.top));

    this.createOrUpdateBox();

    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        if (this.isSelecting) {
          this.computeEnclosedNodes(false);
        }
      });
    }
  };

  private onMouseUp = (_evt: MouseEvent): void => {
    if (!this.isSelecting) return;
    this.isSelecting = false;
    this.detachDragListeners();
    this.removeBox();
    this.computeEnclosedNodes(true);
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

    this.selectionBoxEl.style.transform = `translate3d(${xMin}px, ${yMin}px, 0)`;
    this.selectionBoxEl.style.width = `${xMax - xMin}px`;
    this.selectionBoxEl.style.height = `${yMax - yMin}px`;
  }

  private removeBox(): void {
    if (this.selectionBoxEl) {
      this.selectionBoxEl.remove();
      this.selectionBoxEl = null;
    }
  }

  private computeEnclosedNodes(isFinal: boolean): void {
    const scale = this.renderer.scale || 1;
    const panX = this.renderer.panX || 0;
    const panY = this.renderer.panY || 0;
    const dpr = window.devicePixelRatio || 1;

    const xMin = Math.min(this.startX, this.currentX);
    const xMax = Math.max(this.startX, this.currentX);
    const yMin = Math.min(this.startY, this.currentY);
    const yMax = Math.max(this.startY, this.currentY);

    const worldXMin = (xMin * dpr - panX) / scale;
    const worldXMax = (xMax * dpr - panX) / scale;
    const worldYMin = (yMin * dpr - panY) / scale;
    const worldYMax = (yMax * dpr - panY) / scale;

    const coords = this.cachedCoords;
    const nodes = this.cachedNodes;
    const len = nodes.length;

    let hash = 0;
    for (let i = 0; i < len; i++) {
      const nx = coords[i * 2];
      const ny = coords[i * 2 + 1];
      const inside = nx >= worldXMin && nx <= worldXMax && ny >= worldYMin && ny <= worldYMax;

      if (inside) {
        if (this.isDeselectMode) {
          this.selectedIndices.delete(i);
        } else {
          this.selectedIndices.add(i);
        }
      } else if (!this.isDeselectMode) {
        this.selectedIndices.delete(i);
      }

      if (this.selectedIndices.has(i)) {
        hash = ((hash << 5) - hash + i) | 0;
      }
    }

    if (!isFinal && hash === this.lastSelectionHash) {
      return; // Skip redundant re-renders when enclosed node set hasn't changed
    }
    this.lastSelectionHash = hash;

    const selected: GraphNode[] = [];
    for (const idx of this.selectedIndices) {
      if (nodes[idx]) selected.push(nodes[idx]);
    }
    this.callback.onSelectionChanged(selected, isFinal);
  }

  public clearSelection(): void {
    this.selectedIndices.clear();
    this.lastSelectionHash = -1;
    this.callback.onSelectionChanged([], true);
  }
}
