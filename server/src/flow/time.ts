import { z } from 'zod';
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Invalid calendar date',
  );
export const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const minuteOfDay = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export function localDate(value: Date | string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}
export function localTime(value: Date | string, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
export function addDays(date: string, days: number) {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

/** Reject nonexistent/ambiguous local wall times; callers must choose an explicit offset for a repeated hour. */
export function wallTimeToInstant(value:string, timezone:string) {
 const [date,time]=value.split('T');dateSchema.parse(date);timeSchema.parse(time);
 const target=Date.parse(value+':00Z');
 const offsets=new Set<number>();
 for(let hour=-36;hour<=36;hour+=6){
  const instant=new Date(target+hour*3600000);
  const rendered=localDate(instant,timezone)+'T'+localTime(instant,timezone)+':00Z';
  offsets.add(Date.parse(rendered)-instant.getTime());
 }
 const matches=[...offsets].map(offset=>new Date(target-offset)).filter(instant=>localDate(instant,timezone)===date&&localTime(instant,timezone)===time);
 if(matches.length!==1)throw Object.assign(new Error(matches.length?'This local time occurs twice because of daylight saving. Choose a time outside the repeated hour.':'This local time does not exist because of daylight saving. Choose another time.'),{status:400});
 return matches[0].toISOString();
}
