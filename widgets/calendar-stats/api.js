'use strict';

module.exports = {
  async getStats({ homey }) {
    return homey.app.getCalendarWidgetStats();
  },

  async syncCalendars({ homey }) {
    await homey.app.syncCalendars();
    return homey.app.getCalendarWidgetStats();
  },
};
