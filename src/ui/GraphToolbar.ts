import { Notice } from "obsidian";
import { GraphNode, GraphRenderer } from "../types";
import { CircularLayoutEngine } from "../layout/CircularLayout";
import { AlignmentEngine } from "../layout/AlignmentEngine";
import { LinkExpansionEngine } from "../selection/LinkExpansion";
import { DeltaHistoryManager } from "../history/DeltaHistory";

export interface ToolbarCallbacks {
  getViewType: () => string;
  getSelectedNodes: () => GraphNode[];
  setSelectedNodes: (nodes: GraphNode[]) => void;
  clearSelection: () => void;
  getRenderer: () => GraphRenderer | undefined;
  getActiveFilePath: () => string | null;
  centerAndOrbitOnActive: (showNotice: boolean) => void;
  isAutoFollow: () => boolean;
  toggleAutoFollow: () => void;
  isCircularLocked: () => boolean;
  toggleCircularLocked: () => void;
  setLocalDepth: (depth: number) => void;
  getLocalDepth: () => number;
}

export class GraphToolbarManager {
  private containerEl: HTMLElement;
  private callbacks: ToolbarCallbacks;
  private history: DeltaHistoryManager;
  private toolbarEl: HTMLElement | null = null;
  private titleBadgeEl: HTMLElement | null = null;
  private statsBadgeEl: HTMLElement | null = null;
  private followBtnEl: HTMLButtonElement | null = null;
  private orbitBtnEl: HTMLButtonElement | null = null;
  private depthBtns: HTMLButtonElement[] = [];

