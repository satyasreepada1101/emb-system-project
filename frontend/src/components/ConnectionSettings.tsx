import { useEffect, useState, type FormEvent } from 'react';
import { Plug, PlugZap, Settings2 } from 'lucide-react';
import { EXAMPLE_WS_URL, isValidWsUrl } from '../lib/config';
import type { DashboardState } from '../lib/dashboardState';

interface Props {
  state: DashboardState;
  now: number;
  onApply(wsUrl: string, staleMs: number): void;
  onPause(paused: boolean): void;
}

export function ConnectionSettings({ state, now, onApply, onPause }: Props) {
  const [url, setUrl] = useState(state.wsUrl);
  const [stale, setStale] = useState(String(state.staleMs));

  useEffect(() => setUrl(state.wsUrl), [state.wsUrl]);
  useEffect(() => setStale(String(state.staleMs)), [state.staleMs]);

  const urlValid = isValidWsUrl(url.trim());
  const staleNum = Number(stale);
  const staleValid = Number.isFinite(staleNum) && staleNum >= 300 && staleNum <= 60000;
  const dirty = url.trim() !== state.wsUrl || staleNum !== state.staleMs;
  const pageIsHttps = window.location.protocol === 'https:';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (urlValid && staleValid) onApply(url.trim(), staleNum);
  };

  const { link } = state;
  const retryIn = link.retryAt ? Math.max(0, Math.ceil((link.retryAt - now) / 1000)) : null;
  const hardware = state.mode === 'hardware';

  return (
    <form className="control-block settings" onSubmit={submit}>
      <span className="control-block__title">
        <Settings2 size={15} aria-hidden /> ESP32 connection
      </span>

      <div className="settings__row">
        <label className="field">
          <span>WebSocket URL</span>
          <input
            className="mono"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={EXAMPLE_WS_URL}
            spellCheck={false}
            aria-invalid={!urlValid}
          />
        </label>
        <label className="field field--small">
          <span>Stale after (ms)</span>
          <input
            className="mono"
            type="number"
            min={300}
            max={60000}
            step={100}
            value={stale}
            onChange={(e) => setStale(e.target.value)}
            aria-invalid={!staleValid}
          />
        </label>
        <button type="submit" className="btn" disabled={!dirty || !urlValid || !staleValid}>
          Apply
        </button>
        {hardware &&
          (state.paused ? (
            <button type="button" className="btn" onClick={() => onPause(false)}>
              <PlugZap size={15} aria-hidden /> Connect
            </button>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={() => onPause(true)}>
              <Plug size={15} aria-hidden /> Disconnect
            </button>
          ))}
      </div>

      <span className="hint">
        {!urlValid
          ? 'Enter a URL like ws://<ESP32-IP>:81'
          : hardware
            ? 'Use the IP address the ESP32 prints in Serial Monitor. The default is only an example.'
            : 'Used when Hardware mode is selected.'}
        {pageIsHttps && ' This page is served over HTTPS, so browsers will block ws:// connections.'}
      </span>

      {hardware && link.status === 'reconnecting' && (
        <span className="hint hint--warn">
          {link.error} · retrying{retryIn !== null ? ` in ${retryIn} s` : ''} (attempt {link.attempt + 1})
        </span>
      )}
      {hardware && link.status === 'closed' && link.error && (
        <span className="hint hint--warn">{link.error}</span>
      )}
    </form>
  );
}
