'use strict';

const Homey = require('homey');
const { removeIcon } = require('../../helpers/virtual-icons');

class VirtualMode extends Homey.Device {
  async onAdded() {
    if (this.getCapabilityValue('onoff') === null) {
      await this.setCapabilityValue('onoff', false);
    }
  }

  async onDeleted() {
    await removeIcon(this.getData().iconId);
  }

  async onInit() {
    this.registerCapabilityListener('onoff', async (value) => {
      if (this.getCapabilityValue('onoff') === value) return;
      await this.setCapabilityValue('onoff', value);
      await this.homey.flow.getDeviceTriggerCard(value ? 'virtual-mode-on' : 'virtual-mode-off').trigger(this);
      await this.homey.flow.getDeviceTriggerCard('virtual-mode-changed').trigger(this);
    });
  }
}

module.exports = VirtualMode;
