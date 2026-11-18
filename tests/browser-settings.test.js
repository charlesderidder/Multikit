'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { scryptSync } = require('node:crypto');
const { test } = require('node:test');

const BrowserSettings = require(path.join(process.cwd(), '.homeybuild', 'helpers', 'browser-settings.js')).default; // eslint-disable-line import/no-dynamic-require

test('browser settings protect configuration and keep Flow routes separate', async (t) => {
  const values = new Map([['gmailAppPassword', 'secret'], ['serverPort', '3000']]);
  const calls = [];
  const app = {
    homey: {
      settings: {
        get: (key) => values.get(key),
        set: (key, value) => values.set(key, value),
        unset: (key) => values.delete(key),
      },
    },
    sendTestEmail: async () => {
      calls.push('email');
    },
    syncCalendars: async () => ({ events: 3 }),
    getStatus: () => ({ api: { listening: true } }),
    setCountdownRemaining: async (name, seconds) => {
      calls.push([name, seconds]);
    },
    error: (...args) => {
      throw new Error(`Unexpected server error: ${args}`);
    },
  };
  const settings = new BrowserSettings(app, process.cwd());
  const server = http.createServer(async (req, res) => {
    if (!await settings.handle(req, res)) {
      res.writeHead(200).end('flow');
    }
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const prefix = '/multikit-settings';
  const auth = (password, username = 'admin') => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const post = (path, body, headers = {}) => fetch(base + prefix + path, {
    method: 'POST',
    headers: {
      Authorization: auth('correct horse battery'),
      Origin: base,
      'Content-Type': 'application/json',
      'X-Multikit-Settings': '1',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  assert.equal((await fetch(`${base}/flow`)).status, 200);
  assert.equal(await (await fetch(base + prefix)).text(), 'flow');
  assert.throws(() => settings.setPassword('short'));
  assert.throws(() => settings.setPassword('123456', 'invalid:user'));
  assert.throws(() => settings.setPassword('123456', ' '));
  const salt = '0123456789abcdef0123456789abcdef';
  values.set('browserSettingsPassword', `${salt}:${scryptSync('legacy-password', salt, 32).toString('hex')}`);
  assert.equal((await fetch(base + prefix, { headers: { Authorization: auth('legacy-password') } })).status, 200);
  assert.equal(settings.getUsername(), 'admin');
  settings.setPassword('correct horse battery', 'admin');
  assert.notEqual(values.get('browserSettingsPassword'), 'correct horse battery');
  assert.equal((await fetch(base + prefix)).status, 401);
  assert.equal((await fetch(base + prefix, { headers: { Authorization: auth('wrong password') } })).status, 401);
  const page = await fetch(`${base + prefix}/`, { headers: { Authorization: auth('correct horse battery') } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /\/multikit-settings\/browser\.js/);
  assert.doesNotMatch(html, /src="\/homey\.js"/);
  assert.match(html, /<details class="settings-accordion"/);
  assert.match(html, /id="server-port"/);
  assert.match(html, /id="virtual-tab"/);
  assert.match(html, /id="virtual-panel"/);
  assert.match(html, /settings\.virtual\.deviceTemperature/);
  assert.match(html, /settings\.virtual\.modeTriggers/);
  assert.match(html, /showPanel\(virtualPanel, virtualTab\)/);
  assert.match(html, /widget-images\/active-timers\.png/);
  assert.match(html, /settings\.widgets\.calendarStats\.title/);
  const widgetImage = await fetch(`${base + prefix}/widget-images/active-timers.png`, { headers: { Authorization: auth('correct horse battery') } });
  assert.equal(widgetImage.status, 200);
  assert.match(widgetImage.headers.get('content-type'), /image\/png/);
  const activation = fs.readFileSync(path.join(process.cwd(), 'settings', 'index.html'), 'utf8');
  assert.match(activation, /multikit-cover\.png/);
  assert.match(activation, /id="browser-username"/);
  assert.match(activation, /id="browser-password"/);
  assert.match(activation, /settings\.virtual\.bootstrapHint/);
  assert.doesNotMatch(activation, /id="server-port"|id="email-panel"|id="ical-panel"/);
  const script = await fetch(`${base + prefix}/browser.js`, { headers: { Authorization: auth('correct horse battery') } });
  assert.match(script.headers.get('content-type'), /application\/javascript/);
  assert.doesNotMatch(await script.text(), /Object\.defineProperty\(exports/);
  assert.equal((await post('/get', { key: 'serverPort' })).status, 200);
  assert.deepEqual(await (await post('/get', { key: 'browserSettingsUsername' })).json(), { value: 'admin' });
  assert.equal((await post('/get', { key: 'gmailAppPassword' })).status, 400);
  assert.equal((await post('/get', { key: 'browserSettingsPassword' })).status, 400);
  assert.equal((await post('/set', { key: 'countdownTimerStates', value: [] })).status, 400);
  assert.equal((await post('/set', { key: 'serverPort', value: '99999' })).status, 400);
  assert.equal((await post('/set', { key: 'icalAutoSync', value: false })).status, 200);
  assert.equal((await (await post('/get', { key: 'icalAutoSync' })).json()).value, false);
  assert.equal((await post('/set', { key: 'icalAutoSync', value: 'false' })).status, 400);
  assert.equal((await post('/set', { key: 'icalCalendars', value: [{ name: 'one', url: 'file:///secret' }] })).status, 400);
  const savedWebhook = {
    id: '0123456789abcdef0123456789abcdef',
    name: 'Lights',
    url: 'https://example.com/hook?token=secret',
    method: 'POST',
    headers: '{"Authorization":"Bearer secret"}',
    body: '{"on":true}',
  };
  assert.equal((await post('/set', { key: 'webhooks', value: [savedWebhook] })).status, 200);
  assert.deepEqual((await (await post('/get', { key: 'webhooks' })).json()).value, [savedWebhook]);
  assert.equal((await post('/set', { key: 'webhooks', value: [savedWebhook, { ...savedWebhook, id: '11111111111111111111111111111111', name: 'lights' }] })).status, 400);
  assert.equal((await post('/set', { key: 'webhooks', value: [{ ...savedWebhook, headers: '{"bad header":"value"}' }] })).status, 400);
  assert.equal((await post('/set', { key: 'webhooks', value: [{ ...savedWebhook, url: 'http://user:pass@example.com' }] })).status, 400);
  assert.equal((await post('/set', { key: 'webhooks', value: [{ ...savedWebhook, body: 'x'.repeat(65537) }] })).status, 400);
  const tooLarge = Array.from({ length: 8 }, (_, index) => ({
    ...savedWebhook, id: index.toString(16).padStart(32, '0'), name: `hook-${index}`, body: 'x'.repeat(65536),
  }));
  assert.equal((await post('/set', { key: 'webhooks', value: tooLarge })).status, 400);
  assert.deepEqual(values.get('webhooks'), [savedWebhook]);
  assert.equal((await post('/set', { key: 'countdownTimerNames', value: ['Timer', 'timer'] })).status, 400);
  assert.equal((await post('/set', { key: 'serverPort', value: '4000' }, { Origin: 'http://attacker.example' })).status, 403);
  assert.equal((await post('/set', { key: 'serverPort', value: '4000' }, { 'X-Multikit-Settings': '' })).status, 403);
  assert.equal((await post('/set', { key: 'serverPort', value: '4000' })).status, 200);
  assert.equal(values.get('serverPort'), '4000');
  assert.equal((await post('/set', { key: 'gmailAppPassword', value: 'new secret' })).status, 200);
  assert.equal(values.get('gmailAppPassword'), 'new secret');
  assert.deepEqual(await (await post('/api/sync-calendars', {})).json(), { events: 3 });
  assert.deepEqual(await (await post('/api/status', {})).json(), { api: { listening: true } });
  assert.equal((await post('/api/test-email', {})).status, 200);
  assert.equal((await post('/api/countdown-remaining', { name: 'timer', seconds: 5 })).status, 200);
  assert.deepEqual(calls, ['email', ['timer', 5]]);
  assert.equal((await post('/api/browser-password', { username: 'gebruiker', password: '123456' })).status, 200);
  assert.equal((await post('/get', { key: 'serverPort' })).status, 401);
  assert.equal((await fetch(base + prefix, { headers: { Authorization: auth('123456') } })).status, 401);
  assert.equal((await fetch(base + prefix, { headers: { Authorization: auth('123456', 'gebruiker') } })).status, 200);
  assert.equal(settings.getUsername(), 'gebruiker');
  settings.setPassword('a different password');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    assert.equal((await fetch(base + prefix, { headers: { Authorization: auth('wrong password') } })).status, 401);
  }
  assert.equal((await fetch(base + prefix, { headers: { Authorization: auth('wrong password') } })).status, 429);
  settings.setPassword('');
  assert.equal(await (await fetch(base + prefix)).text(), 'flow');
});

test('Homey activation page configures and recovers browser access', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'settings', 'index.html'), 'utf8');
  const script = html.match(/<script type="text\/javascript">\s*([\s\S]*?)<\/script>/)[1];
  const elements = new Map();
  for (const id of ['browser-username', 'browser-password', 'browser-password-save', 'browser-password-disable', 'browser-password-status', 'browser-address']) {
    elements.set(id, {
      style: {},
      value: '',
      addEventListener(event, callback) {
        this[event] = callback;
      },
    });
  }
  const calls = [];
  const context = {
    document: { getElementById: (id) => elements.get(id) },
  };
  vm.runInNewContext(script, context);
  context.onHomeyReady({
    get(key, callback) {
      callback(null, '4200');
    },
    api(method, route, body, callback) {
      if (method === 'GET') {
        callback(null, { username: 'admin' });
        return;
      }
      calls.push([body.username, body.password]);
      callback(null);
    },
    __: (key) => key,
    ready() {
      calls.push('ready');
    },
  });
  assert.equal(elements.get('browser-address').textContent, 'http://HOMEY_IP:4200/multikit-settings/');
  assert.equal(elements.get('browser-username').value, 'admin');
  elements.get('browser-password').value = 'short';
  elements.get('browser-password-save').click();
  assert.deepEqual(calls, ['ready']);
  elements.get('browser-username').value = 'eigennaam';
  elements.get('browser-password').value = '123456';
  elements.get('browser-password-save').click();
  elements.get('browser-password-disable').click();
  assert.deepEqual(calls, ['ready', ['eigennaam', '123456'], ['eigennaam', '']]);
});

test('service indicators show configuration without acting as tab links', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'settings', 'browser.html'), 'utf8');
  const script = html.match(/ {4}const refreshStatus = \(\) => \{[\s\S]*?\n {4}\};\n {4}statusRefresh\.addEventListener/)[0]
    .replace(/\n {4}statusRefresh\.addEventListener$/, '');
  const elements = [];
  const statusResults = {
    replaceChildren() {
      elements.length = 0;
    },
    append(element) {
      elements.push(element);
    },
  };
  const statusRefresh = { disabled: false };
  const statusMessage = { textContent: '' };
  let response;
  const context = {
    statusResults,
    statusRefresh,
    statusMessage,
    document: {
      createElement(tag) {
        return {
          tag,
          children: [],
          append(child) {
            this.children.push(child);
          },
        };
      },
    },
    Homey: {
      __: (key) => key,
      api: (_method, _path, _body, callback) => callback(response.error, response.result),
    },
  };
  vm.runInNewContext(`${script}\nthis.refresh = refreshStatus;`, context);
  response = {
    result: {
      api: { listening: true, error: null },
      calendars: { configured: 1, lastSync: null, syncing: false },
      email: { configured: true, lastResult: { success: false, time: '2026-01-01', error: 'failed' } },
      webhook: { configured: 0, lastResult: { success: true, time: '2026-01-01' } },
    },
  };
  context.refresh();
  assert.deepEqual(elements.map((element) => element.className), [
    'status-chip ok', 'status-chip ok', 'status-chip ok', 'status-chip idle',
  ]);
  assert.ok(elements.every((element) => element.tag === 'span'));
  assert.match(elements[0].textContent, /settings\.status\.running/);
  assert.match(elements[3].textContent, /settings\.status\.notConfigured/);
  assert.match(elements[2].children[0].textContent, /settings\.status\.error/);

  response = { error: new Error('offline') };
  context.refresh();
  assert.equal(elements.length, 0);
  assert.match(statusMessage.textContent, /offline/);
});

