// World 1 "Teach" — FINAL level set for the Flash Golf rebuild (synthesis of the flow / puzzle / teach
// proposals; see LEVELS.md for the provenance of every level and the verification table).
//
// Designed and verified for SHOT_SPEED_PER_POWER = 6.5 (launch 650 px/s at power 100, gravity 620):
//   vacuum range at 45 deg = 681 px, measured first landing in the current physics = 619 px,
//   vacuum apex = 341 px (ball top 353 px), measured apex = 335 px.
// Built with the CURRENT project helpers so tools/solver.ts (current physics) can verify the geometry.
//
// Vocabulary (all coordinates in the 1280x720 logical space, y down):
//   * floor      = the fairway height of a level (620 for the walled levels).
//   * wall       = permanent solid rect (kind 'gate', no switchId). Its top is >= 420 px above the highest
//                  resting surface in front of it, so no shot at 6.5 can be lobbed over it (67 px margin
//                  over the vacuum apex + ball radius). The rebuilt Level type gives this its own kind 'wall'.
//   * door       = blocker gate (kind 'gate', activeWhen:false): SOLID until its plate is held by a RESTING
//                  ball, then it vanishes. 100 px tall at the foot of a wall: a rolling or low ball passes.
//   * window     = the same gate type 170 px tall in the upper part of a wall (100-270 px above the floor):
//                  the door-holder's own way across, lobbed through later.
//   * field      = colour gate (kind 'hazard', color): the whole upper part of a wall; only the matching
//                  player's ball passes, the other bounces (restitution <= 1 in the rebuild).
//   * plate      = pressure switch, HELD (a resting ball keeps it pressed, it releases the tick the ball
//                  leaves). Every plate sits on the flat bottom of a DISH (20 px deep, 50 px ramps at 22 deg)
//                  so landing anywhere in the bowl is enough; door plates have the wall face as the far rim
//                  so an overshoot bounces back into the bowl.
//   * bridge     = extra floor that exists while ANY of its plates is held. The current data model lets a
//                  rect reference one switch, so coincident rects (one per plate id) give OR semantics; the
//                  rebuilt type carries switchIds: string[].
//   * deck plate = a plate strip along the whole bridge: a ball RESTING on the bridge keeps it up by itself
//                  (a moving ball presses nothing, so a lone ball still cannot cross).
//   * sand       = flush surface zone that kills bounce and roll (1 px proud here so the current physics
//                  registers contact).
import {
  terrainPiece,
  holeAt,
  applySwitchesOnSurface,
  bridgeSurfaceY,
  surfaceYAt,
} from 'file:///C:/Users/KevnP/Downloads/flash_golf/flash_gimme_golf/src/game/terrain.ts';
import type { Level, Rect, HazardColor } from 'file:///C:/Users/KevnP/Downloads/flash_golf/flash_gimme_golf/src/game/types.ts';

export const SHOT_SPEED_PER_POWER = 6.5;
export const FLOOR = 620;
export const DISH_DEPTH = 20;
export const DISH_RAMP = 50;

/** Terrain control points for a plate dish: flat bottom x1..x2 at floor+DISH_DEPTH, 50 px ramps either side. */
function dish(x1: number, x2: number, floor = FLOOR): [number, number][] {
  return [
    [x1 - DISH_RAMP, floor],
    [x1, floor + DISH_DEPTH],
    [x2, floor + DISH_DEPTH],
    [x2 + DISH_RAMP, floor],
  ];
}
/** Flush surface pad (sand): 1 px proud of the ground so the current physics registers contact. */
function pad(level: Level, centerX: number, w: number, kind: Rect['kind'], label: string, proud = 1): Rect {
  const y = (surfaceYAt(level, centerX) ?? 600) - proud;
  return { x: centerX - w / 2, y, w, h: 18 + proud, kind, label };
}
/** Permanent solid block (rebuilt kind: 'wall'). */
function wall(x: number, y1: number, y2: number, w = 40, label = 'wall'): Rect {
  return { x, y: y1, w, h: y2 - y1, kind: 'gate', label };
}
/** Blocker gate: solid until the plate `switchId` is held. */
function door(x: number, y1: number, y2: number, switchId: string, label: string, w = 40): Rect {
  return { x, y: y1, w, h: y2 - y1, kind: 'gate', switchId, activeWhen: false, label };
}
/** Colour field: only the matching player's ball passes. */
function field(x: number, y1: number, y2: number, color: HazardColor, w = 40): Rect {
  return { x, y: y1, w, h: y2 - y1, kind: 'hazard', color, label: color };
}
function base(partial: Omit<Level, 'hole' | 'segments' | 'rects' | 'switches'>): Level {
  return { ...partial, hole: { x: 0, y: 0, radius: 16, rimY: 0, depth: 28 }, segments: [], rects: [], switches: [] };
}

