'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const Module = require('node:module');
const { test } = require('node:test');
const { validateSvg, prepareIcon, removeIcon } = require('../helpers/virtual-icons');

const load = Module._load;
class HomeyObject {}
Module._load = function mockHomey(request, parent, isMain) {
  if (request === 'homey') return { Driver: HomeyObject, Device: HomeyObject };
  return load.call(this, request, parent, isMain);
};
let VirtualDriver;
let VirtualDevice;
let ModeDriver;
let ModeDevice;
try {
  VirtualDriver = require('../drivers/virtualdevice/driver'); // eslint-disable-line global-require
  VirtualDevice = require('../drivers/virtualdevice/device'); // eslint-disable-line global-require
  ModeDriver = require('../drivers/virtualmode/driver'); // eslint-disable-line global-require
  ModeDevice = require('../drivers/virtualmode/device'); // eslint-disable-line global-require
} finally {
  Module._load = load;
}

function makeFlow() {
  const cards = new Map();
  const get = (id) => {
    if (!cards.has(id)) {
      cards.set(id, {
        events: [],
        registerRunListener(listener) {
          this.run = listener;
        },
        registerArgumentAutocompleteListener(_name, listener) {
          this.autocomplete = listener;
        },
        async trigger(...args) {
          this.events.push(args);
        },
      });
    }
    return cards.get(id);
  };
  return { cards, flow: { getActionCard: get, getTriggerCard: get, getDeviceTriggerCard: get }, get };
}

test('virtual pairing validates classes, capabilities, temperature options and unique IDs', async () => {
  const driver = new VirtualDriver();
  driver.homey = { version: '12.3.0', __: (text) => text.en };
  const handlers = {};
  await driver.onPair({
    setHandler: (name, handler) => {
      handlers[name] = handler;
    },
  });
  const catalog = await handlers.catalog();
  assert.ok(catalog.classes.some((entry) => entry.id === 'sensor'));
  assert.ok(catalog.capabilities.some((entry) => entry.id === 'measure_temperature'));
  assert.ok(!catalog.capabilities.some((entry) => entry.id === 'target_power'));
  assert.ok(catalog.suggestions.sensor.includes('measure_temperature'));
  const input = {
    name: ' Room ',
    class: 'thermostat',
    capabilities: ['target_temperature', 'measure_temperature'],
    temperature: { min: 12, max: 30, step: 0.5 },
    decimals: 1,
  };
  const first = await handlers.prepare(input);
  const second = await handlers.prepare(input);
  assert.notEqual(first.data.id, second.data.id);
  assert.equal(first.name, 'Room');
  assert.deepEqual(first.capabilitiesOptions.target_temperature, input.temperature);
  await assert.rejects(handlers.prepare({ ...input, capabilities: ['invalid'] }), /supported capability/);
  await assert.rejects(handlers.prepare({ ...input, temperature: { min: 30, max: 12, step: 0.5 } }), /temperature/);
  await assert.rejects(handlers.prepare({ ...input, decimals: 6 }), /decimals/);
  assert.equal((await handlers.prepare({ ...input, icon: { type: 'star' } })).icon, '/star.svg');
});

test('SVG icons accept simple shapes and reject scripts, external references and oversized uploads', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M1 1L4 4" fill="#000"/></svg>';
  assert.doesNotThrow(() => validateSvg(svg));
  assert.throws(() => validateSvg('<svg><script>alert(1)</script></svg>'), /Unsupported SVG element/);
  assert.throws(() => validateSvg('<svg><path fill="url(https://example.com/a)"/></svg>'), /Unsupported SVG attribute/);
  assert.throws(() => validateSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///test">]><svg>&x;</svg>'), /document types/);
  assert.throws(() => validateSvg(`<svg>${' '.repeat(256001)}</svg>`), /256 KB/);
  await assert.rejects(prepareIcon({ type: 'upload', svg: '<svg onload="bad()"/>' }, 'test'), /Unsupported SVG attribute/);
});

