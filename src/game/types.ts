export type Vec = { x: number; y: number };
export type GamePhase = 'start' | 'aiming' | 'flying' | 'levelComplete' | 'campaignComplete';
export type HazardColor = 'red' | 'blue' | 'green' | 'gold';

export type Segment = {
  a: Vec;
  b: Vec;
  kind?: 'ground' | 'wall' | 'platform' | 'bumper';
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

export type Hole = { x: number; y: number; radius: number };

export type Level = {
  name: string;
  subtitle: string;
  width: number;
  height: number;
  starts: Vec[];
  hole: Hole;
  wind: number;
  segments: Segment[];
  rects: Rect[];
  switches: PressureSwitch[];
  hint: string;
  skyTop: string;
  skyBottom: string;
};

export type Player = {
  id: number;
  name: string;
  color: string;
  safeColor: HazardColor;
  strokes: number;
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

export type GameState = {
  phase: GamePhase;
  playerCount: number;
  levelIndex: number;
  level: Level;
  players: Player[];
  balls: Ball[];
  activePlayerIndex: number;
  angle: number;
  power: number;
  camera: Vec;
  cameraMode: CameraMode;
  particles: Particle[];
  messageTimer: number;
  time: number;
};

export type InputState = {
  held: Set<string>;
  pressed: Set<string>;
};
