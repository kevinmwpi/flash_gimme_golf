import { HazardColor, Level } from './types';
import { blocksFromHeights, blocksFromRow } from './terrain';

export const playerColors = ['#ff5d73', '#50b7ff', '#72de72', '#ffd75c'];
export const safeColors: HazardColor[] = ['red', 'blue', 'green', 'gold'];

const hole = (x: number, surfaceY: number, radius = 16) => ({
  x,
  y: surfaceY + radius * 0.35,
  radius,
  rimY: surfaceY,
  depth: radius * 1.8,
});

export const levels: Level[] = [
  {
    name: 'Tutorial Hills',
    subtitle: 'Solid ground, gentle slopes, and a shared cup.',
    width: 1680,
    height: 720,
    starts: [
      { x: 100, y: 0 },
      { x: 140, y: 0 },
      { x: 180, y: 0 },
      { x: 220, y: 0 },
    ],
    hole: hole(1540, 468),
    wind: 6,
    hint: 'Walk to your ball, aim, and shoot. Grass rolls farther than sand; springs launch you up.',
    switches: [],
    rects: [
      { x: 520, y: 508, w: 48, h: 14, kind: 'spring', bounce: 1.5, label: 'spring' },
      { x: 920, y: 548, w: 120, h: 18, kind: 'sand', label: 'sand' },
      { x: 1180, y: 508, w: 44, h: 14, kind: 'bumper', bounce: 1.15, label: 'boing' },
    ],
    segments: [
      { a: { x: 480, y: 548 }, b: { x: 600, y: 508 }, kind: 'ramp' },
      { a: { x: 1080, y: 548 }, b: { x: 1220, y: 508 }, kind: 'ramp' },
    ],
    blocks: [
      ...blocksFromRow(0, 42, 580),
      ...blocksFromHeights([
        { x: 400, w: 200, surfaceY: 548, thickness: 100 },
        { x: 640, w: 160, surfaceY: 508, thickness: 100 },
        { x: 840, w: 280, surfaceY: 548, thickness: 100 },
        { x: 1160, w: 200, surfaceY: 508, thickness: 100 },
        { x: 1400, w: 280, surfaceY: 468, thickness: 100 },
      ]),
    ],
  },
  {
    name: 'Switch Bridge',
    subtitle: 'Hold a switch to raise the bridge for your team.',
    width: 1880,
    height: 760,
    starts: [
      { x: 90, y: 0 },
      { x: 130, y: 0 },
      { x: 170, y: 0 },
      { x: 210, y: 0 },
    ],
    hole: hole(1720, 428),
    wind: -10,
    hint: 'Park a ball on the pressure plate to extend the bridge across the gap.',
    switches: [
      { id: 'bridge', x: 520, y: 598, w: 88, h: 12, pressed: false, label: 'BRIDGE' },
    ],
    rects: [
      { x: 698, y: 568, w: 258, h: 18, kind: 'bridge', switchId: 'bridge', activeWhen: true, label: 'bridge' },
      { x: 1228, y: 434, w: 48, h: 14, kind: 'spring', bounce: 1.55, label: 'spring' },
    ],
    segments: [
      { a: { x: 1100, y: 548 }, b: { x: 1240, y: 458 }, kind: 'ramp' },
    ],
    blocks: [
      ...blocksFromRow(0, 18, 620),
      ...blocksFromRow(960, 23, 620),
      ...blocksFromHeights([
        { x: 360, w: 320, surfaceY: 580, thickness: 110 },
        { x: 1080, w: 320, surfaceY: 548, thickness: 110 },
        { x: 1320, w: 560, surfaceY: 428, thickness: 110 },
      ]),
    ],
  },
  {
    name: 'Hazard Cavern',
    subtitle: 'Color wards, fans, and springs on a path to the cup.',
    width: 2100,
    height: 800,
    starts: [
      { x: 80, y: 0 },
      { x: 120, y: 0 },
      { x: 160, y: 0 },
      { x: 200, y: 0 },
    ],
    hole: hole(1940, 368),
    wind: 14,
    hint: 'Matching players pass colored wards. Use the spring and fan to reach the upper route.',
    switches: [
      { id: 'gate', x: 1080, y: 588, w: 90, h: 12, pressed: false, label: 'GATE' },
    ],
    rects: [
      { x: 380, y: 568, w: 22, h: 100, kind: 'hazard', color: 'red', label: 'red' },
      { x: 560, y: 528, w: 22, h: 120, kind: 'hazard', color: 'blue', label: 'blue' },
      { x: 900, y: 548, w: 100, h: 16, kind: 'sand', label: 'sand' },
      { x: 1280, y: 488, w: 44, h: 14, kind: 'spring', bounce: 1.65, label: 'spring' },
      { x: 1520, y: 448, w: 90, h: 110, kind: 'fan', label: 'fan' },
      { x: 1720, y: 408, w: 200, h: 18, kind: 'bridge', switchId: 'gate', activeWhen: true, label: 'gate' },
    ],
    segments: [
      { a: { x: 740, y: 548 }, b: { x: 880, y: 488 }, kind: 'ramp' },
      { a: { x: 1180, y: 508 }, b: { x: 1280, y: 448 }, kind: 'ramp' },
    ],
    blocks: [
      ...blocksFromRow(0, 52, 640),
      ...blocksFromHeights([
        { x: 280, w: 200, surfaceY: 580, thickness: 120 },
        { x: 680, w: 240, surfaceY: 548, thickness: 120 },
        { x: 1000, w: 200, surfaceY: 508, thickness: 120 },
        { x: 1360, w: 280, surfaceY: 448, thickness: 120 },
        { x: 1680, w: 420, surfaceY: 368, thickness: 120 },
      ]),
    ],
  },
];
