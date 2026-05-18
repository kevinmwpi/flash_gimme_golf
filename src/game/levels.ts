import { Level } from './types';
import {
  applyPropsOnSurface,
  applySwitchesOnSurface,
  bridgeSurfaceY,
  holeAt,
  terrainPiece,
} from './terrain';

export const playerColors = ['#ff5d73', '#50b7ff', '#72de72', '#ffd75c'];
export const safeColors = ['red', 'blue', 'green', 'gold'] as const;

function tutorialLevel(): Level {
  const terrain = {
    pieces: [
      terrainPiece(
        [
          [0, 598],
          [200, 582],
          [380, 608],
          [520, 568],
          [680, 592],
          [860, 552],
          [1020, 578],
          [1180, 538],
          [1360, 562],
          [1520, 518],
          [1680, 528],
        ],
        700,
      ),
    ],
  };

  const level: Level = {
    name: 'Tutorial Hills',
    subtitle: 'One rolling hillside — arc over bumps and sink every ball.',
    width: 1680,
    height: 720,
    starts: [{ x: 100, y: 0 }, { x: 140, y: 0 }, { x: 180, y: 0 }, { x: 220, y: 0 }],
    hole: { x: 1540, y: 0, radius: 16, rimY: 0, depth: 28 },
    wind: 6,
    hint: 'Walk to your ball, aim, and shoot. Springs launch you; sand slows rolls.',
    terrain,
    segments: [],
    rects: [],
    switches: [],
  };

  level.hole = holeAt(level, 1540);
  level.rects = applyPropsOnSurface(level, [
    { centerX: 544, w: 48, h: 14, kind: 'spring', bounce: 1.5, label: 'spring' },
    { centerX: 980, w: 120, h: 18, kind: 'sand', label: 'sand' },
    { centerX: 1202, w: 44, h: 14, kind: 'bumper', bounce: 1.15, label: 'boing' },
  ]);
  return level;
}

function switchBridgeLevel(): Level {
  const terrain = {
    gaps: [{ x1: 718, x2: 938 }],
    pieces: [
      terrainPiece(
        [
          [0, 628],
          [240, 612],
          [420, 638],
          [580, 598],
          [700, 618],
        ],
        740,
      ),
      terrainPiece(
        [
          [958, 618],
          [1120, 588],
          [1280, 608],
          [1480, 562],
          [1680, 548],
          [1880, 538],
        ],
        740,
      ),
    ],
  };

  const level: Level = {
    name: 'Switch Bridge',
    subtitle: 'Hold the plate to drop a bridge across the chasm.',
    width: 1880,
    height: 760,
    starts: [{ x: 90, y: 0 }, { x: 130, y: 0 }, { x: 170, y: 0 }, { x: 210, y: 0 }],
    hole: { x: 1720, y: 0, radius: 16, rimY: 0, depth: 28 },
    wind: -10,
    hint: 'Rest a ball on the switch, then shoot across the bridge to the far green.',
    terrain,
    segments: [],
    rects: [],
    switches: [],
  };

  level.hole = holeAt(level, 1720);
  level.switches = applySwitchesOnSurface(level, [
    { id: 'bridge', centerX: 520, w: 88, h: 12, label: 'BRIDGE' },
  ]);
  const bridgeH = 18;
  const bridgeW = 220;
  const bridgeY = bridgeSurfaceY(level, 718, 938) - bridgeH;
  level.rects = applyPropsOnSurface(level, [
    { centerX: 1240, w: 48, h: 14, kind: 'spring', bounce: 1.55, label: 'spring' },
  ]);
  level.rects.unshift({
    x: 828 - bridgeW / 2,
    y: bridgeY,
    w: bridgeW,
    h: bridgeH,
    kind: 'bridge',
    switchId: 'bridge',
    activeWhen: true,
    label: 'bridge',
  });
  return level;
}

function hazardCavernLevel(): Level {
  const terrain = {
    pieces: [
      terrainPiece(
        [
          [0, 658],
          [220, 638],
          [400, 668],
          [560, 618],
          [720, 648],
          [900, 598],
          [1080, 628],
          [1260, 578],
          [1420, 608],
          [1580, 548],
          [1760, 568],
          [1940, 528],
          [2100, 538],
        ],
        780,
      ),
    ],
  };

  const level: Level = {
    name: 'Hazard Cavern',
    subtitle: 'Hills, color wards, and tools on the path to the cup.',
    width: 2100,
    height: 800,
    starts: [{ x: 80, y: 0 }, { x: 120, y: 0 }, { x: 160, y: 0 }, { x: 200, y: 0 }],
    hole: { x: 1940, y: 0, radius: 16, rimY: 0, depth: 28 },
    wind: 14,
    hint: 'Matching players pass wards. Spring and fan help reach the upper lane.',
    terrain,
    segments: [],
    rects: [],
    switches: [],
  };

  level.hole = holeAt(level, 1940);
  level.switches = applySwitchesOnSurface(level, [
    { id: 'gate', centerX: 1080, w: 90, h: 12, label: 'GATE' },
  ]);
  level.rects = applyPropsOnSurface(level, [
    { centerX: 391, w: 22, h: 88, kind: 'hazard', color: 'red', label: 'red' },
    { centerX: 571, w: 22, h: 100, kind: 'hazard', color: 'blue', label: 'blue' },
    { centerX: 950, w: 100, h: 16, kind: 'sand', label: 'sand' },
    { centerX: 1288, w: 44, h: 14, kind: 'spring', bounce: 1.65, label: 'spring' },
    { centerX: 1565, w: 90, h: 100, kind: 'fan', label: 'fan' },
    {
      centerX: 1820,
      w: 200,
      h: 18,
      kind: 'bridge',
      switchId: 'gate',
      activeWhen: true,
      label: 'gate',
    },
  ]);
  return level;
}

function ricochetHeightsLevel(): Level {
  const terrain = {
    pieces: [
      terrainPiece(
        [
          [0, 612],
          [220, 608],
          [420, 614],
          [620, 608],
          [820, 612],
          [1000, 614],
          [1140, 610],
          [1180, 588],
          [1220, 478],
          [1260, 410],
          [1340, 408],
          [1480, 410],
          [1620, 405],
          [1780, 410],
          [1900, 408],
        ],
        730,
      ),
    ],
  };

  const level: Level = {
    name: 'Ricochet Heights',
    subtitle: 'The cup is up top — drop onto the bumper to launch onto the green.',
    width: 1900,
    height: 740,
    starts: [{ x: 100, y: 0 }, { x: 140, y: 0 }, { x: 180, y: 0 }, { x: 220, y: 0 }],
    hole: { x: 1600, y: 0, radius: 16, rimY: 0, depth: 28 },
    wind: 0,
    hint: "A direct shot can't reach the cup. Arc your ball onto the bumper to ricochet up.",
    terrain,
    segments: [],
    rects: [],
    switches: [],
  };

  level.hole = holeAt(level, 1600);
  level.rects = applyPropsOnSurface(level, [
    { centerX: 1000, w: 64, h: 16, kind: 'bumper', bounce: 1.5, label: 'launch' },
  ]);
  return level;
}

export const levels: Level[] = [
  tutorialLevel(),
  switchBridgeLevel(),
  hazardCavernLevel(),
  ricochetHeightsLevel(),
];
