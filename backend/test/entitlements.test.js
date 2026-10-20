import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPlan } from '../src/middleware/entitlements.js';

test('free users have only the free entitlement level', () => {
  assert.equal(hasPlan({ role: 'user', plan: 'free' }, 'pro'), false);
  assert.equal(hasPlan({ role: 'user', plan: 'free' }, 'growth'), false);
  assert.equal(hasPlan({ role: 'user', plan: 'free' }, 'free'), true);
});

test('Pro grants Pro features but not Growth-only features', () => {
  assert.equal(hasPlan({ role: 'user', plan: 'pro' }, 'pro'), true);
  assert.equal(hasPlan({ role: 'user', plan: 'pro' }, 'growth'), false);
});

test('Growth and administrators can pass tier checks', () => {
  assert.equal(hasPlan({ role: 'user', plan: 'growth' }, 'pro'), true);
  assert.equal(hasPlan({ role: 'user', plan: 'growth' }, 'growth'), true);
  assert.equal(hasPlan({ role: 'admin', plan: 'free' }, 'growth'), true);
});
