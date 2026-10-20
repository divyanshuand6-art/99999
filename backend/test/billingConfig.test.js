import test from 'node:test';
import assert from 'node:assert/strict';
import { mockBillingEnabled } from '../src/services/mockBillingConfig.js';

test('demo checkout is enabled only when explicitly enabled in production', () => {
  assert.equal(mockBillingEnabled({ NODE_ENV: 'production' }), false);
  assert.equal(mockBillingEnabled({ NODE_ENV: 'production', MOCK_BILLING_ENABLED: 'false' }), false);
  assert.equal(mockBillingEnabled({ NODE_ENV: 'production', MOCK_BILLING_ENABLED: 'true' }), true);
});

test('demo checkout remains enabled by default in development', () => {
  assert.equal(mockBillingEnabled({ NODE_ENV: 'development' }), true);
});
