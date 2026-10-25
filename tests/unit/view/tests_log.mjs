// Log table: fields guessed from the lines, continuation lines joined
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.mjs';

const { parseLog, levelClass } = await load('view/log.js');

/** @param {string} text */
const table = (text) => {
    const t = parseLog(text);
    return t && [t.header, ...t.rows];
};

describe('view/log', () => {
    it('Python logging: time - name - level - message; traceback joined', () => {
        const text = [
            '2026-10-25 12:00:00,123 - app.db - INFO - connected',
            '2026-10-25 12:00:01,000 - app.db - ERROR - failed',
            'Traceback (most recent call last):',
            '  File "x.py", line 1, in <module>',
            'ValueError: bad',
            '2026-10-25 12:00:02,000 - app - WARNING - slow',
        ].join('\n');
        assert.deepEqual(table(text), [
            ['line', 'time', 'name', 'level', 'message'],
            ['1', '2026-10-25 12:00:00,123', 'app.db', 'INFO', 'connected'],
            [
                '2',
                '2026-10-25 12:00:01,000',
                'app.db',
                'ERROR',
                'failed\nTraceback (most recent call last):\n  File "x.py", line 1, in <module>\nValueError: bad',
            ],
            ['6', '2026-10-25 12:00:02,000', 'app', 'WARNING', 'slow'],
        ]);
    });
    it('Python basicConfig: level:name:message; printed lines joined', () => {
        assert.deepEqual(table('INFO:root:hello\nWARNING:app.x:careful\nprinted\nERROR:root:boom'), [
            ['line', 'level', 'name', 'message'],
            ['1', 'INFO', 'root', 'hello'],
            ['2', 'WARNING', 'app.x', 'careful\nprinted'],
            ['4', 'ERROR', 'root', 'boom'],
        ]);
    });
    it('log4j: time [thread] level logger - message; stack frames joined', () => {
        const text = [
            '2026-10-25 12:00:00,123 [main] INFO  com.x.Y - started',
            '2026-10-25 12:00:00,200 [pool-1] DEBUG com.x.Z - tick',
            '\tat com.x.Z.run(Z.java:1)',
        ].join('\n');
        assert.deepEqual(table(text), [
            ['line', 'time', 'context', 'level', 'name', 'message'],
            ['1', '2026-10-25 12:00:00,123', 'main', 'INFO', 'com.x.Y', 'started'],
            ['2', '2026-10-25 12:00:00,200', 'pool-1', 'DEBUG', 'com.x.Z', 'tick\n\tat com.x.Z.run(Z.java:1)'],
        ]);
    });
    it('lines before the first entry: own row, message only', () => {
        assert.deepEqual(table('banner\n[12:00:00] [INFO] go\n[12:00:01] [WARN] hmm'), [
            ['line', 'time', 'level', 'message'],
            ['1', '', '', 'banner'],
            ['2', '12:00:00', 'INFO', 'go'],
            ['3', '12:00:01', 'WARN', 'hmm'],
        ]);
    });
    it('no fields: null (plain text, too few entries)', () => {
        assert.equal(parseLog('hello\nworld\nnothing here'), null);
        assert.equal(parseLog('2026-10-25 one entry'), null);
    });
    it('level classes as in the highlighter', () =>
        assert.deepEqual(['ERROR', 'warn', 'Info', 'TRACE', 'x'].map(levelClass), [
            'lv-err',
            'lv-warn',
            'lv-info',
            'lv-debug',
            '',
        ]));
});
