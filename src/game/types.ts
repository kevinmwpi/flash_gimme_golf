export type Vec = { x: number; y: number };
export type GameMode = 'start' | 'playing' | 'levelComplete' | 'finished';
export type SegmentKind = 'terrain' | 'gate' | 'bridge' | 'bumper' | 'hazard' | 'moving';

export type PlayerColor = 'red' | 'blue' | 'green' | 'gold';

export type Segment = {
  id?: string;
  a: Vec;
  b: Vec;
  kind?: SegmentKind;
  color?: string;
  safeFor?: number[];
  switchId?: string;
  openWhenPressed?: boolean;
  moveTo?: { a: Vec; b: Vec };
  bounce?: number;
};

export type Rect = { x: number; y: number; w: number; h: number; id?: string; switchId?: string };

export type Switch = {
  id: string;
  x: number;
  y: number;
  w: number;
  pressed: boolean;
  label: string;
};

export type Fan = { x: number; y: number; w: number; h: number; force: Vec; label: string };

export type Level = {
  name: string;
  subtitle: string;
  width: number;
  height: number;
  wind: number;
  starts: Vec[];
  hole: Vec;
  segments: Segment[];
  switches: Switch[];
  platforms: Rect[];
  fans?: Fan[];
  parHint: string;
};

export type Ball = {
  pos: Vec;
  vel: Vec;
  radius: number;
  moving: boolean;
  inHole: boolean;
  onGround: boolean;
  trail: Vec[];
};

export type Player = {
  id: number;
  name: string;
  color: string;
  colorKey: PlayerColor;
  ball: Ball;
  strokes: number;
  angle: number;
  power: number;
};

export type Particle = { pos: Vec; vel: Vec; life: number; color: string; size: number };

export type CameraMode = 'full' | 'follow';

export type GameState = {
  mode: GameMode;
  levelIndex: number;
  level: Level;
  playerCount: number;
  players: Player[];
  activePlayer: number;
  camera: { x: number; y: number; zoom: number; mode: CameraMode };
  particles: Particle[];
  shotInFlight: boolean;
  time: number;
  message: string;
};

export type InputState = {
  keys: Set<string>;
  pressed: Set<string>;
};
