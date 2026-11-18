'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');

const sendWebhook = require(path.join(process.cwd(), '.homeybuild', 'helpers', 'webhook.js')).default; // eslint-disable-line import/no-dynamic-require

test('outgoing webhooks send method, headers and body and reject failures', async (t) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ method: req.method, header: req.headers['x-test'], body: Buffer.concat(chunks).toString() });
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/followed' }).end();
      } else if (req.url === '/large') {
        res.end(Buffer.alloc(1024 * 1024 + 1));
      } else {
        res.writeHead(204).end();
      }
    });
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const args = {
    url, method: 'POST', headers: '{"X-Test":"value"}', body: '{"example":1}',
  };
  await sendWebhook(args);
  assert.deepEqual(requests[0], { method: 'POST', header: 'value', body: '{"example":1}' });
  await sendWebhook({ ...args, method: 'GET' });
  assert.equal(requests[1].body, '{"example":1}');
  await assert.rejects(sendWebhook({ ...args, url: `${url}/redirect` }), /HTTP 302/);
  assert.equal(requests.length, 3);
  await assert.rejects(sendWebhook({ ...args, url: `${url}/large` }), /Webhook/);
  await assert.rejects(sendWebhook({ ...args, headers: '{"X-Test":5}' }), /headers/i);
  await assert.rejects(sendWebhook({ ...args, url: 'http://user:pass@example.com' }), /credentials/);
  await assert.rejects(sendWebhook({ ...args, url: 'file:///test' }), /HTTP or HTTPS/);
  await assert.rejects(sendWebhook({ ...args, body: 'x'.repeat(1024 * 1024 + 1) }), /1 MB/);
});

test('webhook deadline applies even while the response is streaming', { timeout: 20000 }, async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200);
    res.write('started');
    const interval = setInterval(() => res.write('.'), 500);
    res.on('close', () => clearInterval(interval));
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  const start = Date.now();
  await assert.rejects(sendWebhook({
    url: `http://127.0.0.1:${server.address().port}`, method: 'GET', headers: '', body: '',
  }), /Webhook/);
  assert.ok(Date.now() - start >= 14500 && Date.now() - start < 19000);
});

