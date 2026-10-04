// OWNER: sim
/**
 * The contract gate (ARCH.md §4, §9): imports every module in §1 and asserts every contracted name
 * exists with the right runtime shape. This is the test that fails the moment someone renames a
 * contract. Build agents extend it when the lead approves a new export; they never weaken it.
 */
import { describe, expect, it } from 'vitest';
import * as GameClientModule from '../../net/GameClient';
import * as protocol from '../../net/protocol';
import * as wsUrl from '../../net/wsUrl';
import * as App from '../../App';
import * as CampaignResults from '../../ui/CampaignResults';
import * as Callouts from '../../ui/Callouts';
import * as Hud from '../../ui/Hud';
import * as LevelIntro from '../../ui/LevelIntro';
import * as LevelResults from '../../ui/LevelResults';
import * as Lobby from '../../ui/Lobby';
import * as OnboardingHint from '../../ui/OnboardingHint';
import * as Pause from '../../ui/Pause';
import * as Settings from '../../ui/Settings';
import * as Title from '../../ui/Title';
import * as eventBus from '../../ui/eventBus';
import * as storage from '../../ui/storage';
import * as url from '../../ui/url';
import * as GameCanvas from '../../view/GameCanvas';
import * as audio from '../../view/audio';
import * as inputGamepad from '../../view/input/gamepad';
import * as input from '../../view/input/index';
import * as inputKeyboard from '../../view/input/keyboard';
import * as inputPointer from '../../view/input/pointer';
import * as renderAim from '../../view/render/aim';
import * as renderEffects from '../../view/render/effects';
import * as renderEntities from '../../view/render/entities';
import * as render from '../../view/render/index';
import * as renderMechanics from '../../view/render/mechanics';
import * as palette from '../../view/render/palette';
import * as renderText from '../../view/render/text';
import * as renderWorld from '../../view/render/world';
import * as view from '../../view/view';
import * as rooms from '../../../server/rooms';
import * as authoring from '../levels/authoring';
import * as levels from '../levels/index';
import * as physics from '../physics';
import * as rng from '../rng';
import * as serialize from '../serialize';
import * as sim from '../sim';
import * as terrain from '../terrain';
import * as types from '../types';

type Module = Record<string, unknown>;

function expectFunctions(mod: Module, names: readonly string[]): void {
  for (const name of names) expect(typeof mod[name], name).toBe('function');
}

