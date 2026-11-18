'use strict';

const Homey = require('homey');
const { randomUUID } = require('crypto');
const { prepareIcon, removeIcon } = require('../../helpers/virtual-icons');

const PRESETS = {
  socket: ['onoff'],
  light: ['onoff'],
  tv: ['onoff'],
  amplifier: ['onoff'],
  windowcoverings: ['onoff'],
  fan: ['onoff'],
  heater: ['onoff'],
  kettle: ['onoff'],
  coffeemachine: ['onoff'],
  remote: ['onoff'],
  button: ['button'],
  doorbell: ['button'],
  speaker: ['button'],
  homealarm: ['homealarm_state'],
  thermostat: ['target_temperature', 'measure_temperature'],
  lock: ['locked'],
  blinds: ['windowcoverings_state'],
  curtain: ['windowcoverings_state'],
  sunshade: ['windowcoverings_state'],
  solarpanel: ['measure_power'],
  vacuumcleaner: ['vacuumcleaner_state'],
  camera: ['alarm_motion'],
  sensor: [],
};

const SUGGESTIONS = {
  socket: ['onoff', 'dim', 'measure_power'],
  light: ['onoff', 'dim', 'light_hue', 'light_saturation', 'light_temperature', 'light_mode', 'measure_power'],
  windowcoverings: ['onoff', 'dim', 'windowcoverings_state', 'windowcoverings_tilt_down', 'windowcoverings_tilt_set', 'windowcoverings_tilt_up', 'windowcoverings_closed', 'windowcoverings_set'],
  fan: ['onoff', 'dim', 'measure_power'],
  heater: ['onoff', 'dim', 'measure_power'],
  kettle: ['onoff', 'target_temperature', 'measure_temperature', 'measure_power'],
  coffeemachine: ['onoff', 'target_temperature', 'measure_temperature'],
  thermostat: ['target_temperature', 'thermostat_mode', 'measure_temperature'],
  blinds: ['onoff', 'windowcoverings_state', 'windowcoverings_tilt_down', 'windowcoverings_tilt_set', 'windowcoverings_tilt_up', 'windowcoverings_closed', 'windowcoverings_set'],
  curtain: ['onoff', 'windowcoverings_state', 'windowcoverings_closed', 'windowcoverings_set'],
  sunshade: ['windowcoverings_state', 'windowcoverings_closed', 'windowcoverings_set'],
  solarpanel: ['meter_power', 'measure_power'],
  button: ['button'],
  homealarm: ['homealarm_state', 'onoff', 'button', 'alarm_motion', 'alarm_contact'],
  sensor: [
    'measure_temperature', 'measure_co2', 'measure_pressure', 'measure_humidity', 'measure_pm25',
    'measure_co', 'measure_current', 'measure_gust_angle', 'measure_gust_strength', 'measure_luminance',
    'measure_noise', 'measure_rain', 'measure_ultraviolet', 'measure_voltage', 'measure_water',
    'measure_wind_angle', 'measure_wind_strength', 'measure_battery', 'meter_power', 'meter_gas',
    'meter_water', 'meter_rain', 'measure_power', 'alarm_motion', 'alarm_contact',
  ],
  lock: ['locked', 'lock_mode'],
  doorbell: ['button'],
  camera: ['alarm_motion', 'alarm_battery', 'alarm_tamper'],
  tv: ['onoff', 'volume_set', 'volume_mute', 'volume_up', 'volume_down'],
  amplifier: ['onoff', 'volume_set', 'volume_mute', 'volume_up', 'volume_down'],
  vacuumcleaner: ['onoff', 'vacuumcleaner_state'],
  remote: ['onoff', 'dim', 'volume_set', 'volume_up', 'volume_down', 'volume_mute', 'channel_up', 'channel_down', 'windowcoverings_state', 'windowcoverings_closed'],
  speaker: [
    'button', 'volume_set', 'volume_mute', 'volume_up', 'volume_down', 'speaker_playing',
    'speaker_next', 'speaker_prev', 'speaker_shuffle', 'speaker_repeat', 'speaker_artist',
    'speaker_album', 'speaker_track', 'speaker_duration', 'speaker_position',
  ],
};

