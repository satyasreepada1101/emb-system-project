import { CheckCircle2, Clock, Loader2, MousePointerClick, Power, XCircle } from 'lucide-react';
import type { CommandState, Mode, ViewModel } from '../lib/dashboardState';
import { sourceText } from '../lib/statusText';

interface Props {
  mode: Mode;
  view: ViewModel;
  command: CommandState;
  onSetEnabled(enabled: boolean): void;
  onSimulateButton(): void;
}

export function SystemControl({ mode, view, command, onSetEnabled, onSimulateButton }: Props) {
  const confirmed = view.live ? view.live.systemEnabled : null;
  const pending = command.status === 'pending';
  const disabled = !view.canCommand || confirmed === null;
  const device = mode === 'demo' ? 'demo simulator' : 'ESP32';

  // The physical button changed the state after the website command was acknowledged.
  const overriddenByButton =
    command.status === 'acknowledged' &&
    view.live !== null &&
    command.requested !== null &&
    view.live.systemEnabled !== command.requested &&
    view.live.enableSource === 'button';

  return (
    <div className="control-block">
      <span className="control-block__title">
        System power (website control)
        {mode === 'demo' && <span className="tag tag--demo">DEMO</span>}
      </span>

      <div className="system-switch">
        <button
          type="button"
          role="switch"
          aria-checked={confirmed === true}
          aria-label="Detection system enabled"
          className={`switch${confirmed ? ' switch--on' : ''}${pending ? ' switch--pending' : ''}`}
          disabled={disabled}
          onClick={() => {
            if (confirmed !== null) onSetEnabled(!confirmed);
          }}
        >
          <span className="switch__knob">
            {pending ? <Loader2 size={14} className="spin" aria-hidden /> : <Power size={14} aria-hidden />}
          </span>
        </button>
        <div className="system-switch__text">
          <strong>{confirmed === null ? 'State unknown' : confirmed ? 'Enabled' : 'Disabled'}</strong>
          {view.live && <span className="hint">Last changed by {sourceText(view.live.enableSource)}</span>}
        </div>
        {mode === 'demo' && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onSimulateButton}
            title="Simulates pressing the physical push button on the ESP32"
          >
            <MousePointerClick size={15} aria-hidden /> Simulate button press
          </button>
        )}
      </div>

      <div className="command-status" role="status" aria-live="polite">
        {pending && (
          <span className="command-status__item command-status--pending">
            <Loader2 size={14} className="spin" aria-hidden />
            Requesting {command.requested ? 'enable' : 'disable'}: waiting for {device} acknowledgement…
          </span>
        )}
        {command.status === 'acknowledged' && (
          <span className="command-status__item command-status--ok">
            <CheckCircle2 size={14} aria-hidden /> Confirmed by {device}: {command.message}
          </span>
        )}
        {command.status === 'rejected' && (
          <span className="command-status__item command-status--error">
            <XCircle size={14} aria-hidden /> Rejected by {device}: {command.message}
          </span>
        )}
        {(command.status === 'timeout' || command.status === 'failed') && (
          <span className="command-status__item command-status--error">
            {command.status === 'timeout' ? <Clock size={14} aria-hidden /> : <XCircle size={14} aria-hidden />}
            {command.message}
          </span>
        )}
        {overriddenByButton && (
          <span className="command-status__item command-status--warn">
            The physical button has since changed the state; the switch shows the current confirmed state.
          </span>
        )}
        {!pending && view.commandBlockedReason && (
          <span className="command-status__item command-status--muted">
            Control unavailable: {view.commandBlockedReason}.
          </span>
        )}
      </div>
    </div>
  );
}
