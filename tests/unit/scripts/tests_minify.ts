// Minified userscript: header kept, local names shortened, top-level names kept (lint worker), CSS minified
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { minify } from '../../../scripts/minify.ts';
import { minifyCss } from '../../../scripts/minify.ts';

const HEADER = '// ==UserScript==\n// @name         X\n// ==/UserScript==';

describe('scripts/minify', () => {
    it('header as it is; top-level names kept, local ones shortened; wrapper kept; comments gone', () => {
        const bundle = [
            HEADER,
            '// built',
            '(() => {',
            "  'use strict';",
            '  const MAX_ITEMS = 5;',
            '  // a comment',
            '  function countItems(itemsGiven) {',
            '    const itemsCounted = itemsGiven.length;',
            '    return Math.min(itemsCounted, MAX_ITEMS);',
            '  }',
            '  globalThis.out = String(countItems);',
            '})();',
            '',
        ].join('\n');
        const out = minify(bundle);
        assert.ok(out.startsWith(`${HEADER}\n// @ts-nocheck: built file\n(()=>{`));
        assert.ok(out.trimEnd().endsWith('})();'));
        assert.match(out, /function countItems\(/);
        assert.match(out, /MAX_ITEMS=5/);
        assert.doesNotMatch(out, /itemsGiven|itemsCounted|a comment/);
        assert.match(
            new Function(out.replace(/^\/\/.*$/gm, '').concat('; return globalThis.out;'))(),
            /^function countItems\(/,
        );
    });

    it('CSS of literals marked /* css */: minified, escapes kept; other literals untouched', () => {
        const text =
            'const A = /* css */ `\n  .x {\n    content: "\\\\2026";\n    color: #ffffff;\n  }\n`;\nconst B = `  keep  `;';
        const out = minifyCss(text);
        assert.equal(out, 'const A = `.x{content:"\\\\2026";color:#fff}`;\nconst B = `  keep  `;');
    });

    it('bundle not wrapped, or no header: refused', () => {
        assert.throws(() => minify(`${HEADER}\nconst a = 1;`), /not wrapped/);
        assert.throws(() => minify('(() => {\n})();'), /no ==UserScript== header/);
    });
});