function isSupported(definition, version, semver) {
  return !definition.minCompatibility || semver.gte(semver.coerce(version), semver.coerce(definition.minCompatibility));
}

class VirtualDeviceDriver extends Homey.Driver {
  async onInit() {
    const setValue = async ({ device, sensor, value }) => {
      const id = typeof sensor === 'string' ? sensor : sensor && sensor.id;
      if (typeof id !== 'string' || !device.hasCapability(id)) {
        throw new Error('The selected capability does not exist on this virtual device.');
      }
      await device.setVirtualValue(id, value);
    };
    this.homey.flow.getActionCard('virtual-device-set-value').registerRunListener(setValue);
    const selectCard = this.homey.flow.getActionCard('virtual-device-select-value');
    selectCard.registerRunListener(setValue);
    selectCard.registerArgumentAutocompleteListener('sensor', async (query, args) => {
      if (!args.device) return [];
      const needle = query.toLowerCase();
      return args.device.getCapabilities()
        .filter((id) => id.toLowerCase().includes(needle))
        .map((id) => ({ id, name: id }));
    });
  }

  async onPair(session) {
    const HomeyLib = require('homey-lib'); // eslint-disable-line global-require
    const semver = require('semver'); // eslint-disable-line global-require
    const pendingIcons = new Set();
    const classes = Object.entries(HomeyLib.getDeviceClasses())
      .filter(([, definition]) => isSupported(definition, this.homey.version, semver));
    const capabilities = Object.entries(HomeyLib.getCapabilities())
      .filter(([, definition]) => isSupported(definition, this.homey.version, semver));
    const classIds = new Set(classes.map(([id]) => id));
    const capabilityIds = new Set(capabilities.map(([id]) => id));
    session.setHandler('catalog', async () => ({
      classes: classes.map(([id, definition]) => ({ id, name: this.homey.__(definition.title) })),
      capabilities: capabilities.map(([id, definition]) => ({ id, name: this.homey.__(definition.title) })),
      presets: PRESETS,
      suggestions: SUGGESTIONS,
    }));
    session.setHandler('prepare', async (input) => {
      if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) {
        throw new Error('Enter a device name of 1 to 80 characters.');
      }
      if (!classIds.has(input.class) || !Array.isArray(input.capabilities)
          || input.capabilities.length === 0 || new Set(input.capabilities).size !== input.capabilities.length
          || !input.capabilities.every((id) => typeof id === 'string' && capabilityIds.has(id))) {
        throw new Error('Select a valid device class and at least one supported capability.');
      }
      const options = {};
      if (input.capabilities.includes('target_temperature')) {
        const { min, max, step } = input.temperature || {};
        if (![min, max, step].every(Number.isFinite) || min < -200 || max > 500 || min >= max || step <= 0 || step > 5) {
          throw new Error('Invalid target temperature range or step.');
        }
        options.target_temperature = { min, max, step };
      }
      if (input.capabilities.includes('measure_temperature')) {
        const { decimals } = input;
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 5) {
          throw new Error('Temperature decimals must be between 0 and 5.');
        }
        options.measure_temperature = { decimals };
      }
      const id = randomUUID();
      const { icon, iconId } = await prepareIcon(input.icon, id);
      if (iconId) pendingIcons.add(iconId);
      return {
        name: input.name.trim(),
        data: { id, ...(iconId ? { iconId } : {}) },
        class: input.class,
        capabilities: input.capabilities,
        capabilitiesOptions: options,
        ...(icon ? { icon } : {}),
      };
    });
    session.setHandler('discard_icon', async (id) => {
      if (pendingIcons.has(id)) {
        await removeIcon(id);
        pendingIcons.delete(id);
      }
    });
  }
}

module.exports = VirtualDeviceDriver;
