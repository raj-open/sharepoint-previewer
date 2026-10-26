// Linters: text -> { problems: [{ line, msg, severity }], info? }

// ===========================================================================
// IMPORTS
// ===========================================================================

import { MAX_PROBLEMS } from '../../_core/settings.ts';

import type { Problem } from '../../_core/types.ts';

// ===========================================================================
// METHODS
// ===========================================================================

/** @returns 1-based line */
export const lineAt = (text: string, index: number): number => {
    let n = 1;
    for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) n++;
    return n;
};

// Collect problems (at most MAX_PROBLEMS)
export function collector(): {
    problems: Problem[];
    add: (line: number, msg: string, severity?: 'error' | 'warning') => void;
} {
    const problems: Problem[] = [];
    const add = (line: number, msg: string, severity: 'error' | 'warning' = 'error') => {
        if (problems.length < MAX_PROBLEMS) problems.push({ line, msg, severity });
    };
    return { problems, add };
}
