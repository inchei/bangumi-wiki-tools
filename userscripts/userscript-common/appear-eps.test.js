import assert from 'node:assert/strict';
import { test } from 'node:test';
import { genAppearEps, parseAppearEps, sortAppearEps } from './appear-eps.js';

test('parses ranges, removes duplicates and sorts numeric labels before other labels', () => {
  assert.deepEqual(parseAppearEps('3-1, 2, SP, OP, -1, 5-4'), [
    '-1',
    '1',
    '2',
    '3',
    '4',
    '5',
    'OP',
    'SP',
  ]);
  assert.deepEqual(parseAppearEps(''), []);
  assert.deepEqual(parseAppearEps('SP-1, 2-x'), ['2-x', 'SP-1']);
});

test('generates compact ranges without losing nonnumeric labels', () => {
  assert.equal(genAppearEps(['3', '1', '2', '2', 'SP', 'OP']), '1-3,OP,SP');
  assert.equal(genAppearEps([]), '');
  assert.deepEqual(sortAppearEps(['SP', '3', '1']), ['1', '3', 'SP']);
});
