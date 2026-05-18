import { useEffect, useRef } from 'react';
import { createGameState, updateGame } from './engine';
import { bindInput, createInput, endInputFrame } from './input';
import { renderGame } from './render';
import { GameState } from './types';

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(createGameState(2));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const input = createInput();
    const unbind = bindInput(input);
    let frame = 0;
    let last = performance.now();

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
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      stateRef.current = updateGame(stateRef.current, input, dt, { x: window.innerWidth, y: window.innerHeight });
      renderGame(ctx, stateRef.current, window.innerWidth, window.innerHeight);
      endInputFrame(input);
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
