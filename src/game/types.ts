export type Vec = { x: number; y: number };
export type GameMode = 'start' | 'playing' | 'levelComplete' | 'campaignComplete';
export type HazardMode = 'safe' | 'bounce' | 'block';

export type Segment = { a: Vec; b: Vec; bounce?: number; friction?: number; color?: string };
export type Rect = { x: number; y: number; w: number; h: number };

export type Switch = {
  id: string;
  rect: Rect;
  targetId: string;
  pressed: boolean;
  color: string;
};

export type Gate = {
  id: string;
  rect: Rect;
  open: boolean;
  kind: 'gate' | 'bridge' | 'platform';
  color: string;
  openOffset?: Vec;
};

export type Hazard = {
  rect: Rect;
  color: string;
  safePlayer: number;
  mode: HazardMode;
};

export type Bumper = { center: Vec; radius: number; strength: number; color: string; targetId?: string };
export type Fan = { rect: Rect; force: Vec; color: string };

export type Level = {
  name: string;
  subtitle: string;
  width: number;
  height: number;
  starts: Vec[];
  hole: Vec;
  wind: number;
  terrain: Segment[];
  staticRects: Rect[];
  switches: Switch[];
  gates: Gate[];
  hazards: Hazard[];
  bumpers: Bumper[];
  fans: Fan[];
  par: number;
};

export type Ball = {
  pos: Vec;
  vel: Vec;
  radius: number;
  color: string;
  strokes: number;
  inHole: boolean;
  stopped: boolean;
  trail: Vec[];
  restTime: number;
};

export type Player = {
  id: number;
  name: string;
  color: string;
  accent: string;
  ball: Ball;
};

export type Particle = { pos: Vec; vel: Vec; life: number; maxLife: number; color: string; size: number };

export type CameraMode = 'full' | 'follow';

export type GameState = {
  mode: GameMode;
  levelIndex: number;
  playerCount: number;
  level: Level;
  players: Player[];
  activePlayer: number;
  angle: number;
  power: number;
  shotInMotion: boolean;
  cameraMode: CameraMode;
  focusIndex: number;
  time: number;
  particles: Particle[];
  message: string;
};

export type InputState = {
  down: Set<string>;
  pressed: Set<string>;
};
