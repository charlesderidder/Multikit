'use strict';

module.exports = {
  async getValue({ homey, query }) {
    return homey.app.getVirtualWidgetValue({
      deviceId: query.deviceId,
      capabilityId: query.capabilityId,
    });
  },

  async setValue({ homey, body }) {
    await homey.app.setVirtualWidgetValue(body.source, body.value);
    return { success: true };
  },
};
