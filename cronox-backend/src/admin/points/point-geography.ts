import { PROVINCES } from '../map/spain-geography';

export const foldPlace = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Conservative normalization of explicit province names and unambiguous cities
// supported by the Spanish point-of-sale editor. Never fuzzy-match a venue.
export const POINT_PLACE_CODES = new Map(PROVINCES.flatMap(p => p.aliases.map(alias => [foldPlace(alias),p.id] as const)));
for (const [name,id] of [['Bilbao','48'],['Bilbo','48'],['Vitoria','01'],['Vitoria-Gasteiz','01'],['Pamplona','31'],['Iruña','31'],['Logroño','26'],['Oviedo','33'],['Gijón','33'],['Santander','39'],['Santiago de Compostela','15'],['Mérida','06']] as const) POINT_PLACE_CODES.set(foldPlace(name),id);
export const normalizedPointProvince = (city: string) => POINT_PLACE_CODES.get(foldPlace(city)) ?? null;
export const pointLocation = (point: { provinceId?: string | null }) => {
  const province = PROVINCES.find(p => p.id === point.provinceId);
  return province ? { group:'identified' as const,provinceId:province.id,regionId:province.regionId } : {group:'unknownSpain' as const};
};
