/**
 * Account deletion must remove everything (§1.5, audit F1).
 *
 * The class of bug — a new user-scoped table that `deleteMe` forgets, orphaning a user's
 * rows forever — is made impossible here: the user-scoped tables are read from schema.sql,
 * and `deleteMe`'s source must DELETE from every one. A table added without its delete fails
 * this the day its schema lands. The api-tests suite proves the same thing against real D1.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const schema = read('worker/schema.sql');
const deleteMeSrc = read('worker/src/api/me.js');

/** Every table with a user_id column — everywhere a user's data can live. */
function userScopedTables(sql) {
  return [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g)]
    .filter(([, , body]) => /\buser_id\b/.test(body))
    .map(([, name]) => name);
}

describe('account deletion coverage (F1)', () => {
  const tables = userScopedTables(schema);

  it('recognises the user-scoped tables, including practice_events', () => {
    expect(tables).toEqual(
      expect.arrayContaining(['review_events', 'practice_events', 'custom_words', 'sessions']),
    );
  });

  it('deleteMe deletes from every user-scoped table, plus the user row', () => {
    for (const table of tables) {
      expect(
        deleteMeSrc,
        `deleteMe must "DELETE FROM ${table} WHERE user_id = ?" — a new user-scoped table needs adding to the §1.5 deletion batch`,
      ).toMatch(new RegExp(`DELETE FROM ${table} WHERE user_id`));
    }
    expect(deleteMeSrc).toMatch(/DELETE FROM users WHERE id/);
  });
});
