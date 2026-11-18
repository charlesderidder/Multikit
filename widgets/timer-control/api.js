'use strict';

module.exports = {
  async getTimer({ homey, query }) {
    return homey.app.getCountdownWidgetTimerState(query.id);
  },

  async controlTimer({ homey, body }) {
    return homey.app.controlCountdownWidgetTimer(body.timer, body.action);
  },
};
