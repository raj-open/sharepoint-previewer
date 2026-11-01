// Solibri rulesets: hints from the values alone (rules of thumb): name vs values, values probably not used,
// contradictions, rules compared (duplicates, limits that cannot both hold), housekeeping

import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { ruleHints, unusedParams } = await load('readers/cset/hints.ts');

type Row = { state: string; subject: string; property: string; operator: string; values: string[] };
const row = (state: string, subject = 'Shelf', values: string[] = []): Row => ({
    state,
    subject,
    property: 'Stock.Code',
    operator: '#3',
    values,
});
const filter = (id: string, ...rows: Row[]) => ({ id, kind: 'Filter', value: '', rows });
const value = (id: string, v: string, kind = 'Length') => ({ id, kind, value: v, rows: null });
const rule = (name: string, params: unknown[], extra: Record<string, unknown> = {}) => ({
    path: [],
    name,
    type: 'GapCheck',
    enabled: true,
    description: 'why',
    params: [filter('xyFrom', row('include')), filter('xyTo', row('include', 'Door')), ...params],
    ...extra,
});
const texts = (hints: { level: string; text: string }[]) => hints.map((h) => `${h.level}: ${h.text}`);
const one = (r: unknown) => texts(ruleHints([r])[0]);

describe('readers/cset/hints', () => {
    it('limits: the check mode says which is used; the other probably not (its value marked)', () => {
        const r = rule('Gap', [
            value('xyGapMin', '85'),
            value('xyGapMax', '25'),
            value('xyCheckMode', 'MinimumRequired', 'Choice'),
        ]);
        assert.deepEqual(one(r), ['info: Gap Max (25) is probably not used (Check Mode: MinimumRequired)']);
        assert.deepEqual([...unusedParams(ruleHints([r])[0])], ['xyGapMax']);
        const m = rule('Gap', [
            value('xyGapMin', '1000'),
            value('xyGapMax', '1'),
            value('xyCheckMode', 'MaximumAllowed', 'Choice'),
        ]);
        assert.deepEqual(one(m), ['info: Gap Min (1000) is probably not used (Check Mode: MaximumAllowed)']);
    });

    it('limits: switch "Check Maximum" adds the maximum; both used and min above max: to check; mode and switch at odds: noted', () => {
        const both = rule('Gap', [
            value('xyGapMin', '3000'),
            value('xyGapMax', '265'),
            value('xyCheckMode', 'MinimumRequired', 'Choice'),
            value('xyCheckMaximumGap', 'true', 'Switch'),
        ]);
        assert.deepEqual(one(both), ['error: Gap Min (3000) is above Gap Max (265)']);
        const odd = rule('Gap', [
            value('xyGapMin', '10'),
            value('xyGapMax', '20'),
            value('xyCheckMode', 'MaximumAllowed', 'Choice'),
            value('xyCheckMaximumGap', 'false', 'Switch'),
        ]);
        assert.deepEqual(one(odd), [
            'info: Gap Min (10) is probably not used (Check Mode: MaximumAllowed)',
            'warning: Check Mode is MaximumAllowed, but Check Maximum Gap is off',
        ]);
        assert.deepEqual(one(rule('Gap', [value('xyGapMin', '5'), value('xyGapMax', '9')])), []); // no mode: both used
    });

    it('name and values: minimum / maximum, lengths (mm, cm, m; values in millimetres or metres)', () => {
        const limits = (mode: string, min: string, max: string) => [
            value('xyGapMin', min),
            value('xyGapMax', max),
            value('xyCheckMode', mode, 'Choice'),
        ];
        assert.deepEqual(
            one(rule('Gap 85 mm (min)', limits('MinimumRequired', '85', '25'))).filter((t) => t.startsWith('warning')),
            [],
        );
        assert.deepEqual(
            one(rule('Gap 8,5 cm (min)', limits('MinimumRequired', '85', '0'))).filter((t) => t.startsWith('warning')),
            [],
        );
        assert.deepEqual(
            one(rule('Gap 0.9 m (min)', limits('MinimumRequired', '0.9', '0'))).filter((t) => t.startsWith('warning')),
            [],
        );
        assert.deepEqual(
            one(rule('Gap 85mm (min)', limits('MinimumRequired', '25', '85'))).filter((t) => t.startsWith('warning')),
            ['warning: the name says 85mm, the rule checks Gap Min 25'],
        );
        assert.deepEqual(
            one(rule('Gap 85 mm (Minimum)', limits('MaximumAllowed', '85', '85'))).filter((t) =>
                t.startsWith('warning'),
            ),
            ['warning: the name says minimum, but the rule checks Gap Max'],
        );
        assert.deepEqual(
            one(rule('Gap höchstens 2 m', limits('MinimumRequired', '2000', '0'))).filter((t) =>
                t.startsWith('warning'),
            ),
            ['warning: the name says maximum, but the rule checks Gap Min'],
        );
        assert.deepEqual(
            one(rule('Room 12 (min)', limits('MinimumRequired', '5', '0'))).filter((t) => t.startsWith('warning')),
            [],
        ); // no length
    });

    it('filters: the same components included and excluded; empty filters', () => {
        const r = rule('Gap', [
            filter('xyOther', row('include', 'Shelf', ['A']), row('exclude', 'Shelf', ['A'])),
            filter('xyRoom'),
        ]);
        assert.deepEqual(one(r), ['error: Other includes and excludes the same components', 'info: Room is empty']);
    });

    it('housekeeping: switched off, no explanation', () => {
        assert.deepEqual(one(rule('Gap', [], { enabled: false, description: '' })), [
            'info: switched off: not part of the checks',
            'info: no explanation',
        ]);
    });

    it('across rules: same values under two names; same filters with limits that cannot both hold', () => {
        const a = rule('A', [value('xyGapMin', '1')]);
        const b = { ...rule('B', [value('xyGapMin', '1')]), path: ['Folder'] };
        const [ha, hb] = ruleHints([a, b]).map(texts);
        assert.deepEqual(ha, ['warning: same type and values as “B” (Folder)']);
        assert.deepEqual(hb, ['warning: same type and values as “A”']);
        const min = rule('Min', [
            value('xyGapMin', '85'),
            value('xyGapMax', '0'),
            value('xyCheckMode', 'MinimumRequired', 'Choice'),
        ]);
        const max = rule('Max', [
            value('xyGapMin', '0'),
            value('xyGapMax', '25'),
            value('xyCheckMode', 'MaximumAllowed', 'Choice'),
        ]);
        const [hmin, hmax] = ruleHints([min, max]).map((h: { level: string; text: string }[]) =>
            texts(h).filter((t) => t.startsWith('error')),
        );
        assert.deepEqual(hmin, ['error: cannot both hold: Gap Min 85 here, Gap Max 25 in “Max” (same filters)']);
        assert.deepEqual(hmax, ['error: cannot both hold: Gap Max 25 here, Gap Min 85 in “Min” (same filters)']);
        const other = { ...max, params: [filter('xyFrom', row('include', 'Door')), ...max.params.slice(1)] };
        assert.deepEqual(
            texts(ruleHints([min, other])[0]).filter((t) => t.startsWith('error')),
            [],
        ); // other filters
    });
});
