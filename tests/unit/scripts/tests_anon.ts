// Anonymous bundle: regions "anon" left out (nested regions too), ABOUT_LINKS emptied, written and checked
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'node:test';
import { it } from 'node:test';
import { anonymise } from '../../../scripts/anon.ts';
import { writeAnon } from '../../../scripts/anon.ts';

describe('scripts/anon', () => {
    it('regions "anon": left out with their markers; other regions kept; nested ones inside go with them', () => {
        const text = [
            '// ==UserScript==',
            '// @name         X',
            '// #region anon',
            '// @copyright    someone',
            '// #endregion anon',
            '// ==/UserScript==',
            '// #region other',
            'const a = 1;',
            '// #endregion',
            '    // #region anon who made it',
            '    // #region inner',
            '    const who = "me";',
            '    // #endregion',
            '    const site = "x";',
            '    // #endregion anon',
            'const b = 2;',
        ].join('\n');
        assert.equal(
            anonymise(text),
            [
                '// ==UserScript==',
                '// @name         X',
                '// ==/UserScript==',
                '// #region other',
                'const a = 1;',
                '// #endregion',
                'const b = 2;',
            ].join('\n'),
        );
    });

    it('"anon" only as a word of its own; a region left open: refused', () => {
        const text = '// #region anonymous\nconst a = 1;\n// #endregion';
        assert.equal(anonymise(text), text);
        assert.throws(() => anonymise('// #region anon\nconst a = 1;'), /not closed/);
    });

    it('ABOUT_LINKS emptied (one line or several, exported or not); commented out or absent: as it is', () => {
        assert.equal(
            anonymise("const ABOUT_LINKS = { Repository: 'https://example.org/a;b' };"),
            'const ABOUT_LINKS = {};',
        );
        assert.equal(
            anonymise("export const ABOUT_LINKS = {\n    Repository: 'https://example.org',\n};\nconst x = 1;"),
            'export const ABOUT_LINKS = {};\nconst x = 1;',
        );
        const off = "// const ABOUT_LINKS = { Repository: 'https://example.org' };\nconst x = 1;";
        assert.equal(anonymise(off), off);
        assert.equal(anonymise('const ABOUT_LINKSX = 1;'), 'const ABOUT_LINKSX = 1;');
    });

    it('written beside, checked by Node: broken output refused', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anon-'));
        try {
            const bundle = path.join(dir, 'userscript.js');
            const out = path.join(dir, 'userscript-anon.js');
            fs.writeFileSync(bundle, "// #region anon\nconst who = 'me';\n// #endregion anon\nconsole.log(1);\n");
            writeAnon(bundle, out);
            assert.equal(fs.readFileSync(out, 'utf8'), 'console.log(1);\n');
            fs.writeFileSync(bundle, 'const a = (;\n');
            assert.throws(() => writeAnon(bundle, out), /not valid JavaScript[\s\S]*SyntaxError/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
