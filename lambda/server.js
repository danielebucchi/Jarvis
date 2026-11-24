'use strict';

// Self-hosted endpoint for the skill, run in Docker behind Caddy (garganacl).
// Alexa sends each request as an HTTPS POST; the adapter checks the request
// signature and timestamp, which Amazon requires for endpoints outside Lambda.

const express = require('express');
const { ExpressAdapter } = require('ask-sdk-express-adapter');
const { createSkill } = require('./index');

function createApp({ skillId = process.env.ALEXA_SKILL_ID, verify = true, ...skillOptions } = {}) {
  const skill = createSkill({ skillId, ...skillOptions });
  const adapter = new ExpressAdapter(skill, verify, verify);

  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (req, res) => res.send('ok'));
  app.post('/', adapter.getRequestHandlers());
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  if (!process.env.ALEXA_SKILL_ID) {
    console.warn('ALEXA_SKILL_ID not set: requests from any skill are accepted');
  }
  createApp().listen(port, () => console.log(`Jarvis listening on :${port}`));
}

module.exports = { createApp };
