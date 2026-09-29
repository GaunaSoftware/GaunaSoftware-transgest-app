# NO VERI*FACTU propio para TLM — diseño y validación pendiente

Estado: **no implantado ni activado**. Esta decisión se tomó para TLM el 29/09/2026. No se debe presentar la cola VERI*FACTU de TransGest, el proveedor Verifacti ni una configuración `modo: ninguno` como cumplimiento de NO VERI*FACTU. Tampoco debe enviarse cada registro a la AEAT como si TLM hubiera elegido VERI*FACTU. El usuario ha confirmado que TLM utilizará NO VERI*FACTU; antes de activarlo hay que comprobar documentalmente su ámbito fiscal, incluida la exclusión del SII.

La gerente de TLM ha indicado que desea NO VERI*FACTU y que previsiblemente dispone de certificado digital. Queda por obtener confirmación de la gestoría sobre su encaje fiscal (incluido SII), así como comprobar el certificado público, titular, vigencia y representación por un canal seguro. **No hace falta enviar la clave privada ni la contraseña por chat o por el repositorio.**

## Fuentes y criterio

- [AEAT, modalidades de cumplimiento](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/cuestiones-generales/modalidades-cumplimiento-obligaciones.html): NO VERI*FACTU no exige remitir cada registro inmediatamente, pero sí firma del sistema emisor y registro de eventos; sus facturas incorporan QR, sin ser facturas verificables en la sede.
- [Real Decreto 1007/2023, texto consolidado](https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840): integridad, conservación, accesibilidad, legibilidad, trazabilidad e inalterabilidad de los registros.
- [AEAT, ámbito de aplicación](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/cuestiones-generales-ambitos-aplicacion.html): revisar expresamente las exclusiones e interacción con SII.
- [Orden HAC/1177/2024, texto consolidado](https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138): especificaciones del registro de eventos, firma y contenido de la declaración responsable.
- [AEAT, firma de registros](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/firma.html): los registros de un sistema NO VERI*FACTU requieren firma electrónica y comprobación de esa firma.
- [AEAT, declaración responsable](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/certificacion-sistemas-informaticos-declaracion-responsable.html): corresponde al productor del sistema, por cada versión puesta a disposición.

Estas fuentes fijan el alcance general; el formato exacto, la firma y la declaración responsable deben contrastarse con las especificaciones técnicas vigentes antes del uso real. La API de Verifacti ya se ha descartado para esta modalidad. **La declaración responsable del fabricante la suscribe la titular autónoma que produce/comercializa TransGest bajo Gauna**, con su identidad legal real, fecha, lugar y versión; no TLM ni su asesoría. La identidad se ha facilitado en la conversación, pero el NIF personal no se guarda en este repositorio público ni se incorpora a un modelo no validado. Según la [FAQ de la AEAT](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/certificacion-sistemas-informaticos-declaracion-responsable.html), esa declaración responsable no necesita firma electrónica, aunque sí debe estar suscrita y disponible para cada versión. La asesoría de TLM debe validar el encaje tributario del cliente, pero no sustituye la declaración del productor. Una revisión técnica independiente del sistema y sus registros es aconsejable antes de que la titular firme.

Existe un certificado digital de la titular autónoma productora, pero **no se ha comprobado su tipo, vigencia, custodia ni aptitud para firmar registros emitidos por TLM**. No se presupone que sea un certificado de TLM ni se instalará en el servidor sin un diseño y autorización de uso. La [AEAT especifica XAdES Enveloped para registros de alta, anulación y eventos NO VERI*FACTU](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/firma.html). La declaración responsable y esa firma técnica son obligaciones distintas.

## Estado del código y brecha

`transgest-backend/src/services/fiscal.js` reconoce `no_verifactu` como modo explícito, informa que no está listo y **bloquea la emisión** en ese modo. Así no lo convierte silenciosamente en `ninguno` ni lo envía por SII/VERI*FACTU. La emisión actual y `factura_registros_fiscales` no forman un registro NO VERI*FACTU firmado ni mantienen un registro de eventos del SIF con sus garantías propias. La factura independiente usa el mismo circuito de borrador/revisión/emisión y queda igualmente bloqueada si se configura este modo.

