import type { Level, Segment, Vec } from './types';

const seg = (x1: number, y1: number, x2: number, y2: number, bounce = 0.42, friction = 0.985, color = '#3f8f4e'): Segment => ({
  a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, bounce, friction, color,
});

const starts = (base: Vec): Vec[] => [0, 1, 2, 3].map((i) => ({ x: base.x + i * 34, y: base.y - i * 4 }));

export const levels: Level[] = [
  {
    name: 'Tutorial Hills',
    subtitle: 'Learn the arc: bounce over the rolling knolls and settle in the cup.',
    width: 1800,
    height: 900,
    starts: starts({ x: 120, y: 650 }),
    hole: { x: 1600, y: 647 },
    wind: 10,
    par: 3,
    terrain: [
      seg(0, 780, 190, 700), seg(190, 700, 390, 705), seg(390, 705, 610, 610),
      seg(610, 610, 850, 660), seg(850, 660, 1040, 585), seg(1040, 585, 1270, 675),
      seg(1270, 675, 1510, 650), seg(1510, 650, 1800, 690),
      seg(640, 505, 840, 480, 0.36), seg(980, 460, 1130, 430, 0.36),
    ],
    staticRects: [
      { x: 720, y: 740, w: 120, h: 28 },
      { x: 1180, y: 735, w: 90, h: 26 },
    ],
    switches: [], gates: [], hazards: [],
    bumpers: [{ center: { x: 1240, y: 620 }, radius: 28, strength: 1.25, color: '#ffd166' }],
    fans: [],
  },
  {
    name: 'Switch Bridge',
    subtitle: 'Park one ball on the flower switch to lift the bridge for friends.',
    width: 1950,
    height: 900,
    starts: starts({ x: 105, y: 650 }),
    hole: { x: 1780, y: 620 },
    wind: -18,
    par: 5,
    terrain: [
      seg(0, 760, 220, 690), seg(220, 690, 500, 700), seg(500, 700, 720, 650),
      seg(720, 650, 900, 650), seg(1110, 650, 1350, 610), seg(1350, 610, 1610, 640),
      seg(1610, 640, 1950, 640), seg(420, 520, 610, 500, 0.35), seg(1280, 470, 1510, 470, 0.35),
    ],
    staticRects: [{ x: 585, y: 710, w: 85, h: 32 }],
    switches: [{ id: 'flower', rect: { x: 470, y: 672, w: 90, h: 16 }, targetId: 'bridge-a', pressed: false, color: '#f77ac6' }],
    gates: [
      { id: 'bridge-a', rect: { x: 902, y: 646, w: 210, h: 24 }, open: false, kind: 'bridge', color: '#f5c542' },
      { id: 'door-a', rect: { x: 1510, y: 490, w: 34, h: 150 }, open: false, kind: 'gate', color: '#7bdff2', openOffset: { x: 0, y: -140 } },
    ],
    hazards: [{ rect: { x: 760, y: 674, w: 110, h: 60 }, color: '#53d769', safePlayer: 0, mode: 'bounce' }],
    bumpers: [{ center: { x: 1420, y: 575 }, radius: 30, strength: 1.5, color: '#ff8fab', targetId: 'flower' }],
    fans: [{ rect: { x: 1180, y: 520, w: 80, h: 120 }, force: { x: 46, y: -110 }, color: '#a0c4ff' }],
  },
  {
    name: 'Hazard Cavern',
    subtitle: 'Use color immunity, switches, fans, and bumpers to solve the cavern siege.',
    width: 2200,
    height: 980,
    starts: starts({ x: 120, y: 720 }),
    hole: { x: 2030, y: 690 },
    wind: 34,
    par: 7,
    terrain: [
      seg(0, 850, 240, 750), seg(240, 750, 460, 785), seg(460, 785, 670, 700),
      seg(670, 700, 850, 735), seg(850, 735, 1030, 610), seg(1030, 610, 1220, 640),
      seg(1220, 640, 1410, 590), seg(1410, 590, 1600, 705), seg(1600, 705, 1840, 710),
      seg(1840, 710, 2200, 705), seg(330, 585, 530, 555, 0.35), seg(740, 515, 940, 500, 0.36),
      seg(1260, 440, 1460, 420, 0.35), seg(1640, 515, 1850, 500, 0.36),
    ],
    staticRects: [{ x: 580, y: 820, w: 120, h: 30 }, { x: 1080, y: 735, w: 90, h: 28 }],
    switches: [
      { id: 'violet', rect: { x: 520, y: 750, w: 90, h: 16 }, targetId: 'lift-violet', pressed: false, color: '#c77dff' },
      { id: 'amber', rect: { x: 1310, y: 564, w: 88, h: 16 }, targetId: 'final-door', pressed: false, color: '#ffd166' },
    ],
    gates: [
      { id: 'lift-violet', rect: { x: 900, y: 700, w: 170, h: 24 }, open: false, kind: 'platform', color: '#c77dff', openOffset: { x: 0, y: -145 } },
      { id: 'final-door', rect: { x: 1860, y: 550, w: 36, h: 160 }, open: false, kind: 'gate', color: '#ffd166', openOffset: { x: 0, y: -150 } },
    ],
    hazards: [
      { rect: { x: 690, y: 720, w: 135, h: 72 }, color: '#ff4d6d', safePlayer: 1, mode: 'bounce' },
      { rect: { x: 1480, y: 610, w: 120, h: 88 }, color: '#4dabf7', safePlayer: 2, mode: 'block' },
      { rect: { x: 1710, y: 635, w: 90, h: 60 }, color: '#53d769', safePlayer: 0, mode: 'bounce' },
    ],
    bumpers: [
      { center: { x: 1125, y: 570 }, radius: 36, strength: 1.7, color: '#ffbe0b' },
      { center: { x: 1550, y: 660 }, radius: 30, strength: 1.45, color: '#f15bb5', targetId: 'amber' },
    ],
    fans: [
      { rect: { x: 360, y: 630, w: 100, h: 115 }, force: { x: 65, y: -120 }, color: '#90e0ef' },
      { rect: { x: 1190, y: 500, w: 95, h: 130 }, force: { x: -35, y: -135 }, color: '#bde0fe' },
    ],
  },
];
