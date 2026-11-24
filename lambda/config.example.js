'use strict';

// Copy this file to config.js and fill in the keys. config.js is not committed.
// At least one key is needed. They are tried in this order: Groq (two models,
// each with its own quota), Gemini, OpenRouter; the next one is used when the
// previous fails.
module.exports = {
  groqApiKey: 'gsk_...', // https://console.groq.com/keys
  geminiApiKey: 'AIza...', // https://aistudio.google.com/apikey
  openrouterApiKey: 'sk-or-...', // https://openrouter.ai/keys

  // Optional: override the default models.
  // groqModel: 'openai/gpt-oss-120b',
  // groqSmallModel: 'openai/gpt-oss-20b',
  // geminiModel: 'gemini-3.5-flash-lite',
  // openrouterModel: 'google/gemma-4-31b-it:free',
};
