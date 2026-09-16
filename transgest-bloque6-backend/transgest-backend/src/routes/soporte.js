const express = require('express');
const crypto = require('crypto');
const db = require('../services/db');
const { ensureSupportSchema: ensureSchema } = require('../services/supportSchema');
const validId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
function createSupportRouter(admin = false) {
  const router = express.Router();
  router.use(async (req,res,next) => {
    if (admin ? !req.superadmin?.id : !req.user?.id || !req.empresaId) return res.status(403).json({error:'Acceso no autorizado'});
    if (req.params.id && !validId(req.params.id)) return res.status(400).json({error:'Solicitud no válida'});
    try { await ensureSchema(); next(); } catch (error) { next(error); }
  });
  const actor = req => admin ? req.superadmin : req.user;
  const scope = req => admin ? [] : [req.empresaId,req.user.id];
  const condition = admin ? '' : ' AND s.empresa_id=$2 AND s.usuario_id=$3';
  const wrap = fn => async (req,res,next) => { try { await fn(req,res); } catch(error) { next(error); } };
  router.get('/',wrap(async(req,res) => {
    const {rows} = await db.query(`SELECT s.*, e.nombre AS empresa_nombre, u.nombre AS usuario_nombre,
      (SELECT COUNT(*)::int FROM soporte_mensajes m WHERE m.solicitud_id=s.id
        AND m.desde_soporte=${admin ? 'false' : 'true'}
        AND m.created_at > COALESCE(s.${admin ? 'soporte_leido_at' : 'usuario_leido_at'}, 'epoch'::timestamptz)) AS sin_leer
      FROM soporte_solicitudes s JOIN empresas e ON e.id=s.empresa_id LEFT JOIN usuarios u ON u.id=s.usuario_id
      ${admin ? '' : 'WHERE s.empresa_id=$1 AND s.usuario_id=$2'} ORDER BY s.updated_at DESC LIMIT 200`,scope(req));
    res.json(rows);
  }));
  router.post('/',wrap(async(req,res) => {
    if (admin) return res.status(405).json({error:'Selecciona una solicitud para responder'});
    const asunto = String(req.body?.asunto || '').trim(), mensaje = String(req.body?.mensaje || '').trim();
    if (!asunto || asunto.length > 160 || !mensaje || mensaje.length > 6000) return res.status(400).json({error:'Indica un asunto (máximo 160 caracteres) y un mensaje (máximo 6000)'});
    const id = crypto.randomUUID();
    await db.transaction(async client => {
      await client.query('INSERT INTO soporte_solicitudes(id,empresa_id,usuario_id,asunto) VALUES($1,$2,$3,$4)',[id,req.empresaId,req.user.id,asunto]);
      await client.query('INSERT INTO soporte_mensajes(id,solicitud_id,autor_id,autor_nombre,desde_soporte,mensaje) VALUES($1,$2,$3,$4,false,$5)',[crypto.randomUUID(),id,String(req.user.id),req.user.nombre || 'Usuario',mensaje]);
    });
    res.status(201).json({id});
  }));
  router.get('/:id',wrap(async(req,res) => {
    if (!validId(req.params.id)) return res.status(404).json({error:'Solicitud no encontrada'});
    const {rows} = await db.query(`SELECT s.* FROM soporte_solicitudes s WHERE s.id=$1${condition}`,[req.params.id,...scope(req)]);
    if (!rows.length) return res.status(404).json({error:'Solicitud no encontrada'});
    const messages = await db.query('SELECT * FROM soporte_mensajes WHERE solicitud_id=$1 ORDER BY created_at,id',[req.params.id]);
    const last = messages.rows.at(-1)?.created_at;
    if (last) await db.query(`UPDATE soporte_solicitudes SET ${admin ? 'soporte_leido_at' : 'usuario_leido_at'}=$2 WHERE id=$1`,[req.params.id,last]);
    res.json({...rows[0],mensajes:messages.rows});
  }));
  router.post('/:id/mensajes',wrap(async(req,res) => {
    const mensaje = String(req.body?.mensaje || '').trim();
    const estado = req.body?.estado;
    if (!validId(req.params.id) || !mensaje || mensaje.length > 6000 || (estado && !['abierta','resuelta'].includes(estado))) return res.status(400).json({error:'Escribe un mensaje válido (máximo 6000 caracteres)'});
    const found = await db.transaction(async client => {
      const {rows} = await client.query(`SELECT s.id FROM soporte_solicitudes s WHERE s.id=$1${condition} FOR UPDATE`,[req.params.id,...scope(req)]);
      if (!rows.length) return false;
      const a = actor(req);
      await client.query('INSERT INTO soporte_mensajes(id,solicitud_id,autor_id,autor_nombre,desde_soporte,mensaje) VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),req.params.id,String(a.id),admin ? 'Soporte TransGest' : (a.nombre || 'Usuario'),admin,mensaje]);
      await client.query('UPDATE soporte_solicitudes SET estado=$1,updated_at=now() WHERE id=$2',[estado || (admin ? 'respondida' : 'abierta'),req.params.id]);
      return true;
    });
    if (!found) return res.status(404).json({error:'Solicitud no encontrada'});
    res.json({ok:true});
  }));
  return router;
}
module.exports = {createSupportRouter,ensureSchema};
