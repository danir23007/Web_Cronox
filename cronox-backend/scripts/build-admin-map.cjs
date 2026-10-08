// Offline asset build; no services or map dependencies at runtime.
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(__dirname, '../../cronox-front/assets/maps');
const geo = JSON.parse(fs.readFileSync(path.join(dir, 'spain-communities.geojson'), 'utf8'));
const names = ['Andalucía','Aragón','Principado de Asturias','Illes Balears','Canarias','Cantabria','Castilla y León','Castilla-La Mancha','Cataluña/Catalunya','Comunitat Valenciana','Extremadura','Galicia','Comunidad de Madrid','Región de Murcia','Comunidad Foral de Navarra','País Vasco/Euskadi','La Rioja','Ciudad Autónoma de Ceuta','Ciudad Autónoma de Melilla'];
for (const f of geo.features) {
  const index = names.indexOf(f.properties.shapeName);
  if (index < 0) throw Error('Unrecognized INE region: ' + f.properties.shapeName);
  f.properties = { ...f.properties, cod_ccaa: String(index + 1).padStart(2,'0'), name: f.properties.shapeName };
}
const ids = geo.features.map(f => f.properties.cod_ccaa);
if (new Set(ids).size !== 19 || ids.some(id => !/^(0[1-9]|1[0-9])$/.test(id))) throw Error('Expected all 19 communities/cities');
const panels = [
  { ids: ids.filter(id => !['05', '18', '19'].includes(id)), box: [20, 20, 820, 425] },
  { ids: ['05'], box: [30, 480, 350, 115], label: 'Canarias' },
  { ids: ['18'], box: [430, 480, 155, 115], label: 'Ceuta' },
  { ids: ['19'], box: [650, 480, 155, 115], label: 'Melilla' },
];
const project = ([x, y]) => [x * Math.cos(40 * Math.PI / 180), -y];
const polygons = feature => feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
function fittedPath(parts, box) {
  const points = parts.flat(2).map(project);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
  const [x,y,w,h] = box, scale = Math.min(w/width,h/height);
  const xy = p => { const [px,py] = project(p); return `${(x+(w-width*scale)/2+(px-minX)*scale).toFixed(2)},${(y+(h-height*scale)/2+(py-minY)*scale).toFixed(2)}`; };
  return parts.map(poly => poly.map(ring => 'M'+ring.map(xy).join('L')+'Z').join('')).join('');
}
let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 625" role="group" aria-label="Distribución de ventas por comunidades autónomas"><title>España: comunidades y ciudades autónomas</title><desc>geoBoundaries / IGN, ESP-ADM1-25490228, CC BY 4.0. Proyección local y recuadros por CRONOX. Ver README.md.</desc>';
for (const panel of panels) {
  const features = geo.features.filter(f => panel.ids.includes(f.properties.cod_ccaa));
  const points = features.flatMap(f => polygons(f).flat(2)).map(project);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
  const [x, y, w, h] = panel.box, scale = Math.min(w / width, h / height);
  const xy = p => { const [px, py] = project(p); return `${(x + (w - width * scale) / 2 + (px - minX) * scale).toFixed(2)},${(y + (h - height * scale) / 2 + (py - minY) * scale).toFixed(2)}`; };
  if (panel.label) svg += `<rect x="${x - 15}" y="${y - 25}" width="${w + 30}" height="${h + 48}" rx="10" class="map-inset"/><text x="${x}" y="${y - 8}" class="map-inset-label">${panel.label}</text>`;
  for (const f of features) {
    let d = polygons(f).map(poly => poly.map(ring => 'M' + ring.map(xy).join('L') + 'Z').join('')).join('');
    if (f.properties.cod_ccaa === '19') {
      // Source also groups distant Spanish islets with Melilla. Keep every polygon,
      // but fit the actual city separately so its outline remains readable.
      const parts = polygons(f);
      const city = parts.filter(p => p[0].every(([lon,lat]) => lon > -3.1 && lon < -2.8 && lat > 35.25));
      if (city.length !== 1) throw Error('Expected one Melilla city polygon');
      d = fittedPath(city,[x,y,w,h-36]) + fittedPath(parts.filter(p=>!city.includes(p)),[x,y+h-14,w,14]);
      svg += `<text x="${x}" y="${y+h-18}" class="map-islets-label">Islotes · otra escala</text>`;
    }
    svg += `<g data-region="${f.properties.cod_ccaa}" tabindex="0" role="button" aria-label="${f.properties.name}" aria-pressed="false">${panel.label ? `<rect x="${x-10}" y="${y-20}" width="${w+20}" height="${h+40}" class="map-hit"/>` : ''}<path d="${d}" fill-rule="evenodd"/></g>`;
  }
}
svg += '<text x="680" y="290" class="map-inset-label">Illes Balears</text></svg>';
fs.writeFileSync(path.join(dir, 'spain-communities.svg'), svg);
console.log(`Generated ${ids.length} regions (${Buffer.byteLength(svg)} bytes)`);
