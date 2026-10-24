// Text view lines: numbers, problem marks, cut lines, escaped text
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load } from '../../helpers.mjs';

const { renderLines, CHUNK_LINES } = await load('view/lines.js');

describe('view/lines', () => {
  it('one line per text line, classes and escaping', () => {
    const html = renderLines(
      [
        ['key', '"a"'],
        ['', ': <1>\n'],
        ['', 'second'],
      ],
      new Map(),
    );
    assert.equal(html.length, 2);
    assert.match(html[0], /data-line="1".*<span class="tp-key">&quot;a&quot;<\/span>/);
    assert.match(html[0], /&lt;1&gt;/);
    assert.match(html[1], /<span class="tp-ln">2<\/span>/);
  });
  it('problems mark their line (error wins over warning)', () => {
    const problems = new Map([
      [
        1,
        [
          { line: 1, msg: 'w', severity: 'warning' },
          { line: 1, msg: 'e', severity: 'error' },
        ],
      ],
    ]);
    assert.match(renderLines([['', 'x']], problems)[0], /class="tp-line tp-err" data-line="1" title="w\ne"/);
  });
  it('cut lines say how much is left out', () => {
    assert.match(renderLines([['', 'x']], new Map(), new Map([[1, 1234]]))[0], /… 1,234 more characters/);
  });
  it('blocks of lines for big files', () => assert.ok(CHUNK_LINES >= 50));
});
