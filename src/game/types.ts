export type Vec = { x: number; y: number };
export type GamePhase = 'start' | 'aiming' | 'flying' | 'levelComplete' | 'campaignComplete';
export type HazardColor = 'red' | 'blue' | 'green' | 'gold';

/** Mario-style solid ground block (y = top edge of grass surface). */
export type GroundBlock = {
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: 'solid' | 'platform';
};

export type Segment = {
  a: Vec;
  b: Vec;
  kind?: 'ramp' | 'bumper';
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
  /** Top rim of the cup (ground level at hole). */
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
  blocks: GroundBlock[];
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
  time: number;
};

export type InputState = {
  held: Set<string>;
  pressed: Set<string>;
};