test('filtered calendar triggers, status and saved webhook Flow action', async (t) => {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'homey') return { App: class App {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  let App;
  try {
    App = require(path.join(process.cwd(), '.homeybuild', 'app.js')); // eslint-disable-line global-require, import/no-dynamic-require
  } finally {
    Module._load = originalLoad;
  }
  assert.equal(require.cache[require.resolve('emailjs')], undefined);
  assert.equal(require.cache[require.resolve('node-ical')], undefined);
  const cards = new Map();
  const settings = { gmailAddress: 'person@example.com', gmailAppPassword: 'private', icalCalendars: [] };
  const card = (id) => {
    if (!cards.has(id)) {
      cards.set(id, {
        calls: [],
        registerRunListener(listener) {
          this.listener = listener;
        },
        registerArgumentAutocompleteListener(_name, listener) {
          this.autocomplete = listener;
        },
        async trigger(tokens, state) {
          this.calls.push({ tokens, state });
        },
      });
    }
    return cards.get(id);
  };
  const app = new App();
  app.homey = {
    flow: { getTriggerCard: card, getActionCard: card, getConditionCard: card },
    settings: { get: (key) => settings[key] },
  };
  app.error = () => {
    throw new Error('Unexpected trigger error');
  };
  app.registerICalCards();
  const now = Date.now();
  app.icalEvents = [
    {
      title: 'Meeting', calendar: 'Work', start: now - 1000, end: now + 300000,
    },
    {
      title: 'Dinner', calendar: 'Home', start: now + 1000, end: now + 3600000,
    },
  ];
  const endsWithin = card('ical-event-ends-within').listener;
  assert.equal(await endsWithin({ minutes: 10, title: 'meet', calendar: 'work' }), true);
  assert.equal(await endsWithin({ minutes: 10, title: 'dinner', calendar: 'home' }), false);
  assert.equal(await endsWithin({ minutes: 10, title: 'meet', calendar: 'home' }), false);
  await assert.rejects(endsWithin({ minutes: -1 }), /timeframe/);
  const tokens = { title: 'Vuilnis ophalen', calendar: 'Thuis' };
  app.fireICalTrigger('ical-event-started', tokens);
  assert.equal(card('ical-event-started').calls.length, 1);
  const filtered = card('ical-event-filtered');
  assert.equal(filtered.calls.length, 1);
  const { state } = filtered.calls[0];
  assert.equal(filtered.listener({ eventType: 'ical-event-started', title: 'VUILNIS', calendar: 'thuis' }, state), true);
  assert.equal(filtered.listener({ eventType: 'ical-event-ended', title: '*', calendar: '*' }, state), false);
  assert.equal(filtered.listener({ eventType: 'ical-event-started', title: 'werk', calendar: '*' }, state), false);
  assert.equal(filtered.listener({ eventType: 'ical-event-started', title: '*', calendar: 'werk' }, state), false);
  assert.equal(filtered.listener({ eventType: 'ical-event-started', title: '*', calendar: '*' }, state), true);
  ['ical-event-ended', 'ical-event-added', 'ical-event-changed'].forEach((id) => {
    app.fireICalTrigger(id, tokens);
    assert.equal(card(id).calls.length, 1);
    assert.equal(filtered.listener({ eventType: id, title: '*', calendar: '*' }, filtered.calls[filtered.calls.length - 1].state), true);
  });
  app.fireICalTrigger('ical-sync-error', { calendar: 'Thuis', error: 'failed' });
  assert.equal(filtered.calls.length, 4);
  app.performICalCalendarSync = async () => ({
    events: 0, added: [], changed: [], failedCalendars: ['Thuis'], failures: [{ calendar: 'Thuis', error: 'failed' }],
  });
  await app.syncICalCalendars();
  app.performGmailEmail = async () => {
    const error = new Error('private');
    error.code = 'EAUTH';
    throw error;
  };
  await assert.rejects(app.sendGmailEmail('person@example.com', 'subject', 'body'));
  await assert.rejects(app.sendWebhook({
    url: 'invalid', method: 'GET', headers: '', body: '',
  }));
  const status = app.getStatus();
  assert.equal(status.email.configured, true);
  assert.match(status.email.lastResult.error, /EAUTH/);
  assert.equal(status.webhook.lastResult.success, false);
  assert.equal(status.webhook.configured, 0);
  assert.equal(status.calendars.configured, 0);
  assert.equal(status.calendars.lastSync.failures[0].calendar, 'Thuis');
  assert.doesNotMatch(JSON.stringify(status), /private|person@example/);

  const received = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      received.push(Buffer.concat(chunks).toString());
      response.writeHead(204).end();
    });
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  const savedWebhook = {
    id: '0123456789abcdef0123456789abcdef',
    name: 'Lights',
    url: `http://127.0.0.1:${server.address().port}`,
    method: 'POST',
    headers: '{"Authorization":"secret"}',
    body: 'first',
  };
  settings.webhooks = [savedWebhook];
  assert.equal(app.getStatus().webhook.configured, 1);
  app.registerWebhookCards();
  const savedCard = card('webhook-send-saved');
  assert.deepEqual(await savedCard.autocomplete('LIGHT'), [{ id: savedWebhook.id, name: 'Lights' }]);
  assert.deepEqual(await savedCard.autocomplete('missing'), []);
  settings.webhooks = [{ ...savedWebhook, name: 'Renamed', body: 'updated' }];
  assert.equal(await savedCard.listener({ webhook: { id: savedWebhook.id } }), true);
  assert.deepEqual(received, ['updated']);
  settings.webhooks = [];
  await assert.rejects(savedCard.listener({ webhook: { id: savedWebhook.id } }), /no longer exists/);
  settings.webhooks = [{ ...savedWebhook, headers: 'invalid' }];
  await assert.rejects(savedCard.autocomplete(''), /headers/i);

  const autoApp = new App();
  const calendarSettings = { icalAutoSync: false };
  let settingsListener;
  let syncCount = 0;
  autoApp.homey = {
    settings: {
      get: (key) => calendarSettings[key],
      on: (_event, listener) => {
        settingsListener = listener;
      },
    },
  };
  autoApp.getICalCalendars = () => [];
  autoApp.registerICalFlowTokens = async () => {};
  autoApp.syncICalCalendars = async () => {
    syncCount += 1;
  };
  autoApp.error = (...args) => {
    throw new Error(String(args));
  };
  await autoApp.initializeICal();
  t.after(() => {
    clearInterval(autoApp.icalInterval);
    clearInterval(autoApp.icalEventTickInterval);
    clearTimeout(autoApp.icalConfigTimeout);
  });
  settingsListener('icalCalendars');
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  assert.equal(syncCount, 0);
  await autoApp.syncCalendars();
  assert.equal(syncCount, 1);
  calendarSettings.icalAutoSync = true;
  settingsListener('icalAutoSync');
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  assert.equal(syncCount, 2);
  settingsListener('icalCalendars');
  calendarSettings.icalAutoSync = false;
  settingsListener('icalAutoSync');
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  assert.equal(syncCount, 2);

  delete calendarSettings.icalAutoSync;
  const defaultApp = new App();
  defaultApp.homey = autoApp.homey;
  defaultApp.getICalCalendars = () => [];
  defaultApp.registerICalFlowTokens = async () => {};
  defaultApp.syncICalCalendars = async () => {
    syncCount += 1;
  };
  defaultApp.error = autoApp.error;
  await defaultApp.initializeICal();
  t.after(() => {
    clearInterval(defaultApp.icalInterval);
    clearInterval(defaultApp.icalEventTickInterval);
    clearTimeout(defaultApp.icalConfigTimeout);
  });
  assert.equal(syncCount, 3);
});

