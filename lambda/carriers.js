'use strict';

// Alexa never hands the skill the raw utterance: an AMAZON.SearchQuery slot needs
// a fixed "carrier" phrase in front of it, and that phrase is not part of the slot
// value. "chi canta bella ciao" would reach us as just "bella ciao". So every
// carrier gets its own intent, and the intent name tells us which words to put
// back in front of the slot.

const SLOT = 'domanda';

// Filler openings that add nothing to the question: they are dropped.
const FILLER_INTENT = 'DomandaIntent';
const FILLERS = [
  'dimmi',
  'sai dirmi',
  'mi sai dire',
  'voglio sapere',
  'vorrei sapere',
  'cerca',
  'ho una domanda',
  'domanda',
  'rispondi',
];

// Openings that are part of the question: they are put back in front of the slot.
const CARRIERS = [
  'chi',
  'chi è',
  'chi era',
  'chi canta',
  'chi ha cantato',
  'chi ha scritto',
  'chi ha vinto',
  'di chi è',
  'cosa',
  'che cosa',
  "cos'è",
  "che cos'è",
  'cosa significa',
  'come',
  'quando',
  'dove',
  'perché',
  'quanto',
  'quanti',
  'quante',
  'quale',
  'quali',
  "qual è",
  'che',
  'in che anno',
  'parlami di',
  'raccontami',
  'spiegami',
  'traduci',
  'calcola',
  'consigliami',
  'secondo te',
  'è vero che',
];

// Intent names allow only letters and underscores.
function intentName(carrier) {
  return (
    'Q_' +
    carrier
      .normalize('NFD')
      .replace(/[̀-ͯ']/g, '')
      .replace(/ /g, '_')
  );
}

const PREFIX_BY_INTENT = new Map([
  [FILLER_INTENT, ''],
  ...CARRIERS.map((carrier) => [intentName(carrier), carrier]),
]);

function isQuestionIntent(name) {
  return PREFIX_BY_INTENT.has(name);
}

// The question as the user said it, or '' when the slot came back empty.
function questionFromIntent(intent) {
  const value = intent.slots?.[SLOT]?.value?.trim();
  if (!value) return '';
  return `${PREFIX_BY_INTENT.get(intent.name)} ${value}`.trim();
}

module.exports = {
  SLOT,
  FILLER_INTENT,
  FILLERS,
  CARRIERS,
  intentName,
  isQuestionIntent,
  questionFromIntent,
};
