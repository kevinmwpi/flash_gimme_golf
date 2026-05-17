import { useEffect, useRef, useState } from 'react';
import { attachInput, consumeFrame, createInput } from './input';
import { createGame, loadLevel, startGame, updateGame } from './engine';
import { renderGame } from './render';
import { GameState } from './types';

export default function GameCanvas({ onRestartApp }: { onRestartApp: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(createGame());
  const inputRef = useRef(createInput());
  const [, forceUi] = useState(0);

  useEffect(() => attachInput(inputRef.current), []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      updateGame(stateRef.current, inputRef.current, dt, rect.width, rect.height);
      renderGame(ctx, stateRef.current, rect.width, rect.height);
      consumeFrame(inputRef.current);
      if (Math.floor(now / 250) !== Math.floor((now - dt * 1000) / 250)) forceUi((tick) => tick + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const state = stateRef.current;
  const begin = (count: number) => {
    startGame(stateRef.current, count);
    forceUi((tick) => tick + 1);
  };

  return (
    <section className="game-wrap" aria-label="Golf Siege game">
      <canvas ref={canvasRef} />
      {state.mode === 'menu' && (
        <div className="menu">
          <div className="panel">
            <h1>Golf Siege</h1>
            <p className="subtitle">A local co-op artillery golf prototype with pressure plates, colored force fields, bumpers, wind, and wild side-view terrain.</p>
            <div className="player-buttons">
              {[1, 2, 3, 4].map((count) => <button key={count} onClick={() => begin(count)}>{count} Player{count > 1 ? 's' : ''}</button>)}
            </div>
            <div className="help-grid">
              <span>←/→ or A/D: angle</span><span>↑/↓ or W/S: power</span>
              <span>Space: shoot</span><span>R: reset level</span>
              <span>Tab: change camera focus</span><span>1-4: quick start</span>
            </div>
            <p className="small">Every player must sink their own ball in the shared cup. Some levels ask a teammate to hold a switch so routes open for everyone.</p>
          </div>
        </div>
      )}
      {(state.mode === 'levelComplete' || state.mode === 'gameComplete') && (
        <div className="complete">
          <div className="panel">
            <h2>{state.mode === 'gameComplete' ? 'Course Conquered!' : 'Level Complete!'}</h2>
            <p className="subtitle">{state.level.name} scorecard</p>
            <div className="score-list">
              {state.players.map((player) => <div className="score-row" key={player.id}><strong style={{ color: player.color }}>{player.name}</strong><span>{player.strokes} strokes</span></div>)}
            </div>
            <button onClick={() => {
              if (state.mode === 'gameComplete') onRestartApp();
              else {
                loadLevel(stateRef.current, stateRef.current.levelIndex + 1);
                stateRef.current.mode = 'playing';
                forceUi((tick) => tick + 1);
              }
            }}>{state.mode === 'gameComplete' ? 'Back to Start' : 'Next Level'}</button>
            <p className="small">Keyboard: press Space or Enter to continue.</p>
          </div>
        </div>
      )}
    </section>
  );
}
