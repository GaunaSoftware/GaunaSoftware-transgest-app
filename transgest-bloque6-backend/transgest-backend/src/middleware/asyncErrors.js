// ─────────────────────────────────────────────────────────────────────────
// Reenvío de errores de handlers async al gestor de errores de Express.
//
// Express 4 NO captura los rechazos de promesas de un handler `async`: si un
// handler lanza (o una promesa se rechaza) sin try/catch, la respuesta no se
// envía nunca y la petición se queda colgada reteniendo una conexión de BD
// (el gestor de errores global no llega a ejecutarse).
//
// Este parche envuelve la ejecución de cada capa (Layer) del router: si el
// handler devuelve una promesa que se rechaza, el error pasa a next(err) y llega
// al error handler global, que responde un 500 limpio. Las promesas resueltas y
// los handlers síncronos no se ven afectados. Cubre también los middleware async.
//
// Es la misma técnica que el paquete `express-async-errors`, reimplementada aquí
// sin dependencia y protegida con try/catch: si la ruta interna de Express
// cambiara, el require falla, se registra y el servidor arranca con el
// comportamiento de siempre (jamás deja el servidor sin arrancar).
// ─────────────────────────────────────────────────────────────────────────
module.exports = function aplicarParcheErroresAsync(logger = console) {
  try {
    const Layer = require("express/lib/router/layer");
    if (!Layer || !Layer.prototype || Layer.prototype.__asyncErrorsPatched) return false;

    const originalHandleRequest = Layer.prototype.handle_request;

    Layer.prototype.handle_request = function handle_request(req, res, next) {
      const fn = this.handle;
      // fn.length > 3 => middleware de error (err, req, res, next): no es un
      // handler de request, se delega al comportamiento original.
      if (!fn || fn.length > 3) {
        return originalHandleRequest.call(this, req, res, next);
      }
      try {
        const ret = fn(req, res, next);
        if (ret && typeof ret.then === "function") {
          // Solo reacciona al rechazo; las promesas resueltas siguen igual.
          ret.then(undefined, next);
        }
      } catch (err) {
        next(err);
      }
    };

    Layer.prototype.__asyncErrorsPatched = true;
    return true;
  } catch (e) {
    (logger && (logger.warn || logger.error || logger.log) || console.warn).call(
      logger || console,
      "No se pudo aplicar el parche de errores async (se continúa con el comportamiento por defecto): " + (e && e.message)
    );
    return false;
  }
};
