import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ClickEvent, Link, Campaign } from '../models/index.js';
import { authenticate } from '../middleware/auth.js';
import { hasPlan } from '../middleware/entitlements.js';

const router = Router();
router.use(authenticate);
const rangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  campaignId: z.string().optional()
});
const RETENTION_DAYS = { free: 30, pro: 90, growth: 365 };

function withinPlanRetention(req, res, from, now = new Date()) {
  if (req.user.role === 'admin') return true;
  const days = RETENTION_DAYS[req.user.plan] || RETENTION_DAYS.free;
  const oldest = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  if (from < oldest) {
    const upgradeMessage = req.user.plan === 'free'
      ? 'Upgrade to Pro or Growth to view more history.'
      : req.user.plan === 'pro'
        ? 'Upgrade to Growth to view more history.'
        : 'The demo Growth plan includes up to 365 days of history.';
    res.status(403).json({
      code: req.user.plan === 'growth' ? 'ANALYTICS_RETENTION_LIMIT' : 'PLAN_UPGRADE_REQUIRED',
      requiredPlan: req.user.plan === 'free' ? 'pro' : req.user.plan === 'pro' ? 'growth' : null,
      error: `Your ${req.user.plan || 'Free'} plan includes ${days} days of analytics history. ${upgradeMessage}`
    });
    return false;
  }
  return true;
}

function ownerScope(user) {
  return user.role === 'admin' ? {} : { ownerId: user._id };
}

