'use strict';

const { TOOLS, FINAL_TOOLS, runTool } = require('./tools');
const { todayInRome } = require('./dates');

// All providers speak the OpenAI chat completions protocol, so one client
// covers them. Groq goes first because it is by far the fastest, and Alexa
// gives the skill about 8 seconds to answer. OpenRouter's free Gemma is last:
// shared free endpoints are slow at times, and without credits it allows only
// 50 requests a day.
const PROVIDERS = [
  {
    name: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyField: 'groqApiKey',
    modelField: 'groqModel',
    defaultModel: 'openai/gpt-oss-120b',
  },
  // Groq's free tier allows 8000 tokens a minute per model, about seven
  // questions: the smaller model has its own quota and catches the overflow.
  {
    name: 'groq-small',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyField: 'groqApiKey',
    modelField: 'groqSmallModel',
    defaultModel: 'openai/gpt-oss-20b',
  },
  {
    name: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyField: 'geminiApiKey',
    modelField: 'geminiModel',
    defaultModel: 'gemini-3.5-flash-lite',
  },
  {
    name: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyField: 'openrouterApiKey',
    modelField: 'openrouterModel',
    defaultModel: 'google/gemma-4-31b-it:free',
  },
];

const MAX_TOOL_ROUNDS = 2;
const LAST_ROUND_NOTE =
  'Non puoi più cercare: rispondi ora alla domanda con quello che hai, in una frase. ' +
  'Se non lo sai, dillo.';
// Not worth starting a provider with less time than this left.
const MIN_ATTEMPT_MS = 1500;

function systemPrompt(now) {
  return [
    'Sei Jarvis, un assistente vocale che risponde in italiano attraverso Alexa.',
    'La risposta viene letta ad alta voce e deve capirsi al primo ascolto: una sola frase, ' +
      'la più corta possibile, con soggetto e risposta e nient\'altro.',
    'Niente premesse, spiegazioni, dettagli non richiesti, domande di ritorno, elenchi, markdown, emoji o link.',
    'Esempi:',
    '- "chi canta hanno ucciso l\'uomo ragno" → "Hanno ucciso l\'uomo ragno è cantata da Max Pezzali."',
    '- "quanto è alta la torre eiffel" → "La Torre Eiffel è alta 330 metri."',
    '- "chi è la bambina del grinch" → "È Cindy Lou Chi, interpretata da Taylor Momsen."',
    'Dai una frase in più solo se la domanda chiede esplicitamente una spiegazione.',
    'La domanda arriva dal riconoscimento vocale e può contenere parole trascritte male, ' +
      'soprattutto titoli e nomi stranieri: interpreta la richiesta più probabile.',
    'Per domande su una canzone (chi la canta, album, anno) usa sempre cerca_canzone. ' +
      'Per fatti, persone, luoghi ed eventi usa cerca_wikipedia quando non sei sicuro.',
    'Per tutto ciò che cambia nel tempo o dipende dalla data di oggi (partite, risultati, notizie, ' +
      'meteo, orari, prezzi) e per le date di feste e ricorrenze usa sempre cerca_web, non Wikipedia. ' +
      'È lenta: per i fatti stabili non usarla.',
    'Se la domanda non nomina un paese, intendi l\'Italia.',
    'Non rispondere mai con una data o un fatto che non hai letto nei risultati o di cui non sei certo.',
    'Se anche dopo la ricerca non conosci la risposta, dillo in una frase senza inventare.',
    `Oggi è ${todayInRome(now)}.`,
  ].join('\n');
}

function configuredProviders(config) {
  return PROVIDERS.filter((p) => config[p.keyField]).map((p) => ({
    name: p.name,
    baseUrl: p.baseUrl,
    apiKey: config[p.keyField],
    model: config[p.modelField] || p.defaultModel,
  }));
}

async function complete(provider, messages, withTools, { deadline, fetchImpl }) {
  const body = { model: provider.model, messages, reasoning_effort: 'low' };
  if (withTools) {
    body.tools = TOOLS;
  } else {
    // Without this, gpt-oss sometimes calls a tool anyway (with a made-up
    // name) and Groq rejects the request; tool_choice "none" does not stop it.
    body.messages = [...messages, { role: 'user', content: LAST_ROUND_NOTE }];
  }

  const post = () =>
    fetchImpl(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1)),
    });

  let res = await post();
  // gpt-oss now and then calls a tool that does not exist ("search_web") and
  // Groq answers 400 tool_use_failed. It is random, so one retry usually works.
  if (res.status === 400) {
    const detail = await res.text();
    if (!detail.includes('tool_use_failed')) throw new Error(`HTTP 400 ${detail.slice(0, 200)}`);
    console.warn(`[${provider.name}] made-up tool call, retrying`);
    res = await post();
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`HTTP ${res.status} ${detail}`);
  }
  const data = await res.json();
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error('response without a message');
  return message;
}

async function converse(provider, initialMessages, ctx) {
  const messages = [...initialMessages];
  for (let round = 0; ; round++) {
    const withTools = round < MAX_TOOL_ROUNDS;
    const message = await complete(provider, messages, withTools, ctx);
    const calls = message.tool_calls || [];

    if (!calls.length) {
      const text = message.content?.trim();
      if (!text) throw new Error('empty answer');
      return text;
    }
    if (!withTools) throw new Error('tool call after the last tool round');

    // The tool calls go back untouched: Gemini attaches thought signatures to
    // them and rejects the follow-up request without them.
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      console.log(`[${provider.name}] ${call.function.name} ${call.function.arguments}`);
      const content = await runTool(call.function.name, call.function.arguments, ctx);
      // A web search already answers in Jarvis' style: one more model call
      // would not fit in Alexa's 8 seconds.
      const final = FINAL_TOOLS.has(call.function.name) && JSON.parse(content).risultato;
      if (final) return final;
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }
}

// history: previous turns as [{ role: 'user' | 'assistant', content }].
async function answer(
  question,
  { history = [], config = {}, deadline = Date.now() + 7000, fetchImpl = fetch, now = new Date() } = {},
) {
  const messages = [
    { role: 'system', content: systemPrompt(now) },
    ...history,
    { role: 'user', content: question },
  ];
  const ctx = { deadline, fetchImpl, config, now, question };
  const errors = [];

  for (const provider of configuredProviders(config)) {
    if (deadline - Date.now() < MIN_ATTEMPT_MS) {
      errors.push(`${provider.name}: no time left`);
      break;
    }
    try {
      return await converse(provider, messages, ctx);
    } catch (err) {
      console.warn(`provider ${provider.name} failed: ${err.message}`);
      errors.push(`${provider.name}: ${err.message}`);
    }
  }
  throw new Error(`no provider answered (${errors.join('; ') || 'no API key configured'})`);
}

module.exports = { answer, systemPrompt };
