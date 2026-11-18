'use strict';

const Homey = require('homey');
const { randomUUID } = require('crypto');
const { prepareIcon, removeIcon } = require('../../helpers/virtual-icons');

class VirtualModeDriver extends Homey.Driver {
  async onInit() {
    this.homey.flow.getActionCard('virtual-mode-on-silent').registerRunListener(async ({ device }) => {
      await device.setCapabilityValue('onoff', true);
    });
    this.homey.flow.getActionCard('virtual-mode-off-silent').registerRunListener(async ({ device }) => {
      await device.setCapabilityValue('onoff', false);
    });
  }

  async onPair(session) {
    const pendingIcons = new Set();
    session.setHandler('prepare', async (input) => {
      if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) {
        throw new Error('Enter a mode name of 1 to 80 characters.');
      }
      const id = randomUUID();
      const { icon, iconId } = await prepareIcon(input.icon, id);
      if (iconId) pendingIcons.add(iconId);
      return {
        name: input.name.trim(), data: { id, ...(iconId ? { iconId } : {}) }, ...(icon ? { icon } : {}),
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

module.exports = VirtualModeDriver;
