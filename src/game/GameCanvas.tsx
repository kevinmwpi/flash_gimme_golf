import { useEffect, useRef } from 'react';
import { createGame, updateGame } from './engine';
import { KeyboardInput } from './input';
import { renderGame } from './render';

export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(createGame(2));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const input = new KeyboardInput();
    input.attach();
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };
    resize();
    window.addEventListener('resize', resize);

    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      updateGame(stateRef.current, input.state, dt);
      renderGame(ctx, stateRef.current, canvas.width, canvas.height);
      input.endFrame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      input.detach();
    };
  }, []);

  return (
    <section className="game-wrap" aria-label="Golf Siege canvas game">
      <canvas ref={canvasRef} className="game-canvas" width={1280} height={720} />
    </section>
  );
}
