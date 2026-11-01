// Simple flowcharts (without Mermaid): the plain part of Mermaid's flowchart syntax; anything else refused

import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { parseFlowchart } = await load('view/flowchart.ts');

describe('view/flowchart', () => {
    it('nodes in their shapes, labels with entities and breaks, edges with text, chains', () => {
        const chart = parseFlowchart(
            'flowchart TB\n  %% note\n  a["One #quot;1#quot;<br/>#35;2"] -->|yes| b(Two)\n  b --- c{Three} --> d\n  a --> d([Four])',
        );
        assert.equal(chart.dir, 'TD');
        assert.deepEqual(
            [...chart.nodes.values()].map((n: { id: string; text: string; shape: string }) => [n.id, n.text, n.shape]),
            [
                ['a', 'One "1"\n#2', '['],
                ['b', 'Two', '('],
                ['c', 'Three', '{'],
                ['d', 'Four', '(['],
            ],
        );
        assert.deepEqual(
            chart.edges.map((e: { from: string; to: string; text: string; arrow: boolean }) => [
                e.from,
                e.to,
                e.text,
                e.arrow,
            ]),
            [
                ['a', 'b', 'yes', true],
                ['b', 'c', '', false],
                ['c', 'd', '', true],
                ['a', 'd', '', true],
            ],
        );
    });

    it('other diagrams and syntax not known here: null (the source stays shown)', () => {
        assert.equal(parseFlowchart('sequenceDiagram\n  A->>B: hi'), null);
        assert.equal(parseFlowchart('flowchart LR\n  subgraph x\n  a --> b\n  end'), null);
        assert.equal(parseFlowchart('flowchart LR'), null);
    });
});
