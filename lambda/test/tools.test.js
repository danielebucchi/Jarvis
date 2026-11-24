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
