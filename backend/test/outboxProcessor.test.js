import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutboxProcessor } from '../src/services/outboxProcessorCore.js';

function queryReturning(value) {
  return { select: async () => value };
}

test('processor classifies ordinary events and marks their outbox row processed', async () => {
  const event = { eventId: 'evt-1', botClass: 'unknown', isQualifiedClick: false, saveCalls: 0, async save() { this.saveCalls += 1; } };
  const calls = { outboxUpdate: null, classify: 0 };
  const processor = createOutboxProcessor({
    ClickEventModel: { findOne: () => queryReturning(event) },
    OutboxEventModel: { updateOne: async (...args) => { calls.outboxUpdate = args; } },
    classify: async () => { calls.classify += 1; return { botClass: 'likely_human', isQualifiedClick: true, detectionReasons: ['no_automation_signals_detected'] }; },
    logger: { error() {} }
  });

  await processor.processEvent('evt-1');
  assert.equal(calls.classify, 1);
  assert.equal(event.botClass, 'likely_human');
  assert.equal(event.isQualifiedClick, true);
  assert.equal(event.saveCalls, 1);
  assert.equal(calls.outboxUpdate[0].eventId, 'evt-1');
  assert.equal(calls.outboxUpdate[1].$set.status, 'processed');
});

test('processor does not promote known bots to qualified clicks', async () => {
  const event = { eventId: 'evt-bot', botClass: 'known_bot', isQualifiedClick: false, save() { throw new Error('known bot should not be reclassified'); } };
  let classifyCalls = 0;
  const processor = createOutboxProcessor({
    ClickEventModel: { findOne: () => queryReturning(event) },
    OutboxEventModel: { updateOne: async () => {} },
    classify: async () => { classifyCalls += 1; throw new Error('must not classify known bot'); },
    logger: { error() {} }
  });

  await processor.processEvent('evt-bot');
  assert.equal(classifyCalls, 0);
});

test('batch retries a missing event and records an error without crashing', async () => {
  const updates = [];
  const pendingQuery = {
    sort() { return this; },
    limit() { return this; },
    async lean() { return [{ _id: 'outbox-1', eventId: 'missing-event' }]; }
  };
  const processor = createOutboxProcessor({
    ClickEventModel: { findOne: () => queryReturning(null) },
    OutboxEventModel: { find: () => pendingQuery, updateOne: async (...args) => { updates.push(args); } },
    classify: async () => { throw new Error('classification should not be reached'); },
    logger: { error() {} }
  });

  const result = await processor.processPendingOutboxBatch();
  assert.deepEqual(result, { scanned: 1, processed: 0 });
  assert.equal(updates[0][0]._id, 'outbox-1');
  assert.equal(updates[0][1].$inc.attempts, 1);
  assert.match(updates[0][1].$set.lastError, /Click event not found/);
});
