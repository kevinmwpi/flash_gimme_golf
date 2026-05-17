import { HazardColor, Level } from './types';

const ground = (points: number[][]) => points.slice(0, -1).map((p, i) => ({
  a: { x: p[0], y: p[1] },
  b: { x: points[i + 1][0], y: points[i + 1][1] },
  kind: 'ground' as const,
}));

export const playerColors = ['#ff5d73', '#50b7ff', '#72de72', '#ffd75c'];
export const safeColors: HazardColor[] = ['red', 'blue', 'green', 'gold'];

export const levels: Level[] = [
  {
    name: 'Tutorial Hills',
    subtitle: 'Warm up your siege swing.',
    width: 1850,
    height: 760,
    starts: [{ x: 120, y: 560 }, { x: 160, y: 560 }, { x: 200, y: 560 }, { x: 240, y: 560 }],
    hole: { x: 1708, y: 515, radius: 18 },
    wind: 9,
    skyTop: '#8fd3ff',
    skyBottom: '#f8dca1',
    hint: 'Use A/D or arrows to aim, W/S to set power, Space to shoot. Sink every ball.',
    switches: [],
    rects: [
      { x: 775, y: 570, w: 58, h: 16, kind: 'bumper', bounce: 1.2, label: 'boing' },
      { x: 1160, y: 580, w: 150, h: 20, kind: 'sand', label: 'sand' },
      { x: 1380, y: 542, w: 42, h: 14, kind: 'spring', bounce: 1.55, label: 'spring' },
    ],
    segments: [
      ...ground([[40,620],[230,598],[430,640],[630,575],[810,610],[990,555],[1210,625],[1430,548],[1620,540],[1815,568]]),
      { a: { x: 925, y: 520 }, b: { x: 1050, y: 475 }, kind: 'platform' },
      { a: { x: 1050, y: 475 }, b: { x: 1170, y: 506 }, kind: 'platform' },
      { a: { x: 1560, y: 500 }, b: { x: 1775, y: 500 }, kind: 'platform' },
    ],
  },
  {
    name: 'Switch Bridge',
    subtitle: 'Hold the garden key open for your friends.',
    width: 2050,
    height: 790,
    starts: [{ x: 112, y: 604 }, { x: 158, y: 604 }, { x: 204, y: 604 }, { x: 250, y: 604 }],
    hole: { x: 1895, y: 485, radius: 18 },
    wind: -13,
    skyTop: '#7bd8d1',
    skyBottom: '#d6f39b',
    hint: 'Rest any ball on a pressure switch to open gates, extend bridges, and move bumpers.',
    switches: [
      { id: 'bridge', x: 620, y: 628, w: 96, h: 13, pressed: false, label: 'BRIDGE' },
      { id: 'lift', x: 1290, y: 528, w: 92, h: 13, pressed: false, label: 'LIFT' },
    ],
    rects: [
      { x: 890, y: 583, w: 260, h: 20, kind: 'bridge', switchId: 'bridge', activeWhen: true, label: 'switch bridge' },
      { x: 852, y: 460, w: 25, h: 155, kind: 'gate', switchId: 'bridge', activeWhen: false, label: 'gate' },
      { x: 1420, y: 455, w: 34, h: 130, kind: 'bumper', switchId: 'lift', activeWhen: true, vx: 0, vy: -70, bounce: 1.35, label: 'moving bumper' },
      { x: 1585, y: 550, w: 170, h: 18, kind: 'spring', bounce: 1.6, label: 'spring shelf' },
    ],
    segments: [
      ...ground([[40,660],[295,635],[500,662],[720,640],[830,612]]),
      ...ground([[1180,625],[1390,540],[1545,588],[1800,520],[2000,510]]),
      { a: { x: 1180, y: 625 }, b: { x: 1180, y: 705 }, kind: 'wall' },
      { a: { x: 830, y: 612 }, b: { x: 830, y: 706 }, kind: 'wall' },
      { a: { x: 480, y: 548 }, b: { x: 640, y: 502 }, kind: 'platform' },
      { a: { x: 640, y: 502 }, b: { x: 770, y: 535 }, kind: 'platform' },
    ],
  },
  {
    name: 'Hazard Cavern',
    subtitle: 'Colored wards, fans, bumpers, and a shared cup.',
    width: 2250,
    height: 830,
    starts: [{ x: 108, y: 636 }, { x: 154, y: 636 }, { x: 200, y: 636 }, { x: 246, y: 636 }],
    hole: { x: 2118, y: 390, radius: 18 },
    wind: 22,
    skyTop: '#32396f',
    skyBottom: '#132132',
    hint: 'Colored hazard walls let matching players pass. Others bounce away. Use switches to shift bumpers.',
    switches: [
      { id: 'cavern', x: 980, y: 646, w: 95, h: 13, pressed: false, label: 'SHIFT' },
    ],
    rects: [
      { x: 555, y: 575, w: 26, h: 110, kind: 'hazard', color: 'red', label: 'red ward' },
      { x: 770, y: 510, w: 26, h: 142, kind: 'hazard', color: 'blue', label: 'blue ward' },
      { x: 1160, y: 545, w: 180, h: 20, kind: 'sand', label: 'crystal sand' },
      { x: 1445, y: 460, w: 34, h: 155, kind: 'bumper', switchId: 'cavern', activeWhen: true, vx: 95, vy: -35, bounce: 1.45, label: 'shift bumper' },
      { x: 1660, y: 512, w: 54, h: 18, kind: 'spring', bounce: 1.7, label: 'spring' },
      { x: 1830, y: 465, w: 84, h: 118, kind: 'fan', label: 'updraft' },
      { x: 1985, y: 426, w: 210, h: 18, kind: 'bridge', switchId: 'cavern', activeWhen: true, label: 'final bridge' },
    ],
    segments: [
      ...ground([[40,690],[320,650],[525,685],[705,615],[915,685],[1130,665],[1360,615],[1580,650],[1790,575],[1970,440],[2220,432]]),
      { a: { x: 365, y: 555 }, b: { x: 520, y: 500 }, kind: 'platform' },
      { a: { x: 860, y: 530 }, b: { x: 1050, y: 485 }, kind: 'platform' },
      { a: { x: 1320, y: 495 }, b: { x: 1495, y: 450 }, kind: 'platform' },
      { a: { x: 1880, y: 520 }, b: { x: 1980, y: 435 }, kind: 'platform' },
    ],
  },
];
