import type { Hospital } from '../types';

export const DEMO_HOSPITAL_IDS = ['samaritan-troy', 'albany-medical-center'] as const;
const inCity = (h: Hospital, city: string) => h.state === 'NY' && h.city.trim().toLowerCase() === city;

export function capitalRegionHospitals(hospitals: Hospital[]): Hospital[] {
  return DEMO_HOSPITAL_IDS.flatMap(id => {
    const city = id === 'samaritan-troy' ? 'troy' : 'albany';
    const exact = hospitals.find(h => h.id === id && inCity(h, city));
    const byName = hospitals.find(h => inCity(h, city) && (city === 'troy'
      ? /^samaritan hospital$/i.test(h.name) : /^albany medical center(?: hospital)?$/i.test(h.name)));
    const match = exact ?? byName;
    return match ? [match] : [];
  });
}

export function hospitalForQuestion(hospitals: Hospital[], query: string): Hospital | undefined {
  const q = query.toLowerCase();
  // Explicit Watertown requests must not take the Troy demo shortcut.
  if (q.includes('watertown') || q.includes('samaritan medical center'))
    return hospitals.find(h => inCity(h, 'watertown') && /^samaritan medical center$/i.test(h.name));
  if (/samaritan|troy/.test(q)) return capitalRegionHospitals(hospitals).find(h => inCity(h, 'troy'));
  if (/albany/.test(q)) return capitalRegionHospitals(hospitals).find(h => inCity(h, 'albany'));
  return hospitals.find(h => q.includes(h.name.toLowerCase()));
}
