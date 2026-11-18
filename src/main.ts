import { Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings, GraphNode, GraphRenderer } from "./types";
import { GraphProSettingsTab } from "./settings/SettingsTab";
import { MarqueeSelectionManager } from "./selection/MarqueeSelection";
import { GraphToolbarManager } from "./ui/GraphToolbar";
import { DeltaHistoryManager } from "./history/DeltaHistory";
import { CircularLayoutEngine } from "./layout/CircularLayout";
import { AlignmentEngine } from "./layout/AlignmentEngine";

interface LeafEnhancement {
  toolbar: GraphToolbarManager;
  marquee: MarqueeSelectionManager;
  selectedNodes: GraphNode[];
}

export default class GraphProNextPlugin extends Plugin {
  public settings: PluginSettings = DEFAULT_SETTINGS;
  public history: DeltaHistoryManager = new DeltaHistoryManager();
  private enhancedLeaves = new Map<WorkspaceLeaf, LeafEnhancement>();
  private activeFilePath: string | null = null;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new GraphProSettingsTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.detectActiveFile();
      this.enhanceAllLeaves();
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file && file.extension === "md") {
          this.activeFilePath = file.path;
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf || !leaf.view) return;
        const viewType = leaf.view.getViewType();
        if (viewType === "markdown" && (leaf.view as any).file) {
          this.activeFilePath = (leaf.view as any).file.path;
        } else if (viewType === "graph" || viewType === "localgraph") {
          this.enhanceLeaf(leaf);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.enhanceAllLeaves();
      })
    );

    // Global Commands
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
          const changes = AlignmentEngine.alignHorizontal(renderer, enh.selectedNodes);
          this.history.recordChange(changes);
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

    // Global Key Listener for Graph View
    this.registerDomEvent(window, "keydown", (evt: KeyboardEvent) => {
      this.handleGlobalKeyDown(evt);
    }, true);
  }

  onunload() {
    for (const [_, enh] of this.enhancedLeaves) {
      enh.toolbar.destroy();
      enh.marquee.destroy();
    }
    this.enhancedLeaves.clear();
  }

  private detectActiveFile(): void {
    const file = this.app.workspace.getActiveFile();
    if (file && file.extension === "md") {
      this.activeFilePath = file.path;
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

  private enhanceAllLeaves(): void {
    const leaves = [
      ...this.app.workspace.getLeavesOfType("graph"),
      ...this.app.workspace.getLeavesOfType("localgraph"),
    ];
    for (const leaf of leaves) {
      this.enhanceLeaf(leaf);
    }
  }

  private enhanceLeaf(leaf: WorkspaceLeaf): void {
    if (this.enhancedLeaves.has(leaf)) return;
    const view = leaf.view as any;
    if (!view || !view.contentEl) return;

    const renderer = view.renderer as GraphRenderer;
    if (!renderer) return;

    const containerEl = view.contentEl as HTMLElement;
    const selectedNodes: GraphNode[] = [];

    const marquee = new MarqueeSelectionManager(containerEl, renderer, {
      onSelectionChanged: (nodes) => {
        enhancement.selectedNodes = nodes;
        enhancement.toolbar.updateSelectionCount(nodes.length);
        this.highlightNodes(renderer, nodes);
      },
    });

    const toolbar = new GraphToolbarManager(
      containerEl,
      {
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
        getActiveFilePath: () => this.activeFilePath,
      },
      this.history
    );

    const enhancement: LeafEnhancement = {
      toolbar,
      marquee,
      selectedNodes,
    };

    this.enhancedLeaves.set(leaf, enhancement);
  }

  private highlightNodes(renderer: GraphRenderer, selected: GraphNode[]): void {
    if (!renderer) return;
    const selectedIds = new Set(selected.map((n) => n.id));
    const all = renderer.nodes || [];
    for (const node of all) {
      node.highlighted = selectedIds.has(node.id);
    }
    if (renderer.changed) renderer.changed();
  }

  private handleGlobalKeyDown(evt: KeyboardEvent): void {
    const active = this.getActiveGraphLeaf();
    if (!active) return;
    const renderer = this.getRenderer(active);
    if (!renderer) return;

    // Ctrl+Z inside Graph View -> Undo
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

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
