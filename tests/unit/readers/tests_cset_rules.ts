// Solibri rulesets: rules read from the Java objects (by their fields), as Markdown with a flowchart each
// Fixture: /tests/mocks/mock-sharepoint/library/Rules/workshop.cset (ZIP), written by ObjectOutputStream:
// an invented ruleset (classes example.checks.*): folders, rules with filters (include / exclude / ignore),
// lengths, a switch, a choice, a table, texts in two languages, an explanation in HTML, a rule switched off

import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fixture } from '../helpers.ts';
import { load } from '../helpers.ts';
import { reader } from '../helpers.ts';
import { serve } from '../helpers.ts';

const { readJava } = await load('readers/java.ts');
const { zipEntries, zipEntryBytes } = await load('readers/zip.ts');
const { csetRules, plainText } = await load('readers/cset/rules.ts');
const { rulesMarkdown, ruleMermaid, rowText } = await load('readers/cset/diagram.ts');
const { paramName } = await load('readers/cset/rules.ts');
const { openCsetSource } = await load('readers/cset/index.ts');
const { parseFlowchart } = await load('view/flowchart.ts');

const file = fixture('Rules/workshop.cset');
const { read } = reader(file);
const [entry] = await zipEntries(read, file.length);
const rules = csetRules(readJava(await zipEntryBytes(read, entry)).roots);
const byName = (name: string) => rules.find((r: { name: string }) => r.name === name);

describe('readers/cset/rules', () => {
    it('rules in the order of their folders, below the ruleset; names in the default language', () => {
        assert.deepEqual(
            rules.map((r: { path: string[]; name: string; type: string; enabled: boolean }) => [
                r.path.join(' / '),
                r.name,
                r.type,
                r.enabled,
            ]),
            [
                ['Power', 'Cables carry a label', 'LabelCheck', true],
                ['Power', 'Cable trays keep 300 mm apart', 'ClearanceCheck', true],
                ['Access', 'Aisles wide enough', 'ClearanceCheck', false],
                ['Access', 'Doors keep shelves at a distance', 'ClearanceCheck', true],
                ['Access', 'Ladders keep 900 mm from cables (min)', 'ClearanceCheck', true],
                ['Access', 'Aisles wide enough (copy)', 'ClearanceCheck', false],
                ['', 'Every part named', 'LabelCheck', true],
            ],
        );
    });

    it('parameters: filter rows, values, choices, tables; explanation as plain text', () => {
        const rule = byName('Doors keep shelves at a distance');
        assert.equal(rule.description, 'Shelves stay clear of doors.\nMeasured & reported.');
        const [from, to, min, max, sides, measure] = rule.params;
        assert.deepEqual(from.rows, [
            { state: 'include', subject: 'Shelf', property: 'Stock.Code', operator: '#3', values: ['SH-*', 'RK-*'] },
            { state: 'exclude', subject: 'Shelf', property: 'Stock.Mobile', operator: '#1', values: ['yes'] },
        ]);
        assert.deepEqual(to.rows, [{ state: 'include', subject: 'Door', property: 'label', operator: '', values: [] }]);
        assert.deepEqual(
            [min, max, sides, measure].map((p: { id: string; kind: string; value: string }) => [p.id, p.kind, p.value]),
            [
                ['ckGapMin', 'Length', '0.8'],
                ['ckGapMax', 'Length', '4.5'],
                ['ckBothSides', 'Switch', 'true'],
                ['ckMeasure', 'Choice', 'edge to edge'],
            ],
        );
        assert.equal(byName('Cables carry a label').params[1].value, 'Circuit | C-##; Phase | L1|L2|L3');
        assert.equal(plainText('<p>a &amp; b</p><p>c&#33;</p>'), 'a & b\nc!');
    });

    it('Markdown: rules at the top first, folders as level 1, a section with flowchart and table per rule', () => {
        const md = rulesMarkdown(rules);
        assert.match(md, /^7 rules in 2 folders, 2 switched off\./);
        assert.match(md, /> \[!NOTE\]\n> 1 rule with errors, 3 rules with warnings: marked in the list/);
        const heads = md.match(/^#{1,2} .*$/gm);
        assert.deepEqual(heads, [
            '## Every part named',
            '# Power',
            '## Cables carry a label',
            '## Cable trays keep 300 mm apart',
            '# Access',
            '## Aisles wide enough',
            '## Doors keep shelves at a distance',
            '## Ladders keep 900 mm from cables (min)',
            '## Aisles wide enough (copy)',
        ]);
        assert.match(
            md,
            /## Ladders keep 900 mm from cables \(min\)\n\n`ClearanceCheck` · on\n\n> \[!WARNING\]\n> - the name says 900 mm, the rule checks Gap Min 0\.6\n\n> \[!NOTE\]\n> - Gap Max \(0\.3\) is probably not used/,
        );
        assert.match(md, /\| Gap Max \| 0\.3 \*\(probably not used\)\* \|/);
        assert.match(md, /Gap Max: 0\.3 \(probably not used\)/); // in the diagram
        assert.match(md, /\| Labels \| Circuit \\\| C-\\#\\#; Phase \\\| L1\\\|L2\\\|L3 \|/); // marks taken literally
        assert.match(md, /> Shelves stay clear of doors\.\n> Measured & reported\./);
        assert.match(md, /```mermaid\nflowchart LR\n/);
    });

    it('Mermaid: filters into the rule, filters "to" out of it; labels escaped; readable by the simple drawing', () => {
        const src = ruleMermaid(byName('Doors keep shelves at a distance'));
        assert.match(src, /rule\("Doors keep shelves at a distance<br\/>Gap Min: 0\.8<br\/>/);
        assert.match(src, /f0\["From<br\/>\+ Shelf · Stock\.Code op 3: SH-\*, RK-\*<br\/>− Shelf/);
        assert.match(src, /f0 --> rule\n.*\n {4}rule --> f1/);
        assert.match(ruleMermaid(byName('Aisles wide enough')), /Aisles wide enough \(switched off\)/);
        assert.match(ruleMermaid(byName('Cables carry a label')), /C-#35;#35;/);
        for (const rule of rules) {
            const chart = parseFlowchart(ruleMermaid(rule));
            assert.ok(chart?.nodes.has('rule'), rule.name);
        }
        assert.equal(rowText({ state: 'ignore', subject: 'A', property: '', operator: '', values: [] }), '○ A');
        assert.equal(paramName('xyShelfGapMax'), 'Shelf Gap Max');
        assert.equal(paramName('TopLimitLevel'), 'Top Limit Level');
    });

    it('source: rules first (Markdown with a navigator), then overview and parts', async () => {
        serve({ '/w.cset': file });
        const src = await openCsetSource(
            '/w.cset',
            () => new AbortController().signal,
            false,
            () => {},
        );
        const [parts] = src.parts;
        assert.deepEqual(
            parts.items.map((p: { name: string; lang: string | null; nav?: boolean }) => [p.name, p.lang, !!p.nav]),
            [
                ['Overview', 'md', false],
                ['Rules', 'md', true],
                ['Workshop checks.cset', 'json', false],
            ],
        );
        assert.deepEqual(src.part, { list: 0, item: 1 });
        assert.match(parts.items[1].note, /^7 rules/);
    });
});
