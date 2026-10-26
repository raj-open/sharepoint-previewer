// Messages in the viewer: plain notices, lint results

// ===========================================================================
// IMPORTS
// ===========================================================================

import { MAX_PROBLEMS } from '../_core/settings.ts';
import { esc } from '../_core/util.ts';
import { renderLines } from '../view/lines.ts';

import type { LintResult } from '../_core/types.ts';
import type { Viewer } from '../_core/types.ts';

// ===========================================================================
// METHODS
// ===========================================================================

export function showPlain(v: Viewer, message: string): void {
    v.lint.style.display = 'none';
    v.loadMoreBtn.style.display = 'none';
    v.lineView?.stop();
    v.lineView = null;
    // notices: italic, grey (dark) / red (light)
    v.content.innerHTML = `<div class="tp-lines tp-notice">${renderLines([['', message]], new Map()).join('')}</div>`;
}

export function showLintWait(v: Viewer, lang: string): void {
    v.lint.style.display = 'block';
    v.lint.className = 'tp-lint tp-lint-wait';
    v.lint.innerHTML = `<div class="tp-lint-summary">… ${lang.toUpperCase()}: check in progress</div>`;
}

export function renderLint(v: Viewer, lang: string, result: LintResult, goToLine: (line: number) => void): void {
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
    const list = lint.querySelector('.tp-lint-list') as HTMLElement; // written just above
    (lint.querySelector('.tp-lint-summary') as HTMLElement).onclick = () => {
        list.style.display = list.style.display === 'none' ? 'block' : 'none';
    };
    list.onclick = (e) => {
        const item = (e.target as HTMLElement).closest('.tp-lint-item') as HTMLElement | null;
        if (item) goToLine(Number(item.dataset.line));
    };
}
