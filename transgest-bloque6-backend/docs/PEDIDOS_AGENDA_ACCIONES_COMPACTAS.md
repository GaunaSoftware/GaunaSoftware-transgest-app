# Pedidos y agenda: acciones compactas

- Menú de pedidos agrupado en Cambiar estado, Asignación, Documentos y Avisos. Conserva permisos y bloqueos de facturación.
- Cancelación mediante motivos habituales o Otro con descripción obligatoria. El motivo se guarda por la API existente, queda en la trazabilidad y se muestra en pedidos cancelados.
- Un colaborador asignado se identifica como tal aunque todavía no haya matrícula o conductor comunicado.
- Orden de carga en el componente de ventana compartido, con el documento digital plegado y los datos del viaje visibles. Impresión y funciones documentales conservadas.
- Agenda con colores comunes en formulario, leyenda, mes, semana, día y detalle: reuniones y seguimiento azules, llamadas moradas, cargas verdes, descargas naranjas, recordatorios amarillos y vencimientos rojos.
- Mis tareas es la vista inicial y filtra por creador o responsable. Los eventos personales son accesibles por creador y responsable; los compartidos siguen visibles al equipo. Gerencia puede asignar nuevas tareas a otros usuarios.

Validación: compilación de producción; `refinement_check.cjs` con API simulada para menús, cancelación, documentos, colaborador y asignación de agenda, incluyendo anchos de 390, 768 y 1672 px; `agenda_access_check.js` para permisos y alcance de las consultas con base de datos simulada. No se envían mensajes reales durante las pruebas.

Desplegar frontend y backend. No requiere nuevas columnas.
