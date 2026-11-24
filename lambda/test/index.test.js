'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSkill } = require('../index');

function envelope(request, attributes = {}) {
  return {
    version: '1.0',
    session: {
      new: false,
      sessionId: 'session',
      application: { applicationId: 'app' },
      attributes,
      user: { userId: 'user' },
    },
    context: { System: { application: { applicationId: 'app' }, user: { userId: 'user' } } },
    request: { requestId: 'req', timestamp: new Date().toISOString(), locale: 'it-IT', ...request },
  };
}

const intentRequest = (name, value) =>
  envelope({
    type: 'IntentRequest',
    intent: { name, confirmationStatus: 'NONE', slots: { domanda: { name: 'domanda', value } } },
  });

const speech = (response) => response.response.outputSpeech.ssml;

test('launch greets and keeps the session open', async () => {
  const skill = createSkill({ ask: async () => assert.fail('no question'), config: () => ({}) });
  const res = await skill.invoke(envelope({ type: 'LaunchRequest' }));
  assert.match(speech(res), /sono Jarvis/);
  assert.equal(res.response.shouldEndSession, false);
});

test('a question is rebuilt, answered and remembered', async () => {
  const asked = [];
  const skill = createSkill({
    ask: async (question, options) => {
      asked.push({ question, options });
      return '**Modena City Ramblers** & altri';
    },
    config: () => ({ groqApiKey: 'k' }),
  });

  const res = await skill.invoke(intentRequest('Q_chi_canta', 'bella ciao'));

  assert.equal(asked[0].question, 'chi canta bella ciao');
  assert.deepEqual(asked[0].options.config, { groqApiKey: 'k' });
  assert.equal(speech(res), '<speak>Modena City Ramblers &amp; altri</speak>');
  assert.equal(res.response.shouldEndSession, false);
  assert.deepEqual(res.sessionAttributes.history, [
    { role: 'user', content: 'chi canta bella ciao' },
    { role: 'assistant', content: 'Modena City Ramblers & altri' },
  ]);
});

test('history is passed on and capped', async () => {
  const old = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  let received;
  const skill = createSkill({
    ask: async (q, options) => {
      received = options.history;
      return 'ok';
    },
    config: () => ({}),
  });
  const req = intentRequest('DomandaIntent', 'altro');
  req.session.attributes = { history: old };

  const res = await skill.invoke(req);

  assert.deepEqual(received, old);
  assert.equal(res.sessionAttributes.history.length, 6);
  assert.equal(res.sessionAttributes.history.at(-2).content, 'altro');
});

test('an empty slot asks again without calling the model', async () => {
  const skill = createSkill({ ask: async () => assert.fail('no question'), config: () => ({}) });
  const res = await skill.invoke(intentRequest('Q_chi', undefined));
  assert.match(speech(res), /Cosa vuoi sapere/);
});

test('a model failure is apologised for', async () => {
  const skill = createSkill({
    ask: async () => {
      throw new Error('boom');
    },
    config: () => ({}),
  });
  const res = await skill.invoke(intentRequest('Q_chi', 'sei'));
  assert.match(speech(res), /non riesco a trovare la risposta/);
  assert.equal(res.response.shouldEndSession, false);
});

test('stop ends the session', async () => {
  const skill = createSkill({ ask: async () => '', config: () => ({}) });
  const res = await skill.invoke(envelope({ type: 'IntentRequest', intent: { name: 'AMAZON.StopIntent' } }));
  assert.equal(res.response.shouldEndSession, true);
});
