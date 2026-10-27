// ============================================================================
// MOCK ESP32 SIMULATOR (integration testing only, NOT hardware data)
//
// Speaks the same WebSocket protocol as the firmware so Hardware mode can be
// exercised without the ESP32. Its hello message reports device "simulator",
// and the dashboard shows a "MOCK SIMULATOR" warning while connected.
//
//   npm run mock-esp32 -- [--port 8081] [--no-ack] [--reject] [--ack-delay 300]
//
// Then set the dashboard URL to ws://localhost:8081 in Hardware mode.
// Keyboard (type + Enter):  b = simulate push-button press
//                           s = pause/resume telemetry (to test "stale")
//                           q = quit
// ============================================================================

import { WebSocketServer } from 'ws';
import readline from 'node:readline';
import { DemoSimulator } from '../src/services/demoSimulator.ts';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};

const PORT = option('--port', 8081);
const ACK_DELAY_MS = option('--ack-delay', 50);
const NO_ACK = flag('--no-ack');
const REJECT = flag('--reject');
const TELEMETRY_MS = 200;

const sim = new DemoSimulator(6000);
const startedAt = Date.now();
sim.start(startedAt);
let telemetryPaused = false;

const wss = new WebSocketServer({ port: PORT });

const send = (ws, obj) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
};
const broadcast = (obj) => wss.clients.forEach((c) => send(c, obj));
const telemetry = () => {
  const now = Date.now();
  sim.advance(now);
  return sim.snapshot(now);
};

// Same validation rules as handleCommand() in the firmware.
function handleCommand(ws, raw) {
  const text = raw.toString();
  if (text.length === 0 || text.length > 512) return send(ws, { type: 'error', message: 'Empty or oversized message' });

  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return send(ws, { type: 'error', message: 'Malformed JSON: expected an object' });
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return send(ws, { type: 'error', message: 'Malformed JSON: expected an object' });
  }
  const { commandId } = doc;
  if (typeof commandId !== 'string' || commandId.length === 0 || commandId.length > 64) {
    return send(ws, { type: 'error', message: 'Missing or invalid commandId' });
  }

  const ack = (accepted, message) => ({
    type: 'commandAck',
    commandId,
    accepted,
    systemEnabled: sim.isEnabled,
    message,
  });

  if (doc.type !== 'setSystemEnabled') return send(ws, ack(false, 'Unsupported command type'));
  if (typeof doc.enabled !== 'boolean') return send(ws, ack(false, "Field 'enabled' must be true or false"));

  if (NO_ACK) {
    console.log(`[mock] ${commandId}: dropping acknowledgement (--no-ack), state unchanged`);
    return;
  }
  if (REJECT) {
    console.log(`[mock] ${commandId}: rejecting (--reject)`);
    return setTimeout(() => send(ws, ack(false, 'Rejected by mock simulator (--reject)')), ACK_DELAY_MS);
  }

  setTimeout(() => {
    const result = sim.handleCommand({ type: 'setSystemEnabled', commandId, enabled: doc.enabled }, Date.now());
    console.log(`[mock] ${commandId}: ${result.message}`);
    send(ws, { ...result, message: result.message.replace(' (demo)', '') });
    broadcast(telemetry());
  }, ACK_DELAY_MS);
}

wss.on('connection', (ws, req) => {
  console.log(`[mock] client connected from ${req.socket.remoteAddress}`);
  send(ws, {
    type: 'hello',
    device: 'simulator',
    firmware: 'mock-esp32 simulator (not hardware)',
    telemetryIntervalMs: TELEMETRY_MS,
    micAngles: [0, 60, 120, 180],
    servoMin: 10,
    servoMax: 170,
  });
  ws.on('message', (raw) => handleCommand(ws, raw));
  ws.on('close', () => console.log('[mock] client disconnected'));
});

setInterval(() => {
  if (!telemetryPaused && wss.clients.size > 0) broadcast(telemetry());
}, TELEMETRY_MS);

console.log(`[mock] MOCK ESP32 SIMULATOR listening on ws://localhost:${PORT}`);
console.log('[mock] This is simulated data, NOT the physical ESP32.');
console.log('[mock] Keys: b = button press, s = pause/resume telemetry, q = quit');

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const key = line.trim().toLowerCase();
  if (key === 'b') {
    sim.setEnabled(!sim.isEnabled, 'button', Date.now());
    console.log(`[mock] button press -> system ${sim.isEnabled ? 'ENABLED' : 'DISABLED'}`);
    broadcast(telemetry());
  } else if (key === 's') {
    telemetryPaused = !telemetryPaused;
    console.log(`[mock] telemetry ${telemetryPaused ? 'PAUSED (dashboard should show stale)' : 'resumed'}`);
  } else if (key === 'q') {
    process.exit(0);
  }
});
