import { describe, expect, it } from 'vitest';
import { CARD_WIDTH, drawShotCard } from './shotCard.js';

function render(shot, options = {}, referenceShot) {
  const texts = [], commands = [];
  const ctx = { fillRect() {}, fillText(value) { texts.push(value); }, measureText(value) { return { width: value.length * 10 }; },
    beginPath() {}, stroke() {}, arc() {}, fill() {}, moveTo(x, y) { commands.push(['move', x, y]); }, lineTo(x, y) { commands.push(['line', x, y]); } };
  const canvas = { getContext: () => ctx };
  drawShotCard(canvas, { shot, bean: { name: 'Private bean' }, grind: 'Private grinder', referenceShot,
    options: { brand: false, bean: false, grinder: false, date: false, notes: false, ...options } });
  return { canvas, texts, commands };
}
const manual = { actualDoseG: 18, actualYieldG: 36, actualTimeS: 30, timestamp: '2025-01-01', notes: 'Private notes' };
describe('shot card rendering', () => {
  it('renders manual shots and redacts private fields by default', () => {
    const { canvas, texts } = render(manual);
    expect(canvas.width).toBe(CARD_WIDTH);
    expect(canvas.height).toBeGreaterThan(500);
    expect(texts).toContain('Manual shot · no sensor curves recorded');
    expect(texts.join(' ')).not.toMatch(/Private|2025|ESPRESSO DIAL-IN/);
    expect(texts).toContain('1:2.0');
  });
  it('includes opted-in fields and a reference', () => {
    const { texts, canvas } = render(manual, { bean: true, grinder: true, notes: true, brand: true }, manual);
    expect(texts.join(' ')).toMatch(/Private bean.*Private grinder.*Private notes/);
    expect(texts).toContain('BEAN REFERENCE');
    expect(canvas.height).toBeGreaterThan(render(manual).canvas.height);
  });
  it('keeps zero and breaks a curve at missing samples', () => {
    const { texts, commands } = render({ ...manual, labPressureCurve: [{ tS: 0, bar: 0 }, { tS: 0.1, bar: 1 }, { tS: 0.2, bar: null }, { tS: 0.3, bar: 2 }] });
    expect(texts).toContain('0.0');
    expect(texts).toContain('GAPS ▾');
    expect(commands.filter(([op]) => op === 'move').length).toBeGreaterThanOrEqual(3);
  });
});
