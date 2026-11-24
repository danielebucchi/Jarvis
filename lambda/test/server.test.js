'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

const launchRequest = (applicationId) =>
  JSON.stringify({
    version: '1.0',
    session: { new: true, sessionId: 's', application: { applicationId }, attributes: {}, user: { userId: 'u' } },
    context: { System: { application: { applicationId }, user: { userId: 'u' } } },
    request: { type: 'LaunchRequest', requestId: 'r', timestamp: new Date().toISOString(), locale: 'it-IT' },
  });

const post = (base, body) =>
  fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

test('health answers ok', async () => {
  await withServer(createApp({ config: () => ({}) }), async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  });
});

test('unsigned requests are rejected', async () => {
  await withServer(createApp({ config: () => ({}) }), async (base) => {
    const res = await post(base, launchRequest('amzn1.ask.skill.jarvis'));
    assert.equal(res.status, 400);
  });
});

test('a request for this skill is answered', async () => {
  const app = createApp({ verify: false, skillId: 'amzn1.ask.skill.jarvis', config: () => ({}) });
  await withServer(app, async (base) => {
    const res = await post(base, launchRequest('amzn1.ask.skill.jarvis'));
    assert.equal(res.status, 200);
    assert.match((await res.json()).response.outputSpeech.ssml, /sono Jarvis/);
  });
});

test('a request for another skill is refused', async () => {
  const app = createApp({ verify: false, skillId: 'amzn1.ask.skill.jarvis', config: () => ({}) });
  await withServer(app, async (base) => {
    const res = await post(base, launchRequest('amzn1.ask.skill.other'));
    assert.equal(res.status, 500);
  });
});
