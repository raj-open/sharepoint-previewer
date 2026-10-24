// Check results bar: waiting, ok, problems
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fakeViewer } from '../helpers.mjs';
import { load } from '../helpers.mjs';

const { showLintWait, renderLint } = await load('viewer/messages.js');

describe('viewer/messages', () => {
    it('waiting', () => {
        const v = fakeViewer();
        showLintWait(v, 'json');
        assert.match(v.lint.innerHTML, /JSON: check in progress/);
    });
    it('no problems', () => {
        const v = fakeViewer();
        renderLint(v, 'yaml', { problems: [], info: 'basic checks' }, () => {});
        assert.match(v.lint.innerHTML, /✓ YAML: no problems · basic checks/);
        assert.match(v.lint.className, /tp-lint-ok/);
    });
    it('problems: counted, listed with lines, escaped', () => {
        const v = fakeViewer();
        const problems = [
            { line: 3, msg: 'bad <tag>', severity: 'error' },
            { line: 5, msg: 'odd', severity: 'warning' },
        ];
        renderLint(v, 'xml', { problems }, () => {});
        assert.match(v.lint.innerHTML, /✗ XML: 1 error, 1 warning/);
        assert.match(v.lint.innerHTML, /<b>Line 3<\/b>bad &lt;tag&gt;/);
    });
});
