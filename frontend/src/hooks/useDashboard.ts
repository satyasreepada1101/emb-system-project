import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  COMMAND_TIMEOUT_MS,
  DEFAULT_STALE_MS,
  DEFAULT_WS_URL,
  loadSetting,
  makeCommandId,
  saveSetting,
} from '../lib/config';
import { initialState, reducer, type Mode } from '../lib/dashboardState';
import { DemoSimulator } from '../services/demoSimulator';
import { Esp32Socket } from '../services/esp32Socket';
import type { CommandAck, IncomingMessage, SetSystemEnabledCommand } from '../types/protocol';

const DEMO_TELEMETRY_MS = 200;
const DEMO_ACK_DELAY_MS = 350;

function init() {
  const mode: Mode = loadSetting('mode') === 'hardware' ? 'hardware' : 'demo';
  const staleMs = Number(loadSetting('staleMs')) || DEFAULT_STALE_MS;
  return initialState(mode, loadSetting('wsUrl') || DEFAULT_WS_URL, staleMs);
}

/** Owns the data source (demo simulator or ESP32 socket) and the command lifecycle. */
export function useDashboard() {
  const [state, dispatch] = useReducer(reducer, undefined, init);

  const socketRef = useRef<Esp32Socket | null>(null);
  const simRef = useRef<DemoSimulator | null>(null);
  const pendingIdRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = useCallback(() => {
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
    pendingIdRef.current = null;
  }, []);

  const failPending = useCallback(
    (status: 'timeout' | 'failed', message: string) => {
      if (!pendingIdRef.current) return;
      clearPending();
      dispatch({ type: 'COMMAND_FAILED', status, message, at: Date.now() });
    },
    [clearPending],
  );

  const resolveAck = useCallback(
    (ack: CommandAck) => {
      if (ack.commandId !== pendingIdRef.current) return; // unrelated / late ack
      clearPending();
      dispatch({ type: 'COMMAND_ACK', ack, at: Date.now() });
    },
    [clearPending],
  );

  // ---- DEMO data source --------------------------------------------------
  useEffect(() => {
    if (state.mode !== 'demo') return;
    const sim = new DemoSimulator();
    simRef.current = sim;
    sim.start(Date.now());

    const tick = () => {
      const now = Date.now();
      sim.advance(now);
      dispatch({ type: 'TELEMETRY', telemetry: sim.snapshot(now), receivedAt: now });
    };
    tick();
    const id = setInterval(tick, DEMO_TELEMETRY_MS);

    return () => {
      clearInterval(id);
      simRef.current = null;
      clearPending();
    };
  }, [state.mode, clearPending]);

  // ---- HARDWARE data source ----------------------------------------------
  useEffect(() => {
    if (state.mode !== 'hardware' || state.paused) return;

    const handleMessage = (message: IncomingMessage) => {
      switch (message.type) {
        case 'telemetry':
          dispatch({ type: 'TELEMETRY', telemetry: message, receivedAt: Date.now() });
          break;
        case 'hello':
          dispatch({ type: 'HELLO', hello: message });
          break;
        case 'commandAck':
          resolveAck(message);
          break;
        case 'error':
          dispatch({ type: 'DEVICE_ERROR', error: message.message });
          break;
      }
    };

    const socket = new Esp32Socket(state.wsUrl, {
      onLink: (info) => {
        dispatch({ type: 'LINK', info });
        if (info.status !== 'open') {
          // Never resend after reconnecting: the outcome is unknown, telemetry will tell.
          failPending(
            'failed',
            'Connection lost before the ESP32 acknowledged the command. Its effect is unknown; check the confirmed state once telemetry resumes.',
          );
        }
      },
      onMessage: handleMessage,
      onProtocolError: (error) => dispatch({ type: 'PROTOCOL_ERROR', error }),
    });
    socketRef.current = socket;
    socket.start();

    return () => {
      socket.stop();
      socketRef.current = null;
      clearPending();
    };
  }, [state.mode, state.wsUrl, state.paused, resolveAck, failPending, clearPending]);

  // ---- Actions -----------------------------------------------------------
  const setSystemEnabled = useCallback(
    (enabled: boolean) => {
      if (pendingIdRef.current) return;
      const command: SetSystemEnabledCommand = {
        type: 'setSystemEnabled',
        commandId: makeCommandId(),
        enabled,
      };
      const now = Date.now();

      if (state.mode === 'demo') {
        const sim = simRef.current;
        if (!sim) return;
        pendingIdRef.current = command.commandId;
        dispatch({ type: 'COMMAND_PENDING', commandId: command.commandId, requested: enabled, at: now });
        pendingTimerRef.current = setTimeout(() => {
          const ack = sim.handleCommand(command, Date.now());
          resolveAck(ack);
          dispatch({ type: 'TELEMETRY', telemetry: sim.snapshot(Date.now()), receivedAt: Date.now() });
        }, DEMO_ACK_DELAY_MS);
        return;
      }

      const socket = socketRef.current;
      if (!socket || !socket.send(command)) {
        pendingIdRef.current = command.commandId;
        dispatch({ type: 'COMMAND_PENDING', commandId: command.commandId, requested: enabled, at: now });
        failPending('failed', 'Not connected to the ESP32; the command was not sent.');
        return;
      }

      pendingIdRef.current = command.commandId;
      dispatch({ type: 'COMMAND_PENDING', commandId: command.commandId, requested: enabled, at: now });
      pendingTimerRef.current = setTimeout(() => {
        failPending(
          'timeout',
          `No acknowledgement within ${COMMAND_TIMEOUT_MS / 1000} s. The ESP32 state shown is the last confirmed state.`,
        );
      }, COMMAND_TIMEOUT_MS);
    },
    [state.mode, resolveAck, failPending],
  );

  const simulateButtonPress = useCallback(() => {
    const sim = simRef.current;
    if (state.mode !== 'demo' || !sim) return;
    const now = Date.now();
    sim.setEnabled(!sim.isEnabled, 'button', now);
    dispatch({ type: 'TELEMETRY', telemetry: sim.snapshot(now), receivedAt: now });
  }, [state.mode]);

  const setMode = useCallback((mode: Mode) => {
    saveSetting('mode', mode);
    dispatch({ type: 'SET_MODE', mode });
  }, []);

  const applySettings = useCallback((wsUrl: string, staleMs: number) => {
    saveSetting('wsUrl', wsUrl);
    saveSetting('staleMs', String(staleMs));
    dispatch({ type: 'SET_SETTINGS', wsUrl, staleMs });
  }, []);

  const setPaused = useCallback((paused: boolean) => dispatch({ type: 'SET_PAUSED', paused }), []);

  return { state, setSystemEnabled, simulateButtonPress, setMode, applySettings, setPaused };
}