test('uploaded icons are stored and removed using their generated ID', async () => {
  const original = { mkdir: fs.mkdir, writeFile: fs.writeFile, unlink: fs.unlink };
  const calls = [];
  fs.mkdir = async (...args) => {
    calls.push(['mkdir', ...args]);
  };
  fs.writeFile = async (...args) => {
    calls.push(['writeFile', ...args]);
  };
  fs.unlink = async (...args) => {
    calls.push(['unlink', ...args]);
  };
  const id = '12345678-1234-1234-1234-123456789abc';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="2" cy="2" r="1"/></svg>';
  try {
    assert.deepEqual(await prepareIcon({ type: 'upload', svg }, id), {
      icon: `/userdata/virtual-icons/${id}.svg`, iconId: id,
    });
    assert.deepEqual(calls.map((entry) => entry[0]), ['mkdir', 'writeFile']);
    assert.equal(calls[1][2], svg);
    assert.deepEqual(calls[1][3], { flag: 'wx' });
    await removeIcon(id);
    await removeIcon('../invalid');
    assert.deepEqual(calls.map((entry) => entry[0]), ['mkdir', 'writeFile', 'unlink']);
  } finally {
    Object.assign(fs, original);
  }
});

test('virtual controls persist, emit events and sensor actions validate typed values', async () => {
  const { flow, get } = makeFlow();
  const device = new VirtualDevice();
  const values = {
    onoff: false, dim: 0, measure_temperature: 20, alarm_motion: false,
  };
  device.homey = { flow };
  device.getCapabilities = () => Object.keys(values);
  device.hasCapability = (id) => id in values;
  device.getCapabilityValue = (id) => values[id];
  device.setCapabilityValue = async (id, value) => {
    values[id] = value;
  };
  device.getName = () => 'Room';
  device.registerMultipleCapabilityListener = (ids, listener, delay) => {
    assert.ok(ids.includes('dim'));
    assert.ok(!ids.includes('measure_temperature'));
    assert.equal(delay, 500);
    device.control = listener;
  };
  await device.onInit();
  await device.control({ dim: 0.5 });
  assert.equal(values.dim, 0.5);
  assert.equal(values.onoff, true);
  assert.equal(get('virtual-device-pressed').events.length, 1);
  assert.deepEqual(get('virtual-device-changed').events[0][0], { device: 'Room', variable: 'dim', value: '0.5' });
  await device.control({ onoff: true });
  assert.equal(get('virtual-device-pressed').events.length, 1);

  const driver = new VirtualDriver();
  driver.homey = { flow };
  await driver.onInit();
  await get('virtual-device-set-value').run({ device, sensor: 'measure_temperature', value: '22.5' });
  assert.equal(values.measure_temperature, 22.5);
  await get('virtual-device-select-value').run({ device, sensor: { id: 'alarm_motion' }, value: 'TRUE' });
  assert.equal(values.alarm_motion, true);
  assert.deepEqual(await get('virtual-device-select-value').autocomplete('TEMP', { device }), [
    { id: 'measure_temperature', name: 'measure_temperature' },
  ]);
  await assert.rejects(get('virtual-device-set-value').run({ device, sensor: 'measure_temperature', value: '' }), /valid number/);
  await assert.rejects(get('virtual-device-set-value').run({ device, sensor: 'alarm_motion', value: 'maybe' }), /true or false/);
  await assert.rejects(get('virtual-device-set-value').run({ device, sensor: 'missing', value: 1 }), /does not exist/);
});

test('modes trigger on changes but silent actions do not fire custom triggers', async () => {
  const { flow, get } = makeFlow();
  const device = new ModeDevice();
  let state = null;
  device.homey = { flow };
  device.getCapabilityValue = () => state;
  device.setCapabilityValue = async (_id, value) => {
    state = value;
  };
  device.registerCapabilityListener = (_id, listener) => {
    device.control = listener;
  };
  await device.onAdded();
  assert.equal(state, false);
  await device.onInit();
  await device.control(true);
  assert.equal(state, true);
  assert.equal(get('virtual-mode-on').events.length, 1);
  assert.equal(get('virtual-mode-changed').events.length, 1);
  await device.control(true);
  assert.equal(get('virtual-mode-changed').events.length, 1);

  const driver = new ModeDriver();
  driver.homey = { flow };
  await driver.onInit();
  await get('virtual-mode-off-silent').run({ device });
  assert.equal(state, false);
  assert.equal(get('virtual-mode-off').events.length, 0);
  await device.control(true);
  await device.control(false);
  assert.equal(get('virtual-mode-off').events.length, 1);
});
