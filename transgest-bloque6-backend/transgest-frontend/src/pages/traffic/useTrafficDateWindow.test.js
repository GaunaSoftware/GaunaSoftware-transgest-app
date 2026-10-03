import React from 'react';
import {createRoot} from 'react-dom/client';
import {act} from 'react';
import useTrafficDateWindow,{addDays,isWeekend,localDate} from './useTrafficDateWindow';

test('visible dates start today, roll over at midnight and retain a manually selected date',()=>{
 jest.useFakeTimers();jest.setSystemTime(new Date(2026,9,3,23,59,50));
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const element=document.createElement('div'),root=createRoot(element);let windowDates;
 function Probe(){windowDates=useTrafficDateWindow();return <span>{windowDates.start}</span>;}
 try{
  act(()=>root.render(<Probe/>));expect(windowDates.start).toBe('2026-10-03');
  act(()=>jest.advanceTimersByTime(30000));expect(windowDates.start).toBe('2026-10-04');
  act(()=>windowDates.select('2026-10-10'));
  act(()=>{jest.setSystemTime(new Date(2026,9,5,9));window.dispatchEvent(new Event('focus'));});
  expect(windowDates.today).toBe('2026-10-05');expect(windowDates.start).toBe('2026-10-10');
  act(()=>windowDates.goToday());expect(windowDates.start).toBe('2026-10-05');
  act(()=>{jest.setSystemTime(new Date(2026,9,6,9));document.dispatchEvent(new Event('visibilitychange'));});
  expect(windowDates.start).toBe('2026-10-06');
 }finally{act(()=>root.unmount());jest.useRealTimers();delete global.IS_REACT_ACT_ENVIRONMENT;}
});

test('day navigation crosses months and identifies real weekends in a rolling window',()=>{
 expect(addDays('2026-10-31',1)).toBe('2026-11-01');
 expect(addDays('2027-01-01',-1)).toBe('2026-12-31');
 expect(localDate(new Date(2026,9,3,0,1))).toBe('2026-10-03');
 expect(['2026-10-03','2026-10-04','2026-10-05'].map(isWeekend)).toEqual([true,true,false]);
});
