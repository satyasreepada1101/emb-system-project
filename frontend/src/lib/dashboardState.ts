// Centralised dashboard state (reducer) and the derived view model that every
// component reads. Pure module: type-only imports, unit tested in tests/.

import type { LinkInfo } from '../services/esp32Socket';
import type { CommandAck, Hello, Telemetry } from '../types/protocol';

export type Mode = 'demo' | 'hardware';

export type CommandStatus = 'idle' | 'pending' | 'acknowledged' | 'rejected' | 'timeout' | 'failed';

export interface CommandState {
  status: CommandStatus;
  commandId: string | null;
  requested: boolean | null;
  message: string | null;
  /** Epoch ms when the command was sent or resolved. */
  at: number | null;
}

export interface LastDetection {
  angle: number;
  strongestMic: number | null;
  at: number;
}

export interface DashboardState {
  mode: Mode;
  wsUrl: string;
  staleMs: number;
  /** User pressed Disconnect in hardware mode. */
  paused: boolean;
  link: LinkInfo;
  device: Hello | null;
  /** Latest telemetry of the current session (cleared on reconnect / mode switch). */
  telemetry: Telemetry | null;
  receivedAt: number | null;
  /** Last successful telemetry time, kept across reconnects for the status panel. */
  lastUpdateAt: number | null;
  lastDetection: LastDetection | null;
  command: CommandState;
  protocolErrors: number;
  lastProtocolError: string | null;
  lastDeviceError: string | null;
}

export type Action =
  | { type: 'SET_MODE'; mode: Mode }
  | { type: 'SET_SETTINGS'; wsUrl: string; staleMs: number }
  | { type: 'SET_PAUSED'; paused: boolean }
  | { type: 'LINK'; info: LinkInfo }
  | { type: 'HELLO'; hello: Hello }
  | { type: 'TELEMETRY'; telemetry: Telemetry; receivedAt: number }
  | { type: 'PROTOCOL_ERROR'; error: string }
  | { type: 'DEVICE_ERROR'; error: string }
  | { type: 'COMMAND_PENDING'; commandId: string; requested: boolean; at: number }
  | { type: 'COMMAND_ACK'; ack: CommandAck; at: number }
  | { type: 'COMMAND_FAILED'; status: 'timeout' | 'failed'; message: string; at: number };

const IDLE_COMMAND: CommandState = {
  status: 'idle',
  commandId: null,
  requested: null,
  message: null,
  at: null,
};

const IDLE_LINK: LinkInfo = { status: 'idle', attempt: 0, retryAt: null, error: null };

export function initialState(mode: Mode, wsUrl: string, staleMs: number): DashboardState {
  return {
    mode,
    wsUrl,
    staleMs,
    paused: false,
    link: IDLE_LINK,
    device: null,
    telemetry: null,
    receivedAt: null,
    lastUpdateAt: null,
    lastDetection: null,
    command: IDLE_COMMAND,
    protocolErrors: 0,
    lastProtocolError: null,
    lastDeviceError: null,
  };
}

/** Everything tied to a data source is discarded so demo and hardware values never mix. */
function freshSession(state: DashboardState): DashboardState {
  return {
    ...state,
    link: IDLE_LINK,
    device: null,
    telemetry: null,
    receivedAt: null,
    lastUpdateAt: null,
    lastDetection: null,
    command: IDLE_COMMAND,
    protocolErrors: 0,
    lastProtocolError: null,
    lastDeviceError: null,
  };
}

