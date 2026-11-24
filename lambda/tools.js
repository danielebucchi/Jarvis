'use strict';

// Free lookups the model can call. Neither the Groq nor the Gemini free tier
// comes with web search, and without it the model makes up song credits.

const TOOL_TIMEOUT_MS = 2500;
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

const HANDLERS = { cerca_canzone: searchSong, cerca_wikipedia: searchWikipedia };

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

module.exports = { TOOLS, runTool, relevantText };