const CONTRACTS: ReadonlyArray<[label: string, mod: Module, fns: readonly string[]]> = [
  ['sim/types', types, ['quantize2', 'quantize4', 'quantize1', 'medalFor']],
  ['sim/rng', rng, ['seedRng', 'rngNext', 'rngInt']],
  [
    'sim/terrain',
    terrain,
    [
      'clamp',
      'groundAt',
      'hasSupport',
      'restsOnPermanentGround',
      'inGap',
      'pieceEdges',
      'pointInPiece',
      'closestPointOnSegment',
      'isRectActive',
      'activeRects',
      'switchMaskOf',
      'solidColliders',
      'collidersFor',
      'distanceToCup',
      'surfaceYAt',
      'surfaceYOnPiece',
      'surfaceSlopeAt',
      'placeOnSurface',
    ],
  ],
  ['sim/physics', physics, ['launchVelocity', 'stepBall', 'evaluateSwitches', 'isSettled', 'predictShot']],
  [
    'sim/sim',
    sim,
    [
      'createSim',
      'stepSim',
      'levelOf',
      'activeBall',
      'teamStrokes',
      'campaignPar',
      'seatOf',
      'isHost',
      'canControl',
      'allowedCommands',
      'isShotReady',
      'nextLevelId',
      'runReplay',
    ],
  ],
  [
    'sim/serialize',
    serialize,
    [
      'SerializeError',
      'encodeSnapshot',
      'decodeSnapshot',
      'isSimSnapshot',
      'encodeConfig',
      'decodeConfig',
      'toBase64Url',
      'fromBase64Url',
      'encodeShareLink',
      'decodeShareLink',
      'buildShareUrl',
    ],
  ],
  ['sim/levels/authoring', authoring, ['terrainPiece', 'compileLevel', 'validateLevel']],
  ['sim/levels/index', levels, ['levelById', 'hasLevel', 'coursePar', 'campaignFrom', 'worldTitle']],
  [
    'view/view',
    view,
    ['createViewState', 'applySimEvents', 'updateView', 'setCameraMode', 'worldToScreen', 'screenToWorld', 'cameraFor'],
  ],
  ['view/render/index', render, ['renderFrame']],
  ['view/render/world', renderWorld, ['drawSky', 'drawTerrain', 'drawCup']],
  ['view/render/mechanics', renderMechanics, ['drawRect', 'drawSwitch']],
  ['view/render/entities', renderEntities, ['drawBall', 'drawGolfer', 'drawTrail']],
  ['view/render/effects', renderEffects, ['drawParticles']],
  ['view/render/aim', renderAim, ['drawAim']],
  ['view/render/text', renderText, ['drawSticker', 'drawOutlinedText']],
  ['view/render/palette', palette, ['font']],
  ['view/audio', audio, ['createAudio']],
  ['view/input/index', input, ['createInputSystem']],
  ['view/input/keyboard', inputKeyboard, ['createKeyboard']],
  ['view/input/pointer', inputPointer, ['createPointer']],
  ['view/input/gamepad', inputGamepad, ['createGamepad']],
  ['view/GameCanvas', GameCanvas, ['default']],
  ['ui/eventBus', eventBus, ['createEventBus']],
  ['ui/storage', storage, ['loadBests', 'saveBest', 'loadOnboarded', 'saveOnboarded']],
  ['ui/url', url, ['readRoomParam', 'readStateParam', 'clearParams']],
  ['App', App, ['default']],
  ['ui/Title', Title, ['default']],
  ['ui/Lobby', Lobby, ['default']],
  ['ui/Hud', Hud, ['default']],
  ['ui/Callouts', Callouts, ['default']],
  ['ui/Pause', Pause, ['default']],
  ['ui/LevelIntro', LevelIntro, ['default']],
  ['ui/LevelResults', LevelResults, ['default']],
  ['ui/CampaignResults', CampaignResults, ['default']],
  ['ui/Settings', Settings, ['default']],
  ['ui/OnboardingHint', OnboardingHint, ['default']],
  [
    'net/protocol',
    protocol,
    ['parsePlayerCommand', 'isPlayerCommand', 'parseClientMessage', 'parseServerMessage', 'isRoomCode', 'isReconnectToken', 'isLevelIdShape'],
  ],
  ['net/GameClient', GameClientModule, ['GameClient']],
  ['net/wsUrl', wsUrl, ['getWsUrl']],
  ['server/rooms', rooms, ['RoomManager']],
];