export function reducer(state: DashboardState, action: Action): DashboardState {
  switch (action.type) {
    case 'SET_MODE':
      if (action.mode === state.mode) return state;
      return { ...freshSession(state), mode: action.mode, paused: false };

    case 'SET_SETTINGS':
      if (action.wsUrl !== state.wsUrl) {
        return { ...freshSession(state), wsUrl: action.wsUrl, staleMs: action.staleMs };
      }
      return { ...state, staleMs: action.staleMs };

    case 'SET_PAUSED':
      return { ...state, paused: action.paused };

    case 'LINK': {
      if (state.mode !== 'hardware') return state;
      const opened = action.info.status === 'open' && state.link.status !== 'open';
      const lost = action.info.status !== 'open';
      return {
        ...state,
        link: action.info,
        // A new connection starts with no live telemetry until the ESP32 sends some.
        telemetry: opened || lost ? null : state.telemetry,
        receivedAt: opened || lost ? null : state.receivedAt,
        device: lost ? null : state.device,
      };
    }

    case 'HELLO':
      return { ...state, device: action.hello };

    case 'TELEMETRY': {
      const t = action.telemetry;
      const detected = t.systemEnabled && t.soundDetected && t.estimatedAngle !== null;
      return {
        ...state,
        telemetry: t,
        receivedAt: action.receivedAt,
        lastUpdateAt: action.receivedAt,
        lastDetection: detected
          ? { angle: t.estimatedAngle as number, strongestMic: t.strongestMic, at: action.receivedAt }
          : state.lastDetection,
      };
    }

    case 'PROTOCOL_ERROR':
      return {
        ...state,
        protocolErrors: state.protocolErrors + 1,
        lastProtocolError: action.error,
      };

    case 'DEVICE_ERROR':
      return { ...state, lastDeviceError: action.error };

    case 'COMMAND_PENDING':
      return {
        ...state,
        command: {
          status: 'pending',
          commandId: action.commandId,
          requested: action.requested,
          message: null,
          at: action.at,
        },
      };

    case 'COMMAND_ACK': {
      if (state.command.status !== 'pending' || state.command.commandId !== action.ack.commandId) {
        return state; // late or unknown acknowledgement
      }
      return {
        ...state,
        command: {
          ...state.command,
          status: action.ack.accepted ? 'acknowledged' : 'rejected',
          message: action.ack.message,
          at: action.at,
        },
        // The ack carries the confirmed state; apply it until the next telemetry arrives.
        telemetry: state.telemetry
          ? { ...state.telemetry, systemEnabled: action.ack.systemEnabled }
          : state.telemetry,
      };
    }

    case 'COMMAND_FAILED':
      if (state.command.status !== 'pending') return state;
      return {
        ...state,
        command: { ...state.command, status: action.status, message: action.message, at: action.at },
      };
  }
}

// ---------------------------------------------------------------------------

export type DataState = 'demo' | 'live' | 'connecting' | 'waiting' | 'stale' | 'disconnected' | 'paused';

export interface ViewModel {
  dataState: DataState;
  /** True when `live` holds fresh, usable data (demo or hardware). */
  isLive: boolean;
  /** Telemetry to present as current, or null when data is not live. */
  live: Telemetry | null;
  /** Age of the latest telemetry in ms. */
  ageMs: number | null;
  canCommand: boolean;
  commandBlockedReason: string | null;
}

export function deriveView(state: DashboardState, now: number): ViewModel {
  const ageMs = state.receivedAt === null ? null : Math.max(0, now - state.receivedAt);
  let dataState: DataState;

  if (state.mode === 'demo') {
    dataState = state.telemetry ? 'demo' : 'waiting';
  } else if (state.paused) {
    dataState = 'paused';
  } else if (state.link.status === 'open') {
    if (!state.telemetry) dataState = 'waiting';
    else dataState = ageMs !== null && ageMs > state.staleMs ? 'stale' : 'live';
  } else if (state.link.status === 'connecting' && state.link.attempt <= 1) {
    dataState = 'connecting';
  } else {
    dataState = 'disconnected';
  }

  const isLive = dataState === 'demo' || dataState === 'live';
  const pending = state.command.status === 'pending';

  let commandBlockedReason: string | null = null;
  if (pending) commandBlockedReason = 'Waiting for acknowledgement of the previous command';
  else if (!isLive) {
    commandBlockedReason =
      dataState === 'stale'
        ? 'Telemetry is stale; the ESP32 state is unknown'
        : 'Not connected to the ESP32';
  }

  return {
    dataState,
    isLive,
    live: isLive ? state.telemetry : null,
    ageMs,
    canCommand: commandBlockedReason === null,
    commandBlockedReason,
  };
}
