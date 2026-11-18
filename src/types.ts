export interface PixiDisplayObject {
  visible?: boolean;
  renderable?: boolean;
  alpha?: number;
  tint?: number;
  scale?: { x: number; y: number; set?: (x: number, y?: number) => void };
}

export interface GraphNode {
  id: string;
  path?: string;
  type?: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  weight?: number;
  forward?: Record<string, any>;
  reverse?: Record<string, any>;
  circle?: PixiDisplayObject;
  text?: PixiDisplayObject;
  _pinnedX?: number;
  _pinnedY?: number;
  _origTint?: number;
  _hopVisible?: boolean;
  _hopLevel?: number;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  line?: PixiDisplayObject;
  px?: PixiDisplayObject;
  arrow?: PixiDisplayObject;
  _linkVisible?: boolean;
}

export interface GraphRenderer {
  nodes?: GraphNode[];
  links?: GraphLink[];
  nodeLookup?: Record<string, GraphNode>;
  px?: {
    renderer?: {
      on?: (event: string, fn: () => void) => void;
    };
    ticker?: {
      add?: (fn: () => void) => void;
    };
  };
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
  renderCallback?: (...args: any[]) => any;
  setPan?: (x: number, y: number) => void;
  setScale?: (scale: number) => void;
  changed?: () => void;
  start?: () => void;
  stop?: () => void;
  _graphProHooked?: boolean;
  _hopFilterActive?: boolean;
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

export interface HopDistanceConfig {
  hop1Radius: number;
  hop2Gap: number;
  hop3Gap: number;
  nodeArcSpacing: number;
}

export interface PluginSettings {
  defaultCircleRadius: number;
  hop1Radius: number;
  hop2Gap: number;
  hop3Gap: number;
  nodeArcSpacing: number;
  gridSize: number;
  enableMarqueeSelection: boolean;
  autoCenterActiveNote: boolean;
  autoCircularInLocalGraph: boolean;
  defaultHopDepth: number;
  historyMaxDepth: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  defaultCircleRadius: 160,
  hop1Radius: 160,
  hop2Gap: 160,
  hop3Gap: 160,
  nodeArcSpacing: 18,
  gridSize: 50,
  enableMarqueeSelection: true,
  autoCenterActiveNote: true,
  autoCircularInLocalGraph: true,
  defaultHopDepth: 1,
  historyMaxDepth: 30,
};
