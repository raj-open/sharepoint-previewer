import { MAX_PROBLEMS } from '../../_core/settings.js';
/** @typedef {import('../../_core/types.js').Problem} Problem */

// ---------------------------------------------------------------------------
// Linters: text -> { problems: [{ line, msg, severity }], info? }
// ---------------------------------------------------------------------------

/** @param {string} text @param {number} index @returns {number} 1-based line */
export const lineAt = (text, index) => {
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) n++;
  return n;
};

// Collect problems (at most MAX_PROBLEMS)
/** @returns {{ problems: Problem[], add: (line: number, msg: string, severity?: 'error'|'warning') => void }} */
export function collector() {
  /** @type {Problem[]} */
  const problems = [];
  /** @param {number} line @param {string} msg @param {'error'|'warning'} [severity] */
  const add = (line, msg, severity = 'error') => {
    if (problems.length < MAX_PROBLEMS) problems.push({ line, msg, severity });
  };
  return { problems, add };
}
