import { tokenise } from './tokenise.js';

/** @typedef {import('../../_core/types.js').Token} Token */

// SQL (any dialect)
const SQL_KEYWORDS = [
  'ADD',
  'ALL',
  'ALTER',
  'AND',
  'ANY',
  'AS',
  'ASC',
  'BEGIN',
  'BETWEEN',
  'BY',
  'CASCADE',
  'CASE',
  'CAST',
  'CHECK',
  'COLUMN',
  'COMMIT',
  'CONSTRAINT',
  'CREATE',
  'CROSS',
  'CURRENT',
  'DATABASE',
  'DECLARE',
  'DEFAULT',
  'DELETE',
  'DESC',
  'DISTINCT',
  'DROP',
  'ELSE',
  'END',
  'ESCAPE',
  'EXCEPT',
  'EXEC',
  'EXECUTE',
  'EXISTS',
  'FALSE',
  'FETCH',
  'FILTER',
  'FIRST',
  'FOR',
  'FOREIGN',
  'FROM',
  'FULL',
  'FUNCTION',
  'GRANT',
  'GROUP',
  'HAVING',
  'IF',
  'ILIKE',
  'IN',
  'INDEX',
  'INNER',
  'INSERT',
  'INTERSECT',
  'INTO',
  'IS',
  'JOIN',
  'KEY',
  'LAST',
  'LATERAL',
  'LEFT',
  'LIKE',
  'LIMIT',
  'MERGE',
  'NATURAL',
  'NOT',
  'NULL',
  'NULLS',
  'OFFSET',
  'ON',
  'OR',
  'ORDER',
  'OUTER',
  'OVER',
  'PARTITION',
  'PRIMARY',
  'PROCEDURE',
  'QUALIFY',
  'RECURSIVE',
  'REFERENCES',
  'REPLACE',
  'RETURN',
  'RETURNS',
  'REVOKE',
  'RIGHT',
  'ROLLBACK',
  'ROW',
  'ROWS',
  'SCHEMA',
  'SELECT',
  'SET',
  'TABLE',
  'TEMP',
  'TEMPORARY',
  'THEN',
  'TOP',
  'TRANSACTION',
  'TRIGGER',
  'TRUE',
  'TRUNCATE',
  'UNION',
  'UNIQUE',
  'UPDATE',
  'USE',
  'USING',
  'VALUES',
  'VIEW',
  'WHEN',
  'WHERE',
  'WINDOW',
  'WITH',
].join('|');
const SQL_TYPES =
  'BIGINT|BINARY|BIT|BLOB|BOOLEAN|BOOL|CHAR|CLOB|DATE|DATETIME|DATETIME2|DECIMAL|DOUBLE|FLOAT|' +
  'INT|INTEGER|INTERVAL|JSON|JSONB|MONEY|NCHAR|NUMBER|NUMERIC|NVARCHAR|REAL|SERIAL|SMALLINT|' +
  'STRING|TEXT|TIME|TIMESTAMP|TIMESTAMPTZ|TINYINT|UUID|VARBINARY|VARCHAR|VARCHAR2|XML';
const SQL_RE = new RegExp(
  [
    /(--[^\n]*|\/\*[\s\S]*?\*\/)/.source, // 1 comment
    /([NEeBbXx]?'(?:[^']|'')*'|\$\$[\s\S]*?\$\$)/.source, // 2 string (also N'..', $$..$$)
    /("(?:[^"]|"")*"|`[^`]*`|\[[^\]\n]*\])/.source, // 3 quoted name
    `\\b(${SQL_KEYWORDS})\\b`, // 4 keyword
    `\\b(${SQL_TYPES})\\b`, // 5 data type
    /([A-Za-z_][\w$]*)(?=\s*\()/.source, // 6 function
    /((?<![\w.])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.source, // 7 number
    /([@:$][A-Za-z_\d][\w$]*|\?)/.source, // 8 parameter / variable
    /(<>|<=|>=|!=|::|\|\||[-+*/%=<>~^&|!]|[(),;.])/.source, // 9 operator / punctuation
  ].join('|'),
  'gi',
);

const SQL_CLASSES = ['', 'com', 'str', 'key', 'kw', 'type', 'enum', 'num', 'anchor', 'punct'];
/** @param {string} text @returns {Token[]} */
export const highlightSql = (text) =>
  tokenise(text, SQL_RE, (m, out) => {
    const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
    out.push([SQL_CLASSES[i], m[0]]);
  });
