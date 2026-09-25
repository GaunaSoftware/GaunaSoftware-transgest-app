const express = require('express');
const ExcelJS = require('exceljs');
const { createImportBatches } = require('../services/importBatches');
const { parseFile } = require('../services/importParser');
const { HEADERS, REQUIRED, ALIASES, columnsFor } = require('../services/importCatalog');
const { createImportEngine } = require('../services/importEngine');
const { createImportDocuments } = require('../services/importDocuments');
const { createImportRollback } = require('../services/importRollback');
const { createImportReports } = require('../services/importReports');
const { createImportHistoricalOverview } = require('../services/importHistoricalOverview');

const rawFile = express.raw({ type: () => true, limit: '20mb' });
function handle(res, error) {
  res.status(error.status || 500).json({
    error: error.status ? error.message : 'No se pudo procesar la importación',
    code: error.code || 'IMPORT_ERROR',
  });
}
function createImportRouter(batches = createImportBatches(), engine = createImportEngine(), documents = createImportDocuments(),
  rollback = createImportRollback(), reports = createImportReports(), historical = createImportHistoricalOverview()) {
  const router = express.Router();
  router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  router.get('/catalog', (_req, res) => res.json({ version: 1, templates: Object.entries(HEADERS).map(([type, header]) => ({ type, columns: header.split(','), required: REQUIRED[type] || [] })), aliases: ALIASES }));
  router.get('/templates/pack.xlsx', async (_req, res) => {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'TransGest';
      for (const [type, header] of Object.entries(HEADERS)) workbook.addWorksheet(type).addRow(header.split(','));
      const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', 'attachment; filename="Pack_TransGest_v1.xlsx"');
      res.send(bytes);
    } catch (error) { handle(res, error); }
  });
  router.get('/templates/:type.csv', (req, res) => {
    const columns = columnsFor(req.params.type);
    if (!columns) return res.status(404).json({ error: 'Plantilla no encontrada' });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${req.params.type}_v1.csv"`);
    res.send(`\uFEFF${columns.join(',')}\r\n`);
  });
  router.post('/upload', rawFile, async (req, res) => {
    let batchId;
    try {
      if (!Buffer.isBuffer(req.body)) throw Object.assign(new Error('Envía el archivo como cuerpo binario'), { status: 400 });
      let filename;
      try { filename = decodeURIComponent(req.get('x-import-filename') || ''); }
      catch { throw Object.assign(new Error('Nombre de archivo no válido'), { status: 400 }); }
      const type = req.get('x-import-type');
      const sourceSystem = req.get('x-import-source-system');
      const rawMapping = req.get('x-import-mapping') || '{}';
      if (rawMapping.length > 8192) throw Object.assign(new Error('Mapeo demasiado grande'), { status: 400 });
      let mapping;
      try { mapping = JSON.parse(rawMapping); }
      catch { throw Object.assign(new Error('Mapeo JSON no válido'), { status: 400 }); }
      if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw Object.assign(new Error('Mapeo no válido'), { status: 400 });
      const sheets = await parseFile(req.body, filename, type, mapping);
      const batch = await batches.createBatch({ empresaId: req.empresaId, actorId: req.user.id,
        tipo: type, filename, fileBuffer: req.body, sourceSystem, config: { mapping, sheets: sheets.map(sheet => sheet.type) } });
      batchId = batch.id;
      for (const sheet of sheets) {
        for (let start = 0; start < sheet.rows.length; start += 500) {
          await batches.stageRows(req.empresaId, batch.id, sheet.rows.slice(start, start + 500));
        }
      }
      const result = await batches.sealBatch(req.empresaId, batch.id, req.user.id);
      res.status(201).json({ batch: result, preview: sheets.map(sheet => ({ type: sheet.type, rows: sheet.rows.slice(0, 5) })) });
    } catch (error) {
      if (batchId) await batches.failBatch(req.empresaId, batchId, req.user.id, error.code || 'STAGING_FAILED').catch(() => {});
      handle(res, error);
    }
  });
  router.post('/batches/:id/simulate', async (req, res) => {
    try { res.status(202).json(await engine.startSimulation(req.empresaId,req.params.id)); }
    catch (cause) { handle(res,cause); }
  });
  router.post('/batches/:id/confirm', async (req, res) => {
    try { res.status(202).json(await engine.confirm(req.empresaId,req.params.id,req.user.id)); }
    catch (cause) { handle(res,cause); }
  });
  router.post('/documents/preview', rawFile, async (req,res)=>{
    try{
      let filename;
      try{filename=decodeURIComponent(req.get('x-import-filename')||'');}catch{throw Object.assign(new Error('Nombre de archivo no válido'),{status:400});}
      const batchId=await documents.stage({empresaId:req.empresaId,actorId:req.user.id,filename,buffer:req.body});
      res.status(201).json({batch:await batches.getBatch(req.empresaId,batchId)});
    }catch(cause){handle(res,cause);}
  });
  router.post('/documents/:id/simulate', async(req,res)=>{
    try{res.json({summary:await documents.simulate(req.empresaId,req.params.id),batch:await batches.getBatch(req.empresaId,req.params.id)});}catch(cause){handle(res,cause);}
  });
  router.post('/documents/:id/confirm', async(req,res)=>{
    try{res.status(202).json(await documents.confirm(req.empresaId,req.params.id,req.user.id));}catch(cause){handle(res,cause);}
  });
  for(const [path,method] of [['cancel','cancel'],['continue','continueBatch'],['retry-errors','retryErrors']]){
    router.post(`/batches/:id/${path}`,async(req,res)=>{
      try{
        const batch=await batches.getBatch(req.empresaId,req.params.id);
        const service=batch.tipo==='Docs_PDF'?documents:engine;
        res.status(202).json(await service[method](req.empresaId,req.params.id,req.user.id));
      }catch(cause){handle(res,cause);}
    });
  }
  router.post('/batches/:id/rollback/simulate',async(req,res)=>{
    try{res.json(await rollback.simulate(req.empresaId,req.params.id));}catch(cause){handle(res,cause);}
  });
  router.post('/batches/:id/rollback/confirm',async(req,res)=>{
    try{res.json(await rollback.confirm(req.empresaId,req.params.id,req.user.id));}catch(cause){handle(res,cause);}
  });
  router.get('/batches/:id/report',async(req,res)=>{
    try{res.json(await reports.report(req.empresaId,req.params.id));}catch(cause){handle(res,cause);}
  });
  router.get('/batches/:id/report.xlsx',async(req,res)=>{
    try{
      const content=await reports.reportXlsx(req.empresaId,req.params.id);
      res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition','attachment; filename="Informe_Migracion_TransGest.xlsx"');res.send(content);
    }catch(cause){handle(res,cause);}
  });
  router.get('/batches/:id/errors.csv',async(req,res)=>{
    try{
      const content=await reports.errorsCsv(req.empresaId,req.params.id);
      res.set('Content-Type','text/csv; charset=utf-8');
      res.set('Content-Disposition','attachment; filename="Errores_TransGest.csv"');res.send(content);
    }catch(cause){handle(res,cause);}
  });
  router.get('/batches/:id/errors.xlsx',async(req,res)=>{
    try{
      const content=await reports.errorsXlsx(req.empresaId,req.params.id);
      res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition','attachment; filename="Errores_TransGest.xlsx"');res.send(content);
    }catch(cause){handle(res,cause);}
  });
  router.get('/history/overview',async(req,res)=>{
    try{
      const batchId=req.query.batch_id||null;
      if(batchId)await batches.getBatch(req.empresaId,batchId);
      res.json(await historical.overview(req.empresaId,batchId));
    }catch(cause){handle(res,cause);}
  });
  router.get('/batches', async (req, res) => {
    try { res.json({ batches: await batches.listBatches(req.empresaId, req.query) }); }
    catch (error) { handle(res, error); }
  });
  router.get('/batches/:id', async (req, res) => {
    try { res.json(await batches.getBatch(req.empresaId, req.params.id)); }
    catch (error) { handle(res, error); }
  });
  router.get('/batches/:id/rows', async (req, res) => {
    try { res.json({ rows: await batches.listRows(req.empresaId, req.params.id, req.query) }); }
    catch (error) { handle(res, error); }
  });
  return router;
}
module.exports = createImportRouter();
module.exports.createImportRouter = createImportRouter;
