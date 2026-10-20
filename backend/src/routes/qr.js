import { Router } from 'express';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import { z } from 'zod';
import { ClickEvent, Link, QrCode } from '../models/index.js';
import { authenticate, canAccessOwnedResource } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { getPublicBaseUrl, makePublicShortUrl } from '../utils/publicUrl.js';

const router = Router();
router.use(authenticate);
router.post('/links/:id/qr', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Link not found' });
    const input = z.object({ name: z.string().trim().max(120).optional().default('') }).parse(req.body || {});
    getPublicBaseUrl(); // Validate deployment URL before persisting the QR code.
    const link = await Link.findById(req.params.id);
    if (!link || !canAccessOwnedResource(link, req.user)) return res.status(404).json({ error: 'Link not found' });
    const qr = await QrCode.create({ linkId: link._id, ownerId: link.ownerId, name: input.name });
    const target = `${makePublicShortUrl(link.code)}?qr=${qr._id}`;
    const image = await QRCode.toDataURL(target, { errorCorrectionLevel: 'M', margin: 2, width: 420 });
    await audit(req.user._id, 'qr.created', 'qrCode', qr._id, { linkId: String(link._id) });
    res.status(201).json({ qrCode: qr, targetUrl: target, dataUrl: image });
  } catch (err) { next(err); }
});
router.get('/links/:id/qr', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Link not found' });
    const link = await Link.findById(req.params.id);
    if (!link || !canAccessOwnedResource(link, req.user)) return res.status(404).json({ error: 'Link not found' });
    const qrCodes = await QrCode.find({ linkId: link._id, ...(req.user.role === 'admin' ? {} : { ownerId: req.user._id }) }).sort({ createdAt: -1 }).lean();
    res.json({ qrCodes });
  } catch (err) { next(err); }
});
router.get('/qr', async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { ownerId: req.user._id };
    const rows = await QrCode.find(filter).sort({ createdAt: -1 }).limit(100)
      .populate('linkId', 'code title status clickCount')
      .lean();
    const scanStats = rows.length ? await ClickEvent.aggregate([
      { $match: { qrCodeId: { $in: rows.map(qr => qr._id) } } },
      { $group: {
        _id: '$qrCodeId',
        totalScans: { $sum: 1 },
        qualifiedScans: { $sum: { $cond: ['$isQualifiedClick', 1, 0] } },
        lastScanAt: { $max: '$clickedAt' }
      } }
    ]) : [];
    const scanMap = new Map(scanStats.map(row => [String(row._id), row]));
    const qrCodes = await Promise.all(rows.map(async qr => {
      const link = qr.linkId;
      const stats = scanMap.get(String(qr._id)) || { totalScans: 0, qualifiedScans: 0, lastScanAt: null };
      if (!link) return { ...qr, targetUrl: '', dataUrl: null, linkId: null, ...stats };
      const targetUrl = `${makePublicShortUrl(link.code)}?qr=${qr._id}`;
      const dataUrl = await QRCode.toDataURL(targetUrl, { errorCorrectionLevel: 'M', margin: 2, width: 240 });
      return { ...qr, targetUrl, dataUrl, ...stats };
    }));
    res.json({ qrCodes });
  } catch (err) { next(err); }
});

router.delete('/qr/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'QR code not found' });
    const qr = await QrCode.findById(req.params.id);
    if (!qr || !canAccessOwnedResource(qr, req.user)) return res.status(404).json({ error: 'QR code not found' });
    await qr.deleteOne();
    await audit(req.user._id, 'qr.deleted', 'qrCode', qr._id, { linkId: String(qr.linkId) });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.get('/qr/:id/image', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'QR code not found' });
    const qr = await QrCode.findById(req.params.id);
    if (!qr || !canAccessOwnedResource(qr, req.user)) return res.status(404).json({ error: 'QR code not found' });
    const link = await Link.findById(qr.linkId);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    const target = `${makePublicShortUrl(link.code)}?qr=${qr._id}`;
    const png = await QRCode.toBuffer(target, { type: 'png', width: 640, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="linkpulse-${link.code}.png"`);
    res.send(png);
  } catch (err) { next(err); }
});
export default router;
