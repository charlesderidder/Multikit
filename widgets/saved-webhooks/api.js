'use strict';

module.exports = {
  async getWebhook({ homey, query }) {
    const webhooks = homey.app.getWidgetWebhooks();
    return webhooks.find((webhook) => webhook.id === query.id) || null;
  },

  async runWebhook({ homey, body }) {
    return homey.app.runWidgetWebhook(body.webhook);
  },
};
