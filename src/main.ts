import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings, GraphNode, GraphRenderer, HopDistanceConfig } from "./types";
import { GraphProSettingsTab } from "./settings/SettingsTab";
import { MarqueeSelectionManager } from "./selection/MarqueeSelection";
import { GraphToolbarManager } from "./ui/GraphToolbar";
import { DeltaHistoryManager } from "./history/DeltaHistory";
import { CircularLayoutEngine, isMassLedgerPath } from "./layout/CircularLayout";
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
  private hopDepth = 1;

  async onload() {
    await this.loadSettings();
    this.autoFollow = this.settings.autoCenterActiveNote;
    this.circularLocked = this.settings.autoCircularInLocalGraph;
    this.hopDepth = this.settings.defaultHopDepth || 1;

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
            this.centerAllGraphs(file.path, false, true);
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
            this.scheduleCenterAndOrbit(leaf, this.activeFilePath, false, true);
          }
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.enhanceAllLeaves(false);
      })
    );

    this.addCommand({
      id: "graph-pro-center-and-orbit",
      name: "현재 페이지 중심 고정 및 주변 노드 원형 배치 (Center & Circular Orbit)",
      callback: () => {
        this.detectActiveFile();
        if (this.activeFilePath) {
          this.centerAllGraphs(this.activeFilePath, true, true);
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
            baseRadius: this.settings.hop1Radius,
            lockPositions: true,
          });
          this.history.recordChange(res.changed);
          this.fitCameraToNodes(active, enh.selectedNodes, this.activeFilePath);
        } else if (this.activeFilePath) {
          this.scheduleCenterAndOrbit(active, this.activeFilePath, true, false);
        }
      },
    });

    this.addCommand({
      id: "graph-pro-align-horizontal",
      name: "노드 수평 정렬 (Align Horizontal)",
      callback: () => {
        const active = this.getActiveGraphLeaf();
        if (!active) return;
        const enh = this.enhancedLeaves.get(active);
        const renderer = this.getRenderer(active);
        if (enh && renderer) {
          const targets = CircularLayoutEngine.resolveTargetNodes(
            renderer,
            enh.selectedNodes,
            this.activeFilePath,
            active.view.getViewType()
          );
          if (targets.length > 1) {
            this.history.recordChange(AlignmentEngine.alignHorizontal(renderer, targets, this.activeFilePath));
            this.fitCameraToNodes(active, targets, this.activeFilePath);
          }
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

  public getHopDistanceConfig(): HopDistanceConfig {
    return {
      hop1Radius: this.settings.hop1Radius,
      hop2Gap: this.settings.hop2Gap,
      hop3Gap: this.settings.hop3Gap,
      nodeArcSpacing: this.settings.nodeArcSpacing,
    };
  }

  public updateHopDistanceConfig(partial: Partial<HopDistanceConfig>): void {
    if (partial.hop1Radius !== undefined) {
      this.settings.hop1Radius = partial.hop1Radius;
      this.settings.defaultCircleRadius = partial.hop1Radius;
    }
    if (partial.hop2Gap !== undefined) {
      this.settings.hop2Gap = partial.hop2Gap;
    }
    if (partial.hop3Gap !== undefined) {
      this.settings.hop3Gap = partial.hop3Gap;
    }
    if (partial.nodeArcSpacing !== undefined) {
      this.settings.nodeArcSpacing = partial.nodeArcSpacing;
    }
    this.saveSettings();
    this.refreshAllToolbars();
  }

  public reapplyActiveLayout(keepCameraZoom = true): void {
    this.detectActiveFile();
    if (!this.activeFilePath) return;
    const leaves = [
      ...this.app.workspace.getLeavesOfType("graph"),
      ...this.app.workspace.getLeavesOfType("localgraph"),
    ];
    for (const leaf of leaves) {
      this.executeCenterAndOrbit(leaf, this.activeFilePath, false, keepCameraZoom);
    }
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
        this.scheduleCenterAndOrbit(leaf, this.activeFilePath, false, true);
      }
    }
  }

  private refreshAllToolbars(): void {
    for (const [_, enh] of this.enhancedLeaves) {
      enh.toolbar.refreshState();
    }
  }

  private centerAllGraphs(filePath: string, showNotice: boolean, asyncChanged: boolean): void {
    const leaves = [
      ...this.app.workspace.getLeavesOfType("graph"),
      ...this.app.workspace.getLeavesOfType("localgraph"),
    ];
    for (const leaf of leaves) {
      this.enhanceLeaf(leaf);
      this.scheduleCenterAndOrbit(leaf, filePath, showNotice, asyncChanged);
    }
  }

  private applyHopDepthToLeaf(leaf: WorkspaceLeaf, depth: number): void {
    this.hopDepth = depth;
    this.settings.defaultHopDepth = depth;
    this.saveSettings();
    this.refreshAllToolbars();

    const view = leaf.view as any;
    const vt = view?.getViewType?.();
    const renderer = this.getRenderer(leaf);

    if (vt === "localgraph" && view.engine?.options) {
      const targetJumps = Math.max(1, depth);
      view.engine.options.localJumps = targetJumps;
      view.engine.options.localBacklinks = true;
      view.engine.options.localForelinks = true;
      view.engine.options.showTags = false;
      view.engine.options.localInterlinks = false;
      if (view.engine.filterOptions?.jumps?.setValue) {
        view.engine.filterOptions.jumps.setValue(targetJumps);
      }
      if (typeof view.onOptionsChange === "function") {
        view.onOptionsChange();
      }
      if (typeof view.engine.render === "function") {
        view.engine.render();
      }
    } else if (vt === "graph" && depth === 0 && renderer) {
      CircularLayoutEngine.showAllNodes(renderer);
      CircularLayoutEngine.releaseAllLocks(renderer);
      new Notice("🌐 전체 그래프 표시 모드");
      return;
    }

    this.detectActiveFile();
    if (this.activeFilePath) {
      this.scheduleCenterAndOrbit(leaf, this.activeFilePath, true, true);
    }
  }

  private enhanceLeaf(leaf: WorkspaceLeaf): void {
    if (this.enhancedLeaves.has(leaf)) return;
    const view = leaf.view as any;
    if (!view || !view.contentEl) return;

    const renderer = view.renderer as GraphRenderer;
    if (!renderer) return;

    CircularLayoutEngine.ensureRendererPinHook(renderer, () => {
      if (this.autoFollow && this.activeFilePath) {
        this.executeCenterAndOrbit(leaf, this.activeFilePath, false, false);
      }
    });

    if (view.getViewType() === "localgraph" && view.engine?.options?.localJumps) {
      this.hopDepth = view.engine.options.localJumps;
    }

    const containerEl = view.contentEl as HTMLElement;

    const enhancement: LeafEnhancement = {
      toolbar: null as any,
      marquee: null as any,
      selectedNodes: [],
      timers: [],
    };

    enhancement.marquee = new MarqueeSelectionManager(containerEl, renderer, {
      onSelectionChanged: (nodes, _isFinal) => {
        const visibleOnly = nodes.filter((n) => n._hopVisible !== false);
        enhancement.selectedNodes = visibleOnly;
        enhancement.toolbar.updateSelectionCount(visibleOnly.length);
        this.highlightNodes(renderer, visibleOnly);
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
        getResolvedLinks: () => (this.app.metadataCache as any)?.resolvedLinks,
        centerAndOrbitOnActive: (showNotice, keepCameraZoom = false) => {
          this.detectActiveFile();
          if (this.activeFilePath) {
            if (keepCameraZoom) {
              this.executeCenterAndOrbit(leaf, this.activeFilePath, showNotice, true);
            } else {
              this.scheduleCenterAndOrbit(leaf, this.activeFilePath, showNotice, false);
            }
          }
        },
        fitCameraToNodes: (nodes, centerId) => {
          this.fitCameraToNodes(leaf, nodes, centerId, false);
        },
        isAutoFollow: () => this.autoFollow,
        toggleAutoFollow: () => {
          this.autoFollow = !this.autoFollow;
          this.settings.autoCenterActiveNote = this.autoFollow;
          this.saveSettings();
          this.refreshAllToolbars();
          if (this.autoFollow && this.activeFilePath) {
            this.scheduleCenterAndOrbit(leaf, this.activeFilePath, true, false);
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
              this.executeCenterAndOrbit(leaf, this.activeFilePath, true, false);
            } else {
              const changes = CircularLayoutEngine.releaseAllLocks(r);
              if (changes.length > 0) this.history.recordChange(changes);
              new Notice("✨ 자유 물리 시뮬레이션 활성화");
            }
          }
        },
        setHopDepth: (depth: number) => {
          this.applyHopDepthToLeaf(leaf, depth);
        },
        getHopDepth: () => {
          return this.hopDepth;
        },
        getHopDistanceConfig: () => this.getHopDistanceConfig(),
        updateHopDistanceConfig: (partial) => this.updateHopDistanceConfig(partial),
      },
      this.history
    );

    this.enhancedLeaves.set(leaf, enhancement);
  }

  public fitCameraToNodes(
    leaf: WorkspaceLeaf,
    nodes: GraphNode[],
    centerId?: string | null,
    keepCurrentZoom = false
  ): void {
    const view = leaf.view as any;
    if (!view || !nodes || nodes.length === 0) return;
    const renderer = view.renderer as GraphRenderer;
    if (!renderer) return;

    const visibleNodes = nodes.filter((n) => n._hopVisible !== false);
    const targetList = visibleNodes.length > 0 ? visibleNodes : nodes;

    let cx = 0;
    let cy = 0;
    const centerNode = centerId
      ? CircularLayoutEngine.findCenterNode(renderer, centerId)
      : undefined;

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;

    for (let i = 0; i < targetList.length; i++) {
      const n = targetList[i];
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }

    if (centerNode) {
      cx = centerNode.x;
      cy = centerNode.y;
    } else {
      cx = (minX + maxX) / 2;
      cy = (minY + maxY) / 2;
    }

    const dpr = window.devicePixelRatio || 1;
    const width = renderer.width || view.contentEl?.clientWidth || 600;
    const height = renderer.height || view.contentEl?.clientHeight || 400;

    let desiredScale = renderer.scale || 0.85;
    if (!keepCurrentZoom) {
      const spanX = Math.max(maxX - minX, 240);
      const spanY = Math.max(maxY - minY, 240);
      const scaleX = (width * dpr * 0.68) / spanX;
      const scaleY = (height * dpr * 0.68) / spanY;
      desiredScale = Math.max(0.25, Math.min(1.38, Math.min(scaleX, scaleY)));
    }

    const targetPanX = (width / 2) * dpr - cx * desiredScale;
    const targetPanY = (height / 2) * dpr - cy * desiredScale;

    renderer.panvX = 0;
    renderer.panvY = 0;
    renderer.targetScale = desiredScale;
    if (renderer.highlightNode) renderer.highlightNode = null;
    if (renderer.setScale) renderer.setScale(desiredScale);
    if (renderer.setPan) renderer.setPan(targetPanX, targetPanY);
    if (renderer.changed) renderer.changed();
  }

  private scheduleCenterAndOrbit(
    leaf: WorkspaceLeaf,
    filePath: string,
    showNotice: boolean,
    expectAsyncEngineUpdate = false
  ): void {
    const enh = this.enhancedLeaves.get(leaf);
    if (enh) {
      for (const t of enh.timers) window.clearTimeout(t);
      enh.timers = [];
    }

    const doneNow = this.executeCenterAndOrbit(leaf, filePath, showNotice, false);

    if (enh && (!doneNow || expectAsyncEngineUpdate)) {
      const t1 = window.setTimeout(() => {
        this.executeCenterAndOrbit(leaf, filePath, !doneNow && showNotice, false);
      }, 65);
      const t2 = window.setTimeout(() => {
        this.executeCenterAndOrbit(leaf, filePath, false, false);
      }, 180);
      const t3 = window.setTimeout(() => {
        this.executeCenterAndOrbit(leaf, filePath, false, false);
      }, 360);
      enh.timers.push(t1, t2, t3);
    }
  }

  private executeCenterAndOrbit(
    leaf: WorkspaceLeaf,
    filePath: string,
    showNotice: boolean,
    keepCameraZoom = false
  ): boolean {
    const view = leaf.view as any;
    if (!view) return false;
    const vt = view.getViewType();
    const renderer = view.renderer as GraphRenderer;
    if (!renderer) return false;

    if (vt === "localgraph" && view.engine?.options) {
      const desiredSearch = isMassLedgerPath(filePath)
        ? ""
        : "-file:_Review_Ledger -file:_All_Papers_Grand_Master_Dashboard";

      const targetJumps = Math.max(1, this.hopDepth);
      let needsRender = false;

      if (view.engine.options.search !== desiredSearch) {
        view.engine.options.search = desiredSearch;
        if (view.engine.filterOptions?.search?.setValue) {
          view.engine.filterOptions.search.setValue(desiredSearch);
        }
        needsRender = true;
      }
      if (view.engine.options.localBacklinks !== true) {
        view.engine.options.localBacklinks = true;
        needsRender = true;
      }
      if (view.engine.options.localForelinks !== true) {
        view.engine.options.localForelinks = true;
        needsRender = true;
      }
      if (view.engine.options.showTags !== false) {
        view.engine.options.showTags = false;
        needsRender = true;
      }
      if (view.engine.options.localInterlinks !== false) {
        view.engine.options.localInterlinks = false;
        needsRender = true;
      }
      if (view.engine.options.localJumps !== targetJumps) {
        view.engine.options.localJumps = targetJumps;
        needsRender = true;
      }
      if (view.file?.path !== filePath || view.engine.options.localFile !== filePath) {
        const targetFile = this.app.vault.getAbstractFileByPath(filePath);
        if (targetFile) {
          view.file = targetFile;
          if (typeof view.onFileOpen === "function") {
            try {
              view.onFileOpen(targetFile);
            } catch (_) {}
          }
        }
        view.engine.options.localFile = filePath;
        needsRender = true;
      }
      if (needsRender) {
        if (typeof view.onOptionsChange === "function") view.onOptionsChange();
        if (typeof view.engine.render === "function") view.engine.render();
      }
    }

    const node = CircularLayoutEngine.findCenterNode(renderer, filePath);
    if (!node) return false;

    const effectiveHop = vt === "localgraph" ? Math.max(1, this.hopDepth) : this.hopDepth;
    const res = CircularLayoutEngine.arrangeAndFilterByHopDepth(
      renderer,
      filePath,
      effectiveHop,
      this.getHopDistanceConfig(),
      this.circularLocked,
      vt,
      (this.app.metadataCache as any)?.resolvedLinks,
      (this.app.metadataCache as any)?.unresolvedLinks
    );

    if (showNotice && res.changes.length > 0) {
      this.history.recordChange(res.changes);
    }

    this.fitCameraToNodes(
      leaf,
      res.visibleNodes.length > 0 ? res.visibleNodes : [node],
      filePath,
      keepCameraZoom
    );

    if (showNotice) {
      const shortName = filePath.split("/").pop()?.replace(/\.md$/i, "") || filePath;
      const hopLabel = effectiveHop > 0 ? `${effectiveHop}홉 (${res.visibleNodes.length}개 노드)` : "전체";
      new Notice(`🎯 [${hopLabel}] 중심·동심원 정렬: ${shortName}`, 1500);
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
      const n = all[i];
      const isSel = selectedIds.has(n.id);
      if (n.circle) {
        if (isSel) {
          if (n._origTint === undefined && n.circle.tint !== undefined) {
            n._origTint = n.circle.tint;
          }
          n.circle.tint = 0x00ffd5;
        } else if (n._origTint !== undefined) {
          n.circle.tint = n._origTint;
          n._origTint = undefined;
        }
      }
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
          this.scheduleCenterAndOrbit(active, this.activeFilePath, true, false);
        }
      } else if (evt.code === "KeyO") {
        evt.preventDefault();
        evt.stopPropagation();
        const enh = this.enhancedLeaves.get(active);
        if (enh) {
          this.circularLocked = !this.circularLocked;
          enh.toolbar.refreshState();
          if (this.circularLocked && this.activeFilePath) {
            this.executeCenterAndOrbit(active, this.activeFilePath, true, false);
          } else {
            const changes = CircularLayoutEngine.releaseAllLocks(renderer);
            if (changes.length > 0) this.history.recordChange(changes);
          }
        }
      } else if (evt.code === "Digit1" || evt.code === "Digit2" || evt.code === "Digit3") {
        evt.preventDefault();
        evt.stopPropagation();
        const depth = parseInt(evt.code.replace("Digit", ""), 10);
        this.applyHopDepthToLeaf(active, depth);
      } else if (evt.code === "BracketLeft") {
        evt.preventDefault();
        evt.stopPropagation();
        const cfg = this.getHopDistanceConfig();
        this.updateHopDistanceConfig({
          hop1Radius: Math.max(40, cfg.hop1Radius - 25),
          hop2Gap: Math.max(40, cfg.hop2Gap - 25),
          hop3Gap: Math.max(40, cfg.hop3Gap - 25),
        });
        this.reapplyActiveLayout(true);
      } else if (evt.code === "BracketRight") {
        evt.preventDefault();
        evt.stopPropagation();
        const cfg = this.getHopDistanceConfig();
        this.updateHopDistanceConfig({
          hop1Radius: Math.min(800, cfg.hop1Radius + 25),
          hop2Gap: Math.min(800, cfg.hop2Gap + 25),
          hop3Gap: Math.min(800, cfg.hop3Gap + 25),
        });
        this.reapplyActiveLayout(true);
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
    this.scheduleCenterAndOrbit(leaf, this.activeFilePath, true, true);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
