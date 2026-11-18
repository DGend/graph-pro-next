import { Notice } from "obsidian";
import { GraphNode, GraphRenderer } from "../types";
import { CircularLayoutEngine } from "../layout/CircularLayout";
import { AlignmentEngine } from "../layout/AlignmentEngine";
import { LinkExpansionEngine } from "../selection/LinkExpansion";
import { DeltaHistoryManager } from "../history/DeltaHistory";

export interface ToolbarCallbacks {
  getSelectedNodes: () => GraphNode[];
  setSelectedNodes: (nodes: GraphNode[]) => void;
  clearSelection: () => void;
  getRenderer: () => GraphRenderer | undefined;
  getActiveFilePath: () => string | null;
}

export class GraphToolbarManager {
  private containerEl: HTMLElement;
  private callbacks: ToolbarCallbacks;
  private history: DeltaHistoryManager;
  private toolbarEl: HTMLElement | null = null;
  private statsBadgeEl: HTMLElement | null = null;

  constructor(containerEl: HTMLElement, callbacks: ToolbarCallbacks, history: DeltaHistoryManager) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    this.history = history;
    this.mount();
  }

  public mount(): void {
    if (this.toolbarEl) return;

    this.toolbarEl = document.createElement("div");
    this.toolbarEl.className = "graph-pro-next-toolbar";

    // 1. Selection Stats Badge
    this.statsBadgeEl = document.createElement("div");
    this.statsBadgeEl.className = "graph-pro-badge";
    this.statsBadgeEl.textContent = "선택: 0개";
    this.toolbarEl.appendChild(this.statsBadgeEl);

    // 2. Action Buttons
    this.addButton("⭕ 원형", "선택한 노드를 중심 노드 기준으로 원형 궤도 정렬", () => {
      const renderer = this.callbacks.getRenderer();
      const selected = this.callbacks.getSelectedNodes();
      if (!renderer || selected.length <= 1) {
        new Notice("원형으로 배치할 노드를 2개 이상 선택해주세요 (Shift + 드래그).");
        return;
      }
      const activeFile = this.callbacks.getActiveFilePath();
      const res = CircularLayoutEngine.arrangeInCircle(renderer, selected, {
        centerNodeId: activeFile || undefined,
        baseRadius: 180,
        lockPositions: true,
      });
      this.history.recordChange(res.changed);
      new Notice(`🎯 ${selected.length}개 노드 원형 궤도 정렬 완료`);
    });

    this.addButton("↔️ 수평", "선택한 노드를 수평 일직선 정렬", () => {
      const renderer = this.callbacks.getRenderer();
      const selected = this.callbacks.getSelectedNodes();
      if (!renderer || selected.length <= 1) return;
      const changes = AlignmentEngine.alignHorizontal(renderer, selected);
      this.history.recordChange(changes);
    });

    this.addButton("↕️ 수직", "선택한 노드를 수직 일직선 정렬", () => {
      const renderer = this.callbacks.getRenderer();
      const selected = this.callbacks.getSelectedNodes();
      if (!renderer || selected.length <= 1) return;
      const changes = AlignmentEngine.alignVertical(renderer, selected);
      this.history.recordChange(changes);
    });

    this.addButton("🔲 그리드", "50px 격자 스냅 정렬", () => {
      const renderer = this.callbacks.getRenderer();
      const selected = this.callbacks.getSelectedNodes();
      if (!renderer || selected.length === 0) return;
      const changes = AlignmentEngine.snapToGrid(renderer, selected, 50);
      this.history.recordChange(changes);
      new Notice(`📐 ${selected.length}개 노드 그리드 정렬 완료`);
    });

    this.addButton("⬅️ 역링크", "선택한 노드를 가리키는 백링크 노드 포함 선택", () => {
      const renderer = this.callbacks.getRenderer();
      const selected = this.callbacks.getSelectedNodes();
      if (!renderer || selected.length === 0) return;
      const expanded = LinkExpansionEngine.selectBacklinks(renderer, selected);
      this.callbacks.setSelectedNodes(expanded);
      new Notice(`🔗 역링크 확장: 총 ${expanded.length}개`);
    });

    this.addButton("➡️ 후속링크", "선택한 노드가 가리키는 아웃고잉 링크 포함 선택", () => {
      const renderer = this.callbacks.getRenderer();
      const selected = this.callbacks.getSelectedNodes();
      if (!renderer || selected.length === 0) return;
      const expanded = LinkExpansionEngine.selectOutgoingLinks(renderer, selected);
      this.callbacks.setSelectedNodes(expanded);
      new Notice(`🔗 후속링크 확장: 총 ${expanded.length}개`);
    });

    this.addButton("↩️ 실행취소", "배치 변경 되돌리기 (Ctrl+Z)", () => {
      const renderer = this.callbacks.getRenderer();
      if (renderer && this.history.undo(renderer)) {
        new Notice("배치 변경 실행 취소");
      } else {
        new Notice("되돌릴 이전 배치가 없습니다.");
      }
    });

    this.addButton("🔒 고정/해제", "선택 노드 물리 고정(fx, fy) 토글", () => {
      const renderer = this.callbacks.getRenderer();
      const selected = this.callbacks.getSelectedNodes();
      if (!renderer || selected.length === 0) return;
      const isLocked = selected[0].fx != null;
      AlignmentEngine.toggleLock(renderer, selected, !isLocked);
      new Notice(isLocked ? "노드 물리 고정 해제" : "노드 현재 위치 고정");
    });

    this.addButton("✕ 선택해제", "선택 초기화", () => {
      this.callbacks.clearSelection();
    });

    this.containerEl.appendChild(this.toolbarEl);
  }

  private addButton(text: string, title: string, onClick: () => void): void {
    if (!this.toolbarEl) return;
    const btn = document.createElement("button");
    btn.className = "graph-pro-btn";
    btn.textContent = text;
    btn.title = title;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    this.toolbarEl.appendChild(btn);
  }

  public updateSelectionCount(count: number): void {
    if (this.statsBadgeEl) {
      this.statsBadgeEl.textContent = `선택: ${count}개`;
      this.statsBadgeEl.classList.toggle("is-active", count > 0);
    }
  }

  public destroy(): void {
    if (this.toolbarEl) {
      this.toolbarEl.remove();
      this.toolbarEl = null;
    }
  }
}
