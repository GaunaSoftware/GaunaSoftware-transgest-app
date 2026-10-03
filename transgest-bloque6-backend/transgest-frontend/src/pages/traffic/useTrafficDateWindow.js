import {useCallback,useEffect,useState} from 'react';

export const localDate=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const addDays=(date,days)=>{const result=new Date(`${date}T12:00:00`);result.setDate(result.getDate()+days);return localDate(result);};
export const isWeekend=date=>[0,6].includes(new Date(`${date}T12:00:00`).getDay());

// A null selection follows today, including after midnight or resuming a tab.
export default function useTrafficDateWindow(){
 const [today,setToday]=useState(localDate),[selectedDate,setSelectedDate]=useState(null);
 useEffect(()=>{
  const refresh=()=>setToday(localDate());
  const timer=setInterval(refresh,30000);
  window.addEventListener('focus',refresh);
  document.addEventListener('visibilitychange',refresh);
  return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[]);
 const select=useCallback(date=>setSelectedDate(date===localDate()?null:date),[]);
 const goToday=useCallback(()=>{setToday(localDate());setSelectedDate(null);},[]);
 return {start:selectedDate||today,today,select,goToday};
}
