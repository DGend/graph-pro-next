import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings, GraphNode, GraphRenderer } from "./types";
import { GraphProSettingsTab } from "./settings/SettingsTab";
import { MarqueeSelectionManager } from "./selection/MarqueeSelection";
import { GraphToolbarManager } from "./ui/GraphToolbar";
import { DeltaHistoryManager } from "./history/DeltaHistory";
import { CircularLayoutEngine, isSuperHubPath } from "./layout/CircularLayout";
import { AlignmentEngine } from "./layout/AlignmentEngine";

interface LeafEnhancement {
  toolbar: GraphToolbarManager;
  marquee: MarqueeSelectionManager;
  selectedNodes: GraphNode[];
  timers: number[];
}

export default class GraphProNextPlugin extends Plugin {
  public settings: PluginSettings = DEFAULT_SETTINGS;
  public history: DeltaHistoryManager = new DeltaHistoryManager();
  private enhancedLeaves = new Map<WorkspaceLeaf, LeafEnhancement>();
  private activeFilePath: string | null = null;
  private autoFollow = true;
  private circularLocked = true;

  async onload() {
    await this.loadSettings();
    this.autoFollow = this.settings.autoCenterActiveNote;
    this.circularLocked = this.settings.autoCircularInLocalGraph;

    this.addSettingTab(new GraphProSettingsTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.detectActiveFile();
      this.enhanceAllLeaves(true);
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file && file.extension === "md") {
          this.activeFilePath = file.path;
          this.refreshAllToolbars();
          if (this.autoFollow) {
            this.centerAllGraphs(file.path, false);
          }
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf || !leaf.view) return;
        const vt = leaf.view.getViewType();
        if (vt === "markdown" && (leaf.view as any).file) {
          this.activeFilePath = (leaf.view as any).file.path;
          this.refreshAllToolbars();
        } else if (vt === "graph" || vt === "localgraph") {
          this.enhanceLeaf(leaf);
          if (this.autoFollow && this.activeFilePath) {
            this.scheduleCenterAndOrbit(leaf, this.activeFilePath, false);
          }
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.enhanceAllLeaves(false);
      })
    );

    // Commands
    this.addCommand({
      id: "graph-pro-center-and-orbit",
      name: "현재 페이지 중심 고정 및 주변 노드 원형 배치 (Center & Circular Orbit)",
      callback: () => {
        this.detectActiveFile();
        if (this.activeFilePath) {
          this.centerAllGraphs(this.activeFilePath, true);
        }
      },
    });

    this.addCommand({
      id: "graph-pro-arrange-circle",
      name: "선택된 노드 원형 궤도 정렬 (Arrange Selected in Circle)",
      callback: () => {
        const active = this.getActiveGraphLeaf();
        if (!active) return;
        const enh = this.enhancedLeaves.get(active);
        const renderer = this.getRenderer(active);
        if (enh && renderer && enh.selectedNodes.length > 1) {
          const res = CircularLayoutEngine.arrangeInCircle(renderer, enh.selectedNodes, {
            centerNodeId: this.activeFilePath || undefined,
            baseRadius: this.settings.defaultCircleRadius,
            lockPositions: true,
          });
          this.history.recordChange(res.changed);
        } else if (this.activeFilePath) {
          this.scheduleCenterAndOrbit(active, this.activeFilePath, true);
        }
      },
    });

    this.addCommand({
      id: "graph-pro-align-horizontal",
      name: "선택된 노드 수평 정렬 (Align Horizontal)",
      callback: () => {
        const active = this.getActiveGraphLeaf();
        if (!active) return;
        const enh = this.enhancedLeaves.get(active);
        const renderer = this.getRenderer(active);
        if (enh && renderer && enh.selectedNodes.length > 1) {
          this.history.recordChange(AlignmentEngine.alignHorizontal(renderer, enh.selectedNodes));
        }
      },
    });

    this.addCommand({
      id: "graph-pro-undo",
      name: "그래프 배치 실행 취소 (Undo Layout)",
      callback: () => {
        const active = this.getActiveGraphLeaf();
        if (!active) return;
        const renderer = this.getRenderer(active);
        if (renderer) this.history.undo(renderer);
      },
    });

    this.registerDomEvent(
      window,
      "keydown",
      (evt: KeyboardEvent) => {
        this.handleGlobalKeyDown(evt);
      },
      true
    );
  }

  onunload() {
    for (const [_, enh] of this.enhancedLeaves) {
      for (const t of enh.timers) window.clearTimeout(t);
      enh.toolbar.destroy();
      enh.marquee.destroy();
    }
    this.enhancedLeaves.clear();
  }

  private detectActiveFile(): void {
    const file = this.app.workspace.getActiveFile();
    if (file && file.extension === "md") {
      this.activeFilePath = file.path;
      return;
    }
    if (this.activeFilePath) return;
    const mdLeaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of mdLeaves) {
      const f = (leaf.view as any)?.file;
      if (f && f.path) {
        this.activeFilePath = f.path;
        return;
      }
    }
  }

  private getActiveGraphLeaf(): WorkspaceLeaf | null {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf || !leaf.view) return null;
    const vt = leaf.view.getViewType();
    if (vt === "graph" || vt === "localgraph") return leaf;
    return null;
  }

  private getRenderer(leaf: WorkspaceLeaf): GraphRenderer | undefined {
    return (leaf.view as any)?.renderer;
  }

  private enhanceAllLeaves(centerInitial: boolean): void {
    const leaves = [
      ...this.app.workspace.getLeavesOfType("graph"),
      ...this.app.workspace.getLeavesOfType("localgraph"),
    ];
    for (const leaf of leaves) {
      this.enhanceLeaf(leaf);
      if (centerInitial && this.autoFollow && this.activeFilePath) {
        this.scheduleCenterAndOrbit(leaf, this.activeFilePath, false);
      }
    }
  }

  private refreshAllToolbars(): void {
    for (const [_, enh] of this.enhancedLeaves) {
      enh.toolbar.refreshState();
    }
  }

  private centerAllGraphs(filePath: string, showNotice: boolean): void {
    const leaves = [
      ...this.app.workspace.getLeavesOfType("graph"),
      ...this.app.workspace.getLeavesOfType("localgraph"),
    ];
    for (const leaf of leaves) {
      this.enhanceLeaf(leaf);
      this.scheduleCenterAndOrbit(leaf, filePath, showNotice);
    }
  }

  private enhanceLeaf(leaf: WorkspaceLeaf): void {
    if (this.enhancedLeaves.has(leaf)) return;
    const view = leaf.view as any;
    if (!view || !view.contentEl) return;

    const renderer = view.renderer as GraphRenderer;
    if (!renderer) return;

    const containerEl = view.contentEl as HTMLElement;

    const enhancement: LeafEnhancement = {
      toolbar: null as any,
      marquee: null as any,
      selectedNodes: [],
      timers: [],
    };

    enhancement.marquee = new MarqueeSelectionManager(containerEl, renderer, {
      onSelectionChanged: (nodes, _isFinal) => {
        enhancement.selectedNodes = nodes;
        enhancement.toolbar.updateSelectionCount(nodes.length);
        this.highlightNodes(renderer, nodes);
      },
    });

    enhancement.toolbar = new GraphToolbarManager(
      containerEl,
      {
        getViewType: () => leaf.view.getViewType(),
        getSelectedNodes: () => enhancement.selectedNodes,
        setSelectedNodes: (nodes) => {
          enhancement.selectedNodes = nodes;
          enhancement.toolbar.updateSelectionCount(nodes.length);
          this.highlightNodes(renderer, nodes);
        },
        clearSelection: () => {
          enhancement.marquee.clearSelection();
          enhancement.selectedNodes = [];
          enhancement.toolbar.updateSelectionCount(0);
          this.highlightNodes(renderer, []);
        },
        getRenderer: () => (leaf.view as any)?.renderer,
        getActiveFilePath: () => {
          this.detectActiveFile();
          return this.activeFilePath;
        },
        centerAndOrbitOnActive: (showNotice) => {
          this.detectActiveFile();
          if (this.activeFilePath) {
            this.scheduleCenterAndOrbit(leaf, this.activeFilePath, showNotice);
          }
        },
        isAutoFollow: () => this.autoFollow,
        toggleAutoFollow: () => {
          this.autoFollow = !this.autoFollow;
          this.settings.autoCenterActiveNote = this.autoFollow;
          this.saveSettings();
          this.refreshAllToolbars();
          if (this.autoFollow && this.activeFilePath) {
            this.scheduleCenterAndOrbit(leaf, this.activeFilePath, true);
          }
        },
        isCircularLocked: () => this.circularLocked,
        toggleCircularLocked: () => {
          this.circularLocked = !this.circularLocked;
          this.settings.autoCircularInLocalGraph = this.circularLocked;
          this.saveSettings();
          this.refreshAllToolbars();
          const r = this.getRenderer(leaf);
          if (r) {
            if (this.circularLocked && this.activeFilePath) {
              this.executeCenterAndOrbit(leaf, this.activeFilePath, true);
            } else {
              CircularLayoutEngine.releaseAllLocks(r);
              new Notice("✨ 자유 물리 시뮬레이션 활성화");
            }
          }
        },
        setLocalDepth: (depth: number) => {
          const eng = (leaf.view as any)?.engine;
          if (eng && eng.options) {
            eng.options.localJumps = depth;
            if (typeof eng.render === "function") eng.render();
            if (this.activeFilePath) {
              this.scheduleCenterAndOrbit(leaf, this.activeFilePath, false);
            }
          }
        },
        getLocalDepth: () => {
          return (leaf.view as any)?.engine?.options?.localJumps || 1;
        },
      },
      this.history
    );

    this.enhancedLeaves.set(leaf, enhancement);
  }

  /**
   * Executes immediately if the target node is already in renderer.nodeLookup.
   * Only schedules a single 70ms follow-up if Obsidian is still building the Local Graph nodes.
   */
  private scheduleCenterAndOrbit(leaf: WorkspaceLeaf, filePath: string, showNotice: boolean): void {
    const enh = this.enhancedLeaves.get(leaf);
    if (enh) {
      for (const t of enh.timers) window.clearTimeout(t);
      enh.timers = [];
    }

    const doneNow = this.executeCenterAndOrbit(leaf, filePath, showNotice);

    if (!doneNow && enh) {
      const t1 = window.setTimeout(() => {
        this.executeCenterAndOrbit(leaf, filePath, showNotice);
      }, 70);
      enh.timers.push(t1);
    }
  }

  private executeCenterAndOrbit(leaf: WorkspaceLeaf, filePath: string, showNotice: boolean): boolean {
    const view = leaf.view as any;
    if (!view) return false;
    const vt = view.getViewType();
    const renderer = view.renderer as GraphRenderer;
    if (!renderer) return false;

    if (vt === "localgraph" && view.engine?.options) {
      // Prevent 4,000-paper master ledgers from blowing up multi-hop Local Graphs
      const desiredSearch = isSuperHubPath(filePath)
        ? "-file:_Review_Ledger"
        : "-file:_Papers_Dashboard -file:_Review_Ledger -file:_Papers_Graph_Hub";

      let needsRender = false;
      if (view.engine.options.search !== desiredSearch) {
        view.engine.options.search = desiredSearch;
        needsRender = true;
      }
      if (view.engine.options.localFile !== filePath) {
        const targetFile = this.app.vault.getAbstractFileByPath(filePath);
        if (targetFile) view.file = targetFile;
        view.engine.options.localFile = filePath;
        needsRender = true;
      }
      if (needsRender && typeof view.engine.render === "function") {
        view.engine.render();
      }
    }

    const node = renderer.nodeLookup
      ? renderer.nodeLookup[filePath]
      : (renderer.nodes || []).find((n) => (n.id || n.path) === filePath);

    if (!node) return false;

    if (vt === "localgraph") {
      CircularLayoutEngine.arrangeLocalGraphConcentric(
        renderer,
        filePath,
        this.settings.defaultCircleRadius,
        this.circularLocked
      );
    } else if (vt === "graph" && this.circularLocked && showNotice) {
      // In Global Graph, only arrange in circle if active note is NOT a 4,000-node master hub
      if (!isSuperHubPath(filePath)) {
        const neighborhood = CircularLayoutEngine.getCleanNeighborhood(renderer, node, filePath, 50);
        if (neighborhood.length > 1 && neighborhood.length <= 51) {
          const res = CircularLayoutEngine.arrangeInCircle(renderer, neighborhood, {
            centerNodeId: filePath,
            baseRadius: this.settings.defaultCircleRadius,
            lockPositions: true,
          });
          this.history.recordChange(res.changed);
        }
      }
    }

    // Instantaneous 1-frame camera centering (DO NOT set renderer.highlightNode!)
    const dpr = window.devicePixelRatio || 1;
    const width = renderer.width || view.contentEl?.clientWidth || 600;
    const height = renderer.height || view.contentEl?.clientHeight || 400;

    let desiredScale = renderer.scale || 1.1;
    if (vt === "localgraph") {
      const allNodes = renderer.nodes || [];
      let maxDist = 180;
      for (let i = 0, len = allNodes.length; i < len; i++) {
        const n = allNodes[i];
        const dx = n.x - node.x;
        const dy = n.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDist) maxDist = dist;
      }
      const minDim = Math.min(width, height) * dpr;
      desiredScale = Math.max(0.45, Math.min(1.35, (minDim * 0.38) / Math.max(maxDist, 100)));
    } else if (showNotice) {
      desiredScale = Math.max(renderer.scale || 1.0, 1.25);
    }

    const targetPanX = (width / 2) * dpr - node.x * desiredScale;
    const targetPanY = (height / 2) * dpr - node.y * desiredScale;

    renderer.panvX = 0;
    renderer.panvY = 0;
    renderer.targetScale = desiredScale;
    // Ensure highlightNode is cleared so Obsidian's WebGL renderer can enter 0% GPU idle sleep
    if (renderer.highlightNode) {
      renderer.highlightNode = null;
    }
    if (renderer.setScale) renderer.setScale(desiredScale);
    if (renderer.setPan) renderer.setPan(targetPanX, targetPanY);
    if (renderer.changed) renderer.changed();

    if (showNotice) {
      const shortName = filePath.split("/").pop()?.replace(/\.md$/i, "") || filePath;
      new Notice(`🎯 중심·원형 정렬 완료: ${shortName}`, 1500);
    }
    return true;
  }

  private highlightNodes(renderer: GraphRenderer, selected: GraphNode[]): void {
    if (!renderer) return;
    const selectedIds = new Set<string>();
    for (let i = 0, len = selected.length; i < len; i++) {
      selectedIds.add(selected[i].id);
    }
    const all = renderer.nodes || [];
    for (let i = 0, len = all.length; i < len; i++) {
      all[i].highlighted = selectedIds.has(all[i].id);
    }
    if (renderer.changed) renderer.changed();
  }

  private handleGlobalKeyDown(evt: KeyboardEvent): void {
    const activeEl = document.activeElement;
    if (
      activeEl &&
      (activeEl.tagName === "INPUT" ||
        activeEl.tagName === "TEXTAREA" ||
        (activeEl as HTMLElement).isContentEditable)
    ) {
      return;
    }

    if (evt.altKey && !evt.ctrlKey && !evt.shiftKey && evt.code === "KeyG") {
      evt.preventDefault();
      evt.stopPropagation();
      this.openOrFocusLocalGraph();
      return;
    }

    const active = this.getActiveGraphLeaf();
    if (!active) return;
    const renderer = this.getRenderer(active);
    if (!renderer) return;

    if (!evt.ctrlKey && !evt.altKey && !evt.metaKey) {
      if (evt.code === "KeyF" || evt.code === "Space" || evt.code === "Digit0") {
        evt.preventDefault();
        evt.stopPropagation();
        this.detectActiveFile();
        if (this.activeFilePath) {
          this.scheduleCenterAndOrbit(active, this.activeFilePath, true);
        }
      } else if (evt.code === "KeyO") {
        evt.preventDefault();
        evt.stopPropagation();
        const enh = this.enhancedLeaves.get(active);
        if (enh) {
          this.circularLocked = !this.circularLocked;
          enh.toolbar.refreshState();
          if (this.circularLocked && this.activeFilePath) {
            this.executeCenterAndOrbit(active, this.activeFilePath, true);
          } else {
            CircularLayoutEngine.releaseAllLocks(renderer);
          }
        }
      } else if (
        active.view.getViewType() === "localgraph" &&
        (evt.code === "Digit1" || evt.code === "Digit2" || evt.code === "Digit3")
      ) {
        evt.preventDefault();
        evt.stopPropagation();
        const depth = parseInt(evt.code.replace("Digit", ""), 10);
        const eng = (active.view as any)?.engine;
        if (eng && eng.options) {
          eng.options.localJumps = depth;
          if (typeof eng.render === "function") eng.render();
          if (this.activeFilePath) {
            this.scheduleCenterAndOrbit(active, this.activeFilePath, false);
          }
        }
        this.refreshAllToolbars();
      }
      return;
    }

    if ((evt.ctrlKey || evt.metaKey) && !evt.shiftKey && evt.code === "KeyZ") {
      if (this.history.canUndo()) {
        evt.preventDefault();
        evt.stopPropagation();
        this.history.undo(renderer);
      }
    } else if (
      (evt.ctrlKey || evt.metaKey) &&
      (evt.shiftKey || evt.code === "KeyY") &&
      (evt.code === "KeyZ" || evt.code === "KeyY")
    ) {
      if (this.history.canRedo()) {
        evt.preventDefault();
        evt.stopPropagation();
        this.history.redo(renderer);
      }
    }
  }

  private async openOrFocusLocalGraph(): Promise<void> {
    this.detectActiveFile();
    if (!this.activeFilePath) return;

    const localLeaves = this.app.workspace.getLeavesOfType("localgraph");
    let leaf = localLeaves.length > 0 ? localLeaves[0] : null;

    if (!leaf) {
      leaf = this.app.workspace.getLeaf("split", "vertical");
      await leaf.setViewState({
        type: "localgraph",
        active: true,
        state: { file: this.activeFilePath },
      });
    } else {
      this.app.workspace.revealLeaf(leaf);
    }

    this.enhanceLeaf(leaf);
    this.scheduleCenterAndOrbit(leaf, this.activeFilePath, true);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
