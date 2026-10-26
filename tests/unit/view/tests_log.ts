// Log table: fields guessed from the lines, continuation lines joined
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { parseLog, levelClass, logExpand } = await load('view/log.ts');

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
    it('source word before a field (worker, host); printed blocks: one entry, many lines', () => {
        const text = [
            '2026-10-25 09:15:00 worker [DEBUG] (LOAD) stock keys: []',
            '2026-10-25 09:15:00 worker [DEBUG] stock: (2, 2)',
            '',
            '┌───────┬─────┐',
            ...Array.from({ length: 50 }, () => '│ apple ┆ 3   │'),
            '└───────┴─────┘',
            '2026-10-25 09:15:01 worker [INFO] (DONE) stock read',
        ].join('\n');
        const t = parseLog(text);
        assert.deepEqual(t?.header, ['line', 'time', 'source', 'level', 'message']);
        assert.equal(t?.rows.length, 3);
        assert.deepEqual(t?.rows[0].slice(1, 4), ['2026-10-25 09:15:00', 'worker', 'DEBUG']);
        assert.equal(t?.rows[0][4], '(LOAD) stock keys: []'); // context not shared by most: stays in the message
        assert.equal(t?.rows[1][4].split('\n').length, 54);
        assert.match(t?.rows[1][4] ?? '', /^stock: \(2, 2\)\n\n┌/);
    });
    it('syslog: time, host, process', () =>
        assert.deepEqual(table('Oct 25 12:00:00 host sshd[123]: accepted\nOct 25 12:00:01 host cron[9]: run'), [
            ['line', 'time', 'source', 'name', 'message'],
            ['1', 'Oct 25 12:00:00', 'host', 'sshd[123]', 'accepted'],
            ['2', 'Oct 25 12:00:01', 'host', 'cron[9]', 'run'],
        ]));
    it('fields of the template only: others stay in the message', () =>
        assert.deepEqual(table('12:00:00 INFO a\n12:00:01 INFO b\n12:00:02 INFO c\n12:00:03 INFO d\n12:00:04 [x] e'), [
            ['line', 'time', 'level', 'message'],
            ['1', '12:00:00', 'INFO', 'a'],
            ['2', '12:00:01', 'INFO', 'b'],
            ['3', '12:00:02', 'INFO', 'c'],
            ['4', '12:00:03', 'INFO', 'd'],
            ['5', '12:00:04', '', '[x] e'],
        ]));
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
    it('expand: rows with objects, lists or several lines; segments labelled', () => {
        const rows = [
            ['1', 'INFO', 'plain'],
            ['2', 'INFO', 'got {"a": 1}'],
            ['3', 'INFO', "state={'ok': True}"],
            ['4', 'ERROR', 'failed\n  at x'],
        ];
        const x = logExpand(rows, false);
        assert.deepEqual([0, 1, 2, 3].map(x.can), [false, true, true, true]);
        assert.match(x.html(1), /JSON object<\/div><pre>\{\n {2}&quot;a&quot;: 1\n\}<\/pre>/);
        assert.match(x.html(2), /Python dict/);
        assert.match(logExpand(rows, true).html(1), /<span class="tp-key">/);
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
