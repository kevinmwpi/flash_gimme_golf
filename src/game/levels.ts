import { Level, Segment, Vec } from './types';

const seg = (a: Vec, b: Vec, extra: Partial<Segment> = {}): Segment => ({ a, b, kind: 'terrain', ...extra });

export const levels: Level[] = [
  {
    name: 'Tutorial Hills',
    subtitle: 'Learn the artillery swing: arc over the soft hills and settle near the flag.',
    width: 1800,
    height: 900,
    wind: 8,
    sky: ['#6ed0ff', '#c5f1ff'],
    spawns: [
      { x: 150, y: 642 }, { x: 205, y: 634 }, { x: 260, y: 631 }, { x: 315, y: 632 },
    ],
    hole: { x: 1605, y: 595, radius: 19 },
    terrain: [
      seg({ x: 0, y: 790 }, { x: 120, y: 700 }),
      seg({ x: 120, y: 700 }, { x: 360, y: 660 }),
      seg({ x: 360, y: 660 }, { x: 570, y: 710 }),
      seg({ x: 570, y: 710 }, { x: 780, y: 610 }),
      seg({ x: 780, y: 610 }, { x: 1010, y: 665 }),
      seg({ x: 1010, y: 665 }, { x: 1220, y: 575 }),
      seg({ x: 1220, y: 575 }, { x: 1450, y: 625 }),
      seg({ x: 1450, y: 625 }, { x: 1740, y: 610 }),
      seg({ x: 1740, y: 610 }, { x: 1800, y: 680 }),
      seg({ x: 0, y: 120 }, { x: 0, y: 900 }),
      seg({ x: 1800, y: 120 }, { x: 1800, y: 900 }),
    ],
    rects: [
      { x: 780, y: 580, w: 150, h: 18, kind: 'bumper', color: '#ff5c8a', bounce: 1.05 },
      { x: 1100, y: 545, w: 95, h: 16, kind: 'platform', color: '#9be564' },
    ],
    switches: [],
  },
  {
    name: 'Switch Bridge',
    subtitle: 'Park one ball on the glowing plate to extend a bridge for the team.',
    width: 2000,
    height: 920,
    wind: -12,
    sky: ['#8a7dff', '#d7d1ff'],
    spawns: [
      { x: 130, y: 655 }, { x: 185, y: 655 }, { x: 240, y: 655 }, { x: 295, y: 655 },
    ],
    hole: { x: 1810, y: 530, radius: 19 },
    terrain: [
      seg({ x: 0, y: 760 }, { x: 520, y: 700 }),
      seg({ x: 520, y: 700 }, { x: 750, y: 720 }),
      seg({ x: 900, y: 720 }, { x: 1180, y: 665 }),
      seg({ x: 1180, y: 665 }, { x: 1380, y: 690 }),
      seg({ x: 1500, y: 625 }, { x: 1980, y: 560 }),
      seg({ x: 0, y: 120 }, { x: 0, y: 920 }),
      seg({ x: 2000, y: 120 }, { x: 2000, y: 920 }),
    ],
    rects: [
      { id: 'drawbridge', x: 750, y: 820, w: 155, h: 18, kind: 'bridge', color: '#f9c74f', active: false, switchId: 'bridgeA', movesTo: { x: 750, y: 704, w: 155, h: 18 } },
      { id: 'stonegate', x: 1390, y: 555, w: 38, h: 138, kind: 'gate', color: '#7b8794', active: true, switchId: 'bridgeA', movesTo: { x: 1390, y: 760, w: 38, h: 138 } },
      { x: 1030, y: 626, w: 95, h: 18, kind: 'bumper', color: '#4cc9f0', bounce: 1.1 },
    ],
    switches: [
      { id: 'bridgeA', x: 575, y: 674, w: 84, h: 18, pressed: false, targetIds: ['drawbridge', 'stonegate'], label: 'BRIDGE' },
    ],
  },
  {
    name: 'Hazard Cavern',
    subtitle: 'Colored force fields favor matching players; switches wake bumpers and moving ledges.',
    width: 2200,
    height: 980,
    wind: 22,
    sky: ['#18243b', '#36405f'],
    spawns: [
      { x: 125, y: 710 }, { x: 185, y: 705 }, { x: 245, y: 700 }, { x: 305, y: 695 },
    ],
    hole: { x: 2025, y: 650, radius: 19 },
    terrain: [
      seg({ x: 0, y: 820 }, { x: 410, y: 740 }),
      seg({ x: 410, y: 740 }, { x: 640, y: 785 }),
      seg({ x: 640, y: 785 }, { x: 900, y: 700 }),
      seg({ x: 1110, y: 720 }, { x: 1350, y: 650 }),
      seg({ x: 1350, y: 650 }, { x: 1560, y: 700 }),
      seg({ x: 1680, y: 735 }, { x: 2180, y: 675 }),
      seg({ x: 0, y: 120 }, { x: 0, y: 980 }),
      seg({ x: 2200, y: 120 }, { x: 2200, y: 980 }),
    ],
    rects: [
      { x: 705, y: 645, w: 24, h: 116, kind: 'hazard', color: '#ff5c8a', safePlayers: [0], bounce: 1.0 },
      { x: 930, y: 588, w: 24, h: 162, kind: 'hazard', color: '#4cc9f0', safePlayers: [1], bounce: 1.0 },
      { id: 'lift', x: 1015, y: 840, w: 135, h: 18, kind: 'bridge', color: '#b8f26a', active: false, switchId: 'liftSwitch', movesTo: { x: 1015, y: 705, w: 135, h: 18 } },
      { id: 'wakeBumper', x: 1510, y: 628, w: 120, h: 20, kind: 'bumper', color: '#ffd166', bounce: 1.25, active: false, switchId: 'liftSwitch', movesTo: { x: 1510, y: 628, w: 120, h: 20 } },
      { x: 1715, y: 640, w: 90, h: 18, kind: 'bumper', color: '#f15bb5', bounce: 1.18 },
    ],
    switches: [
      { id: 'liftSwitch', x: 1210, y: 622, w: 84, h: 18, pressed: false, targetIds: ['lift', 'wakeBumper'], label: 'LIFT' },
    ],
  },
];
