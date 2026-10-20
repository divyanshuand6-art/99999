export function createOutboxProcessor({
  ClickEventModel,
  OutboxEventModel,
  classify,
  logger = console
} = {}) {
  if (!ClickEventModel || !OutboxEventModel || typeof classify !== 'function') {
    throw new TypeError('ClickEventModel, OutboxEventModel, and classify are required');
  }
  async function processEvent(eventId) {
    const eventQuery = ClickEventModel.findOne({ eventId });
    const event = await eventQuery.select('+userAgent');
    if (!event) throw new Error(`Click event not found for outbox event ${eventId}`);

    // Keep known bots and high-frequency automation excluded. Only the shared
    // rule classifier can promote an unknown event to a qualified click.
    if (event.botClass !== 'known_bot' && event.botClass !== 'suspected_automation' && !event.isQualifiedClick) {
      const result = await classify(event, ClickEventModel);
      event.botClass = result.botClass;
      event.isQualifiedClick = result.isQualifiedClick;
      event.detectionReasons = result.detectionReasons;
      await event.save();
    }

    await OutboxEventModel.updateOne(
      { eventId },
      { $set: { status: 'processed', processedAt: new Date(), lastError: '' } }
    );
  }

  async function processPendingOutboxBatch({ limit = 50 } = {}) {
    const pending = await OutboxEventModel.find({ status: { $in: ['pending', 'published'] } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    let processed = 0;
    for (const item of pending) {
      try {
        await processEvent(item.eventId);
        processed += 1;
      } catch (err) {
        await OutboxEventModel.updateOne(
          { _id: item._id },
          { $inc: { attempts: 1 }, $set: { lastError: String(err?.message || err).slice(0, 500) } }
        );
        logger.error?.('Click outbox processing failed; event remains retryable:', item.eventId, err?.message || err);
      }
    }
    return { scanned: pending.length, processed };
  }

  return { processEvent, processPendingOutboxBatch };
}

