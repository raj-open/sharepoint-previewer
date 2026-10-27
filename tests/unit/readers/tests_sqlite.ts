// SQLite database file: tables by name, columns as created, values of every kind, big tables and overflow pages
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'node:test';
import { it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { load } from '../helpers.ts';

const { sqliteDatabase, columnsOf } = await load('readers/sqlite.ts');

// Database file written by SQLite itself
function database(sql: string, pageSize = 4096): Uint8Array {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-')), 'test.db');
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA page_size = ${pageSize}; ${sql}`);
    db.close();
    const bytes = new Uint8Array(fs.readFileSync(file));
    fs.rmSync(path.dirname(file), { recursive: true });
    return bytes;
}

describe('readers/sqlite', () => {
    it('values: integers (all sizes, negative), reals, text, blobs, NULL, 0 and 1', () => {
        const db = sqliteDatabase(
            database(`
                CREATE TABLE v (a INTEGER, b REAL, c TEXT, d BLOB);
                INSERT INTO v VALUES (0, 1.5, 'äöü €', x'00ff10'), (1, -2.25, '', NULL);
                INSERT INTO v VALUES (-1, 0, NULL, x''), (300, 1e300, 'x', NULL), (-70000, NULL, NULL, NULL);
                INSERT INTO v VALUES (123456789012, NULL, NULL, NULL), (-9007199254740991, NULL, NULL, NULL);
            `),
        );
        const rows = db.rows('v');
        assert.deepEqual(
            rows.map((r) => r.a),
            [0, 1, -1, 300, -70000, 123456789012, -9007199254740991],
        );
        assert.deepEqual(rows[0], { a: 0, b: 1.5, c: 'äöü €', d: new Uint8Array([0, 255, 16]) });
        assert.deepEqual(rows[1], { a: 1, b: -2.25, c: '', d: null });
        assert.equal(rows[3].b, 1e300);
        assert.deepEqual(rows[2].d, new Uint8Array(0));
    });

    it('rowid aliases: INTEGER PRIMARY KEY, and PRIMARY KEY("ID" ASC) as in Power BI models', () => {
        const db = sqliteDatabase(
            database(`
                CREATE TABLE [Table]( [ID] INTEGER ,  [Name] TEXT ,  PRIMARY KEY("ID" ASC) );
                INSERT INTO [Table] VALUES (12, 'ABC'), (337, 'H$ABC (12)$Col1 (25)');
                CREATE TABLE "with key" (id INTEGER PRIMARY KEY, "na""me" TEXT);
                INSERT INTO "with key" VALUES (5, 'five');
                CREATE TABLE plain (x TEXT, y INT);
                INSERT INTO plain VALUES ('a', 7);
            `),
        );
        assert.deepEqual(db.rows('table'), [
            { ID: 12, Name: 'ABC' },
            { ID: 337, Name: 'H$ABC (12)$Col1 (25)' },
        ]);
        assert.deepEqual(db.rows('With Key'), [{ id: 5, 'na"me': 'five' }]);
        assert.deepEqual(db.rows('plain'), [{ x: 'a', y: 7 }]);
        assert.equal(db.rows('missing'), null);
        assert.deepEqual(db.tables().sort(), ['plain', 'table', 'with key']);
    });

    it('big tables (interior pages) and long texts (overflow pages), small pages', () => {
        const long = 'M code '.repeat(5000);
        const rows = Array.from({ length: 2000 }, (_, i) => `(${i}, 'row ${i}')`).join(', ');
        const db = sqliteDatabase(
            database(
                `
                CREATE TABLE t (id INTEGER PRIMARY KEY, s TEXT);
                INSERT INTO t VALUES ${rows};
                CREATE TABLE e (Name TEXT, Expression TEXT);
                INSERT INTO e VALUES ('long', '${long}'), ('short', 'let x = 1 in x');
            `,
                1024,
            ),
        );
        const t = db.rows('t');
        assert.equal(t.length, 2000);
        assert.deepEqual(t[1999], { id: 1999, s: 'row 1999' });
        assert.equal(db.rows('e')[0].Expression, long);
        assert.equal(db.rows('e')[1].Expression, 'let x = 1 in x');
    });

    it('UTF-16 databases', () => {
        const db = sqliteDatabase(
            database(`PRAGMA encoding = 'UTF-16le'; CREATE TABLE u (s TEXT); INSERT INTO u VALUES ('Grüße');`),
        );
        assert.deepEqual(db.rows('u'), [{ s: 'Grüße' }]);
    });

    it('columns of CREATE TABLE: quoting, types with brackets, table constraints', () => {
        assert.deepEqual(
            columnsOf('CREATE TABLE x ("a b" TEXT, [c] DECIMAL(10, 2), `d`, e INTEGER PRIMARY KEY, UNIQUE (c))'),
            {
                columns: ['a b', 'c', 'd', 'e'],
                rowid: 3,
            },
        );
        assert.deepEqual(columnsOf('CREATE TABLE y (id INTEGER PRIMARY KEY DESC, v)').rowid, -1);
        assert.deepEqual(columnsOf('CREATE TABLE z (id TEXT, PRIMARY KEY (id))').rowid, -1); // not INTEGER: no alias
    });

    it('not a database', () => {
        assert.throws(() => sqliteDatabase(new TextEncoder().encode('just some text, nothing more')), /not an SQLite/);
    });
});
