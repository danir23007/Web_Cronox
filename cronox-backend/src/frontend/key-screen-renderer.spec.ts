/* eslint-disable @typescript-eslint/no-require-imports */
import path from 'node:path';

const frontendAssets = path.resolve(__dirname, '../../../cronox-front/assets');
const geometry = require(
  path.join(frontendAssets, 'media-framing-geometry.js'),
);
const renderer = require(path.join(frontendAssets, 'key-screen-renderer.js'));

describe('Pantalla Clave shared renderer', () => {
  it('uses the canonical breakpoint and independent responsive values', () => {
    const screen = {
      desktopFocalX: 20,
      desktopFocalY: 30,
      desktopZoom: 1.2,
      desktopFit: 'COVER',
      desktopHorizontalAlign: 'LEFT',
      desktopVerticalAlign: 'TOP',
      desktopOffsetX: 12,
      desktopOffsetY: 18,
      mobileFocalX: 70,
      mobileFocalY: 80,
      mobileZoom: 1.7,
      mobileFit: 'CONTAIN',
      mobileHorizontalAlign: 'RIGHT',
      mobileVerticalAlign: 'BOTTOM',
      mobileOffsetX: -22,
      mobileOffsetY: -28,
      desktopFormOffsetY: 35,
      mobileFormOffsetY: -45,
      desktopPrivacyOffsetY: -10,
      mobilePrivacyOffsetY: -30,
    };

    expect(renderer.deviceForWidth(640)).toBe('mobile');
    expect(renderer.deviceForWidth(641)).toBe('desktop');
    expect(renderer.resolve(screen, 'desktop')).toMatchObject({
      focalX: 20,
      horizontalAlign: 'LEFT',
      offsetX: 12,
      formOffsetY: 35,
    });
    expect(renderer.resolve(screen, 'mobile')).toMatchObject({
      focalX: 70,
      zoom: 1.7,
      fit: 'CONTAIN',
      horizontalAlign: 'RIGHT',
      offsetX: -22,
      formOffsetY: -45,
      privacyOffsetY: -30,
    });
  });

  it('preserves legacy layouts when responsive fields are absent', () => {
    const resolved = renderer.resolve(
      {
        desktopFocalX: 51,
        desktopFocalY: 52,
        desktopZoom: 1.05,
        desktopFit: 'COVER',
        horizontalAlign: 'CENTER',
        verticalAlign: 'BOTTOM',
        offsetX: 9,
        offsetY: -17,
      },
      'mobile',
    );
    expect(resolved).toMatchObject({
      focalX: 51,
      focalY: 52,
      zoom: 1.05,
      horizontalAlign: 'CENTER',
      verticalAlign: 'BOTTOM',
      offsetX: 9,
      offsetY: -17,
    });
  });

  it('turns a media drag into focal coordinates and keeps zoom under the cursor', () => {
    const before = geometry.calculate({
      frameWidth: 390,
      frameHeight: 844,
      mediaWidth: 1600,
      mediaHeight: 900,
      focalX: 50,
      focalY: 50,
      zoom: 1,
      fit: 'COVER',
    });
    const dragged = geometry.focalFromDrag(before, before, 40, -60);
    expect(dragged.focalX).toBeLessThan(50);
    expect(dragged.focalY).toBe(50);

    const cursor = { x: 120, y: 300 };
    const mediaPointBefore = {
      x: (cursor.x - before.translateX) / before.scale,
      y: (cursor.y - before.translateY) / before.scale,
    };
    const zoomed = geometry.zoomAtPoint(before, 1.5, cursor.x, cursor.y);
    expect(zoomed.zoom).toBe(1.5);
    const after = geometry.calculate({
      frameWidth: 390,
      frameHeight: 844,
      mediaWidth: 1600,
      mediaHeight: 900,
      ...zoomed,
      fit: 'COVER',
    });
    expect(after.translateX + mediaPointBefore.x * after.scale).toBeCloseTo(
      cursor.x,
      5,
    );
    expect(after.translateY + mediaPointBefore.y * after.scale).toBeCloseTo(
      cursor.y,
      5,
    );
  });

  it('keeps dragged content fully inside each virtual viewport', () => {
    expect(
      renderer.clampContentOffsets({
        viewportWidth: 390,
        viewportHeight: 844,
        contentWidth: 350,
        contentHeight: 300,
        horizontalAlign: 'CENTER',
        verticalAlign: 'CENTER',
        offsetX: 999,
        offsetY: -999,
      }),
    ).toEqual({ offsetX: 20, offsetY: -272 });
  });
});