router.get('/overview', async (req, res, next) => {
  try {
    const input = rangeSchema.parse(req.query);
    const now = new Date();
    const from = input.from ? new Date(input.from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const to = input.to ? new Date(input.to) : now;
    if (from > to || to > now) return res.status(400).json({ error: '`from` must be before `to` and `to` cannot be in the future' });
    if (!withinPlanRetention(req, res, from, now)) return;

    const ownerFilter = ownerScope(req.user);
    const linkFilter = { ...ownerFilter, archivedAt: null };
    let campaignObjectId = null;
    if (input.campaignId) {
      if (!mongoose.isValidObjectId(input.campaignId)) return res.status(400).json({ error: 'Invalid campaignId' });
      const campaign = await Campaign.findById(input.campaignId);
      if (!campaign || (req.user.role !== 'admin' && String(campaign.ownerId) !== String(req.user._id))) return res.status(404).json({ error: 'Campaign not found' });
      campaignObjectId = campaign._id;
      linkFilter.campaignId = campaign._id;
    }
    const eventFilter = {
      ...ownerFilter,
      clickedAt: { $gte: from, $lte: to },
      ...(campaignObjectId ? { campaignId: campaignObjectId } : {})
    };

    const [totalLinks, activeLinks, disabledLinks, expiredLinks, redirectTotals, clickStats, daily, topLinks, traffic, topReferrers, topDevices, topCountries] = await Promise.all([
      Link.countDocuments(linkFilter),
      Link.countDocuments({ ...linkFilter, status: 'active', $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }),
      Link.countDocuments({ ...linkFilter, status: 'disabled' }),
      Link.countDocuments({ ...linkFilter, status: 'active', expiresAt: { $ne: null, $lte: now } }),
      Link.aggregate([
        { $match: campaignObjectId ? { ...ownerFilter, campaignId: campaignObjectId } : ownerFilter },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$clickCount', 0] } } } },
        { $project: { _id: 0, total: 1 } }
      ]),
      ClickEvent.aggregate([
        { $match: eventFilter },
        { $group: {
          _id: null,
          total: { $sum: 1 },
          humanQualified: { $sum: { $cond: ['$isQualifiedClick', 1, 0] } },
          bots: { $sum: { $cond: [{ $eq: ['$botClass', 'known_bot'] }, 1, 0] } },
          suspected: { $sum: { $cond: [{ $eq: ['$botClass', 'suspected_automation'] }, 1, 0] } },
          unknown: { $sum: { $cond: [{ $eq: ['$botClass', 'unknown'] }, 1, 0] } },
          uniqueVisitors: { $addToSet: { $cond: ['$isQualifiedClick', '$visitorHash', null] } }
        } },
        { $project: { _id: 0, total: 1, humanQualified: 1, bots: 1, suspected: 1, unknown: 1, uniqueVisitors: { $size: { $filter: { input: '$uniqueVisitors', as: 'v', cond: { $ne: ['$$v', null] } } } } } }
      ]),
      ClickEvent.aggregate([
        { $match: { ...eventFilter, isQualifiedClick: true } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$clickedAt', timezone: 'UTC' } }, clicks: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      ClickEvent.aggregate([
        { $match: { ...eventFilter, isQualifiedClick: true } },
        { $group: { _id: '$linkId', clicks: { $sum: 1 } } }, { $sort: { clicks: -1 } }, { $limit: 10 },
        { $lookup: { from: 'links', localField: '_id', foreignField: '_id', as: 'link' } }, { $unwind: '$link' },
        { $project: { _id: 0, linkId: '$_id', code: '$link.code', title: '$link.title', clicks: 1, totalRedirectsAllTime: '$link.clickCount' } }
      ]),
      ClickEvent.aggregate([{ $match: eventFilter }, { $group: { _id: '$botClass', count: { $sum: 1 } } }]),
      ClickEvent.aggregate([
        { $match: { ...eventFilter, isQualifiedClick: true } },
        { $group: { _id: { $cond: [{ $or: [{ $eq: ['$referrerDomain', null] }, { $eq: ['$referrerDomain', ''] }] }, 'Direct / unknown', '$referrerDomain'] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 5 }
      ]),
      ClickEvent.aggregate([{ $match: { ...eventFilter, isQualifiedClick: true } }, { $group: { _id: '$deviceType', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 }]),
      ClickEvent.aggregate([
        { $match: { ...eventFilter, isQualifiedClick: true, country: { $nin: [null, ''] } } },
        { $group: { _id: '$country', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 }
      ])
    ]);
    const totals = clickStats[0] || { total: 0, humanQualified: 0, bots: 0, suspected: 0, unknown: 0, uniqueVisitors: 0 };
    totals.allTimeRedirects = Number(redirectTotals[0]?.total || 0);
    res.json({
      period: { from, to, timezone: 'UTC' },
      links: { total: totalLinks, active: activeLinks, disabled: disabledLinks, expired: expiredLinks, totalRedirectsAllTime: totals.allTimeRedirects },
      clicks: totals, daily, topLinks, trafficClassification: traffic, referrers: topReferrers, devices: topDevices, countries: topCountries
    });
  } catch (err) { next(err); }
});

router.get('/campaigns', async (req, res, next) => {
  try {
    const now = new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const to = req.query.to ? new Date(String(req.query.to)) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to || to > now) return res.status(400).json({ error: 'Invalid date range' });
    if (!withinPlanRetention(req, res, from, now)) return;
    const ownerFilter = ownerScope(req.user);
    const [campaignRows, eventRows, linkCounts] = await Promise.all([
      Campaign.find(ownerFilter).select('_id name description createdAt archivedAt').sort({ createdAt: -1 }).lean(),
      ClickEvent.aggregate([
        { $match: { ...ownerFilter, clickedAt: { $gte: from, $lte: to }, campaignId: { $ne: null } } },
        { $group: {
          _id: '$campaignId',
          totalClicks: { $sum: 1 },
          humanQualifiedClicks: { $sum: { $cond: ['$isQualifiedClick', 1, 0] } },
          knownBots: { $sum: { $cond: [{ $eq: ['$botClass', 'known_bot'] }, 1, 0] } },
          suspectedAutomation: { $sum: { $cond: [{ $eq: ['$botClass', 'suspected_automation'] }, 1, 0] } },
          visitors: { $addToSet: { $cond: ['$isQualifiedClick', '$visitorHash', null] } }
        } }
      ]),
      Link.aggregate([
        { $match: { ...ownerFilter, campaignId: { $ne: null } } },
        { $group: { _id: '$campaignId', totalLinks: { $sum: { $cond: [{ $eq: ['$archivedAt', null] }, 1, 0] } }, totalRedirectsAllTime: { $sum: { $ifNull: ['$clickCount', 0] } } } }
      ])
    ]);
    const eventMap = new Map(eventRows.map(row => [String(row._id), {
      totalClicks: row.totalClicks || 0,
      humanQualifiedClicks: row.humanQualifiedClicks || 0,
      knownBots: row.knownBots || 0,
      suspectedAutomation: row.suspectedAutomation || 0,
      uniqueVisitors: (row.visitors || []).filter(value => value !== null).length
    }]));
    const linkMap = new Map(linkCounts.map(row => [String(row._id), row]));
    const campaigns = campaignRows.map(campaign => {
      const key = String(campaign._id);
      return {
        campaignId: campaign._id,
        name: campaign.name,
        description: campaign.description,
        archivedAt: campaign.archivedAt || null,
        ...({ totalLinks: linkMap.get(key)?.totalLinks || 0, totalRedirectsAllTime: linkMap.get(key)?.totalRedirectsAllTime || 0 }),
        ...(eventMap.get(key) || { totalClicks: 0, humanQualifiedClicks: 0, knownBots: 0, suspectedAutomation: 0, uniqueVisitors: 0 })
      };
    }).sort((a, b) => b.humanQualifiedClicks - a.humanQualifiedClicks);
    res.json({ period: { from, to, timezone: 'UTC' }, campaigns });
  } catch (err) { next(err); }
});

// Basic analytics are available on every plan. Higher tiers unlock longer history
// and the detailed device/browser/referrer/country breakdowns, enforced here too.
router.get('/links/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Link not found' });
    const link = await Link.findById(req.params.id).select('_id ownerId code title campaignId clickCount createdAt status expiresAt clickLimit');
    if (!link || (req.user.role !== 'admin' && String(link.ownerId) !== String(req.user._id))) return res.status(404).json({ error: 'Link not found' });

    const now = new Date();
    const days = req.user.role === 'admin' ? 365 : (RETENTION_DAYS[req.user.plan] || RETENTION_DAYS.free);
    const range = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }).parse(req.query);
    const from = range.from ? new Date(range.from) : new Date(now.getTime() - Math.min(30, days) * 24 * 60 * 60 * 1000);
    const to = range.to ? new Date(range.to) : now;
    if (from > to || to > now) return res.status(400).json({ error: 'Invalid date range' });
    if (!withinPlanRetention(req, res, from, now)) return;

    const eventMatch = { linkId: link._id, clickedAt: { $gte: from, $lte: to } };
    const rows = await ClickEvent.aggregate([
      { $match: eventMatch },
      { $facet: {
        summary: [{ $group: {
          _id: null,
          trackedClicks: { $sum: 1 },
          qualifiedClicks: { $sum: { $cond: ['$isQualifiedClick', 1, 0] } },
          knownBots: { $sum: { $cond: [{ $eq: ['$botClass', 'known_bot'] }, 1, 0] } },
          suspectedAutomation: { $sum: { $cond: [{ $eq: ['$botClass', 'suspected_automation'] }, 1, 0] } },
          unknown: { $sum: { $cond: [{ $eq: ['$botClass', 'unknown'] }, 1, 0] } },
          visitors: { $addToSet: { $cond: ['$isQualifiedClick', '$visitorHash', null] } }
        } }, { $project: { _id: 0, trackedClicks: 1, qualifiedClicks: 1, knownBots: 1, suspectedAutomation: 1, unknown: 1, uniqueVisitors: { $size: { $filter: { input: '$visitors', as: 'v', cond: { $ne: ['$$v', null] } } } } } }],
        daily: [{ $match: { isQualifiedClick: true } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$clickedAt', timezone: 'UTC' } }, clicks: { $sum: 1 } } }, { $sort: { _id: 1 } }],
        classification: [{ $group: { _id: '$botClass', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
        devices: [{ $match: { isQualifiedClick: true } }, { $group: { _id: '$deviceType', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
        browsers: [{ $match: { isQualifiedClick: true } }, { $group: { _id: '$browser', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }],
        referrers: [{ $match: { isQualifiedClick: true } }, { $group: { _id: { $cond: [{ $or: [{ $eq: ['$referrerDomain', null] }, { $eq: ['$referrerDomain', ''] }] }, 'Direct / unknown', '$referrerDomain'] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }],
        countries: [{ $match: { isQualifiedClick: true, country: { $nin: [null, ''] } } }, { $group: { _id: '$country', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]
      } }
    ]);
    const aggregate = rows[0] || {};
    const summary = aggregate.summary?.[0] || { trackedClicks: 0, qualifiedClicks: 0, knownBots: 0, suspectedAutomation: 0, unknown: 0, uniqueVisitors: 0 };
    const advancedAvailable = hasPlan(req.user, 'pro');
    res.json({
      period: { from, to, timezone: 'UTC' },
      advancedAvailable,
      link: {
        id: String(link._id), code: link.code, title: link.title, campaignId: link.campaignId,
        status: link.status, createdAt: link.createdAt, expiresAt: link.expiresAt,
        clickLimit: link.clickLimit, totalRedirectsAllTime: Number(link.clickCount || 0)
      },
      analytics: {
        ...summary,
        daily: aggregate.daily || [],
        classification: aggregate.classification || [],
        devices: advancedAvailable ? aggregate.devices || [] : [],
        browsers: advancedAvailable ? aggregate.browsers || [] : [],
        referrers: advancedAvailable ? aggregate.referrers || [] : [],
        countries: advancedAvailable ? aggregate.countries || [] : []
      }
    });
  } catch (err) { next(err); }
});

export default router;
