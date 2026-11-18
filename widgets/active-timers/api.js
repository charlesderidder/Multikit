'use strict';

module.exports = {
  async getTimers({ homey }) {
    return homey.app.getActiveCountdownWidgetTimers();
  },
};
