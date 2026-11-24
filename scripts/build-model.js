#!/usr/bin/env node
'use strict';

// Generates the it-IT interaction model from lambda/carriers.js, so that the
// intents Alexa knows and the ones the Lambda handles cannot drift apart.
// Run after editing carriers.js, then paste the JSON into the Alexa console.

const fs = require('node:fs');
const path = require('node:path');
const { SLOT, FILLER_INTENT, FILLERS, CARRIERS, intentName } = require('../lambda/carriers');

const MODEL_PATH = path.join(__dirname, '..', 'skill-package', 'interactionModels', 'custom', 'it-IT.json');
const INVOCATION_NAME = 'jarvis';

function questionIntent(name, phrases) {
  return {
    name,
    slots: [{ name: SLOT, type: 'AMAZON.SearchQuery' }],
    samples: phrases.map((phrase) => `${phrase} {${SLOT}}`),
  };
}

function buildModel() {
  return {
    interactionModel: {
      languageModel: {
        invocationName: INVOCATION_NAME,
        intents: [
          { name: 'AMAZON.CancelIntent', samples: [] },
          { name: 'AMAZON.HelpIntent', samples: [] },
          { name: 'AMAZON.StopIntent', samples: [] },
          { name: 'AMAZON.NavigateHomeIntent', samples: [] },
          { name: 'AMAZON.FallbackIntent', samples: [] },
          questionIntent(FILLER_INTENT, FILLERS),
          ...CARRIERS.map((carrier) => questionIntent(intentName(carrier), [carrier])),
        ],
        types: [],
      },
    },
  };
}

function render() {
  return `${JSON.stringify(buildModel(), null, 2)}\n`;
}

if (require.main === module) {
  fs.writeFileSync(MODEL_PATH, render());
  console.log(`written ${path.relative(process.cwd(), MODEL_PATH)}`);
}

module.exports = { MODEL_PATH, render };
