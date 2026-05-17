import type { Level } from './types';

const ground = (points: [number, number][]) =>
  points.slice(0, -1).map((p, i) => ({ a: { x: p[0], y: p[1] }, b: { x: points[i + 1][0], y: points[i + 1][1] } }));

export const levels: Level[] = [
  {
    name: 'Tutorial Hills',
    subtitle: 'Learn the arc, ride the slopes, share the cup.',
    width: 1500,
    height: 760,
    wind: 8,
    starts: [{ x: 115, y: 572 }, { x: 155, y: 568 }, { x: 195, y: 565 }, { x: 235, y: 562 }],
    hole: { x: 1370, y: 543 },
    switches: [],
    platforms: [
      { x: 640, y: 505, w: 130, h: 18 },
      { x: 855, y: 445, w: 130, h: 18 },
    ],
    segments: [
      ...ground([[30, 610], [190, 590], [345, 625], [505, 560], [665, 585], [835, 520], [1005, 565], [1180, 535], [1460, 558]]),
      { a: { x: 640, y: 505 }, b: { x: 770, y: 505 }, kind: 'terrain' },
      { a: { x: 855, y: 445 }, b: { x: 985, y: 445 }, kind: 'terrain' },
      { a: { x: 455, y: 505 }, b: { x: 490, y: 455 }, kind: 'bumper', color: '#ff6b70', bounce: 1.18 },
      { a: { x: 1095, y: 530 }, b: { x: 1120, y: 480 }, kind: 'bumper', color: '#8cffd2', bounce: 1.12 },
    ],
    parHint: 'Tip: tiny taps roll; high power lobs over ridges.',
  },
  {
    name: 'Switch Bridge',
    subtitle: 'Hold the pressure switch to raise the glowing bridge.',
    width: 1700,
    height: 800,
    wind: -12,
    starts: [{ x: 115, y: 625 }, { x: 155, y: 620 }, { x: 195, y: 615 }, { x: 235, y: 610 }],
    hole: { x: 1560, y: 520 },
    switches: [{ id: 'bridge', x: 545, y: 616, w: 88, pressed: false, label: 'BRIDGE' }],
    platforms: [
      { x: 825, y: 550, w: 260, h: 18, switchId: 'bridge' },
      { x: 1240, y: 520, w: 220, h: 18 },
    ],
    segments: [
      ...ground([[30, 660], [270, 632], [475, 640], [630, 642], [735, 705], [820, 705], [1120, 705], [1200, 570], [1450, 545], [1660, 530]]),
      { a: { x: 825, y: 550 }, b: { x: 1085, y: 550 }, kind: 'bridge', switchId: 'bridge', openWhenPressed: false, color: '#65e6ff' },
      { a: { x: 1240, y: 520 }, b: { x: 1460, y: 520 }, kind: 'terrain' },
      { a: { x: 1088, y: 705 }, b: { x: 1088, y: 540 }, kind: 'gate', switchId: 'bridge', openWhenPressed: true, color: '#ffca66' },
      { a: { x: 700, y: 694 }, b: { x: 760, y: 610 }, kind: 'bumper', color: '#c18cff', bounce: 1.25 },
    ],
    parHint: 'Co-op idea: leave one ball resting on the switch while another crosses.',
  },
  {
    name: 'Hazard Cavern',
    subtitle: 'Color wards, fans, and a switch-powered bumper guard the flag.',
    width: 1900,
    height: 860,
    wind: 22,
    starts: [{ x: 110, y: 675 }, { x: 155, y: 670 }, { x: 200, y: 665 }, { x: 245, y: 660 }],
    hole: { x: 1765, y: 475 },
    switches: [{ id: 'lift', x: 980, y: 625, w: 92, pressed: false, label: 'LIFT' }],
    fans: [{ x: 1135, y: 610, w: 105, h: 120, force: { x: 28, y: -42 }, label: 'UPDRAFT' }],
    platforms: [
      { x: 415, y: 610, w: 180, h: 18 },
      { x: 740, y: 545, w: 180, h: 18 },
      { x: 1320, y: 560, w: 230, h: 18 },
      { x: 1600, y: 485, w: 220, h: 18 },
    ],
    segments: [
      ...ground([[25, 720], [295, 690], [390, 635], [540, 680], [690, 610], [850, 635], [1020, 650], [1165, 720], [1305, 610], [1480, 620], [1600, 505], [1865, 502]]),
      { a: { x: 415, y: 610 }, b: { x: 595, y: 610 }, kind: 'terrain' },
      { a: { x: 740, y: 545 }, b: { x: 920, y: 545 }, kind: 'terrain' },
      { a: { x: 1320, y: 560 }, b: { x: 1550, y: 560 }, kind: 'terrain' },
      { a: { x: 1600, y: 485 }, b: { x: 1820, y: 485 }, kind: 'terrain' },
      { a: { x: 640, y: 617 }, b: { x: 700, y: 555 }, kind: 'hazard', color: '#ff5c7c', safeFor: [0], bounce: 1.05 },
      { a: { x: 930, y: 640 }, b: { x: 970, y: 565 }, kind: 'hazard', color: '#50b7ff', safeFor: [1], bounce: 1.05 },
      { a: { x: 1260, y: 655 }, b: { x: 1320, y: 580 }, kind: 'hazard', color: '#49df78', safeFor: [2], bounce: 1.05 },
      { a: { x: 1515, y: 598 }, b: { x: 1575, y: 515 }, kind: 'hazard', color: '#ffd34f', safeFor: [3], bounce: 1.05 },
      { id: 'liftBumper', a: { x: 1080, y: 645 }, b: { x: 1135, y: 585 }, kind: 'moving', color: '#f892ff', switchId: 'lift', moveTo: { a: { x: 1090, y: 555 }, b: { x: 1165, y: 512 } }, bounce: 1.35 },
    ],
    parHint: 'Colored wards let matching players pass. Others ricochet hard.',
  },
];
