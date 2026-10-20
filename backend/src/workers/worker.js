import 'dotenv/config';
import { createClient } from 'redis';
import { connectDatabase } from '../config/db.js';
import { OutboxEvent } from '../models/index.js';
import { processEvent, processPendingOutboxBatch } from '../services/outboxProcessor.js';

const STREAM = 'linkpulse:click-events';
const GROUP = 'linkpulse-click-workers';
const CONSUMER = `worker-${process.pid}`;
// Redis Streams are used in deployment.  Local development can set
// USE_REDIS=false and process the durable MongoDB outbox directly.
const USE_REDIS = process.env.USE_REDIS !== 'false';
const redis = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
redis.on('error', err => console.error('Redis error:', err.message));

async function dispatchOutbox() {
  // MongoDB remains the source of truth. Re-publish stale outbox events that
  // were accepted by Redis but never marked processed (for example, after a
  // Redis restart on an ephemeral/free queue service). Duplicate delivery is
  // safe because click event classification is idempotent.
  const requeueBefore = new Date(Date.now() - 5 * 60 * 1000);
  const pending = await OutboxEvent.find({
    $or: [
      { status: 'pending' },
      { status: 'published', publishedAt: { $lt: requeueBefore } }
    ]
  }).sort({ createdAt: 1 }).limit(50).lean();
  for (const item of pending) {
    try {
      await redis.xAdd(STREAM, '*', { eventId: item.eventId });
      await OutboxEvent.updateOne(
        { _id: item._id, status: { $in: ['pending', 'published'] } },
        { $set: { status: 'published', publishedAt: new Date(), lastError: '' }, $inc: { attempts: 1 } }
      );
    } catch (err) {
      await OutboxEvent.updateOne({ _id: item._id, status: { $ne: 'processed' } }, { $inc: { attempts: 1 }, $set: { lastError: String(err.message).slice(0, 500) } });
      console.error('Outbox dispatch failed; event remains retryable:', item.eventId, err.message);
      break;
    }
  }
}

async function processMessage(message) {
  await processEvent(message.message.eventId);
  await redis.xAck(STREAM, GROUP, message.id);
}

async function processMongoOutbox() {
  await processPendingOutboxBatch({ limit: 50 });
}

async function ensureConsumerGroup() {
  try { await redis.xGroupCreate(STREAM, GROUP, '0', { MKSTREAM: true }); }
  catch (err) { if (!String(err.message).includes('BUSYGROUP')) throw err; }
}

async function main() {
  await connectDatabase();
  console.log(`LinkPulse click worker starting (${CONSUMER}, ${USE_REDIS ? 'Redis Streams' : 'MongoDB local outbox'})`);
  while (true) {
    try {
      if (!USE_REDIS) {
        await processMongoOutbox();
        await new Promise(resolve => setTimeout(resolve, 1500));
        continue;
      }
      if (!redis.isOpen) await redis.connect();
      if (!redis.isReady) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        continue;
      }
      await ensureConsumerGroup();
      await dispatchOutbox();
      const claimed = await redis.xAutoClaim(STREAM, GROUP, CONSUMER, 60_000, '0-0', { COUNT: 25 });
      for (const message of claimed.messages || []) {
        try { await processMessage(message); } catch (err) { console.error('Claimed event processing failed:', err.message); }
      }
      const batches = await redis.xReadGroup(GROUP, CONSUMER, [{ key: STREAM, id: '>' }], { COUNT: 25, BLOCK: 2000 });
      for (const batch of batches || []) for (const message of batch.messages) {
        try { await processMessage(message); } catch (err) { console.error('Event processing failed; message remains pending:', err.message); }
      }
    } catch (err) {
      console.error('Worker loop error; pending outbox events remain durable:', err.message);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
}
main().catch(err => { console.error(err); process.exit(1); });
