const router = require('express').Router();
const { Contact } = require('../models');
const { authenticate, requireModule } = require('../middleware/auth');

router.use(authenticate);
router.use(requireModule('customers', 'read'));

// GET /api/contacts?customer_name=Acme
router.get('/', async (req, res) => {
  try {
    const where = { business_unit: req.user.business_unit };
    if (req.query.customer_name) {
      where.customer_name = req.query.customer_name;
    }
    const contacts = await Contact.findAll({ where, order: [['created_at', 'DESC']] });
    return res.json(contacts);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/contacts
router.post('/', async (req, res) => {
  try {
    const { customer_name, contact_name, role, designation, phone, email, notes } = req.body;
    const contact = await Contact.create({
      customer_name,
      contact_name,
      role: role || null,
      designation: designation || null,
      phone: phone || null,
      email: email || null,
      notes: notes || null,
      business_unit: req.user.business_unit,
      created_by: req.user.id,
    });
    return res.status(201).json(contact);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/contacts/:id
router.put('/:id', async (req, res) => {
  try {
    const contact = await Contact.findByPk(req.params.id);
    if (!contact) return res.status(404).json({ message: 'Contact not found' });
    if (contact.business_unit !== req.user.business_unit) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const { customer_name, contact_name, role, designation, phone, email, notes } = req.body;
    await contact.update({
      customer_name: customer_name !== undefined ? customer_name : contact.customer_name,
      contact_name: contact_name !== undefined ? contact_name : contact.contact_name,
      role: role !== undefined ? role : contact.role,
      designation: designation !== undefined ? designation : contact.designation,
      phone: phone !== undefined ? phone : contact.phone,
      email: email !== undefined ? email : contact.email,
      notes: notes !== undefined ? notes : contact.notes,
    });
    return res.json(contact);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', async (req, res) => {
  try {
    const contact = await Contact.findByPk(req.params.id);
    if (!contact) return res.status(404).json({ message: 'Contact not found' });
    if (contact.business_unit !== req.user.business_unit) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    await contact.destroy();
    return res.json({ message: 'Contact deleted' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
