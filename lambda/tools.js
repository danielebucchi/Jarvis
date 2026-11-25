'use strict';

// Lookups the model can call: without them it makes up song credits and knows
// nothing after its training cutoff.

const { todayInRome } = require('./dates');

const TOOL_TIMEOUT_MS = 2500;
// Groq's built-in browser_search, which works on the free tier. A search costs
// 3000-6000 tokens against an 8000 tokens/minute quota per model, so it runs
// on the small model first (its quota is separate from the one answering) and
// moves to the large one when that is used up.
const WEB_SEARCH_URL = 'https://api.groq.com/openai/v1/chat/completions';
const WEB_SEARCH_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];
// The web search writes the final answer itself (see FINAL_TOOLS), so it can
// use almost all the time left: no model call comes after it.
const WEB_RESERVE_MS = 300;
// Time kept back for the model to turn the tool result into an answer.
const ANSWER_RESERVE_MS = 1500;
const USER_AGENT = 'JarvisAlexaSkill/1.0 (personal Alexa skill)';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'cerca_canzone',
      description:
        'Cerca canzoni nel catalogo musicale e restituisce titolo, interprete, album e anno. ' +
        'Da usare per sapere chi canta un brano. Attenzione: anno_album è l\'anno dell\'album, ' +
        'spesso una raccolta, e non per forza quello di uscita del brano.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: "Titolo della canzone, eventualmente seguito dal nome dell'artista",
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cerca_wikipedia',
      description:
        'Cerca su Wikipedia in italiano e restituisce l\'inizio della voce più pertinente, ' +
        'i paragrafi che contengono le parole cercate e i titoli di altre voci simili. ' +
        'Da usare per fatti, persone, luoghi, opere ed eventi quando non sei sicuro della risposta. ' +
        'Metti nella query le parole che compaiono nel testo cercato, per esempio ' +
        '"Il Grinch film Cindy Lou attrice" per sapere chi interpreta la bambina del Grinch.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Cosa cercare, in poche parole' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cerca_web',
      description:
        'Cerca sul web e restituisce un breve riassunto aggiornato. Da usare per ciò che cambia ' +
        'nel tempo: partite e risultati, notizie, meteo, orari, date di feste e ricorrenze, prezzi. ' +
        'È lenta: non usarla per fatti stabili che trovi su Wikipedia.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Cosa cercare, in poche parole, con nomi e date' },
        },
        required: ['query'],
      },
    },
  },
];

async function getJson(url, { deadline, fetchImpl }) {
  const timeout = Math.min(TOOL_TIMEOUT_MS, deadline - Date.now() - ANSWER_RESERVE_MS);
  if (timeout <= 0) throw new Error('tempo esaurito');
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function searchSong({ query }, ctx) {
  const url =
    'https://itunes.apple.com/search?media=music&entity=song&limit=5&country=IT&term=' +
    encodeURIComponent(query);
  const data = await getJson(url, ctx);
  return (data.results || []).map((song) => ({
    titolo: song.trackName,
    interprete: song.artistName,
    album: song.collectionName,
    anno_album: song.releaseDate?.slice(0, 4),
  }));
}

const INTRO_PARAGRAPHS = 2;
const MATCHING_PARAGRAPHS = 3;
const MAX_TEXT_CHARS = 2500;

const normalize = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// The article intro alone often misses the detail asked about (who plays a
// character, say), and whole articles are too long to send: keep the intro plus
// the paragraphs that mention the most words of the query.
function relevantText(article, query) {
  const paragraphs = article
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('=='));
  const keywords = normalize(query)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4);

  const intro = paragraphs.slice(0, INTRO_PARAGRAPHS);
  const matching = paragraphs
    .slice(INTRO_PARAGRAPHS)
    .map((text, index) => {
      const words = normalize(text);
      return { text, index, hits: keywords.filter((word) => words.includes(word)).length };
    })
    .filter((p) => p.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.index - b.index)
    .slice(0, MATCHING_PARAGRAPHS)
    .sort((a, b) => a.index - b.index)
    .map((p) => p.text);

  return [...intro, ...matching].join('\n').slice(0, MAX_TEXT_CHARS);
}

async function searchWikipedia({ query }, ctx) {
  const search = await getJson(
    `https://it.wikipedia.org/w/rest.php/v1/search/page?limit=3&q=${encodeURIComponent(query)}`,
    ctx,
  );
  const [page, ...others] = search.pages || [];
  if (!page) return { risultato: 'nessuna voce trovata' };
  const data = await getJson(
    'https://it.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1' +
      `&format=json&formatversion=2&titles=${encodeURIComponent(page.title)}`,
    ctx,
  );
  const article = data.query?.pages?.[0]?.extract || '';
  return {
    voce: page.title,
    testo: relevantText(article, query),
    altre_voci: others.map((p) => p.title),
  };
}

async function searchWeb({ query }, { deadline, fetchImpl, config = {}, now = new Date(), question }) {
  if (!config.groqApiKey) throw new Error('ricerca web non configurata');
  const messages = [
    {
      role: 'system',
      content:
        `Oggi è ${todayInRome(now)}. Cerca sul web e rispondi alla domanda in italiano con una sola ` +
        'frase breve, che verrà letta ad alta voce: soggetto e risposta, con date e nomi precisi, ' +
        'senza markdown, link o fonti. Se la domanda non nomina un paese, intendi l\'Italia. ' +
        'Se non trovi la risposta, dillo in una frase.',
    },
    { role: 'user', content: question ? `${question}\n(cerca: ${query})` : query },
  ];

  let lastError;
  for (const model of WEB_SEARCH_MODELS) {
    const timeout = deadline - Date.now() - WEB_RESERVE_MS;
    if (timeout <= 0) throw lastError || new Error('tempo esaurito');
    const res = await fetchImpl(WEB_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.groqApiKey}` },
      body: JSON.stringify({ model, messages, reasoning_effort: 'low', tools: [{ type: 'browser_search' }] }),
      signal: AbortSignal.timeout(timeout),
    });
    if (res.status === 429) {
      lastError = new Error('limite di ricerche raggiunto, riprova tra un minuto');
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.json()).choices?.[0]?.message?.content?.trim();
    // It sometimes searches and then writes nothing.
    if (!text) throw new Error('nessun risultato');
    return { risultato: text };
  }
  throw lastError;
}

const HANDLERS = { cerca_canzone: searchSong, cerca_wikipedia: searchWikipedia, cerca_web: searchWeb };

// Always returns a string for the tool message: failures go back to the model
// as an error so that it can still answer from what it knows.
async function runTool(name, rawArgs, ctx) {
  try {
    const handler = HANDLERS[name];
    if (!handler) throw new Error(`strumento sconosciuto: ${name}`);
    const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : rawArgs || {};
    return JSON.stringify(await handler(args, ctx));
  } catch (err) {
    console.warn(`tool ${name} failed: ${err.message}`);
    return JSON.stringify({ errore: err.message });
  }
}

// Tools whose result is already the answer to read out.
const FINAL_TOOLS = new Set(['cerca_web']);

module.exports = { TOOLS, FINAL_TOOLS, runTool, relevantText };
