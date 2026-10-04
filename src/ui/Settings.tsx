// OWNER: ui
/**
 * Settings overlay (UX.md §3.10; BUILD_DECISIONS D3): sound effects + music + ONE volume slider
 * (all owned by view/audio.ts, seeded from `audio.settings`), reduced-motion and control-hint
 * pickers (owned by storage.ts `fg.v1.settings`), and Reset best medals behind a confirm. Rows are
 * 52 px and whole-row clickable; changes apply immediately.
 */
import React, { useState } from 'react';
import type { InputDevice } from '../view/view';
import { COPY, deviceLabel } from './copy';
import { ConfirmDialog, Modal } from './Pause';
import type { HintDevice, ReducedMotion, UiSettings } from './storage';

export type SettingsProps = {
  muted: boolean;
  onToggleMute(): void;
  music: boolean;
  onToggleMusic(): void;
  volume: number;
  onVolume(v: number): void;
  settings: UiSettings;
  onChange(patch: Partial<UiSettings>): void;
  /** the device the input system currently reports (shown in the Auto option) */
  detectedDevice: InputDevice;
  onResetBests(): void;
  onClose(): void;
};

const MOTION_OPTIONS: readonly ReducedMotion[] = ['system', 'on', 'off'];
const HINT_OPTIONS: readonly HintDevice[] = ['auto', 'keyboard', 'pointer', 'touch', 'gamepad'];

function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle(): void }): React.JSX.Element {
  return (
    <button type="button" className="row toggle-row" role="switch" aria-checked={on} onClick={onToggle}>
      <span className="row-label">{label}</span>
      <span className={`switch${on ? ' on' : ''}`} aria-hidden="true">
        <span className="knob" />
        <span className="switch-word">{on ? COPY.settings.on : COPY.settings.off}</span>
      </span>
    </button>
  );
}

function Segmented<T extends string>({ id, label, options, value, render, onPick }: { id: string; label: string; options: readonly T[]; value: T; render(v: T): string; onPick(v: T): void }): React.JSX.Element {
  return (
    <div className="row seg-row">
      <span className="row-label" id={id}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={value === o} className={`seg${value === o ? ' on' : ''}`} onClick={() => onPick(o)}>
            {render(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Settings(props: SettingsProps): React.JSX.Element {
  const { muted, onToggleMute, music, onToggleMusic, volume, onVolume, settings, onChange, detectedDevice, onResetBests, onClose } = props;
  const [confirmReset, setConfirmReset] = useState(false);
  const isIos = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

  if (confirmReset) {
    return (
      <ConfirmDialog
        title={COPY.settings.resetConfirm}
        body={COPY.title.medalTooltip}
        confirmLabel={COPY.settings.resetClear}
        cancelLabel={COPY.settings.resetCancel}
        danger
        onConfirm={() => {
          setConfirmReset(false);
          onResetBests();
        }}
        onCancel={() => setConfirmReset(false)}
      />
    );
  }

  return (
    <Modal labelledBy="settings-title" onClose={onClose} size="narrow" scrim="dark" className="settings-card">
      <h2 id="settings-title" className="card-title">
        {COPY.settings.title}
      </h2>
      <div className="rows">
        <Toggle label={COPY.settings.sfx} on={!muted} onToggle={onToggleMute} />
        <Toggle label={COPY.settings.music} on={music} onToggle={onToggleMusic} />
        <label className="row slider-row">
          <span className="row-label">{COPY.settings.volume}</span>
          <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => onVolume(Number(e.target.value))} aria-valuetext={`${Math.round(volume * 100)}%`} />
        </label>
        <Segmented id="seg-motion" label={COPY.settings.motion} options={MOTION_OPTIONS} value={settings.reducedMotion} render={(v) => COPY.settings.motionOptions[v]} onPick={(v) => onChange({ reducedMotion: v })} />
        <Segmented
          id="seg-hints"
          label={COPY.settings.hints}
          options={HINT_OPTIONS}
          value={settings.hints ? settings.hintDevice : 'off'}
          render={(v) => (v === 'off' ? COPY.settings.hintOptions.off : v === 'auto' ? `${COPY.settings.hintOptions.auto} (${deviceLabel(detectedDevice)})` : COPY.settings.hintOptions[v])}
          onPick={(v) => onChange(v === 'off' ? { hints: false } : { hints: true, hintDevice: v })}
        />
        <button type="button" className="row danger-row" onClick={() => setConfirmReset(true)}>
          <span className="row-label">{COPY.settings.reset}</span>
        </button>
        {isIos && <p className="caption">{COPY.settings.ringer}</p>}
      </div>
      <button type="button" className="btn btn-primary" onClick={onClose} data-autofocus>
        {COPY.settings.done}
      </button>
    </Modal>
  );
}
