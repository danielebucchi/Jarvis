# Jarvis — skill Alexa con LLM gratuito

"Alexa, chiedi a jarvis chi canta Bella Ciao" → la domanda va a un LLM gratuito, che
può cercare la canzone su iTunes o la voce su Wikipedia prima di rispondere.

- **LLM**: Groq (`openai/gpt-oss-120b`, poi `openai/gpt-oss-20b` che ha una quota
  separata: gratis sono 8000 token al minuto per modello, circa 7 domande), poi Gemini (`gemini-3.5-flash-lite`), poi
  Gemma su OpenRouter (`google/gemma-4-31b-it:free`): se uno fallisce si passa al
  successivo. Tutti gratuiti, nessuno ha la ricerca web sul piano free: per questo
  ci sono gli strumenti di ricerca.
- **Strumenti**: `cerca_canzone` (iTunes Search API) e `cerca_wikipedia` (it.wikipedia),
  gratuiti e senza chiave.
- **Tempi**: Alexa aspetta circa 8 secondi; la skill si dà 6,5 secondi e, se la
  risposta tarda più di 1,5, dice "Un attimo…".
- **Conversazione**: la sessione resta aperta e ricorda gli ultimi 3 scambi, quindi
  "e in che anno è uscita?" funziona.

## Struttura

```
lambda/                 codice della skill (è la cartella che va su Alexa)
  index.js              handler Alexa
  llm.js                client Groq/Gemini e ciclo degli strumenti
  tools.js              ricerca canzoni e Wikipedia
  carriers.js           frasi d'apertura riconosciute (vedi sotto)
  speech.js             pulizia del testo per la voce
  settings.js           lettura delle chiavi
  config.example.js     modello per config.js (le chiavi, fuori da git)
skill-package/          manifest e modello d'interazione it-IT
scripts/build-model.js  rigenera il modello d'interazione da carriers.js
scripts/ask.js          fa una domanda da terminale, senza Alexa
```

### Perché tanti intent

Alexa non passa mai alla skill la frase detta: uno slot `AMAZON.SearchQuery` vuole una
frase fissa davanti ("chi canta {domanda}") e quella frase non arriva nello slot.
Quindi ogni frase d'apertura ha il suo intent (`Q_chi_canta`, `Q_quando`, …) e la
Lambda la rimette davanti al testo. Per aggiungerne una: modifica `lambda/carriers.js`,
lancia `node scripts/build-model.js` e reincolla il JSON nella console.

Una frase che non comincia con nessuna di queste finisce in `AMAZON.FallbackIntent`,
che non porta testo: Jarvis chiede di riformulare cominciando con "dimmi".

## Chiavi API (gratuite)

- Groq: <https://console.groq.com/keys>
- Gemini: <https://aistudio.google.com/apikey>
- OpenRouter: <https://openrouter.ai/keys> (gratis 50 richieste al giorno, 1000 dopo
  aver comprato almeno 10 $ di crediti)

Ne basta una; con più chiavi ci sono le riserve.

## Prova da terminale

```sh
cd lambda && npm install && npm test && cd ..
GROQ_API_KEY=gsk_... node scripts/ask.js "chi canta il mondo"
```

Oppure copia `lambda/config.example.js` in `lambda/config.js`, mettici le chiavi e
lancia solo `node scripts/ask.js "..."`.

## Installazione su Alexa

1. Vai su <https://developer.amazon.com/alexa/console/ask> con lo stesso account
   Amazon dell'Echo e scegli **Crea skill**.
2. Nome `Jarvis`, lingua **Italiano (IT)**, tipo **Personalizzato**, hosting
   **Alexa-hosted (Node.js)**, regione **UE (Irlanda)**, modello **Inizia da zero**.
3. **Build → Modello di interazione → Editor JSON**: incolla il contenuto di
   `skill-package/interactionModels/custom/it-IT.json`, **Salva** e **Crea il modello**.
   Se la console rifiuta il nome d'invocazione di una sola parola, cambialo in
   `ok jarvis` (o simile) in `scripts/build-model.js` e rigenera.
4. **Codice**: sostituisci `index.js` e `package.json` con quelli di `lambda/`, crea
   `llm.js`, `tools.js`, `carriers.js`, `speech.js`, `settings.js` copiandoli, e crea
   `config.js` con le chiavi (come in `config.example.js`). **Salva** e **Distribuisci**.
5. **Test**: attiva il test in **Sviluppo** e scrivi o di' "chiedi a jarvis chi canta
   bella ciao". I log sono in **Codice → CloudWatch Logs**.
6. Sull'Echo (impostato in italiano, stesso account) la skill in sviluppo è già attiva:
   "Alexa, apri jarvis".