// ---------------------------------------------------------------------------------------------
// 1. FIRST FAIRWAY (1280x720, one screen, no scroll) — aim, power, cup, gimme. One mechanic: SAND.
//    Provenance: puzzle proposal L1 (hill + bunker + raised green), bunker 140 px, flatter green approach.
// ---------------------------------------------------------------------------------------------
function level1(): Level {
  const level = base({
    name: 'First Fairway',
    subtitle: 'Over the hill, past the bunker, onto the green.',
    width: 1280,
    height: 720,
    starts: [{ x: 90, y: 0 }, { x: 130, y: 0 }],
    wind: 0,
    hint: 'Pull back from your ball and let go. Sand stops a rolling ball dead, so pitch over the bunker.',
    terrain: {
      pieces: [
        terrainPiece(
          [
            [0, 590],
            [200, 590],
            [320, 578],
            [440, 552],
            [540, 538], // hill crest, 52 px above the tee
            [640, 554],
            [760, 580],
            [840, 590],
            [1020, 590], // flat carrying the bunker (870..1010)
            [1060, 578],
            [1120, 562],
            [1280, 562], // green 1120..1280 (flat), cup at 1190
          ],
          720,
        ),
      ],
    },
  });
  level.hole = holeAt(level, 1190);
  level.rects = [pad(level, 940, 140, 'sand', 'sand')]; // 870..1010
  return level;
}

// ---------------------------------------------------------------------------------------------
// 2. TWO DOORS (1920x720) — the HELD plate + blocker gate. One 420 px wall carrying a DOOR at the
//    foot (plate on the tee side, in a dish whose far rim is the wall) and a WINDOW up top (plate on
//    the far side, in a dish where a ball that skips through the door naturally stops).
//    Provenance: flow proposal L2 + puzzle dishes + 420 px wall.
// ---------------------------------------------------------------------------------------------
function level2(): Level {
  const level = base({
    name: 'Two Doors',
    subtitle: 'A plate opens its door only while a ball RESTS on it.',
    width: 1800,
    height: 720,
    starts: [{ x: 100, y: 0 }, { x: 150, y: 0 }],
    wind: 0,
    hint: 'A plate works only while a ball is RESTING on it. Park on the DOOR plate for your partner, then they open the WINDOW for you from the far side.',
    terrain: {
      pieces: [
        terrainPiece(
          [
            [0, 620],
            [360, 620],
            [460, 606], // gentle hump (14 px) between tee and door plate
            [560, 620],
            ...dish(740, 850), // DOOR plate dish 690..900, far rim = wall face at 900
            [900, 620],
            ...dish(990, 1180), // WINDOW plate dish 940..1230, starts right behind the wall
            [1230, 620],
            [1320, 620],
            [1400, 600], // hump (20 px) before the green
            [1480, 620],
            [1540, 620],
            [1600, 600],
            [1800, 600], // raised green 1600..1800, cup at 1680 (one full shot from the WINDOW plate)
          ],
          720,
        ),
      ],
    },
  });
  level.hole = holeAt(level, 1680);
  level.switches = applySwitchesOnSurface(level, [
    { id: 'door', centerX: 795, w: 110, h: 12, label: 'DOOR' }, // 740..850 on the dish floor
    { id: 'window', centerX: 1085, w: 190, h: 12, label: 'WINDOW' }, // 990..1180
  ]);
  level.rects = [
    wall(900, 200, 350), // solid cap: 420 px above the floor
    door(900, 350, 520, 'window', 'window'),
    door(900, 520, 640, 'door', 'door'),
  ];
  return level;
}

