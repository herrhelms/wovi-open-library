/**
 * GitHub footer strip for the Sources modal and the first-save notice.
 * Plain ES module; no DOM work happens at import time.
 */
import { el } from './lib.js';

export const REPO_URL = 'https://github.com/herrhelms/wovi-open-library';
export const SPONSORS_URL = 'https://github.com/sponsors/herrhelms';

const SVG_NS = 'http://www.w3.org/2000/svg';

const GITHUB_PATH =
  'M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21';

/**
 * Create the GitHub mark: a stroked outline, hidden from assistive tech.
 * @returns {SVGSVGElement}
 */
function createGithubMark() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', GITHUB_PATH);
  svg.append(path);

  return svg;
}

/**
 * Build the GitHub footer strip: feedback link, sponsor link and a heart.
 * @returns {HTMLDivElement}
 */
export function createGithubStrip() {
  const paragraph = el('p', {}, [
    'Let me know what you think about this project ',
    el('a', { href: REPO_URL, target: '_blank', rel: 'noopener', text: 'on GitHub' }),
    '.',
    el('br'),
    'If you want to support its continuous development, consider ',
    el('a', {
      href: SPONSORS_URL,
      target: '_blank',
      rel: 'noopener',
      text: 'becoming a GitHub Sponsor',
    }),
    ' ',
    el('span', { class: 'gh-heart', 'aria-hidden': 'true', text: '\u2665' }),
  ]);

  return el('div', { class: 'gh-strip' }, [createGithubMark(), paragraph]);
}