test('empty calendars stay lazy and legacy calendar snapshots become compact', async (t) => {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'homey') return { App: class App {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  let App;
  try {
    delete require.cache[require.resolve(path.join(process.cwd(), '.homeybuild', 'app.js'))];
    App = require(path.join(process.cwd(), '.homeybuild', 'app.js')); // eslint-disable-line global-require, import/no-dynamic-require
  } finally {
    Module._load = originalLoad;
  }

  const settings = {
    icalCalendars: [{ name: 'Work', url: 'https://example.com/calendar.ics' }],
    icalAutoSync: false,
  };
  const legacyEvent = {
    id: 'Work|event|1700000000000',
    uid: 'event',
    calendar: 'Work',
    title: 'Meeting',
    description: 'Legacy snapshot',
    location: 'Office',
    url: 'https://example.com/event',
    status: 'CONFIRMED',
    created: null,
    start: 1700000000000,
    end: 1700003600000,
    source: 'remote',
  };
  settings.icalSyncSnapshots = { Work: [legacyEvent] };
  const app = new App();
  app.homey = {
    settings: {
      get: (key) => settings[key],
      set: (key, value) => {
        settings[key] = value;
      },
      on: () => {},
    },
  };
  app.registerICalFlowTokens = async () => {};
  app.error = () => {};
  app.log = () => {};
  await app.initializeICal();
  t.after(() => {
    clearInterval(app.icalInterval);
    clearInterval(app.icalEventTickInterval);
    clearTimeout(app.icalConfigTimeout);
  });
  const [snapshot] = app.icalSyncSnapshots.get('Work');
  assert.deepEqual(Object.keys(snapshot).sort(), ['fingerprint', 'id']);
  assert.equal(snapshot.id, legacyEvent.id);
  assert.match(snapshot.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(snapshot).length < JSON.stringify(legacyEvent).length, true);
  assert.deepEqual(settings.icalSyncSnapshots, { Work: [snapshot] });
  assert.equal(app.getICalSyncFingerprint({ ...legacyEvent, created: Date.now() }), snapshot.fingerprint);
  assert.notEqual(app.getICalSyncFingerprint({ ...legacyEvent, description: 'Changed' }), snapshot.fingerprint);

  settings.icalCalendars = [];
  const result = await app.performICalCalendarSync();
  assert.deepEqual(result, {
    events: 0,
    added: [],
    changed: [],
    failedCalendars: [],
    failures: [],
  });
  assert.equal(require.cache[require.resolve('emailjs')], undefined);
});

test('upcoming calendar events include ongoing events and respect the day window', () => {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'homey') return { App: class App {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  let App;
  try {
    App = require(path.join(process.cwd(), '.homeybuild', 'app.js')); // eslint-disable-line global-require, import/no-dynamic-require
  } finally {
    Module._load = originalLoad;
  }
  const app = new App();
  const now = Date.now();
  app.icalEvents = [
    {
      id: 'ongoing',
      uid: 'ongoing',
      calendar: 'Home',
      title: 'Ongoing',
      description: '',
      location: '',
      url: '',
      status: '',
      created: null,
      start: now - 60000,
      end: now + 60000,
      source: 'local',
    },
    {
      id: 'soon',
      uid: 'soon',
      calendar: 'Home',
      title: 'Soon',
      description: '',
      location: '',
      url: '',
      status: '',
      created: null,
      start: now + 86400000,
      end: now + 86460000,
      source: 'local',
    },
    {
      id: 'later',
      uid: 'later',
      calendar: 'Home',
      title: 'Later',
      description: '',
      location: '',
      url: '',
      status: '',
      created: null,
      start: now + 4 * 86400000,
      end: now + 4 * 86400000 + 60000,
      source: 'local',
    },
  ];
  assert.deepEqual(app.getUpcomingICalEvents(3).map((event) => event.title), ['Ongoing', 'Soon']);
});

test('new widget backends expose safe timer, webhook, email and calendar data', async () => {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'homey') return { App: class App {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  let App;
  try {
    App = require(path.join(process.cwd(), '.homeybuild', 'app.js')); // eslint-disable-line global-require, import/no-dynamic-require
  } finally {
    Module._load = originalLoad;
  }
  const app = new App();
  const webhook = {
    id: '0123456789abcdef0123456789abcdef',
    name: 'Secure action',
    url: 'https://example.com/hook',
    method: 'POST',
    headers: '{"Authorization":"secret"}',
    body: '{"secret":true}',
  };
  const settings = {
    webhooks: [webhook],
    gmailAddress: 'person@example.com',
    gmailAppPassword: 'secret',
    emailDailyUsage: { date: app.getEmailUsageDate(), count: 7 },
  };
  app.homey = { settings: { get: (key) => settings[key] } };
  app.countdownTimerDurations.set('Kitchen', 600);
  app.countdownTimers.set('Kitchen', {
    name: 'Kitchen',
    value: 120,
    expiresAt: Date.now() + 120000,
    paused: false,
    round: 1,
    roundsRemaining: 0,
    repeatDuration: null,
  });
  assert.deepEqual(app.getWidgetWebhooks(), [{ id: webhook.id, name: webhook.name, method: 'POST' }]);
  assert.doesNotMatch(JSON.stringify(app.getWidgetWebhooks()), /Authorization|secret|example\.com/);
  assert.equal(app.getActiveCountdownWidgetTimers()[0].name, 'Kitchen');
  assert.equal(app.getEmailWidgetStatus().sent, 7);
  assert.equal(app.getEmailWidgetStatus().configured, true);
  const ran = [];
  app.sendWebhook = async (entry) => {
    ran.push(entry.id);
  };
  await app.runWidgetWebhook({ id: webhook.id });
  assert.deepEqual(ran, [webhook.id]);
  await assert.rejects(app.runWidgetWebhook({ id: 'missing' }), /no longer exists/);
  const now = Date.now();
  app.icalEvents = [{
    id: 'today',
    uid: 'today',
    calendar: 'Work',
    title: 'Meeting',
    description: '',
    location: 'Office',
    url: '',
    status: '',
    created: null,
    start: now + 60000,
    end: now + 3600000,
    source: 'local',
  }];
  assert.equal(app.getCalendarWidgetStats().upcoming, 1);
  assert.equal(app.getCalendarWidgetStats().nextEvent.title, 'Meeting');
  const virtualValues = { measure_temperature: 21.5 };
  const virtualDevice = {
    getData: () => ({ id: 'virtual-1' }),
    getName: () => 'Room',
    getCapabilities: () => ['measure_temperature'],
    hasCapability: (id) => id in virtualValues,
    getCapabilityValue: (id) => virtualValues[id],
    setVirtualValue: async (id, value) => {
      virtualValues[id] = Number(value);
    },
  };
  app.homey.drivers = { getDriver: () => ({ getDevices: () => [virtualDevice] }) };
  const [source] = app.getVirtualWidgetOptions('room');
  assert.equal(source.deviceId, 'virtual-1');
  assert.equal(source.capabilityId, 'measure_temperature');
  assert.equal(app.getVirtualWidgetValue(source).value, 21.5);
  await app.setVirtualWidgetValue(source, 22);
  assert.equal(virtualValues.measure_temperature, 22);
});

test('all new widget pages use promise APIs and local artwork', () => {
  const widgets = ['active-timers', 'saved-webhooks', 'virtual-value', 'timer-control', 'email-quota', 'calendar-stats'];
  widgets.forEach((widget) => {
    const html = fs.readFileSync(path.join(process.cwd(), 'widgets', widget, 'public', 'index.html'), 'utf8');
    assert.match(html, /src="\.\/art\.png"/);
    assert.match(html, /Homey\.api\(/);
    assert.doesNotMatch(html, /Homey\.api\([^;]*,\s*\w+\s*\)\s*;/);
    const art = fs.readFileSync(path.join(process.cwd(), 'widgets', widget, 'public', 'art.png'));
    assert.deepEqual([...art.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
