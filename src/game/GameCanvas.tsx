import { useEffect, useRef, useState } from 'react';
import { bindInput, clearPressed, createInput } from './input';
import { createGame, nextLevel, startGame, updateGame } from './engine';
import { renderGame } from './render';
import type { GameState } from './types';

export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<GameState>(createGame(2));
  const inputRef = useRef(createInput());
  const [, forceRender] = useState(0);

  const begin = (count: number) => {
    gameRef.current = startGame(count);
    clearPressed(inputRef.current);
    forceRender((v) => v + 1);
  };

  useEffect(() => bindInput(inputRef.current, (count) => {
    if (gameRef.current.mode === 'start') begin(count);
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
      const viewport = { w: window.innerWidth, h: window.innerHeight };
      gameRef.current = updateGame(gameRef.current, inputRef.current, dt, viewport);
      renderGame(ctx, gameRef.current, viewport.w, viewport.h);
      clearPressed(inputRef.current);
      forceRender((v) => (v + 1) % 100000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const game = gameRef.current;
  return (
    <div className="gameShell">
      <canvas ref={canvasRef} className="gameCanvas" aria-label="Golf Siege playable canvas" />
      {game.mode === 'start' && <StartScreen onStart={begin} />}
      {(game.mode === 'levelComplete' || game.mode === 'finished') && (
        <CompleteScreen
          game={game}
          onContinue={() => {
            gameRef.current = nextLevel(gameRef.current);
            forceRender((v) => v + 1);
          }}
          onRestart={() => begin(game.playerCount)}
        />
      )}
    </div>
  );
}

function StartScreen({ onStart }: { onStart: (count: number) => void }) {
  return (
    <div className="overlay">
      <section className="panel">
        <h1>Golf Siege</h1>
        <p>
          A local co-op artillery golf prototype. Take turns launching balls through side-view courses,
          hold switches for friends, use color-safe hazards, and sink every ball in the shared cup.
        </p>
        <div className="playerButtons">
          {[1, 2, 3, 4].map((count) => <button key={count} onClick={() => onStart(count)}>{count} Player{count > 1 ? 's' : ''}</button>)}
        </div>
        <div className="hintGrid">
          <span>1–4 keys: quick start</span>
          <span>Space: shoot</span>
          <span>Arrows / WASD: aim & power</span>
          <span>R: reset level</span>
        </div>
      </section>
    </div>
  );
}

function CompleteScreen({ game, onContinue, onRestart }: { game: GameState; onContinue: () => void; onRestart: () => void }) {
  const finished = game.mode === 'finished';
  return (
    <div className="overlay">
      <section className="panel">
        <h2>{finished ? 'Siege Complete!' : `${game.level.name} Cleared!`}</h2>
        <p>{finished ? 'Every course has been conquered. Start again to improve the team score.' : 'All players reached the flag. Press Space or continue to advance.'}</p>
        <div className="scoreRows">
          {game.players.map((p) => (
            <div className="scoreRow" key={p.id} style={{ borderLeft: `8px solid ${p.color}` }}>
              <strong>Player {p.id + 1}</strong>
              <span>{p.strokes} strokes</span>
            </div>
          ))}
        </div>
        <button className="primary" onClick={finished ? onRestart : onContinue}>{finished ? 'Play Again' : 'Next Level'}</button>
      </section>
    </div>
  );
}
