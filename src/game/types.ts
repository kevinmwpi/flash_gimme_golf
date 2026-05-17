export type Vec = { x: number; y: number };

export type GameMode = 'menu' | 'playing' | 'levelComplete' | 'gameComplete';

export type SegmentKind = 'terrain' | 'gate' | 'bridge' | 'bumper' | 'hazard' | 'platform';

export type Segment = {
  id?: string;
  a: Vec;
  b: Vec;
  kind?: SegmentKind;
  color?: string;
  active?: boolean;
  safePlayers?: number[];
  bounce?: number;
  friction?: number;
  switchId?: string;
  movesTo?: { a: Vec; b: Vec };
  baseA?: Vec;
  baseB?: Vec;
};

export type Rect = {
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: SegmentKind;
  color?: string;
  active?: boolean;
  safePlayers?: number[];
  bounce?: number;
  switchId?: string;
  movesTo?: { x: number; y: number; w: number; h: number };
  base?: { x: number; y: number; w: number; h: number };
};

export type Switch = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pressed: boolean;
  targetIds: string[];
  label: string;
};

export type Ball = {
  pos: Vec;
  vel: Vec;
  radius: number;
  playerId: number;
  moving: boolean;
  sunk: boolean;
  restingFrames: number;
  trail: Vec[];
};

export type Player = {
  id: number;
  name: string;
  color: string;
  accent: string;
  spawn: Vec;
  ball: Ball;
  strokes: number;
  finished: boolean;
  safeHazardColor: string;
};

export type Hole = { x: number; y: number; radius: number };

export type Particle = { pos: Vec; vel: Vec; life: number; color: string; size: number };

export type Level = {
  name: string;
  subtitle: string;
  width: number;
  height: number;
  wind: number;
  sky: [string, string];
  spawns: Vec[];
  hole: Hole;
  terrain: Segment[];
  rects: Rect[];
  switches: Switch[];
};

export type Camera = { x: number; y: number; zoom: number; focusIndex: number };

export type GameState = {
  mode: GameMode;
  playerCount: number;
  levelIndex: number;
  level: Level;
  players: Player[];
  activePlayerIndex: number;
  angle: number;
  power: number;
  camera: Camera;
  shotInFlight: boolean;
  particles: Particle[];
  time: number;
  message: string;
};

export type InputState = {
  keysDown: Set<string>;
  keysPressed: Set<string>;
};