// ---------------------------------------------------------------------------------------------
// 3. COLOUR KEYS (1860x720) — colour fields. Two walls, each a colour field on top of a plated door.
//    The plate that opens door 1 sits BEHIND wall 1 and only blue can fly there (blue field); the plate
//    that opens door 2 sits behind wall 2 and only red can fly there (red field). Blue unlocks red,
//    red unlocks blue, and the colours fix the order: blue first.
//    Provenance: puzzle proposal L3 structure (mutual unlock) + flow's field-over-door wall + dishes.
// ---------------------------------------------------------------------------------------------
function level3(): Level {
  const level = base({
    name: 'Colour Keys',
    subtitle: 'A field passes only its own colour. The plate that opens YOUR door is behind THEIR field.',
    width: 1860,
    height: 720,
    starts: [{ x: 100, y: 0 }, { x: 150, y: 0 }],
    wind: 0,
    hint: 'Blue: lob over the door, through the blue field, and rest on the plate behind it: that opens DOOR 1 for red. Red: roll through low, then lob the red field onto the plate that opens DOOR 2 for blue.',
    terrain: {
      pieces: [
        terrainPiece(
          [
            [0, 620],
            [440, 620], // wall 1 stands at 440..480 on flat ground, 290 px from blue's tee (red rolls through its door)
            [480, 620],
            ...dish(700, 1000), // DOOR 1 plate bowl 650..1050, behind wall 1: where a tee lob through the field rests
            [1050, 620],
            [1160, 620], // wall 2 stands at 1160..1200, 250-350 px from where red rests in the bowl
            [1200, 620],
            ...dish(1270, 1560), // DOOR 2 plate bowl 1220..1610, behind wall 2 (red's field lob lands here)
            [1610, 620],
            [1660, 600],
            [1720, 596],
            [1860, 596], // green 1660..1860, cup at 1740
          ],
          720,
        ),
      ],
    },
  });
  level.hole = holeAt(level, 1740);
  level.switches = applySwitchesOnSurface(level, [
    { id: 'door1', centerX: 850, w: 300, h: 12, label: 'DOOR 1' }, // 700..1000
    { id: 'door2', centerX: 1415, w: 290, h: 12, label: 'DOOR 2' }, // 1270..1560
  ]);
  level.rects = [
    field(440, 200, 520, 'blue'),
    door(440, 520, 640, 'door1', 'door 1'),
    field(1160, 200, 520, 'red'),
    door(1160, 520, 640, 'door2', 'door 2'),
  ];
  return level;
}

// ---------------------------------------------------------------------------------------------
// 4. PLATE & BRIDGE (1960x720) — the bridge. A 720 px chasm (wider than any shot) bridged while
//    plate A (near lip), plate B (landing bowl across the gap) or the bridge DECK is held.
//    Provenance: teach proposal L3 (gap widened 660 -> 720 so the drag-free rebuilt physics cannot
//    fly it either), plate B bowl kept, deck plate kept, plate A put in a dish (puzzle).
// ---------------------------------------------------------------------------------------------
function level4(): Level {
  const GAP_X1 = 520;
  const GAP_X2 = 1240;
  const level = base({
    name: 'Plate & Bridge',
    subtitle: 'The bridge is only there while a plate is held. Someone has to stay behind.',
    width: 1960,
    height: 720,
    starts: [{ x: 250, y: 0 }, { x: 290, y: 0 }], // both tee on the flat just behind plate A
    wind: 0,
    hint: 'A resting ball on plate A holds the bridge up. Both chip onto plate A, then cross one at a time with a full swing; the bridge deck also holds itself while a ball rests on it.',
    terrain: {
      gaps: [{ x1: GAP_X1, x2: GAP_X2 }],
      pieces: [
        terrainPiece(
          [
            [0, 624],
            [120, 616],
            [220, 630],
            [320, 630], // tee flat 220..320
            [350, 620],
            [400, 640], // plate A dish 350..520: flat 400..470, the far ramp climbs to the lip at 520
            [470, 640],
            [GAP_X1, 620],
          ],
          720,
        ),
        terrainPiece(
          [
            [GAP_X2, 620],
            [1256, 620],
            [1272, 628], // landing bowl 1272..1540 carries plate B (the natural roll-out zone)
            [1540, 628],
            [1560, 620],
            [1700, 616],
            [1760, 590],
            [1800, 584], // green 1800..1920 (flat), cup at 1860
            [1920, 584],
            [1960, 590],
          ],
          720,
        ),
      ],
    },
  });
  level.hole = holeAt(level, 1860);
  level.switches = applySwitchesOnSurface(level, [
    { id: 'near', centerX: 435, w: 70, h: 12, label: 'PLATE A' }, // 400..470 on the dish floor
    { id: 'far', centerX: 1406, w: 268, h: 12, label: 'PLATE B' },
  ]);
  const bridgeTop = bridgeSurfaceY(level, GAP_X1, GAP_X2) + 1; // 1 px below both lips: never a step
  const bridge = (switchId: string): Rect => ({
    x: GAP_X1,
    y: bridgeTop,
    w: GAP_X2 - GAP_X1,
    h: 18,
    kind: 'bridge',
    switchId,
    activeWhen: true,
    label: 'BRIDGE',
  });
  // Deck plate: the bridge is its own plate, INSET 24 px from both lips so only a ball fully on the bridge
  // presses it (a ball resting at the lip must not hold the deck). Hand-placed because rectOnSurface
  // cannot sample inside a gap.
  const DECK_INSET = 24;
  level.switches.push({ id: 'deck', x: GAP_X1 + DECK_INSET, y: bridgeTop - 2, w: GAP_X2 - GAP_X1 - 2 * DECK_INSET, h: 12, pressed: false, label: 'DECK' });
  // Three coincident bridge rects = OR of plate A, plate B and the deck (rebuilt: one rect, switchIds: ['near','far','deck']).
  level.rects = [bridge('near'), bridge('far'), bridge('deck')];
  return level;
}

