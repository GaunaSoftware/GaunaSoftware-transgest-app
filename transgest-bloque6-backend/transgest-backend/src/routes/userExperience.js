const express = require('express');
const db = require('../services/db');
const service = require('../services/userExperience');
const router = express.Router();
router.use((req,res,next) => { res.set('Cache-Control','private, no-store'); next(); });
const handle = work => async (req,res) => {
  try { res.json(await work(req)); }
  catch (e) { res.status(e.status || 500).json({error:e.status ? e.message : 'No se pudo guardar o consultar tu configuración. Inténtalo de nuevo.'}); }
};
router.get('/releases/:id', handle(req => service.getRelease(db,req.user,req.params.id)));
router.post('/releases/:id/dismiss', handle(req => service.dismissRelease(db,req.user,req.params.id)));
router.get('/agenda', handle(req => service.agendaPreferences(db,req.user)));
router.put('/agenda', handle(req => service.saveAgendaPreferences(db,req.user,req.body?.notice_types)));
module.exports = router;
