const express = require('express');
const { createImportBatches } = require('../services/importBatches');

const router = express.Router();
const batches = createImportBatches();

function handle(res, error) {
  res.status(error.status || 500).json({
    error: error.status ? error.message : 'No se pudo consultar la importación',
    code: error.code || 'IMPORT_ERROR',
  });
}
router.get('/batches', async (req, res) => {
  try {
    res.json({ batches: await batches.listBatches(req.empresaId, req.query) });
  } catch (error) { handle(res, error); }
});
router.get('/batches/:id', async (req, res) => {
  try {
    res.json(await batches.getBatch(req.empresaId, req.params.id));
  } catch (error) { handle(res, error); }
});
router.get('/batches/:id/rows', async (req, res) => {
  try {
    res.json({ rows: await batches.listRows(req.empresaId, req.params.id, req.query) });
  } catch (error) { handle(res, error); }
});

module.exports = router;