export const levels: Level[] = [level1(), level2(), level3(), level4()];

// ---------------------------------------------------------------------------------------------
// Registry metadata (the rebuilt src/sim/levels/index.ts carries these fields on each level).
// Axis ratings follow LEVEL_DESIGN.md (1-5). Pars: see LEVELS.md (6 / 7 / 9 / 8, course 30).
// ---------------------------------------------------------------------------------------------
export type LevelMeta = {
  id: string;
  index: number;
  world: 1;
  name: string;
  /** Team par (both balls combined). */
  par: number;
  hint: string;
  aha: string;
  failureMode: string;
  mechanicsIntroduced: string[];
  mechanicsPresent: string[];
  /** Which ball shoots first on this level (0 = red / P1, 1 = blue / P2) and why. */
  firstPlayer: 0 | 1;
  /** Rebuilt-sim rule: once a ball is sunk it counts as resting on the cup, and the cup holds this switch. */
  cupHoldsSwitch?: string;
  axes: {
    geometric: { distance: number; verticality: number; cupWidth: number };
    path: { par: number; obstacles: number; branching: number; precision: number };
    mechanicLoad: { distinct: number; newThisLevel: number; sequencing: number };
    coop: { puzzles: number; simultaneity: number; communication: number };
    recovery: { hazardDensity: number; softlockRisk: number };
  };
  /** Verified with tools/solver.ts at this shot speed (px/s per power unit). */
  verifiedShotSpeed: number;
};

