// Takes the screenshots shots.json names: serves app/ with serve.ts, drives headless Chrome over
// the DevTools protocol (Node's own WebSocket and fetch, nothing installed), waits for each
// route's window.__shotReady on live make.fun data, and writes screenshots/<file>.
//
//   node tools/shots.mjs            every shot in shots.json
//   node tools/shots.mjs --probe    also print each page's text and request counters

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_PORT = 8137;
const CDP_PORT = 9337;
const probe = process.argv.includes('--probe');
// A second list (the phone and profile checks in tools/checks.json) goes to its own directory:
//   node tools/shots.mjs tools/checks.json /tmp/mc-checks
const [listFile = 'shots.json', outDir = 'screenshots'] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const shots = JSON.parse(readFileSync(listFile, 'utf8'));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const server = spawn(process.execPath, ['serve.ts', '--port', String(APP_PORT)], { stdio: 'ignore' });
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mc-shots-'))}`,
  '--use-mock-keychain', '--password-store=basic', '--disable-background-networking', '--disable-component-update',
  '--disable-sync', '--disable-extensions', '--hide-scrollbars', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

async function connect() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* Chrome is still starting */ }
    await sleep(200);
  }
  throw new Error('Chrome did not open its DevTools port');
}

try {
  const socket = await connect();
  await new Promise((open, fail) => { socket.onopen = open; socket.onerror = fail; });
  const waiting = new Map();
  let nextId = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) { waiting.get(message.id)(message); waiting.delete(message.id); }
    if (probe && message.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR', JSON.stringify(message.params.exceptionDetails).slice(0, 400));
    // What really went over the wire for each API read: its status and the bytes it cost.
    if (probe && message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/')) {
      wire.set(message.params.requestId, `${message.params.response.status} ${message.params.response.url.replace(/^https:\/\/make\.fun\/api/, '')}`);
    }
    if (probe && message.method === 'Network.loadingFinished' && wire.has(message.params.requestId)) {
      console.log(`  WIRE ${wire.get(message.params.requestId)} · ${message.params.encodedDataLength} bytes`);
    }
  };
  const wire = new Map();
  const send = (method, params = {}) => new Promise((done) => { waiting.set(++nextId, done); socket.send(JSON.stringify({ id: nextId, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;

  await send('Page.enable');
  await send('Runtime.enable');
  if (probe) await send('Network.enable');
  for (const shot of shots) {
    const { width, height } = shot.viewport;
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await send('Page.navigate', { url: 'about:blank' });
    await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/${shot.path}` });
    let ready = false;
    for (let i = 0; i < 150 && !ready; i++) { await sleep(200); ready = (await evaluate('window.__shotReady === true')) === true; }
    if (!ready) throw new Error(`${shot.path} never set window.__shotReady`);
    if (shot.scroll) await evaluate(shot.scroll);
    await sleep(shot.wait ?? 700); // let the ticker and any avatar settle (a check may wait longer)
    const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    const bytes = Buffer.from(result.data, 'base64');
    writeFileSync(join(outDir, shot.file), bytes);
    console.log(`${shot.file}: ${shot.path} at ${width}x${height}, ${bytes.length} bytes`);
    if (probe) {
      console.log(await evaluate(`document.querySelector('#net').textContent + ' | DOM nodes ' + document.querySelectorAll('*').length + ' | resources ' + performance.getEntriesByType('resource').map((r) => r.name.replace(/^https?:\\/\\/[^/]+/, '')).join(' ')`));
      console.log(String(await evaluate(`document.querySelector(${width < 960 || shot.path === '#/' ? "'#board'" : "'#view'"}).innerText`)).slice(0, probe ? 900 : 0));
    }
  }
  socket.close();
} finally {
  chrome.kill();
  server.kill();
}
