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
  forward?: Record<string, any>;
  reverse?: Record<string, any>;
  circle?: {
    tint?: number;
    alpha?: number;
    scale?: { x: number; y: number; set?: (x: number, y?: number) => void };
  };
  _pinnedX?: number;
  _pinnedY?: number;
  _origTint?: number;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}

export interface GraphRenderer {
  nodes?: GraphNode[];
  links?: GraphLink[];
  nodeLookup?: Record<string, GraphNode>;
  hanger?: {
    localTransform?: {
      a: number;
      b: number;
      c: number;
      d: number;
      tx: number;
      ty: number;
    };
  };
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
  _graphProHooked?: boolean;
}

export interface NodePositionChange {
  id: string;
  prevX: number;
  prevY: number;
  prevPinnedX?: number;
  prevPinnedY?: number;
  newX: number;
  newY: number;
  newPinnedX?: number;
  newPinnedY?: number;
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