describe('contract: every module exports every contracted name', () => {
  for (const [label, mod, fns] of CONTRACTS) {
    it(label, () => expectFunctions(mod, fns));
  }

  it('sim/terrain.vec has the contracted helpers', () => {
    expectFunctions(terrain.vec as unknown as Module, ['add', 'sub', 'mul', 'dot', 'len', 'normalize', 'dist']);
  });

  it('sim/types exports the shared constants with the lead-decision values', () => {
    expect(types.TICK_RATE).toBe(60);
    expect(types.VIEWPORT_W).toBe(1280);
    expect(types.VIEWPORT_H).toBe(720);
    expect(types.BALL_RADIUS).toBe(12);
    expect(types.GRAVITY).toBe(620);
    expect(types.SHOT_SPEED_PER_POWER).toBe(6.5);
    expect(types.TURN_DELAY_TICKS).toBe(27);
    expect(types.GIMME_RADIUS).toBe(40);
    expect(types.AIM_ANGLE_MIN).toBe(-3.11);
    expect(types.AIM_ANGLE_MAX).toBe(-0.03);
    expect(types.DEFAULT_AIM).toEqual({ angle: -0.7854, power: 55 });
    expect(types.DRAG_FULL_POWER_PX).toBe(240);
    expect(types.DRAG_DEAD_ZONE_PX).toBe(24);
    expect(types.DRAG_CANCEL_RADIUS_PX).toBe(24);
    expect(types.DRAG_GRAB_RADIUS_PX).toBe(48);
    expect(types.DRAG_GRAB_RADIUS_TOUCH_PX).toBe(80);
    expect(Object.isFrozen(types.DEFAULT_AIM)).toBe(true);
    expect(Object.isFrozen(types.IMMEDIATE_SNAPSHOT_EVENTS)).toBe(true);
  });

  it('sim/levels/index exposes the registry arrays', () => {
    expect(Array.isArray(levels.LEVELS)).toBe(true);
    expect(levels.LEVELS.length).toBeGreaterThan(0);
    expect(levels.WORLD1_IDS).toEqual(levels.LEVELS.map((l) => l.id));
  });

  it('view/render/palette exports THEME in the ARCH shape and the D1 outline width', () => {
    expect(palette.OUTLINE_WIDTH).toBe(4);
    expect(palette.STICKER_FONT_PX).toBe(15);
    for (const key of ['grass', 'grassDark', 'dirt', 'dirtDark', 'outline', 'sand', 'spring', 'bumper', 'fan', 'bridge', 'blocker', 'cupDark', 'flag', 'red', 'blue'] as const) {
      expect(typeof palette.THEME[key], key).toBe('string');
    }
    expect(palette.THEME.sky).toHaveLength(2);
    expect(palette.THEME.red).toBe(types.PLAYER_COLOURS[0]);
    expect(palette.THEME.blue).toBe(types.PLAYER_COLOURS[1]);
  });

  it('view/audio createAudio() has the ARCH members plus the D3 additions', () => {
    const system = audio.createAudio() as unknown as Module;
    expectFunctions(system, [
      'unlock',
      'handleEvents',
      'play',
      'setMuted',
      'isMuted',
      'setMusic',
      'dispose',
      'attachUnlock',
      'onReady',
      'setVolume',
      'setFan',
    ]);
    expect(typeof system.ready).toBe('boolean');
    expect(system.settings).toMatchObject({ muted: expect.any(Boolean), music: expect.any(Boolean), volume: expect.any(Number) });
  });

  it('view/input createInputSystem() has the ARCH members', () => {
    expectFunctions(input.createInputSystem() as unknown as Module, ['attach', 'detach', 'poll', 'localAim', 'setEnabled']);
  });

  it('net/GameClient instances have every contracted method', () => {
    const client = new GameClientModule.GameClient({ url: 'ws://localhost/ws' }) as unknown as Module;
    expectFunctions(client, [
      'subscribe',
      'getStatus',
      'createRoom',
      'joinRoom',
      'tryReconnect',
      'setLevel',
      'start',
      'playAgain',
      'sendCommand',
      'leave',
      'getConfig',
      'interpolated',
      'drainEvents',
      'renderTime',
      'rttMs',
    ]);
  });

  it('server/rooms RoomManager instances have every contracted method', () => {
    const manager = new rooms.RoomManager() as unknown as Module;
    expectFunctions(manager, ['handleOpen', 'handleMessage', 'handleClose', 'tickAll', 'heartbeat', 'shutdown', 'stats']);
  });

  it('net/protocol re-exports the shared constants', () => {
    expect(protocol.SERVER_TICK_RATE).toBe(types.TICK_RATE);
    expect(protocol.PROTOCOL_VERSION).toBe(3);
    expect(Object.isFrozen(protocol.LIMITS)).toBe(true);
    expect(Object.isFrozen(protocol.ERROR_COPY)).toBe(true);
  });
});
