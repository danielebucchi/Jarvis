#!/usr/bin/env node
'use strict';

// Asks Jarvis a question from the terminal, without going through Alexa.
//   GROQ_API_KEY=... node scripts/ask.js "chi canta bella ciao"
// Keys come from the environment or from lambda/config.js.

const { answer } = require('../lambda/llm');
const { cleanForSpeech } = require('../lambda/speech');
const { loadConfig } = require('../lambda/settings');

async function main() {
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) {
    console.error('usage: node scripts/ask.js "<domanda>"');
    process.exit(2);
  }
  const started = Date.now();
  try {
    const text = await answer(question, { config: loadConfig() });
    console.log(`\n${cleanForSpeech(text)}\n`);
    console.log(`(${Date.now() - started} ms)`);
  } catch (err) {
    console.error(`${err.message} (${Date.now() - started} ms)`);
    process.exit(1);
  }
}

main();
