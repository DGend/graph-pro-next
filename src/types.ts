export interface GraphNode {
  id: string;
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
  panX?: number;
  panY?: number;
  width?: number;
  height?: number;
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
  renderer?: GraphRenderer;
  engine?: {
    options?: Record<string, any>;
    render?: () => void;
  };
  dataEngine?: {
    render?: () => void;
    currentFocusFile?: string;
  };
}

export interface PluginSettings {
  defaultCircleRadius: number;
  gridSize: number;
  enableMarqueeSelection: boolean;
  autoCenterActiveNote: boolean;
  historyMaxDepth: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  defaultCircleRadius: 200,
  gridSize: 50,
  enableMarqueeSelection: true,
  autoCenterActiveNote: true,
  historyMaxDepth: 30,
};