export const meta: LevelMeta[] = [
  {
    id: 'w1-first-fairway',
    index: 0,
    world: 1,
    name: 'First Fairway',
    par: 6,
    hint: 'Pull back from your ball and let go. Sand stops a rolling ball dead, so pitch over the bunker.',
    aha: 'Power is distance: a full swing carries over the hill and runs into the bunker, a softer swing stops short of it, and a short pitch over the sand lands on the green where a ball that stops next to the cup is conceded (GIMME).',
    failureMode: 'Players hit every shot at full power, end up in the bunker and do not connect "the ball stopped dead" with the sand; the SAND label and the enterSand callout must carry it.',
    mechanicsIntroduced: ['aim + power', 'cup / gimme', 'turn order', 'sand'],
    mechanicsPresent: ['sand'],
    firstPlayer: 0,
    axes: {
      geometric: { distance: 2, verticality: 1, cupWidth: 2 },
      path: { par: 6, obstacles: 1, branching: 1, precision: 1 },
      mechanicLoad: { distinct: 1, newThisLevel: 1, sequencing: 1 },
      coop: { puzzles: 0, simultaneity: 1, communication: 1 },
      recovery: { hazardDensity: 1, softlockRisk: 1 },
    },
    verifiedShotSpeed: 6.5,
  },
  {
    id: 'w1-two-doors',
    index: 1,
    world: 1,
    name: 'Two Doors',
    par: 7,
    hint: 'A plate works only while a ball is RESTING on it. Park on the DOOR plate for your partner, then they open the WINDOW for you from the far side.',
    aha: 'A plate is held, not pressed: the door shuts the moment you leave, so the crosser goes first while the holder waits, and the holder follows later through the window the crosser holds open.',
    failureMode: 'The first ball through the door plays on toward the cup instead of settling on the WINDOW plate; the holder is stuck in front of the wall until it comes back (2 strokes) or sinks (cup holds the window in the rebuilt sim). Also: the holder must shoot on their turn before the partner is through and needs the stall tap.',
    mechanicsIntroduced: ['pressure plate (held)', 'blocker gate (door / window)'],
    mechanicsPresent: ['pressure plate', 'blocker gate', 'wall'],
    firstPlayer: 0,
    cupHoldsSwitch: 'window',
    axes: {
      geometric: { distance: 3, verticality: 1, cupWidth: 2 },
      path: { par: 7, obstacles: 2, branching: 1, precision: 2 },
      mechanicLoad: { distinct: 2, newThisLevel: 1, sequencing: 2 },
      coop: { puzzles: 2, simultaneity: 2, communication: 2 },
      recovery: { hazardDensity: 1, softlockRisk: 2 },
    },
    verifiedShotSpeed: 6.5,
  },
  {
    id: 'w1-colour-keys',
    index: 2,
    world: 1,
    name: 'Colour Keys',
    par: 9,
    hint: 'Blue: lob over the door, through the blue field, and rest on the plate behind it: that opens DOOR 1 for red. Red: roll through low, then lob the red field onto the plate that opens DOOR 2 for blue.',
    aha: 'The plate that opens MY door is behind YOUR colour of field: blue unlocks red at wall 1, red unlocks blue at wall 2, and the colours dictate who goes first (blue) - a leapfrog, not a race.',
    failureMode: 'Red tries to lob wall 1 and bounces off the blue field (door 1 must be rolled through, low); or red leaves the DOOR 2 plate for the cup before blue has rolled through door 2 (red can come back through its own field; in the rebuilt sim the cup holds door 2).',
    mechanicsIntroduced: ['colour field (colour gate)'],
    mechanicsPresent: ['colour field', 'pressure plate', 'blocker gate'],
    firstPlayer: 1,
    cupHoldsSwitch: 'door2',
    axes: {
      geometric: { distance: 3, verticality: 1, cupWidth: 2 },
      path: { par: 9, obstacles: 3, branching: 1, precision: 3 },
      mechanicLoad: { distinct: 3, newThisLevel: 1, sequencing: 3 },
      coop: { puzzles: 2, simultaneity: 2, communication: 3 },
      recovery: { hazardDensity: 1, softlockRisk: 2 },
    },
    verifiedShotSpeed: 6.5,
  },
  {
    id: 'w1-plate-and-bridge',
    index: 3,
    world: 1,
    name: 'Plate & Bridge',
    par: 8,
    hint: 'A resting ball on plate A holds the bridge up. Both chip onto plate A, then cross one at a time with a full swing; the bridge deck also holds itself while a ball rests on it.',
    aha: 'The bridge only exists while someone is resting on a plate, so one of us stays behind on plate A while the other crosses, and the landing plate across the chasm (or the bridge deck itself) lets the first crosser hold it for the partner: we swap roles instead of racing.',
    failureMode: 'The crosser under-hits and parks on the bridge deck (safe: the deck holds the bridge) and then tries to roll off it instead of flying off while nobody else holds; or the ball on plate B putts out before the partner is across (cup holds the bridge in the rebuilt sim).',
    mechanicsIntroduced: ['bridge (exists while held)'],
    mechanicsPresent: ['pressure plate', 'bridge', 'deck plate'],
    firstPlayer: 0,
    cupHoldsSwitch: 'far',
    axes: {
      geometric: { distance: 3, verticality: 1, cupWidth: 2 },
      path: { par: 8, obstacles: 2, branching: 1, precision: 2 },
      mechanicLoad: { distinct: 2, newThisLevel: 1, sequencing: 3 },
      coop: { puzzles: 2, simultaneity: 2, communication: 2 },
      recovery: { hazardDensity: 2, softlockRisk: 1 },
    },
    verifiedShotSpeed: 6.5,
  },
];

export default { levels, meta };
