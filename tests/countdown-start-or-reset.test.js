'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');

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

test('configured start-or-reset action starts, resets and persists timers', async () => {
  const cards = new Map();
  const savedStates = [];
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
        async trigger(tokens) {
          this.calls.push(tokens);
        },
      });
    }
    return cards.get(id);
  };
  const app = new App();
  app.homey = {
    flow: { getTriggerCard: card, getActionCard: card, getConditionCard: card },
    settings: { set: (key, value) => savedStates.push({ key, value: value.map((item) => ({ ...item })) }) },
  };
  app.error = (message) => {
    throw new Error(message);
  };
  const timer = {
    name: 'Motion', value: -1, expiresAt: null, paused: false, round: 1, roundsRemaining: 0, repeatDuration: null,
  };
  app.countdownTimers.set(timer.name, timer);
  app.countdownTimerDurations.set(timer.name, 60);
  app.registerCountdownCards();
  const action = card('countdown-start-or-reset-configured');
  assert.deepEqual(await action.autocomplete('mot'), [{ name: 'Motion', id: 'Motion' }]);

  assert.equal(await action.listener({ timer: { id: 'Motion' } }), true);
  assert.equal(timer.value, 60);
  assert.equal(timer.paused, false);
  assert.ok(timer.expiresAt > Date.now());
  assert.equal(card('countdown-started').calls.length, 1);
  assert.equal(savedStates.at(-1).value[0].value, 60);

  timer.value = 10;
  timer.expiresAt = Date.now() + 10000;
  app.countdownTimerDurations.set(timer.name, 90);
  await action.listener({ timer: 'Motion' });
  assert.equal(timer.value, 90);
  assert.ok(timer.expiresAt > Date.now() + 89000);
  assert.equal(card('countdown-started').calls.length, 1);
  assert.equal(card('countdown-started-or-updated').calls.length, 2);

  timer.paused = true;
  timer.expiresAt = null;
  await action.listener({ timer: 'Motion' });
  assert.equal(timer.value, 90);
  assert.equal(timer.paused, false);
  assert.equal(card('countdown-started').calls.length, 2);

  timer.value = 1;
  timer.expiresAt = Date.now() - 1000;
  await action.listener({ timer: 'Motion' });
  assert.equal(card('countdown-reaches-zero').calls.length, 1);
  assert.equal(card('countdown-started').calls.length, 3);
  assert.equal(timer.value, 90);

  app.countdownTimerDurations.delete(timer.name);
  await assert.rejects(action.listener({ timer: 'Motion' }), /not configured/);
  await assert.rejects(action.listener({ timer: 'Missing' }), /does not exist/);
});
