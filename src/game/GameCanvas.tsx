import { useEffect, useRef } from 'react';
import { createGameState, SIM_VIEWPORT, updateGame } from './engine';
import { bindInput, createInput, endInputFrame, snapshotInput } from './input';
import { renderGame } from './render';
import { readStateFromUrl } from './state';
import { GameState } from './types';
import type { OnlineSession } from '../net/protocol';

const FIXED_STEP = 1 / 60;
const MAX_FRAME = 0.25;
const SIM_ASPECT = SIM_VIEWPORT.x / SIM_VIEWPORT.y;

type GameCanvasProps = {
  online?: OnlineSession;
};

export default function GameCanvas({ online }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(readStateFromUrl() ?? createGameState(2));
  const onlineRef = useRef(online);
  onlineRef.current = online;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const input = createInput();
    const unbind = bindInput(input);
    let frame = 0;
    let last = performance.now();
    let accumulator = 0;

    const resize = () => {
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      // Fit the largest 16:9 box inside the window. Anything outside is
      // letterbox (the body's gradient shows through).
      let cssW = window.innerWidth;
      let cssH = cssW / SIM_ASPECT;
      if (cssH > window.innerHeight) {
        cssH = window.innerHeight;
        cssW = cssH * SIM_ASPECT;
      }
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      // Combine DPR with the sim->canvas scale so draw calls use the fixed
      // 1280x720 logical coord space regardless of the actual canvas size.
      const simScale = canvas.width / SIM_VIEWPORT.x;
      ctx.setTransform(simScale, 0, 0, simScale, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const loop = (now: number) => {
      const frameDt = Math.min(MAX_FRAME, (now - last) / 1000);
      last = now;
      accumulator += frameDt;
      const session = onlineRef.current;

      while (accumulator >= FIXED_STEP) {
        if (session) {
          const snap = snapshotInput(input);
          session.sendInput(snap.held, snap.pressed);
          stateRef.current = session.state;
        } else {
          stateRef.current = updateGame(stateRef.current, input, FIXED_STEP, SIM_VIEWPORT);
        }
        endInputFrame(input);
        accumulator -= FIXED_STEP;
      }

      const renderState = onlineRef.current?.state ?? stateRef.current;
      const localPlayerId = onlineRef.current?.playerId;
      renderGame(ctx, renderState, SIM_VIEWPORT.x, SIM_VIEWPORT.y, { localPlayerId });
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      unbind();
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} aria-label="Flash Golf playable canvas" />;
}
