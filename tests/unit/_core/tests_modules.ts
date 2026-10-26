// Every module loads (browser stubbed) and defines what it exports; the entry wires them all up.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe } from 'node:test';
import { it } from 'node:test';
import { gm } from '../helpers.ts';
import { load } from '../helpers.ts';
import { ROOT } from '../helpers.ts';

const DIR = path.join(ROOT, 'src');
const modules = fs
    .readdirSync(DIR, { recursive: true, encoding: 'utf8' })
    .filter(
        (f) =>
            f.endsWith('.ts') &&
            !f.startsWith('@apis/') &&
            !['main.ts', '_core/header.ts', '_core/types.ts'].includes(f),
    )
    .sort();

describe('modules', () => {
    it('there are modules to test', () => assert.ok(modules.length > 40));
    for (const file of modules) {
        it(`${file}: loads, exports defined`, async () => {
            const m = await load(file);
            for (const [name, value] of Object.entries(m)) assert.notEqual(value, undefined, `${file}: ${name}`);
        });
    }

    it('entry: starts up (modules alone register no menu)', async () => {
        assert.deepEqual(Object.keys(gm.menu), []);
        await load('main.ts');
        assert.deepEqual(Object.keys(gm.menu).sort(), ['Reset settings to defaults', 'Settings …']);
    });

    it('header: Tampermonkey metadata block', () => {
        const header = fs.readFileSync(path.join(DIR, '_core/header.ts'), 'utf8');
        assert.match(header, /^\/\/ ==UserScript==\n[\s\S]*\n\/\/ ==\/UserScript==\n$/);
        for (const key of ['@name', '@version', '@match', '@grant']) assert.match(header, new RegExp(`// ${key} `));
    });
});
