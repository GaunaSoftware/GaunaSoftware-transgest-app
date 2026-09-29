export function signaturePayload({stopId,role,image,name,evidence}) {
  return {
    ...(stopId ? {parada_id:stopId} : {}),
    rol:role,
    firma_destinatario:image,
    firma_nombre:name,
    source:role==='cargador'?'app_chofer_carga':'app_chofer',
    ...evidence,
  };
}
