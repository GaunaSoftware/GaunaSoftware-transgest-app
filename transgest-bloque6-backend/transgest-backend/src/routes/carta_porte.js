// Compatibility entry point: use the same authorization and document payload.
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { getCartaPorte } = require('./pedidos');
router.use(authenticate);
router.get('/:id/carta-porte', getCartaPorte);
module.exports = router;
