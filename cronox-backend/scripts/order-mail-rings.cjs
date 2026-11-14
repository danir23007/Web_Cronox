// The email consumes raster PNGs, not this SVG. Keep the approved canvas,
// centre and set of radii; circle identity runs from outside to inside.
const ORDER_RING_GEOMETRY = Object.freeze({ width: 640, height: 1400, cx: 450, cy: 700, radii: Object.freeze([268, 220, 172, 124, 76]) });
const ORDER_RING_COLORS = Object.freeze(['#000000', '#000000', '#7C7C7C', '#FFFFFF', '#FFFFFF']);

function orderRingSvg(selected, theme) {
  if (!Number.isInteger(selected) || selected < 1 || selected > 5 || !['light', 'dark'].includes(theme)) throw Error('INVALID_ORDER_RING_VARIANT');
  const dark = theme === 'dark';
  const { width, height, cx, cy, radii } = ORDER_RING_GEOMETRY;
  const neutral = dark ? '#B0B0B0' : '#686868';
  const circles = radii.map((radius, index) => {
    const active = index + 1 === selected;
    const stroke = active ? ORDER_RING_COLORS[index] : neutral;
    const strokeWidth = active ? ((dark && index < 2) || (!dark && index === 3) || index === 4 ? 2 : 1.4) : 1.15;
    const opacity = !active ? (dark ? .15 : .17) : dark ? [1, 1, .6, .22, 1][index] : [.3, .3, .55, 1, 1][index];
    // Preserve pure black in dark mode. The neutral halo lights only its
    // immediate surroundings. White needs the inverse treatment on light.
    const halo = active && ((dark && index < 2) || (!dark && (index === 3 || index === 4)))
      ? `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${dark ? '#B8B8B8' : '#505050'}" stroke-width="6" opacity=".025"/><circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${dark ? '#B8B8B8' : '#505050'}" stroke-width="3.6" opacity="${dark ? .16 : .14}"/>` : '';
    return `${halo}<circle data-ring="${index + 1}" cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${circles}</svg>`;
}

module.exports = { ORDER_RING_GEOMETRY, ORDER_RING_COLORS, orderRingSvg };
