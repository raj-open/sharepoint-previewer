// Every module loads (browser stubbed) and defines what it exports; the entry wires them all up.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { gm, load, ROOT } from '../helpers.mjs';

const DIR = path.join(ROOT, 'src/userscript');
const modules = fs
  .readdirSync(DIR, { recursive: true })
  .filter((f) => f.endsWith('.js') && !['header.js', 'main.js', 'types.js'].includes(f))
  .sort();

describe('modules', () => {
  it('there are modules to test', () => assert.ok(modules.length > 40));
  for (const file of modules) {
    it(`${file}: loads, exports defined`, async () => {
      const m = await load(file);
      for (const [name, value] of Object.entries(m)) assert.notEqual(value, undefined, `${file}: ${name}`);
    });
  }

  it('entry: registers the Tampermonkey menu', async () => {
    await load('main.js');
    assert.deepEqual(Object.keys(gm.menu).sort(), ['Reset settings to defaults', 'Settings …']);
  });

  it('header: Tampermonkey metadata block', () => {
    const header = fs.readFileSync(path.join(DIR, 'header.js'), 'utf8');
    assert.match(header, /^\/\/ ==UserScript==\n[\s\S]*\n\/\/ ==\/UserScript==\n$/);
    for (const key of ['@name', '@version', '@match', '@grant']) assert.match(header, new RegExp(`// ${key} `));
  });
});
