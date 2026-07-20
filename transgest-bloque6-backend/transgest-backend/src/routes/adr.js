// routes/adr.js - Apoyo ADR (mercancias peligrosas) para la operativa y el CMR.
const express = require("express");
const router = express.Router();
const adr = require("../services/adr");

// Catalogo de clases y categorias (para desplegables de la UI).
router.get("/meta", (req, res) => {
  res.json({
    clases: adr.ADR_CLASSES,
    grupos_embalaje: adr.PACKING_GROUPS,
    categorias_transporte: adr.TRANSPORT_CATEGORIES,
    limite_puntos: adr.ADR_POINTS_LIMIT,
  });
});

// Busqueda en el catalogo de numeros ONU (autocompletar). ?q=gasoleo | 1202
router.get("/catalogo", (req, res) => {
  const q = req.query.q || "";
  res.json({ resultados: adr.searchUn(q, Number(req.query.limit) || 12) });
});

// Datos de un numero ONU concreto.
router.get("/onu/:un", (req, res) => {
  const data = adr.lookupUn(req.params.un);
  if (!data) return res.status(404).json({ error: "Numero ONU no esta en el catalogo. Introduce los datos a mano." });
  res.json(data);
});

// Calculo en vivo para un conjunto de mercancias peligrosas del viaje:
// devuelve las lineas del documento de transporte, la exencion 1.1.3.6,
// los requisitos operativos y la validacion de datos obligatorios.
router.post("/calcular", (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const cisterna = !!req.body?.cisterna;
  const normalizados = items.map(it => adr.normalizeItem(it)).filter(it => it.un || it.nombre);
  res.json({
    items: normalizados,
    lineas: normalizados.map(it => adr.buildTransportDocumentLine(it)),
    exencion: adr.calcExencion1136(items),
    requisitos: adr.buildRequisitos(items, { cisterna }),
    validacion: adr.validateItems(items),
  });
});

module.exports = router;
