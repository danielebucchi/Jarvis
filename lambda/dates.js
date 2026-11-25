'use strict';

// "mercoledì 25 novembre 2026": models need today's date to make sense of
// "prossima partita", "domani" and the like.
function todayInRome(now = new Date()) {
  return now.toLocaleDateString('it-IT', {
    timeZone: 'Europe/Rome',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

module.exports = { todayInRome };
