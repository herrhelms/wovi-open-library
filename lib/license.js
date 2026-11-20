/**
 * Licence classifier for the "Open licences only" filter.
 * Uses only the licence label and the licence URL of an item.
 */

const CLOSED_PHRASES = [
  'in copyright',
  'copyright not evaluated',
  'undetermined',
];

const CLOSED_URL_PARTS = [
  'rightsstatements.org/vocab/inc',
  'rightsstatements.org/vocab/cne/',
  'rightsstatements.org/vocab/und/',
];

const OPEN_PARTS = [
  'creativecommons.org/publicdomain/',
  'creativecommons.org/licenses/',
  'cc0',
  'public domain',
  'rightsstatements.org/vocab/noc-',
  'rightsstatements.org/vocab/nkc/',
  'no copyright',
  'no known copyright',
  'no known restrictions',
  'no restrictions',
  'free to use',
  'united states government work',
  'gfdl',
  'free art licen',
  'pixabay content license',
  'pexels license',
  'unsplash license',
  'open access',
  'getty open content',
  'free to reuse',
];

const IN_C_TOKEN = /\bInC(-[A-Z]+)*\b/;
const PDM_WORD = /\bpdm\b/;
const CC_BY_WORDS = /\bcc\s+by\b/;

/**
 * Decide whether a licence is open.
 * When the text is unknown (no rule matches) the licence is not open.
 * @param {unknown} label
 * @param {unknown} url
 * @returns {boolean}
 */
export function isOpenLicense(label, url) {
  const parts = [];
  if (typeof label === 'string') parts.push(label);
  if (typeof url === 'string') parts.push(url);
  if (parts.length === 0) return false;

  const original = parts.join(' ');
  const text = original.toLowerCase();

  // Closed rules win over every open rule.
  for (const phrase of CLOSED_PHRASES) {
    if (text.includes(phrase)) return false;
  }
  for (const part of CLOSED_URL_PARTS) {
    if (text.includes(part)) return false;
  }
  if (IN_C_TOKEN.test(original)) return false;

  for (const part of OPEN_PARTS) {
    if (text.includes(part)) return true;
  }
  if (PDM_WORD.test(text)) return true;
  if (CC_BY_WORDS.test(text)) return true;
  if (text.includes('cc-by') || text.includes('cc_by')) return true;

  return false;
}
