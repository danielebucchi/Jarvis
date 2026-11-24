'use strict';

// Alexa-hosted skills have no environment variables, so the keys live in
// lambda/config.js (kept out of git, see config.example.js). Environment
// variables win, which is handy when running scripts/ask.js locally.
function loadConfig() {
  let file = {};
  try {
    file = require('./config');
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
  }
  return {
    groqApiKey: process.env.GROQ_API_KEY || file.groqApiKey,
    geminiApiKey: process.env.GEMINI_API_KEY || file.geminiApiKey,
    openrouterApiKey: process.env.OPENROUTER_API_KEY || file.openrouterApiKey,
    groqModel: process.env.GROQ_MODEL || file.groqModel,
    groqSmallModel: process.env.GROQ_SMALL_MODEL || file.groqSmallModel,
    geminiModel: process.env.GEMINI_MODEL || file.geminiModel,
    openrouterModel: process.env.OPENROUTER_MODEL || file.openrouterModel,
  };
}

module.exports = { loadConfig };
