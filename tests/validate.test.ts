import { describe, test, expect } from 'vitest';
import { validateAndCap, SQLValidationError } from '../src/validate.js';

describe('validateAndCap', () => {
  test('SELECT is allowed and capped', () => {
    const out = validateAndCap('SELECT id, name FROM users', 100);
    expect(out.toUpperCase()).toContain('LIMIT 100');
    expect(out.toLowerCase()).toContain('from users');
  });

  test('WITH CTE is allowed', () => {
    const sql = "WITH active AS (SELECT id FROM users WHERE flg = 'A') SELECT count(*) FROM active";
    const out = validateAndCap(sql, 50);
    expect(out.toUpperCase()).toContain('LIMIT 50');
  });

  test('UNION is allowed', () => {
    const sql = 'SELECT id FROM a UNION SELECT id FROM b';
    const out = validateAndCap(sql, 10);
    expect(out.toUpperCase()).toContain('LIMIT 10');
  });

  test.each([
    ['INSERT INTO users (id) VALUES (1)'],
    ["UPDATE users SET name = 'x' WHERE id = 1"],
    ['DELETE FROM users WHERE id = 1'],
    ['DROP TABLE users'],
    ['CREATE TABLE t (id int)'],
    ['ALTER TABLE users ADD COLUMN x int'],
    ['TRUNCATE TABLE users'],
    ['GRANT SELECT ON users TO public'],
  ])('rejects mutation: %s', (sql) => {
    expect(() => validateAndCap(sql, 100)).toThrow(SQLValidationError);
  });

  test('multiple statements rejected', () => {
    expect(() => validateAndCap('SELECT 1; SELECT 2', 10)).toThrow(SQLValidationError);
  });

  test('unparseable rejected', () => {
    expect(() => validateAndCap('SELECT FROM WHERE', 10)).toThrow(SQLValidationError);
  });

  test('empty rejected', () => {
    expect(() => validateAndCap('   ', 10)).toThrow(SQLValidationError);
  });

  test('inner LIMIT overridden by outer cap', () => {
    const out = validateAndCap('SELECT * FROM users LIMIT 99999', 25);
    expect(out.toUpperCase()).toContain('LIMIT 25');
  });

  test('DML inside CTE rejected', () => {
    expect(() =>
      validateAndCap('WITH d AS (DELETE FROM users RETURNING id) SELECT * FROM d', 10),
    ).toThrow(SQLValidationError);
  });
});
