'use strict';

const MAX_CHARS = 300;

// LLMs write for a screen: strip what would be read aloud as noise and cut long
// answers at a sentence boundary.
function cleanForSpeech(text, maxChars = MAX_CHARS) {
  let clean = text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (clean.length > maxChars) {
    const cut = clean.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    clean = lastStop > 0 ? cut.slice(0, lastStop + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
  }
  return clean;
}

// The SDK wraps the text in <speak> as is, so SSML metacharacters must be escaped.
function escapeSsml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { cleanForSpeech, escapeSsml };
