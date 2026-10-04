// OWNER: ui
/**
 * Boot (UX.md §2, AUDIO.md §8): read `?room=` / `?state=` and the reconnect token ONCE, strip the URL
 * params with replaceState BEFORE anything connects or decodes, create the audio system and attach the
 * gesture unlock, then render. Doing the URL read here (not in a React initializer) keeps it exactly
 * once under StrictMode's double-invoked initializers.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App, { hasReconnectToken, type BootRoute } from './App';
import './styles.css';
import { clearParams, readRoomParam, readStateParam } from './ui/url';
import { createAudio } from './view/audio';

const rejoin = hasReconnectToken();
const boot: BootRoute = {
  rejoin,
  room: rejoin ? null : readRoomParam(),
  state: rejoin ? null : readStateParam(),
};
clearParams(['room', 'state']);

const audio = createAudio();
audio.attachUnlock(window);

const root = document.getElementById('root');
if (root === null) throw new Error('index.html is missing #root');

createRoot(root).render(
  <React.StrictMode>
    <App audio={audio} boot={boot} version={import.meta.env.VITE_APP_VERSION ?? 'dev'} />
  </React.StrictMode>,
);
