'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanForSpeech, escapeSsml } = require('../speech');

test('markdown is stripped', () => {
  const text = '## Risposta\n**Bella Ciao** è un canto *popolare*.\n- uno\n- due\n1. tre';
  assert.equal(cleanForSpeech(text), 'Risposta Bella Ciao è un canto popolare. uno due tre');
});

test('links keep their text and bare URLs go away', () => {
  assert.equal(
    cleanForSpeech('Vedi [Wikipedia](https://it.wikipedia.org/wiki/X) o https://example.com qui'),
    'Vedi Wikipedia o qui',
  );
});

test('long answers are cut at the end of a sentence', () => {
  const text = 'Prima frase. Seconda frase molto lunga che supera il limite.';
  assert.equal(cleanForSpeech(text, 30), 'Prima frase.');
});

test('long answers without a sentence end are cut at a word', () => {
  assert.equal(cleanForSpeech('una due tre quattro cinque', 15), 'una due tre…');
});

test('SSML metacharacters are escaped', () => {
  assert.equal(escapeSsml('Simon & Garfunkel <live>'), 'Simon &amp; Garfunkel &lt;live&gt;');
});
