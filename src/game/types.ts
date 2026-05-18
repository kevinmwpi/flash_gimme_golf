export type Vec = { x: number; y: number };
export type GamePhase = 'start' | 'aiming' | 'flying' | 'levelComplete' | 'campaignComplete';
export type HazardColor = 'red' | 'blue' | 'green' | 'gold';

/** One solid ground mass: hilly top surface extruded down to baseY. */
export type TerrainPiece = {
  surface: Vec[];
  baseY: number;
};

export type Terrain = {
  pieces: TerrainPiece[];
  /** World-x ranges with no ground (balls fall; bridges span these). */
  gaps?: { x1: number; x2: number }[];
};

export type Segment = {
  a: Vec;
  b: Vec;
  kind?: 'platform' | 'bumper';
  bounce?: number;
  color?: string;
  switchId?: string;
  activeWhen?: boolean;
};

export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'gate' | 'bridge' | 'bumper' | 'hazard' | 'sand' | 'spring' | 'fan';
  color?: HazardColor;
  switchId?: string;
  activeWhen?: boolean;
  vx?: number;
  vy?: number;
  bounce?: number;
  label?: string;
};

export type PressureSwitch = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pressed: boolean;
  label: string;
};

export type Hole = {
  x: number;
  y: number;
  radius: number;
  rimY: number;
  depth: number;
};

export type Level = {
  name: string;
  subtitle: string;
  width: number;
  height: number;
  starts: Vec[];
  hole: Hole;
  wind: number;
  terrain: Terrain;
  segments: Segment[];
  rects: Rect[];
  switches: PressureSwitch[];
  hint: string;
};

export type Player = {
  id: number;
  name: string;
  color: string;
  safeColor: HazardColor;
  strokes: number;
};

export type Golfer = {
  playerId: number;
  pos: Vec;
  facing: number;
  ready: boolean;
  handoffFrom?: Vec;
};

export type Ball = {
  playerId: number;
  pos: Vec;
  prevPos: Vec;
  vel: Vec;
  radius: number;
  color: string;
  safeColor: HazardColor;
  strokes: number;
  sunk: boolean;
  asleep: boolean;
  sinking: boolean;
  sinkT: number;
  trail: Vec[];
};

export type Particle = {
  pos: Vec;
  vel: Vec;
  life: number;
  maxLife: number;
  color: string;
  size: number;
};

export type CameraMode = 'follow' | 'overview';

export type LeaderboardRow = {
  rank: number;
  playerId: number;
  name: string;
  color: string;
  total: number;
  perLevel: number[];
  isWinner: boolean;
};

export type GameState = {
  phase: GamePhase;
  playerCount: number;
  levelIndex: number;
  level: Level;
  players: Player[];
  golfers: Golfer[];
  balls: Ball[];
  activePlayerIndex: number;
  angle: number;
  power: number;
  camera: Vec;
  cameraMode: CameraMode;
  particles: Particle[];
  messageTimer: number;
  /** Seconds left before the active golfer is ready for the next shot. */
  turnHandoffLeft: number;
  time: number;
  /** Strokes per level per player (player index → level scores). */
  campaignHistory: number[][];
};

export type InputState = {
  held: Set<string>;
  pressed: Set<string>;
};
