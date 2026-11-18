import { Notice } from "obsidian";
import { GraphNode, GraphRenderer, HopDistanceConfig } from "../types";
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
  getResolvedLinks: () => Record<string, Record<string, number>> | undefined;
  centerAndOrbitOnActive: (showNotice: boolean, keepCameraZoom?: boolean) => void;
  fitCameraToNodes: (nodes: GraphNode[], centerId?: string | null) => void;
  isAutoFollow: () => boolean;
  toggleAutoFollow: () => void;
  isCircularLocked: () => boolean;
  toggleCircularLocked: () => void;
  setHopDepth: (depth: number) => void;
  getHopDepth: () => number;
  getHopDistanceConfig: () => HopDistanceConfig;
  updateHopDistanceConfig: (partial: Partial<HopDistanceConfig>) => void;
}

export class GraphToolbarManager {
  private containerEl: HTMLElement;
  private callbacks: ToolbarCallbacks;
  private history: DeltaHistoryManager;
  private toolbarEl: HTMLElement | null = null;
  private popoverEl: HTMLElement | null = null;
  private titleBadgeEl: HTMLElement | null = null;
  private statsBadgeEl: HTMLElement | null = null;
  private followBtnEl: HTMLButtonElement | null = null;
  private orbitBtnEl: HTMLButtonElement | null = null;
  private distBtnEl: HTMLButtonElement | null = null;
  private depthBtns: HTMLButtonElement[] = [];
  private sliderInputs: Record<string, { input: HTMLInputElement; valEl: HTMLElement }> = {};

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
    const existingPop = this.containerEl.querySelector(".graph-pro-distance-popover");
    if (existingPop) existingPop.remove();
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
      "현재 페이지를 정중앙에 고정하고 설정된 홉(1~3홉) 범위만 동심원으로 즉시 배치 (단축키: F / Space)",
      () => {
        this.callbacks.centerAndOrbitOnActive(true, false);
      },
      true
    );

    const curDepth = this.callbacks.getHopDepth();
    const hopOptions: Array<{ depth: number; label: string; desc: string }> = [
      { depth: 1, label: "1홉", desc: "현재 페이지와 직접(1차: 역링크+후속링크) 연결된 페이지만 원형으로 표시 (단축키: 1)" },
      { depth: 2, label: "2홉", desc: "현재 페이지 + 1차(내원) + 2차(외원) 연결 페이지까지 2단 동심원으로 표시 (단축키: 2)" },
      { depth: 3, label: "3홉", desc: "현재 페이지 + 1차 + 2차 + 3차 연결 페이지까지 3단 동심원으로 표시 (단축키: 3)" },
    ];
    if (this.callbacks.getViewType() === "graph") {
      hopOptions.push({ depth: 0, label: "🌐 전체", desc: "홉 필터 해제 및 볼트 전체 노드 표시" });
    }

    for (const opt of hopOptions) {
      const b = this.addButton(
        opt.label,
        opt.desc,
        () => {
          this.callbacks.setHopDepth(opt.depth);
          this.refreshState();
        },
        curDepth === opt.depth
      );
      b.dataset.depth = String(opt.depth);
      this.depthBtns.push(b);
    }

    // Quick Hop Distance Stepper & Live Sliders Popover Button
    this.addButton("➖", "1·2·3홉 원형 반경 간격 축소 (-25px, 단축키: [ )", () => {
      const cfg = this.callbacks.getHopDistanceConfig();
      this.callbacks.updateHopDistanceConfig({
        hop1Radius: Math.max(40, cfg.hop1Radius - 25),
        hop2Gap: Math.max(40, cfg.hop2Gap - 25),
        hop3Gap: Math.max(40, cfg.hop3Gap - 25),
      });
      this.syncSlidersFromConfig();
      this.callbacks.centerAndOrbitOnActive(false, true);
    });

    this.distBtnEl = this.addButton(
      "📏 거리조절",
      "1홉 반경, 2홉 간격, 3홉 간격, 자동확장 비율을 슬라이더로 정밀 조절",
      () => {
        this.toggleDistancePopover();
      },
      false
    );

    this.addButton("➕", "1·2·3홉 원형 반경 간격 확대 (+25px, 단축키: ] )", () => {
      const cfg = this.callbacks.getHopDistanceConfig();
      this.callbacks.updateHopDistanceConfig({
        hop1Radius: Math.min(800, cfg.hop1Radius + 25),
        hop2Gap: Math.min(800, cfg.hop2Gap + 25),
        hop3Gap: Math.min(800, cfg.hop3Gap + 25),
      });
      this.syncSlidersFromConfig();
      this.callbacks.centerAndOrbitOnActive(false, true);
    });

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

    this.addButton("↔️ 수평", "표시된 노드(또는 선택 노드)를 수평 일직선 행(Row)으로 정렬", () => {
      const renderer = this.callbacks.getRenderer();
      if (!renderer) return;
      const activeFile = this.callbacks.getActiveFilePath();
      const targets = CircularLayoutEngine.resolveTargetNodes(
        renderer,
        this.callbacks.getSelectedNodes(),
        activeFile,
        this.callbacks.getViewType()
      );
      if (targets.length <= 1) {
        new Notice("정렬할 연결 노드가 없습니다.");
        return;
      }
      const changes = AlignmentEngine.alignHorizontal(renderer, targets, activeFile);
      this.history.recordChange(changes);
      this.callbacks.fitCameraToNodes(targets, activeFile);
      new Notice(`↔️ ${targets.length}개 노드 수평 정렬 완료`);
    });

    this.addButton("↕️ 수직", "표시된 노드(또는 선택 노드)를 수직 일직선 열(Column)로 정렬", () => {
      const renderer = this.callbacks.getRenderer();
      if (!renderer) return;
      const activeFile = this.callbacks.getActiveFilePath();
      const targets = CircularLayoutEngine.resolveTargetNodes(
        renderer,
        this.callbacks.getSelectedNodes(),
        activeFile,
        this.callbacks.getViewType()
      );
      if (targets.length <= 1) {
        new Notice("정렬할 연결 노드가 없습니다.");
        return;
      }
      const changes = AlignmentEngine.alignVertical(renderer, targets, activeFile);
      this.history.recordChange(changes);
      this.callbacks.fitCameraToNodes(targets, activeFile);
      new Notice(`↕️ ${targets.length}개 노드 수직 정렬 완료`);
    });

    this.addButton("🔲 그리드", "표시된 노드(또는 선택 노드)를 바둑판 격자 행렬로 정렬", () => {
      const renderer = this.callbacks.getRenderer();
      if (!renderer) return;
      const activeFile = this.callbacks.getActiveFilePath();
      const targets = CircularLayoutEngine.resolveTargetNodes(
        renderer,
        this.callbacks.getSelectedNodes(),
        activeFile,
        this.callbacks.getViewType()
      );
      if (targets.length === 0) return;
      const changes = AlignmentEngine.snapToGrid(renderer, targets, activeFile);
      this.history.recordChange(changes);
      this.callbacks.fitCameraToNodes(targets, activeFile);
      const cols = Math.max(2, Math.ceil(Math.sqrt(targets.length)));
      const rows = Math.ceil(targets.length / cols);
      new Notice(`🔲 ${targets.length}개 노드 바둑판 그리드(${cols}×${rows}) 정렬 완료`);
    });

    this.addButton("⬅️ 역링크", "현재 페이지(또는 선택 노드)를 인용하는 역링크 노드를 선택하고 좌측 반원 호로 배치", () => {
      const renderer = this.callbacks.getRenderer();
      if (!renderer) return;
      const activeFile = this.callbacks.getActiveFilePath();
      const res = LinkExpansionEngine.selectAndArrangeBacklinks(
        renderer,
        this.callbacks.getSelectedNodes(),
        activeFile,
        this.callbacks.getResolvedLinks()
      );
      if (res.nodes.length <= 1) {
        new Notice("⬅️ 연결된 역링크(Backlinks) 노드가 없습니다.");
        return;
      }
      this.history.recordChange(res.changes);
      this.callbacks.setSelectedNodes(res.nodes);
      this.callbacks.fitCameraToNodes(res.nodes, activeFile);
      new Notice(`⬅️ 역링크 ${res.nodes.length - 1}개 선택 및 좌측 호 정렬 완료`);
    });

    this.addButton("➡️ 후속", "현재 페이지(또는 선택 노드)가 인용하는 후속 링크 노드를 선택하고 우측 반원 호로 배치", () => {
      const renderer = this.callbacks.getRenderer();
      if (!renderer) return;
      const activeFile = this.callbacks.getActiveFilePath();
      const res = LinkExpansionEngine.selectAndArrangeOutgoingLinks(
        renderer,
        this.callbacks.getSelectedNodes(),
        activeFile,
        this.callbacks.getResolvedLinks()
      );
      if (res.nodes.length <= 1) {
        new Notice("➡️ 연결된 후속 링크(Outgoing) 노드가 없습니다.");
        return;
      }
      this.history.recordChange(res.changes);
      this.callbacks.setSelectedNodes(res.nodes);
      this.callbacks.fitCameraToNodes(res.nodes, activeFile);
      new Notice(`➡️ 후속링크 ${res.nodes.length - 1}개 선택 및 우측 호 정렬 완료`);
    });

    this.addButton("↩️ 취소", "이전 노드 배치로 되돌리기 (Ctrl+Z)", () => {
      const renderer = this.callbacks.getRenderer();
      if (!renderer) return;
      if (this.history.undo(renderer)) {
        new Notice(`↩️ 이전 배치로 복원 완료 (남은 단계: ${this.history.getUndoCount()})`);
      } else {
        new Notice("되돌릴 이전 배치 기록이 없습니다.");
      }
    });

    this.addButton("✕ 해제", "선택 초기화 및 모든 노드 위치 고정 해제 (자유 물리 복원)", () => {
      const renderer = this.callbacks.getRenderer();
      this.callbacks.clearSelection();
      if (renderer) {
        const changes = CircularLayoutEngine.releaseAllLocks(renderer);
        if (changes.length > 0) {
          this.history.recordChange(changes);
        }
      }
      new Notice("🔓 선택 해제 및 자유 물리 모드로 복원되었습니다.");
    });

    this.containerEl.appendChild(this.toolbarEl);
  }

  private toggleDistancePopover(): void {
    if (this.popoverEl) {
      this.popoverEl.remove();
      this.popoverEl = null;
      this.distBtnEl?.classList.remove("is-active");
      return;
    }

    this.distBtnEl?.classList.add("is-active");
    const pop = document.createElement("div");
    pop.className = "graph-pro-distance-popover";
    pop.addEventListener("pointerdown", (e) => e.stopPropagation());
    pop.addEventListener("mousedown", (e) => e.stopPropagation());

    const header = document.createElement("div");
    header.className = "graph-pro-popover-header";
    const hTitle = document.createElement("span");
    hTitle.textContent = "📏 1·2·3홉 동심원 반경 및 거리 조절";
    header.appendChild(hTitle);

    const resetBtn = document.createElement("button");
    resetBtn.className = "graph-pro-btn";
    resetBtn.textContent = "🔄 기본값";
    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.callbacks.updateHopDistanceConfig({
        hop1Radius: 160,
        hop2Gap: 160,
        hop3Gap: 160,
        nodeArcSpacing: 18,
      });
      this.syncSlidersFromConfig();
      this.callbacks.centerAndOrbitOnActive(false, true);
    });
    header.appendChild(resetBtn);
    pop.appendChild(header);

    const cfg = this.callbacks.getHopDistanceConfig();
    this.sliderInputs = {};

    this.addSliderRow(pop, "hop1Radius", "1홉 반경 (중심 ↔ 1홉)", 40, 700, 10, cfg.hop1Radius, "px");
    this.addSliderRow(pop, "hop2Gap", "2홉 간격 (1홉 ↔ 2홉)", 40, 700, 10, cfg.hop2Gap, "px");
    this.addSliderRow(pop, "hop3Gap", "3홉 간격 (2홉 ↔ 3홉)", 40, 700, 10, cfg.hop3Gap, "px");
    this.addSliderRow(pop, "nodeArcSpacing", "노드 수 비례 자동확장 (0=고정)", 0, 80, 2, cfg.nodeArcSpacing, "px");

    this.popoverEl = pop;
    this.containerEl.appendChild(pop);
  }

  private addSliderRow(
    parent: HTMLElement,
    key: keyof HopDistanceConfig,
    label: string,
    min: number,
    max: number,
    step: number,
    initialVal: number,
    unit: string
  ): void {
    const row = document.createElement("div");
    row.className = "graph-pro-slider-row";

    const lbl = document.createElement("span");
    lbl.className = "graph-pro-slider-label";
    lbl.textContent = label;
    row.appendChild(lbl);

    const input = document.createElement("input");
    input.type = "range";
    input.className = "graph-pro-slider-input";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(initialVal);

    const valEl = document.createElement("span");
    valEl.className = "graph-pro-slider-val";
    valEl.textContent = `${initialVal}${unit}`;

    input.addEventListener("input", (e) => {
      e.stopPropagation();
      const num = Number(input.value);
      valEl.textContent = `${num}${unit}`;
      this.callbacks.updateHopDistanceConfig({ [key]: num });
      this.callbacks.centerAndOrbitOnActive(false, true);
    });

    row.appendChild(input);
    row.appendChild(valEl);
    parent.appendChild(row);

    this.sliderInputs[key] = { input, valEl };
  }

  public syncSlidersFromConfig(): void {
    const cfg = this.callbacks.getHopDistanceConfig();
    for (const k of ["hop1Radius", "hop2Gap", "hop3Gap", "nodeArcSpacing"] as Array<keyof HopDistanceConfig>) {
      const item = this.sliderInputs[k];
      if (item) {
        item.input.value = String(cfg[k]);
        item.valEl.textContent = `${cfg[k]}px`;
      }
    }
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
      const cur = this.callbacks.getHopDepth();
      for (const b of this.depthBtns) {
        b.classList.toggle("is-active", Number(b.dataset.depth) === cur);
      }
    }
    this.syncSlidersFromConfig();
  }

  public destroy(): void {
    if (this.popoverEl) {
      this.popoverEl.remove();
      this.popoverEl = null;
    }
    if (this.toolbarEl) {
      this.toolbarEl.remove();
      this.toolbarEl = null;
    }
  }
}
