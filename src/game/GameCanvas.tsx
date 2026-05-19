import { useEffect, useRef } from 'react';
import { createGameState, updateGame } from './engine';
import { bindInput, createInput, endInputFrame, snapshotInput } from './input';
import { renderGame } from './render';
import { readStateFromUrl } from './state';
import { GameState } from './types';
import type { OnlineSession } from '../net/protocol';

const FIXED_STEP = 1 / 60;
const MAX_FRAME = 0.25;

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
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const loop = (now: number) => {
      const frameDt = Math.min(MAX_FRAME, (now - last) / 1000);
      last = now;
      accumulator += frameDt;
      const viewport = { x: window.innerWidth, y: window.innerHeight };
      const session = onlineRef.current;

      while (accumulator >= FIXED_STEP) {
        if (session) {
          const snap = snapshotInput(input);
          session.sendInput(snap.held, snap.pressed);
          stateRef.current = session.state;
        } else {
          stateRef.current = updateGame(stateRef.current, input, FIXED_STEP, viewport);
        }
        endInputFrame(input);
        accumulator -= FIXED_STEP;
      }

      const renderState = onlineRef.current?.state ?? stateRef.current;
      const localPlayerId = onlineRef.current?.playerId;
      renderGame(ctx, renderState, window.innerWidth, window.innerHeight, { localPlayerId });
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
