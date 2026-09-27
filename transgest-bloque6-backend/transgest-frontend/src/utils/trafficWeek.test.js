import {madridDay,trafficWeek,visibleTrafficDays} from './trafficWeek';
test('current week hides past days; past and future weeks remain complete',()=>{
 const days=trafficWeek(new Date('2026-09-26T10:00:00Z'));
 expect(visibleTrafficDays(days,{today:'2026-09-26'})).toHaveLength(2);
 expect(visibleTrafficDays(days,{today:'2026-09-26',showPast:true})).toHaveLength(7);
 expect(visibleTrafficDays(days,{today:'2026-10-01'})).toHaveLength(7);
 expect(visibleTrafficDays(days,{today:'2026-09-19'})).toHaveLength(7);
});
test('Madrid day and seven distinct days survive midnight and DST boundaries',()=>{
 expect(madridDay(new Date('2026-09-25T22:30:00Z'))).toBe('2026-09-26');
 const days=trafficWeek(new Date('2026-10-25T01:30:00Z'));
 expect(days.map(d=>d.toISOString().slice(0,10))).toEqual(['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25']);
});
