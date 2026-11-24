'use strict';

const Alexa = require('ask-sdk-core');
const llm = require('./llm');
const { isQuestionIntent, questionFromIntent } = require('./carriers');
const { cleanForSpeech, escapeSsml } = require('./speech');
const { loadConfig } = require('./settings');

// Alexa drops the request after 8 seconds; keep a margin for the Lambda itself.
const ANSWER_BUDGET_MS = 6500;
// Say "un attimo" only when the answer is slow to come.
const PROGRESSIVE_AFTER_MS = 1500;
const HISTORY_MESSAGES = 6;

const REPROMPT = 'Vuoi chiedermi altro?';
const ASK_AGAIN = 'Cosa vuoi sapere?';

const LaunchRequestHandler = {
  canHandle: (input) => Alexa.getRequestType(input.requestEnvelope) === 'LaunchRequest',
  handle: (input) =>
    input.responseBuilder.speak(`Ciao, sono Jarvis. ${ASK_AGAIN}`).reprompt(ASK_AGAIN).getResponse(),
};

async function sendProgressive(input, speech) {
  const { requestEnvelope, serviceClientFactory } = input;
  if (!serviceClientFactory || !requestEnvelope.context?.System?.apiAccessToken) return;
  try {
    await serviceClientFactory.getDirectiveServiceClient().enqueue({
      header: { requestId: requestEnvelope.request.requestId },
      directive: { type: 'VoicePlayer.Speak', speech },
    });
  } catch (err) {
    console.warn(`progressive response failed: ${err.message}`);
  }
}

function questionHandler({ ask, config }) {
  return {
    canHandle: (input) =>
      Alexa.getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      isQuestionIntent(Alexa.getIntentName(input.requestEnvelope)),

    async handle(input) {
      const question = questionFromIntent(input.requestEnvelope.request.intent);
      if (!question) {
        return input.responseBuilder.speak(ASK_AGAIN).reprompt(ASK_AGAIN).getResponse();
      }

      const attributes = input.attributesManager.getSessionAttributes();
      const history = attributes.history || [];
      const timer = setTimeout(() => sendProgressive(input, 'Un attimo…'), PROGRESSIVE_AFTER_MS);

      let speech;
      try {
        const raw = await ask(question, {
          history,
          config: config(),
          deadline: Date.now() + ANSWER_BUDGET_MS,
        });
        speech = cleanForSpeech(raw);
        attributes.history = [
          ...history,
          { role: 'user', content: question },
          { role: 'assistant', content: speech },
        ].slice(-HISTORY_MESSAGES);
        input.attributesManager.setSessionAttributes(attributes);
      } catch (err) {
        console.error(`no answer for "${question}": ${err.message}`);
        speech = 'Scusa, in questo momento non riesco a trovare la risposta. Riprova tra poco.';
      } finally {
        clearTimeout(timer);
      }

      return input.responseBuilder.speak(escapeSsml(speech)).reprompt(REPROMPT).getResponse();
    },
  };
}

function intentHandler(names, handle) {
  return {
    canHandle: (input) =>
      Alexa.getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      names.includes(Alexa.getIntentName(input.requestEnvelope)),
    handle,
  };
}

const HelpIntentHandler = intentHandler(['AMAZON.HelpIntent'], (input) => {
  const speech =
    'Fammi una domanda qualsiasi, per esempio: chi canta Bella Ciao? ' +
    'Oppure: quanto è alta la Torre Eiffel? ' +
    ASK_AGAIN;
  return input.responseBuilder.speak(speech).reprompt(ASK_AGAIN).getResponse();
});

const StopIntentHandler = intentHandler(
  ['AMAZON.StopIntent', 'AMAZON.CancelIntent', 'AMAZON.NavigateHomeIntent'],
  (input) => input.responseBuilder.speak('A presto!').withShouldEndSession(true).getResponse(),
);

// The fallback intent carries no text, so there is nothing to forward to the model.
const FallbackIntentHandler = intentHandler(['AMAZON.FallbackIntent'], (input) => {
  const speech =
    'Non ho capito la domanda. Prova a cominciare con "dimmi", per esempio: dimmi chi ha inventato il telefono.';
  return input.responseBuilder.speak(speech).reprompt(ASK_AGAIN).getResponse();
});

const SessionEndedRequestHandler = {
  canHandle: (input) => Alexa.getRequestType(input.requestEnvelope) === 'SessionEndedRequest',
  handle: (input) => input.responseBuilder.getResponse(),
};

const ErrorHandler = {
  canHandle: () => true,
  handle(input, error) {
    console.error(`unhandled error: ${error.stack || error.message}`);
    return input.responseBuilder
      .speak('Scusa, qualcosa è andato storto.')
      .reprompt(ASK_AGAIN)
      .getResponse();
  },
};

// skillId: when set, requests from any other skill are rejected. Signature
// checks only prove a request comes from Alexa, not that it is for Jarvis.
function createSkill({ ask = llm.answer, config = loadConfig, skillId } = {}) {
  const builder = Alexa.SkillBuilders.custom();
  if (skillId) builder.withSkillId(skillId);
  return builder
    .addRequestHandlers(
      LaunchRequestHandler,
      questionHandler({ ask, config }),
      HelpIntentHandler,
      StopIntentHandler,
      FallbackIntentHandler,
      SessionEndedRequestHandler,
    )
    .addErrorHandlers(ErrorHandler)
    .withApiClient(new Alexa.DefaultApiClient())
    .create();
}

const skill = createSkill();

exports.createSkill = createSkill;
exports.handler = (event, context) => skill.invoke(event, context);
