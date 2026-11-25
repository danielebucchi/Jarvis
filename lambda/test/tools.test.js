'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runTool, relevantText } = require('../tools');

const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

test('the intro and the paragraphs matching the query are kept', () => {
  const article = [
    'Il Grinch è un film del 2000.',
    'Con Jim Carrey e Taylor Momsen.',
    '== Trama ==',
    'Il Grinch odia il Natale.',
    'La trama non riguarda nessuno.',
    'Cindy Lou è la bambina che diventa amica del Grinch.',
  ].join('\n');
  assert.equal(
    relevantText(article, 'bambina Cindy'),
    'Il Grinch è un film del 2000.\nCon Jim Carrey e Taylor Momsen.\nCindy Lou è la bambina che diventa amica del Grinch.',
  );
});

test('matching ignores accents and case, and keeps article order', () => {
  const article = ['intro', 'intro due', 'Parla di perché e città.', 'Solo CITTA qui.', 'niente'].join('\n');
  assert.equal(relevantText(article, 'citta perche'), 'intro\nintro due\nParla di perché e città.\nSolo CITTA qui.');
});

test('the text is capped', () => {
  const article = ['a'.repeat(2000), 'b'.repeat(2000)].join('\n');
  assert.equal(relevantText(article, 'x').length, 2500);
});

test('a Wikipedia search returns the best article and the other titles', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return urls.length === 1
      ? json({ pages: [{ title: 'Il Grinch (film 2000)' }, { title: 'Grinch' }] })
      : json({ query: { pages: [{ extract: 'Il Grinch è un film del 2000.' }] } });
  };
  const result = JSON.parse(
    await runTool('cerca_wikipedia', '{"query":"grinch film"}', { deadline: Date.now() + 8000, fetchImpl }),
  );
  assert.deepEqual(result, {
    voce: 'Il Grinch (film 2000)',
    testo: 'Il Grinch è un film del 2000.',
    altre_voci: ['Grinch'],
  });
  assert.match(urls[1], /titles=Il%20Grinch%20\(film%202000\)/);
});

const webCtx = (fetchImpl) => ({
  deadline: Date.now() + 8000,
  fetchImpl,
  config: { groqApiKey: 'k' },
  now: new Date('2026-11-25T10:00:00Z'),
});

const answerWith = (content) => json({ choices: [{ message: { role: 'assistant', content } }] });
const rateLimited = () => new Response('{}', { status: 429 });

test('a web search uses Groq browser search on the small model', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return answerWith('La festa dei nonni è il 2 ottobre.');
  };
  const result = JSON.parse(await runTool('cerca_web', '{"query":"festa dei nonni"}', webCtx(fetchImpl)));
  assert.deepEqual(result, { risultato: 'La festa dei nonni è il 2 ottobre.' });
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(calls[0].body.model, 'openai/gpt-oss-20b');
  assert.deepEqual(calls[0].body.tools, [{ type: 'browser_search' }]);
  assert.match(calls[0].body.messages[0].content, /mercoledì 25 novembre 2026/);
});

test('a rate limited web search moves to the large model', async () => {
  const models = [];
  const fetchImpl = async (url, init) => {
    models.push(JSON.parse(init.body).model);
    return models.length === 1 ? rateLimited() : answerWith('Inter-Stoccarda stasera.');
  };
  const result = JSON.parse(await runTool('cerca_web', '{"query":"partita inter"}', webCtx(fetchImpl)));
  assert.equal(result.risultato, 'Inter-Stoccarda stasera.');
  assert.deepEqual(models, ['openai/gpt-oss-20b', 'openai/gpt-oss-120b']);
});

test('web search failures go back to the model as errors', async () => {
  const both = JSON.parse(await runTool('cerca_web', '{"query":"x"}', webCtx(async () => rateLimited())));
  assert.match(both.errore, /limite di ricerche/);
  const empty = JSON.parse(await runTool('cerca_web', '{"query":"x"}', webCtx(async () => answerWith(''))));
  assert.equal(empty.errore, 'nessun risultato');
  const noKey = JSON.parse(await runTool('cerca_web', '{"query":"x"}', { deadline: Date.now() + 8000 }));
  assert.equal(noKey.errore, 'ricerca web non configurata');
});
