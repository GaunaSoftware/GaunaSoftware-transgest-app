// Multiple reminders for the same operational condition are one task in the
// startup summary. Original agenda entries remain available for review.
export function uniquePendingTasks(events) {
  const found = new Map();
  for (const event of events) {
    const key = event.metadata?.source === 'avisos_operativos_colaborador' && event.metadata?.alert_key
      ? `alert:${event.metadata.alert_key}` : event.source_type && event.source_id && event.cause_code
        ? `${event.source_type}:${event.source_id}:${event.cause_code}` : `event:${event.id}`;
    if (!found.has(key)) found.set(key, event);
  }
  return [...found.values()];
}