test('calendar search filters title, calendar and location and shows empty results', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'settings', 'browser.html'), 'utf8');
  const script = html.match(/ {4}const renderICalEvents = \(\) => \{[\s\S]*?\n {4}\};\n {4}const loadICalEvents/)[0]
    .replace(/\n {4}const loadICalEvents$/, '');
  const body = {
    children: [],
    replaceChildren() {
      this.children = [];
    },
    appendChild(child) {
      this.children.push(child);
    },
  };
  const context = {
    displayedICalEvents: [
      {
        title: 'Meeting', calendar: 'Work', location: 'Office', start: 1, end: 2,
      },
      {
        title: 'Dinner', calendar: 'Home', location: 'Kitchen', start: 3, end: 4,
      },
    ],
    icalEventsSearch: { value: '' },
    icalEventsBody: body,
    icalEventsEmpty: { hidden: true },
    icalEventsNoMatches: { hidden: true },
    document: {
      createElement() {
        return {
          classList: { toggle() {} },
          children: [],
          appendChild(child) {
            this.children.push(child);
          },
        };
      },
    },
  };
  vm.runInNewContext(`${script}\nthis.render = renderICalEvents;`, context);
  for (const query of ['MEETING', 'work', 'office']) {
    context.icalEventsSearch.value = query;
    context.render();
    assert.equal(body.children.length, 1);
    assert.equal(body.children[0].children[2].textContent, 'Meeting');
  }
  context.icalEventsSearch.value = 'missing';
  context.render();
  assert.equal(body.children.length, 0);
  assert.equal(context.icalEventsNoMatches.hidden, false);
  assert.equal(context.icalEventsEmpty.hidden, true);
});

