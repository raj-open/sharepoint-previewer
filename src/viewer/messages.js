import { MAX_PROBLEMS } from '../_core/settings.js';
import { esc } from '../_core/util.js';
import { renderLines } from '../view/lines.js';
/** @typedef {import('../_core/types.js').LintResult} LintResult */
/** @typedef {import('../_core/types.js').Viewer} Viewer */
/** @typedef {import('../_core/types.js').TargetEvent} TargetEvent */

/** @param {Viewer} v @param {string} message @returns {void} */
export function showPlain(v, message) {
  v.lint.style.display = 'none';
  v.loadMoreBtn.style.display = 'none';
  v.lineView?.stop();
  v.lineView = null;
  // notices: italic, grey (dark) / red (light)
  v.content.innerHTML = `<div class="tp-lines tp-notice">${renderLines([['', message]], new Map()).join('')}</div>`;
}

/** @param {Viewer} v @param {string} lang @returns {void} */
export function showLintWait(v, lang) {
  v.lint.style.display = 'block';
  v.lint.className = 'tp-lint tp-lint-wait';
  v.lint.innerHTML = `<div class="tp-lint-summary">… ${lang.toUpperCase()}: check in progress</div>`;
}

/** @param {Viewer} v @param {string} lang @param {LintResult} result @param {(line: number) => void} goToLine @returns {void} */
export function renderLint(v, lang, result, goToLine) {
  const { problems, info } = result;
  const label = lang.toUpperCase();
  const lint = v.lint;
  lint.style.display = 'block';
  lint.className = `tp-lint ${problems.length ? 'tp-lint-bad' : 'tp-lint-ok'}`;

  if (!problems.length) {
    const extra = info ? ` · ${esc(info)}` : '';
    lint.innerHTML = `<div class="tp-lint-summary">✓ ${label}: no problems${extra}</div>`;
    return;
  }

  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.length - errors;
  const parts = [];
  if (errors) parts.push(`${errors.toLocaleString()} error${errors > 1 ? 's' : ''}`);
  if (warnings) parts.push(`${warnings.toLocaleString()} warning${warnings > 1 ? 's' : ''}`);
  const capped = problems.length >= MAX_PROBLEMS ? ` (first ${MAX_PROBLEMS} shown)` : '';

  const items = problems
    .map(
      (p) => `
        <div class="tp-lint-item tp-sev-${p.severity}" data-line="${p.line}">
          <b>Line ${p.line}</b>${esc(p.msg)}
        </div>
      `,
    )
    .join('');
  lint.innerHTML = `
    <button class="tp-lint-summary" type="button">✗ ${label}: ${parts.join(', ')}${capped} ▾</button>
    <div class="tp-lint-list" style="display:none">
      ${items}
    </div>
  `;
  const list = lint.querySelector('.tp-lint-list');
  lint.querySelector('.tp-lint-summary').onclick = () => {
    list.style.display = list.style.display === 'none' ? 'block' : 'none';
  };
  list.onclick = (/** @type {TargetEvent} */ e) => {
    const item = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('.tp-lint-item'));
    if (item) goToLine(Number(item.dataset.line));
  };
}