  constructor(containerEl: HTMLElement, callbacks: ToolbarCallbacks, history: DeltaHistoryManager) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    this.history = history;
    this.mount();
  }

  private getShortName(path: string | null): string {
    if (!path) return "노트 없음";
    const parts = path.split("/");
    return parts[parts.length - 1].replace(/\.md$/i, "");
  }

  public mount(): void {
    if (this.toolbarEl) return;

    const existing = this.containerEl.querySelector(".graph-pro-next-toolbar");
    if (existing) existing.remove();
    const legacyHud = this.containerEl.querySelector(".agy-graph-hud");
    if (legacyHud) legacyHud.remove();

    this.toolbarEl = document.createElement("div");
    this.toolbarEl.className = "graph-pro-next-toolbar";

    this.titleBadgeEl = document.createElement("span");
    this.titleBadgeEl.className = "graph-pro-title";
    this.titleBadgeEl.textContent = "📄 " + this.getShortName(this.callbacks.getActiveFilePath());
    this.toolbarEl.appendChild(this.titleBadgeEl);

    this.statsBadgeEl = document.createElement("span");
    this.statsBadgeEl.className = "graph-pro-badge";
    this.statsBadgeEl.textContent = "선택: 0";
    this.toolbarEl.appendChild(this.statsBadgeEl);

    this.addButton(
      "🎯 중심·원형 (F)",
      "현재 페이지를 정중앙에 고정하고 주변 노드를 원형으로 즉시 배치 (단축키: F / Space)",
      () => {
        this.callbacks.centerAndOrbitOnActive(true);
      },
      true
    );

    this.orbitBtnEl = this.addButton(
      this.callbacks.isCircularLocked() ? "⭕ 원형고정: ON" : "✨ 자유물리: ON",
      "원형 궤도 고정 <-> D3 자유 물리 시뮬레이션 전환 (단축키: O)",
      () => {
        this.callbacks.toggleCircularLocked();
        this.refreshState();
      },
      this.callbacks.isCircularLocked()
    );

    this.followBtnEl = this.addButton(
      this.callbacks.isAutoFollow() ? "📌 자동추적: ON" : "⏸️ 자동추적: OFF",
      "노트 이동 시 자동으로 그래프 중심 및 원형 배치 수행",
      () => {
        this.callbacks.toggleAutoFollow();
        this.refreshState();
      },
      this.callbacks.isAutoFollow()
    );

    this.addButton("⭕ 선택원형", "Shift+드래그로 선택한 노드들을 원형 배치", () => {
      const renderer = this.callbacks.getRenderer();
      if (!renderer) return;
      const selected = this.callbacks.getSelectedNodes();
      if (selected.length > 1) {
        const activeFile = this.callbacks.getActiveFilePath();
        const res = CircularLayoutEngine.arrangeInCircle(renderer, selected, {
          centerNodeId: activeFile || undefined,
          baseRadius: 180,
          lockPositions: true,
        });
        this.history.recordChange(res.changed);
        new Notice(`🎯 선택된 ${selected.length}개 노드 원형 정렬 완료`);
      } else {
        this.callbacks.centerAndOrbitOnActive(true);
      }
    });

    this.addButton("↔️ 수평", "선택 노드 수평 일직선 정렬", () => {
      const renderer = this.callbacks.getRenderer();
      const selected = this.callbacks.getSelectedNodes();
      if (!renderer || selected.length <= 1) return;
      this.history.recordChange(AlignmentEngine.alignHorizontal(renderer, selected));
    });

    this.addButton("↕️ 수직", "선택 노드 수직 일직선 정렬", () => {
      const renderer = this.callbacks.getRenderer();
      const selected = this.callbacks.getSelectedNodes();
      if (!renderer || selected.length <= 1) return;
      this.history.recordChange(AlignmentEngine.alignVertical(renderer, selected));
    });

    this.addButton("🔲 그리드", "선택 노드 50px 격자 스냅", () => {
      const renderer = this.callbacks.getRenderer();
      const selected = this.callbacks.getSelectedNodes();
      if (!renderer || selected.length === 0) return;
      this.history.recordChange(AlignmentEngine.snapToGrid(renderer, selected, 50));
    });

    this.addButton("⬅️ 역링크", "선택 노드의 역링크(Backlinks) 확장 선택", () => {
      const renderer = this.callbacks.getRenderer();
      const selected = this.callbacks.getSelectedNodes();
      if (!renderer || selected.length === 0) return;
      this.callbacks.setSelectedNodes(LinkExpansionEngine.selectBacklinks(renderer, selected));
    });

    this.addButton("➡️ 후속", "선택 노드의 후속 링크(Outgoing) 확장 선택", () => {
      const renderer = this.callbacks.getRenderer();
      const selected = this.callbacks.getSelectedNodes();
      if (!renderer || selected.length === 0) return;
      this.callbacks.setSelectedNodes(LinkExpansionEngine.selectOutgoingLinks(renderer, selected));
    });

    if (this.callbacks.getViewType() === "localgraph") {
      const curDepth = this.callbacks.getLocalDepth();
      for (const d of [1, 2, 3]) {
        const b = this.addButton(
          `${d}홉`,
          `로컬 그래프 탐색 깊이 ${d}단계 (단축키: ${d})`,
          () => {
            this.callbacks.setLocalDepth(d);
            this.refreshState();
          },
          curDepth === d
        );
        b.dataset.depth = String(d);
        this.depthBtns.push(b);
      }
    }

    this.addButton("↩️ 취소", "이전 노드 배치로 되돌리기 (Ctrl+Z)", () => {
      const renderer = this.callbacks.getRenderer();
      if (renderer) this.history.undo(renderer);
    });

    this.addButton("✕ 해제", "선택 해제", () => {
      this.callbacks.clearSelection();
    });

    this.containerEl.appendChild(this.toolbarEl);
  }

  private addButton(text: string, title: string, onClick: () => void, isActive = false): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "graph-pro-btn" + (isActive ? " is-active" : "");
    btn.textContent = text;
    btn.title = title;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    if (this.toolbarEl) {
      this.toolbarEl.appendChild(btn);
    }
    return btn;
  }

  public updateSelectionCount(count: number): void {
    if (this.statsBadgeEl) {
      this.statsBadgeEl.textContent = `선택: ${count}`;
      this.statsBadgeEl.classList.toggle("is-active", count > 0);
    }
  }

  public refreshState(): void {
    if (this.titleBadgeEl) {
      this.titleBadgeEl.textContent = "📄 " + this.getShortName(this.callbacks.getActiveFilePath());
    }
    if (this.followBtnEl) {
      const on = this.callbacks.isAutoFollow();
      this.followBtnEl.textContent = on ? "📌 자동추적: ON" : "⏸️ 자동추적: OFF";
      this.followBtnEl.classList.toggle("is-active", on);
    }
    if (this.orbitBtnEl) {
      const on = this.callbacks.isCircularLocked();
      this.orbitBtnEl.textContent = on ? "⭕ 원형고정: ON" : "✨ 자유물리: ON";
      this.orbitBtnEl.classList.toggle("is-active", on);
    }
    if (this.depthBtns.length > 0) {
      const cur = this.callbacks.getLocalDepth();
      for (const b of this.depthBtns) {
        b.classList.toggle("is-active", Number(b.dataset.depth) === cur);
      }
    }
  }

  public destroy(): void {
    if (this.toolbarEl) {
      this.toolbarEl.remove();
      this.toolbarEl = null;
    }
  }
}
