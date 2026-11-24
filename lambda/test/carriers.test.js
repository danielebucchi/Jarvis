'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  CARRIERS,
  FILLER_INTENT,
  intentName,
  isQuestionIntent,
  questionFromIntent,
} = require('../carriers');
const { MODEL_PATH, render } = require('../../scripts/build-model');

const intent = (name, value) => ({ name, slots: { domanda: { name: 'domanda', value } } });

test('intent names are valid and unique', () => {
  const names = CARRIERS.map(intentName);
  for (const name of names) assert.match(name, /^[A-Za-z_]+$/);
  assert.equal(new Set(names).size, names.length);
  assert.ok(!names.includes(FILLER_INTENT));
});

test('accented and apostrophised carriers get plain names', () => {
  assert.equal(intentName("che cos'è"), 'Q_che_cose');
  assert.equal(intentName('perché'), 'Q_perche');
});

test('the carrier is put back in front of the slot', () => {
  assert.equal(questionFromIntent(intent('Q_chi_canta', 'bella ciao')), 'chi canta bella ciao');
  assert.equal(questionFromIntent(intent('Q_di_chi_e', 'la canzone volare')), 'di chi è la canzone volare');
});

test('filler openings are dropped', () => {
  assert.equal(questionFromIntent(intent(FILLER_INTENT, 'chi ha inventato il telefono')), 'chi ha inventato il telefono');
});

test('an empty slot gives an empty question', () => {
  assert.equal(questionFromIntent(intent('Q_chi', undefined)), '');
  assert.equal(questionFromIntent({ name: 'Q_chi' }), '');
});

test('built-in intents are not question intents', () => {
  assert.ok(isQuestionIntent('Q_chi_canta'));
  assert.ok(!isQuestionIntent('AMAZON.HelpIntent'));
});

test('the committed interaction model matches carriers.js', () => {
  assert.equal(
    fs.readFileSync(MODEL_PATH, 'utf8'),
    render(),
    'run node scripts/build-model.js and commit the result',
  );
});