La configuración de Mi empresa muestra ahora la opción NO VERI*FACTU y sus cinco grupos de requisitos sin campos de Verifacti o un endpoint SII inaplicable. **Elegir y guardar esta opción no habilita la emisión**: el servidor devuelve `NO_VERIFACTU_NOT_READY`. No debe cambiarse la modalidad de una empresa que está emitiendo facturas hasta acordar con su asesoría la transición y disponer del motor validado. Las pruebas locales comprueban el bloqueo y los diagnósticos; no acreditan firma, custodia ni conformidad fiscal.

En la migración actual `022_fiscal_accounting_delivery.sql`, `factura_registros_fiscales` y `factura_eventos_fiscales` enlazan con facturas mediante `ON DELETE CASCADE`; ese esquema no proporciona por sí solo conservación inalterable ante borrados. `huella` es un hash, no una firma XAdES verificable. El log `factura_eventos_fiscales` es un historial de aplicación, no el registro de eventos firmado exigido para NO VERI*FACTU. La futura migración deberá preservar los históricos y separar claramente los nuevos registros fiscales inmutables de estas tablas existentes.

## Secuencia de implementación propuesta

1. Confirmar documentalmente la situación fiscal de TLM, NIF y territorio, fecha de obligación, exclusión del SII y política de custodia. Registrar el criterio por escrito junto a la versión normativa usada.
2. Mantener el control servidor ya añadido para `no_verifactu` **sin equipararlo** a `ninguno`, SII o VERI*FACTU. No desbloquear la emisión hasta que el motor, el certificado y las pruebas estén validados. Mantener las facturas históricas intactas.
3. En una transacción de emisión, generar el registro de alta o anulación correspondiente a partir de la factura final, con numeración, impuestos y referencias correctas. Conservar los bytes canónicos, huella, encadenamiento y versión de software, separando cada empresa. Reintentos y concurrencia no deben crear dos registros.
4. Determinar con las especificaciones vigentes qué certificado cualificado y titular/representación son admisibles para firmar los registros de TLM. Implementar la firma XAdES Enveloped y su verificación mediante un almacén de claves fuera de la base de aplicación, con custodia, rotación y recuperación documentadas. Una huella SHA-256 o una firma dibujada por el usuario **no sustituyen** la firma exigida a los registros.
5. Añadir el registro de eventos del sistema y controles de inalterabilidad, exportación legible y verificable, copias restaurables y vigilancia de roturas de cadena. Diseñar acceso y conservación para requerimientos de la Administración.
6. Generar el QR y la leyenda fiscal correctos para NO VERI*FACTU, comprobando que no se muestran como factura verificable o enviada a la AEAT. Probar facturas normales, simplificadas si se admiten, abonos/rectificativas, anulaciones y distintos tipos de IVA.
7. Entregar a revisión técnica y a la asesoría de TLM muestras sintéticas de registros, firmas, eventos, exportaciones y PDF. La titular autónoma productora firma y publica la declaración responsable específica de la versión solo cuando tenga evidencia suficiente de cumplimiento. Registrar correcciones y aceptación antes de habilitar el modo para TLM.

## Pruebas de salida obligatorias

- 1.501 facturas sintéticas, empresas separadas, concurrencia de emisión y reintento con igual idempotencia; ninguna laguna o duplicado de serie/encadenamiento.
- Modificación, borrado, reordenación, pérdida y restauración de un registro: detección explícita y evidencia de auditoría; no autocorrección silenciosa.
- Firma verificable con certificado válido; rechazo de certificado caducado, revocado o de otra empresa. Rotación sin perder verificabilidad histórica.
- Rectificativa y anulación que conservan el registro anterior, con sus importes y referencias; periodos y cambio de horario Europe/Madrid.
- PDF, QR, exportación y datos fiscales conciliados para igual factura; no mostrar `enviado a AEAT` en esta modalidad.
- Recuperación desde copia en entorno aislado y verificación de cadena/eventos tras la restauración.
- Borrado o modificación de factura/empresa: los registros fiscales y de eventos ya emitidos siguen conservados y verificables según la política legal; no se aprovecha el `ON DELETE CASCADE` del esquema anterior para eliminarlos.

Hasta superar estas pruebas y la validación fiscal, la interfaz debe indicar **«NO VERI*FACTU: pendiente de integración»** y no afirmar que TLM cumple con este modo mediante TransGest.
