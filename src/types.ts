export interface GraphNode {
  id: string;
  path?: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  weight?: number;
  highlighted?: boolean;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}

export interface GraphRenderer {
  nodes?: GraphNode[];
  links?: GraphLink[];
  nodeLookup?: Record<string, GraphNode>;
  scale?: number;
  targetScale?: number;
  panX?: number;
  panY?: number;
  panvX?: number;
  panvY?: number;
  zoomCenterX?: number;
  zoomCenterY?: number;
  width?: number;
  height?: number;
  highlightNode?: GraphNode | null;
  worker?: Worker;
  setPan?: (x: number, y: number) => void;
  setScale?: (scale: number) => void;
  changed?: () => void;
  start?: () => void;
  stop?: () => void;
}

export interface GraphLeafView {
  getViewType: () => string;
  contentEl: HTMLElement;
  file?: { path: string };
  renderer?: GraphRenderer;
  engine?: {
    options?: Record<string, any>;
    render?: () => void;
  };
  dataEngine?: {
    render?: () => void;
    currentFocusFile?: string;
  };
  onOptionsChange?: () => void;
}

export interface PluginSettings {
  defaultCircleRadius: number;
  gridSize: number;
  enableMarqueeSelection: boolean;
  autoCenterActiveNote: boolean;
  autoCircularInLocalGraph: boolean;
  historyMaxDepth: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  defaultCircleRadius: 180,
  gridSize: 50,
  enableMarqueeSelection: true,
  autoCenterActiveNote: true,
  autoCircularInLocalGraph: true,
  historyMaxDepth: 30,
};
