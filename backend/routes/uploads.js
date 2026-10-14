const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Lead } = require('../models');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

const UPLOAD_ROOT = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, String(req.params.leadId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `po-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf', 'image/png', 'image/jpeg'].includes(file.mimetype);
    cb(ok ? null : new Error('Only PDF, PNG, or JPEG files are allowed'), ok);
  },
});

// POST /api/uploads/po/:leadId — multipart field name "file"
router.post('/po/:leadId', upload.single('file'), async (req, res) => {
  try {
    const lead = await Lead.findByPk(req.params.leadId);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    if (req.user.role === 'bd' && lead.owner_id !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const url = `/uploads/${req.params.leadId}/${req.file.filename}`;
    return res.json({ url });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
