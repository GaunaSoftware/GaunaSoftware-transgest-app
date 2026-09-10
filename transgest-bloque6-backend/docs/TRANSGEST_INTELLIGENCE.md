# TransGest Intelligence

## Ediciones

| ID conservado | Nombre comercial |
| --- | --- |
| lite | TransGest Go |
| basico | TransGest Control |
| profesional | TransGest Pro |
| enterprise | TransGest Pro Intelligence |

No se cambian los contratos, precios Stripe, permisos ni limites existentes al
renombrar. La IA sigue incluida en el ultimo nivel.

## Configuracion

Superadmin > Integraciones > OpenAI. Selecciona empresa para elegir explicitamente
clave propia o general. Las claves existentes siguen cifradas en el servidor y
no se envian al navegador. Intelligence usa exclusivamente OpenAI: no cambia a
otro proveedor si una empresa ha desactivado su clave.

Usa el modelo OpenAI configurado en IA cuando OpenAI sea el proveedor elegido;
en otro caso usa el valor predeterminado de `normalizeAiModel`. Debe probarse
el acceso al modelo con la clave de la empresa. Tener una suscripcion ChatGPT
no demuestra saldo o acceso de la API.

## Alcance inicial funcional

- Buscar pedidos por numero, referencia, cliente o ruta, con fechas.
- Consultar ocupacion registrada de vehiculos, sin afirmar disponibilidad fisica.
- Consultar ingresos netos de viajes realizados, costes registrados, margen
  operativo y pendientes de facturar por mes economico. Los borradores quedan
  pendientes. No confunde el importe de viajes facturados con cobros.
- Explicar resultados y preparar textos, sin enviar ni alterar documentos.

Solo gerente, trafico, administrativo y contable pueden acceder si su plan y
permisos lo permiten. Cada herramienta comprueba ademas permiso de lectura
del modulo, limita filas y usa parametros SQL y empresa derivada del token.
No se permite SQL libre, URLs arbitrarias, ejecutar codigo ni herramientas de escritura.
No expone telefonos, DNI, claves ni contrasenas en el contexto de estas herramientas.

Las respuestas muestran fuentes, filtros, momento de consulta y listas parciales.
Se limita longitud del historial, numero de pasos, tokens, tiempo y peticiones.
Se reserva un uso por turno en transaccion antes de llamar al proveedor; un
intento fallido puede consumir ese uso para evitar reintentos de coste ilimitado.
El log registra empresa, usuario, herramientas y tokens, no texto de conversaciones.
El historial permanece en memoria de la pestaña, no en localStorage.

OpenAI recibe la consulta, historial enviado y los campos de las herramientas
usadas. `store:false` evita almacenar la respuesta para recuperacion por API;
no equivale a garantia de retencion cero. Configurar la politica de datos y
consentimiento empresarial antes de habilitarlo con datos reales.

Referencia tecnica: https://developers.openai.com/api/docs/guides/function-calling

## Pendientes de validacion real

Prueba con clave autorizada y saldo; pruebas de calidad con preguntas reales
anonimizadas; revision de politica de datos y costes de cada empresa. No se han
enviado datos reales de produccion a OpenAI durante las pruebas automatizadas.
