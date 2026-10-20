import { ClickEvent, OutboxEvent } from '../models/index.js';
import { classifyEvent } from './botRules.js';
import { createOutboxProcessor } from './outboxProcessorCore.js';

const defaultProcessor = createOutboxProcessor({ ClickEventModel: ClickEvent, OutboxEventModel: OutboxEvent, classify: classifyEvent });
export const processEvent = defaultProcessor.processEvent;
export const processPendingOutboxBatch = defaultProcessor.processPendingOutboxBatch;

let inlineTimer = null;
let inlineBatchRunning = false;

// Render Free has no free background-worker service. The API process can safely
// drain the durable MongoDB outbox without Redis. Set INLINE_CLICK_PROCESSOR=false
// only when a dedicated worker is deployed and intentionally handles all events.
export function startInlineOutboxProcessor({ intervalMs = 1500, batchSize = 50 } = {}) {
  if (process.env.INLINE_CLICK_PROCESSOR === 'false') {
    console.log('Inline click processor disabled by INLINE_CLICK_PROCESSOR=false');
    return () => {};
  }
  if (inlineTimer) return () => clearInterval(inlineTimer);

  const tick = async () => {
    if (inlineBatchRunning) return;
    inlineBatchRunning = true;
    try {
      const result = await processPendingOutboxBatch({ limit: batchSize });
      if (result.processed > 0) console.log(`Classified ${result.processed} click event(s) from MongoDB outbox`);
    } catch (err) {
      console.error('Inline click processor failed; MongoDB outbox remains durable:', err?.message || err);
    } finally {
      inlineBatchRunning = false;
    }
  };

  void tick();
  inlineTimer = setInterval(tick, intervalMs);
  inlineTimer.unref?.();
  console.log(`Inline MongoDB click processor started (${intervalMs}ms polling; ${batchSize} events/batch)`);
  return () => {
    if (inlineTimer) clearInterval(inlineTimer);
    inlineTimer = null;
  };
}
