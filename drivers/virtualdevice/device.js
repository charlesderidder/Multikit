'use strict';

const Homey = require('homey');
const { removeIcon } = require('../../helpers/virtual-icons');

class VirtualDevice extends Homey.Device {
  async onAdded() {
    if (this.hasCapability('onoff') && this.getCapabilityValue('onoff') === null) {
      await this.setCapabilityValue('onoff', false);
    }
  }

  async onDeleted() {
    await removeIcon(this.getData().iconId);
  }

  async onInit() {
    const HomeyLib = require('homey-lib'); // eslint-disable-line global-require
    const definitions = HomeyLib.getCapabilities();
    const controls = this.getCapabilities().filter((id) => definitions[id] && definitions[id].setable);
    if (controls.length) {
      this.registerMultipleCapabilityListener(controls, async (values) => {
        for (const [id, value] of Object.entries(values)) {
          if (id === 'onoff' && this.getCapabilityValue(id) === value) continue;
          if (definitions[id].getable) await this.setCapabilityValue(id, value);
          if (id === 'dim' && this.hasCapability('onoff')) {
            await this.setCapabilityValue('onoff', value > 0);
          }
          await this.homey.flow.getDeviceTriggerCard('virtual-device-pressed').trigger(this);
          await this.homey.flow.getTriggerCard('virtual-device-changed').trigger({
            device: this.getName(), variable: id, value: String(value),
          });
        }
      }, 500);
    }
  }

  async setVirtualValue(id, rawValue) {
    const HomeyLib = require('homey-lib'); // eslint-disable-line global-require
    const definition = HomeyLib.getCapabilities()[id];
    if (!definition || !this.hasCapability(id) || !definition.getable) {
      throw new Error('This capability does not support storing a sensor value.');
    }
    let value = rawValue;
    if (definition.type === 'number') {
      if (typeof rawValue !== 'number' && (typeof rawValue !== 'string' || rawValue.trim() === '')) {
        throw new Error('Enter a valid number.');
      }
      value = Number(rawValue);
      if (!Number.isFinite(value)) throw new Error('Enter a valid number.');
    } else if (definition.type === 'boolean') {
      if (rawValue === true || rawValue === false) value = rawValue;
      else if (typeof rawValue === 'string' && /^(true|false)$/i.test(rawValue.trim())) {
        value = rawValue.trim().toLowerCase() === 'true';
      } else throw new Error('Enter true or false.');
    } else if (typeof rawValue !== 'string') {
      value = String(rawValue);
    }
    await this.setCapabilityValue(id, value);
  }
}

module.exports = VirtualDevice;
