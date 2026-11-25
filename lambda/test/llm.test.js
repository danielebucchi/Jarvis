'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { answer } = require('../llm');

const config = { groqApiKey: 'groq-key', geminiApiKey: 'gemini-key' };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const reply = (message) => json({ choices: [{ message: { role: 'assistant', ...message } }] });

// A fetch that answers each call with the next response and records the requests.
function scriptedFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : undefined, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return typeof next === 'function' ? next(url, init) : next;
  };
  return { fetchImpl, calls };
}

test('a plain answer comes from Groq', async () => {
  const { fetchImpl, calls } = scriptedFetch([reply({ content: ' Roma. ' })]);
  const text = await answer('capitale d italia', { config, fetchImpl });
  assert.equal(text, 'Roma.');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\.groq\.com/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer groq-key');
  assert.equal(calls[0].body.model, 'openai/gpt-oss-120b');
  assert.equal(calls[0].body.messages.at(-1).content, 'capitale d italia');
});

test('a song lookup goes through the tool and back to the model', async () => {
  const toolCall = {
    id: 'call_1',
    type: 'function',
    function: { name: 'cerca_canzone', arguments: '{"query":"bella ciao"}' },
    extra_content: { google: { thought_signature: 'sig' } },
  };
  const { fetchImpl, calls } = scriptedFetch([
    reply({ content: null, tool_calls: [toolCall] }),
    json({
      results: [
        { trackName: 'Bella ciao', artistName: 'Modena City Ramblers', collectionName: 'X', releaseDate: '1994-01-01T00:00:00Z' },
      ],
    }),
    reply({ content: 'La canta Modena City Ramblers.' }),
  ]);

  const text = await answer('chi canta bella ciao', { config, fetchImpl });

  assert.equal(text, 'La canta Modena City Ramblers.');
  assert.match(calls[1].url, /itunes\.apple\.com\/search.*term=bella%20ciao/);
  const followUp = calls[2].body.messages;
  assert.deepEqual(followUp.at(-2).tool_calls, [toolCall], 'tool calls are sent back untouched');
  assert.equal(followUp.at(-1).role, 'tool');
  assert.equal(followUp.at(-1).tool_call_id, 'call_1');
  assert.deepEqual(JSON.parse(followUp.at(-1).content), [
    { titolo: 'Bella ciao', interprete: 'Modena City Ramblers', album: 'X', anno_album: '1994' },
  ]);
});

test('a failing tool is reported to the model instead of aborting', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    reply({
      tool_calls: [{ id: 'c', type: 'function', function: { name: 'cerca_wikipedia', arguments: '{"query":"x"}' } }],
    }),
    json({}, 503),
    reply({ content: 'Non lo so.' }),
  ]);
  assert.equal(await answer('x', { config, fetchImpl }), 'Non lo so.');
  assert.deepEqual(JSON.parse(calls[2].body.messages.at(-1).content), { errore: 'HTTP 503' });
});

test('the small Groq model answers when the large one is rate limited', async () => {
  const { fetchImpl, calls } = scriptedFetch([json({ error: 'rate limited' }, 429), reply({ content: 'Ciao.' })]);
  assert.equal(await answer('ciao', { config, fetchImpl }), 'Ciao.');
  assert.match(calls[1].url, /api\.groq\.com/);
  assert.equal(calls[1].body.model, 'openai/gpt-oss-20b');
});

test('Gemini answers when both Groq models fail', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    json({ error: 'rate limited' }, 429),
    json({ error: 'rate limited' }, 429),
    reply({ content: 'Ciao.' }),
  ]);
  assert.equal(await answer('ciao', { config, fetchImpl }), 'Ciao.');
  assert.match(calls[2].url, /generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions/);
  assert.equal(calls[2].body.model, 'gemini-3.5-flash-lite');
});

test('OpenRouter Gemma answers when Groq and Gemini fail', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    json({ error: 'down' }, 500),
    json({ error: 'down' }, 500),
    json({ error: 'quota' }, 429),
    reply({ content: 'Eccomi.' }),
  ]);
  const text = await answer('ci sei', { config: { ...config, openrouterApiKey: 'or-key' }, fetchImpl });
  assert.equal(text, 'Eccomi.');
  assert.equal(calls[3].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[3].init.headers.Authorization, 'Bearer or-key');
  assert.equal(calls[3].body.model, 'google/gemma-4-31b-it:free');
});

test('only providers with a key are used', async () => {
  const { fetchImpl, calls } = scriptedFetch([reply({ content: 'Sì.' })]);
  await answer('ok', { config: { geminiApiKey: 'g' }, fetchImpl });
  assert.match(calls[0].url, /generativelanguage/);
});

test('no key configured is an error', async () => {
  await assert.rejects(answer('ok', { config: {} }), /no API key configured/);
});

test('no provider is started without enough time left', async () => {
  const { fetchImpl, calls } = scriptedFetch([]);
  await assert.rejects(answer('ok', { config, fetchImpl, deadline: Date.now() + 100 }), /no time left/);
  assert.equal(calls.length, 0);
});

test('tools stop being offered after two rounds', async () => {
  const call = (id) => ({ id, type: 'function', function: { name: 'cerca_wikipedia', arguments: '{"query":"x"}' } });
  const noPages = () => json({ pages: [] });
  const { fetchImpl, calls } = scriptedFetch([
    reply({ tool_calls: [call('a')] }),
    noPages,
    reply({ tool_calls: [call('b')] }),
    noPages,
    reply({ content: 'Fine.' }),
  ]);
  assert.equal(await answer('x', { config, fetchImpl }), 'Fine.');
  assert.ok(calls[0].body.tools);
  assert.ok(calls[2].body.tools);
  assert.equal(calls[4].body.tools, undefined);
});

test('history is sent before the question', async () => {
  const { fetchImpl, calls } = scriptedFetch([reply({ content: 'Nel 1994.' })]);
  const history = [
    { role: 'user', content: 'chi canta bella ciao' },
    { role: 'assistant', content: 'I Modena City Ramblers.' },
  ];
  await answer('e in che anno', { config, fetchImpl, history });
  const roles = calls[0].body.messages.map((m) => m.role);
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'user']);
});

test('a web search result is the answer, with no further model call', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    reply({
      tool_calls: [{ id: 'w', type: 'function', function: { name: 'cerca_web', arguments: '{"query":"inter"}' } }],
    }),
    reply({ content: "L'Inter gioca stasera contro lo Stoccarda." }),
  ]);
  const text = await answer("quando gioca l'inter", { config, fetchImpl });
  assert.equal(text, "L'Inter gioca stasera contro lo Stoccarda.");
  assert.equal(calls.length, 2);
  assert.match(calls[1].body.messages[1].content, /^quando gioca l'inter\n\(cerca: inter\)$/);
});

test('a failed web search goes back to the model', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    reply({
      tool_calls: [{ id: 'w', type: 'function', function: { name: 'cerca_web', arguments: '{"query":"x"}' } }],
    }),
    json({ choices: [{ message: { content: '' } }] }),
    reply({ content: 'Non lo so.' }),
  ]);
  assert.equal(await answer('x', { config, fetchImpl }), 'Non lo so.');
  assert.equal(JSON.parse(calls[2].body.messages.at(-1).content).errore, 'nessun risultato');
});
