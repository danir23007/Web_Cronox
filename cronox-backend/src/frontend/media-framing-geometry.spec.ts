/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const geometryScript = readFileSync(
  path.resolve(
    __dirname,
    '../../../cronox-front/assets/media-framing-geometry.js',
  ),
  'utf8',
);

const loadEngine = () => {
  const dom = new JSDOM('<div id="frame"><video id="media"></video></div>', {
    runScripts: 'outside-only',
  });
  dom.window.eval(geometryScript);
  return {
    dom,
    engine: (dom.window as any).CRONOX_MEDIA_GEOMETRY,
  };
};

const cover = {
  mediaWidth: 1920,
  mediaHeight: 1080,
  fit: 'COVER',
  zoom: 1,
  focalX: 50,
  focalY: 50,
};

describe('shared media framing geometry', () => {
  it('calculates wide desktop cover movement at 0, 50, and 100 percent', () => {
    const { engine } = loadEngine();
    const left = engine.calculate({
      ...cover,
      frameWidth: 1440,
      frameHeight: 900,
      focalX: 0,
    });
    const center = engine.calculate({
      ...cover,
      frameWidth: 1440,
      frameHeight: 900,
    });
    const right = engine.calculate({
      ...cover,
      frameWidth: 1440,
      frameHeight: 900,
      focalX: 100,
    });

    expect(left.translateX).toBeCloseTo(0);
    expect(center.translateX).toBeCloseTo(-80);
    expect(right.translateX).toBeCloseTo(-160);
    expect(center.movementX).toBe(true);
    expect(center.movementY).toBe(false);
  });

  it.each([
    ['landscape tablet', 1024, 768],
    ['tablet', 768, 1024],
    ['mobile', 390, 844],
  ])(
    'calculates the large horizontal %s crop for a 16:9 video',
    (_label, width, height) => {
      const { engine } = loadEngine();
      const result = engine.calculate({
        ...cover,
        frameWidth: width,
        frameHeight: height,
      });

      expect(result.valid).toBe(true);
      expect(result.renderedWidth).toBeGreaterThan(width);
      expect(result.renderedHeight).toBeCloseTo(height);
      expect(result.movementX).toBe(true);
      expect(result.movementY).toBe(false);
    },
  );

  it('creates vertical travel for a short, extra-wide desktop viewport', () => {
    const { engine } = loadEngine();
    const top = engine.calculate({
      ...cover,
      frameWidth: 1920,
      frameHeight: 600,
      focalY: 0,
    });
    const bottom = engine.calculate({
      ...cover,
      frameWidth: 1920,
      frameHeight: 600,
      focalY: 100,
    });

    expect(top.movementX).toBe(false);
    expect(top.movementY).toBe(true);
    expect(top.translateY).toBeCloseTo(0);
    expect(bottom.translateY).toBeCloseTo(-480);
  });

  it('uses predictable contain free space and disables an axis with no travel', () => {
    const { engine } = loadEngine();
    const top = engine.calculate({
      ...cover,
      frameWidth: 1440,
      frameHeight: 900,
      fit: 'CONTAIN',
      focalY: 0,
    });
    const middle = engine.calculate({
      ...cover,
      frameWidth: 1440,
      frameHeight: 900,
      fit: 'CONTAIN',
      focalY: 50,
    });
    const bottom = engine.calculate({
      ...cover,
      frameWidth: 1440,
      frameHeight: 900,
      fit: 'CONTAIN',
      focalY: 100,
    });

    expect(middle.movementX).toBe(false);
    expect(middle.movementY).toBe(true);
    expect(top.translateY).toBeCloseTo(0);
    expect(middle.translateY).toBeCloseTo(45);
    expect(bottom.translateY).toBeCloseTo(90);
  });

  it('creates both-axis travel when zoom is greater than one', () => {
    const { engine } = loadEngine();
    const start = engine.calculate({
      ...cover,
      frameWidth: 1440,
      frameHeight: 900,
      zoom: 1.5,
      focalX: 0,
      focalY: 0,
    });
    const end = engine.calculate({
      ...cover,
      frameWidth: 1440,
      frameHeight: 900,
      zoom: 1.5,
      focalX: 100,
      focalY: 100,
    });

    expect(end.movementX).toBe(true);
    expect(end.movementY).toBe(true);
    expect(end.translateX).not.toBe(start.translateX);
    expect(end.translateY).not.toBe(start.translateY);
  });

  it('clamps inputs and cover never exposes an empty band', () => {
    const { engine } = loadEngine();
    const result = engine.calculate({
      ...cover,
      frameWidth: 390,
      frameHeight: 844,
      focalX: 500,
      focalY: -200,
      zoom: 99,
    });

    expect(result.focalX).toBe(100);
    expect(result.focalY).toBe(0);
    expect(result.zoom).toBe(3);
    expect(result.translateX).toBeLessThanOrEqual(0);
    expect(result.translateY).toBeLessThanOrEqual(0);
    expect(result.translateX + result.renderedWidth).toBeGreaterThanOrEqual(
      390,
    );
    expect(result.translateY + result.renderedHeight).toBeGreaterThanOrEqual(
      844,
    );
  });

  it.each([
    {},
    { frameWidth: 0, frameHeight: 900, mediaWidth: 1920, mediaHeight: 1080 },
    {
      frameWidth: 1440,
      frameHeight: 900,
      mediaWidth: Number.NaN,
      mediaHeight: 1080,
    },
  ])('returns finite safe state for invalid or missing dimensions', (input) => {
    const { engine } = loadEngine();
    expect(engine.calculate(input)).toEqual({
      valid: false,
      movementX: false,
      movementY: false,
      travelX: 0,
      travelY: 0,
    });
  });

  it('maps pointer dragging through the same travel bounds as the sliders', () => {
    const { engine } = loadEngine();
    const geometry = engine.calculate({
      ...cover,
      frameWidth: 1440,
      frameHeight: 900,
    });
    const moved = engine.focalFromDrag(
      geometry,
      { focalX: 50, focalY: 50 },
      40,
      100,
    );

    expect(moved.focalX).toBeCloseTo(25);
    expect(moved.focalY).toBe(50);
  });

  it('recalculates on resize and produces identical admin/public styles', () => {
    const { dom, engine } = loadEngine();
    const document = dom.window.document;
    const publicFrame = document.getElementById('frame') as HTMLElement;
    const publicMedia = document.getElementById('media') as HTMLElement;
    const adminFrame = document.createElement('div');
    const adminMedia = document.createElement('video');
    adminFrame.appendChild(adminMedia);

    const options = {
      frameWidth: 390,
      frameHeight: 844,
      mediaWidth: 1920,
      mediaHeight: 1080,
    };
    engine.apply(publicMedia, publicFrame, cover, options);
    engine.apply(adminMedia, adminFrame, cover, options);
    expect(adminMedia.style.cssText).toBe(publicMedia.style.cssText);

    const desktop = engine.calculate({
      ...cover,
      frameWidth: 1440,
      frameHeight: 900,
    });
    const mobile = engine.calculate({ ...cover, ...options });
    expect(mobile.renderedWidth).not.toBe(desktop.renderedWidth);
    expect(mobile.translateX).not.toBe(desktop.translateX);
  });
});
