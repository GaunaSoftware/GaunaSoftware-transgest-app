export function madridDay(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
}
export function trafficWeek(anchor) {
  const monday=new Date(`${madridDay(anchor)}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay()+6)%7));
  return Array.from({length:7},(_,i)=>new Date(monday.getTime()+i*86400000));
}
export function visibleTrafficDays(days,{showPast=false,today=madridDay()}={}) {
  const labels=days.map(day=>day.toISOString().slice(0,10));
  return !showPast&&labels.includes(today)?days.filter((_,index)=>labels[index]>=today):days;
}
