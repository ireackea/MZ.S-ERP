// Utility: getValidSelectionDetails
// - Accepts either a Selection object (window.getSelection()) or a plain string
// - Returns a detailed object describing whether the selection is valid for translation
// - Validation rules: Unicode letters (including Arabic), length 1..64, strips surrounding punctuation

/**
 * @typedef {Object} SelectionDetails
 * @property {boolean} valid
 * @property {string} original
 * @property {string} cleaned
 * @property {string} normalized
 * @property {boolean} isSingleWord
 * @property {number} wordCount
 * @property {number} length
 * @property {{startOffset?: number, endOffset?: number}|null} range
 * @property {boolean} containsArabic
 * @property {string=} reason
 */

/**
 * Extract raw text from a Selection or string.
 * @param {Selection|string} input
 * @returns {{text: string, range: {startOffset?: number, endOffset?: number}|null}}
 */
function _extractText(input) {
  if (!input) return { text: '', range: null };
  if (typeof input === 'string') return { text: input, range: null };
  try {
    const s = /** @type {Selection} */ (input);
    const txt = s.toString?.() ?? '';
    if (s.rangeCount && s.rangeCount > 0) {
      try {
        const r = s.getRangeAt(0);
        return { text: txt, range: { startOffset: r.startOffset, endOffset: r.endOffset } };
      } catch (e) {
        return { text: txt, range: null };
      }
    }
    return { text: txt, range: null };
  } catch (err) {
    return { text: String(input ?? ''), range: null };
  }
}

/**
 * Strip surrounding punctuation / symbols / invisible chars and collapse whitespace.
 * @param {string} s
 */
function _cleanText(s) {
  if (!s) return '';
  // remove BOM/ZWSP and normalize whitespace
  let t = s.replace(/[\uFEFF\u200B]/g, '');
  // collapse whitespace
  t = t.replace(/\s+/g, ' ').trim();
  // strip leading/trailing punctuation/symbols/quotes/parens
  // \p{P} = punctuation, \p{S} = symbols, \p{C} = invisible/control
  t = t.replace(/^[\p{P}\p{S}\p{C}]+|[\p{P}\p{S}\p{C}]+$/gu, '');
  // final trim
  return t.trim();
}

/**
 * Return true if token looks like a (single) word made of Unicode letters (allowing hyphen/apostrophe)
 * @param {string} token
 */
function _isLetterWord(token) {
  if (!token) return false;
  // allow letters, combining marks, hyphen, apostrophe
  return /^\p{L}[\p{L}\p{M}\p{Pd}'7�"�7�"�7�"�#���97�"�7�"�#���⬆7�"�`]*$/u.test(token);
}

/**
 * Detect Arabic script in text
 * @param {string} s
 */
function _containsArabic(s) {
  return /\p{Script=Arabic}/u.test(s);
}

/**
 * Validate and return details for a selected text (string or Selection).
 * Rules (per project): allow Unicode letters (including Arabic), strip surrounding punctuation,
 * accept 1..64 characters (cleaned length), report if single word, word count, normalized value.
 *
 * @param {Selection|string|null|undefined} selectionOrString
 * @returns {SelectionDetails}
 */
export function getValidSelectionDetails(selectionOrString) {
  const { text: raw, range } = _extractText(selectionOrString);
  const original = String(raw ?? '');
  const cleaned = _cleanText(original);
  const length = cleaned.length;

  const details = {
    valid: false,
    original,
    cleaned,
    normalized: cleaned ? cleaned.toLowerCase() : '',
    isSingleWord: false,
    wordCount: 0,
    length,
    range: range ?? null,
    containsArabic: _containsArabic(cleaned),
    reason: undefined,
  };

  if (!cleaned) {
    details.reason = 'empty';
    return details;
  }

  if (length > 64) {
    details.reason = 'too_long';
    return details;
  }

  // split words on whitespace
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  details.wordCount = tokens.length;

  // determine if single-token and composed of letters
  if (tokens.length === 1 && _isLetterWord(tokens[0])) {
    details.isSingleWord = true;
  }

  // valid when at least one token contains a letter character
  const anyLetterToken = tokens.some(t => /\p{L}/u.test(t));
  if (!anyLetterToken) {
    details.reason = 'no_letters';
    return details;
  }

  details.valid = true;
  return details;
}

export default getValidSelectionDetails;