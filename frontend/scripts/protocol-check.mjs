// Protocol test utility: connects to an ESP32 (or the mock simulator) and
// checks telemetry and the command/acknowledgement flow.
//
//   npm run protocol-check -- ws://192.168.1.120:81            (full check)
//   npm run protocol-check -- ws://192.168.1.120:81 --no-toggle (read-only)
//
// The full check briefly disables and re-enables the system. If the ESP32 is
// still calibrating, disabling aborts calibration and it restarts (30 s).

import WebSocket from 'ws';
import { parseIncoming } from '../src/services/protocolParser.ts';

const url = process.argv.slice(2).find((a) => a.startsWith('ws'));
const noToggle = process.argv.includes('--no-toggle');
if (!url) {
  console.error('Usage: npm run protocol-check -- ws://<esp32-ip>:81 [--no-toggle]');
  process.exit(2);
}

let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};
const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

const ws = new WebSocket(url);
const queue = [];
const waiters = [];

ws.on('message', (data) => {
  const result = parseIncoming(data.toString());
  if (!result.ok) {
    fail(`received invalid message: ${result.error}`);
    return;
  }
  const msg = { ...result.message, receivedAt: Date.now() };
  const i = waiters.findIndex((w) => w.match(msg));
  if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
  else queue.push(msg);
});

function next(match, timeoutMs = 3000) {
  const i = queue.findIndex(match);
  if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
  return new Promise((resolve, reject) => {
    const waiter = { match, resolve };
    waiters.push(waiter);
    setTimeout(() => {
      const j = waiters.indexOf(waiter);
      if (j >= 0) {
        waiters.splice(j, 1);
        reject(new Error('timeout'));
      }
    }, timeoutMs);
  });
}

const isType = (type) => (m) => m.type === type;
const ackFor = (id) => (m) => (m.type === 'commandAck' && m.commandId === id) || m.type === 'error';
let counter = 0;
const command = (enabled) => {
  const commandId = `check-${Date.now()}-${++counter}`;
  ws.send(JSON.stringify({ type: 'setSystemEnabled', commandId, enabled }));
  return commandId;
};

async function run() {
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  console.log(`Connected to ${url}\n`);

  // 1. hello + telemetry
  try {
    const hello = await next(isType('hello'), 2000);
    pass(`hello received (device: ${hello.device}, firmware: ${hello.firmware})`);
    if (hello.device === 'simulator') console.log('        NOTE: this is the MOCK SIMULATOR, not physical hardware');
  } catch {
    fail('no hello message within 2 s');
  }

  const first = await next(isType('telemetry'));
  pass('telemetry received and valid');

  // 2. rate and sequence
  queue.length = 0;
  const samples = [];
  const until = Date.now() + 2000;
  while (Date.now() < until) {
    try {
      samples.push(await next(isType('telemetry'), 1000));
    } catch {
      break;
    }
  }
  const rate = samples.length / 2;
  check(rate >= 2 && rate <= 15, `telemetry rate ${rate.toFixed(1)} msg/s (expected ~5)`);
  check(
    samples.every((s, i) => i === 0 || s.sequence > samples[i - 1].sequence),
    'sequence strictly increases',
  );
  const last = samples.at(-1) ?? first;
  check(last.led1On === last.systemEnabled, 'LED 1 matches systemEnabled');
  check(!last.led2On || last.soundDetected, 'LED 2 only on while sound detected');
  check(
    last.estimatedAngle === null || (last.estimatedAngle >= 0 && last.estimatedAngle <= 180),
    'estimatedAngle null or within 0–180°',
  );
  check(last.servoTarget === null || (last.servoTarget >= 10 && last.servoTarget <= 170), 'servoTarget within 10–170°');
  console.log(
    `        state: enabled=${last.systemEnabled} calibrating=${last.calibrating} sound=${last.soundDetected} angle=${last.estimatedAngle}`,
  );

  // 3. malformed and unsupported commands
  ws.send('{not json');
  try {
    const e = await next(isType('error'));
    pass(`malformed JSON rejected ("${e.message}")`);
  } catch {
    fail('no error reply to malformed JSON');
  }

  ws.send(JSON.stringify({ type: 'reboot', commandId: 'check-unsupported' }));
  try {
    const a = await next(ackFor('check-unsupported'));
    check(a.type === 'commandAck' && a.accepted === false, `unsupported command rejected ("${a.message}")`);
  } catch {
    fail('no reply to unsupported command');
  }

  ws.send(JSON.stringify({ type: 'setSystemEnabled', commandId: 'check-badfield', enabled: 'no' }));
  try {
    const a = await next(ackFor('check-badfield'));
    check(a.type === 'commandAck' && a.accepted === false, `non-boolean 'enabled' rejected ("${a.message}")`);
  } catch {
    fail("no reply to invalid 'enabled' field");
  }

  // 4. set-state commands
  if (noToggle) {
    console.log('\n  SKIP  enable/disable checks (--no-toggle)');
  } else {
    const original = last.systemEnabled;
    for (const enabled of [!original, !original, original]) {
      const id = command(enabled);
      const sentAt = Date.now();
      try {
        const ack = await next(ackFor(id));
        check(
          ack.type === 'commandAck' && ack.accepted && ack.systemEnabled === enabled,
          `setSystemEnabled(${enabled}) acknowledged in ${Date.now() - sentAt} ms ("${ack.message}")`,
        );
        queue.length = 0;
        const t = await next((m) => m.type === 'telemetry' && m.receivedAt >= ack.receivedAt);
        check(t.systemEnabled === enabled && t.led1On === enabled, `telemetry confirms enabled=${enabled}, LED 1 ${enabled ? 'ON' : 'OFF'}`);
        if (!enabled) {
          check(
            !t.led2On && !t.soundDetected && t.estimatedAngle === null && t.micActivity === null,
            'disabled: LED 2 off, no detection, no mic readings',
          );
          check(t.enableSource === 'web', 'enableSource reported as "web"');
        }
      } catch {
        fail(`setSystemEnabled(${enabled}): no acknowledgement within 3 s`);
      }
    }
  }

  ws.close();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error(`\nCould not complete checks: ${err.message}`);
  process.exit(1);
});