test('calendar widget renders the Promise response and upcoming events', async () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'widgets', 'ical-upcoming', 'public', 'index.html'), 'utf8');
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  const elements = new Map([
    ['events', {
      replaceChildren() {
        this.children = [];
      },
      appendChild(child) {
        this.children.push(child);
      },
      children: [],
    }],
    ['status', { textContent: '' }],
    ['refresh', {
      disabled: false,
      addEventListener(event, callback) {
        this[event] = callback;
      },
    }],
    ['heading', { textContent: '' }],
  ]);
  const calls = [];
  const context = {
    document: {
      getElementById: (id) => elements.get(id),
      createElement(tag) {
        return {
          tag,
          children: [],
          appendChild(child) {
            this.children.push(child);
          },
          append(...children) {
            this.children.push(...children);
          },
        };
      },
    },
    setInterval: () => 1,
  };
  vm.runInNewContext(script, context);
  const events = [{
    title: 'Meeting',
    calendar: 'Work',
    location: 'Office',
    start: '2030-01-01T10:00:00.000Z',
    end: '2030-01-01T11:00:00.000Z',
  }];
  let ready = false;
  context.onHomeyReady({
    getSettings: () => ({ daysAhead: 3, showCalendar: true, showLocation: true }),
    __: (key) => key,
    async api(method, route) {
      calls.push([method, route]);
      return events;
    },
    ready: () => {
      ready = true;
    },
  });
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(ready, true);
  assert.deepEqual(calls, [['GET', '/events?daysAhead=3']]);
  assert.equal(elements.get('status').textContent, '');
  assert.equal(elements.get('events').children.length, 1);
  assert.equal(elements.get('events').children[0].children[0].textContent, 'Meeting');
  assert.equal(elements.get('events').children[0].children[2].textContent, 'Work');
  assert.equal(elements.get('events').children[0].children[3].textContent, 'Office');
});
