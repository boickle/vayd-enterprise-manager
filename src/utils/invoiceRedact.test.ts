import { describe, expect, it } from 'vitest';
import {
  deaBoxesFromText,
  deaCheckDigitOk,
  findDeaSpans,
  padReaderBox,
  type PlacedText,
} from './invoiceRedact';

describe('DEA check digit', () => {
  it('accepts real-shaped numbers whose check digit adds up', () => {
    // 1+3+5 + 2*(2+4+6) = 33 -> 3
    expect(deaCheckDigitOk('AB1234563')).toBe(true);
    // From the owner's Covetrus example: supplier DEA and doctor DEA.
    expect(deaCheckDigitOk('RB0394940')).toBe(true);
    expect(deaCheckDigitOk('FP7683851')).toBe(true);
  });

  it('rejects a wrong check digit and other codes', () => {
    expect(deaCheckDigitOk('AB1234564')).toBe(false);
    expect(deaCheckDigitOk('GA87264')).toBe(false);
    expect(deaCheckDigitOk('1234567AB')).toBe(false);
  });
});

describe('finding DEA numbers in text', () => {
  it('finds them after a label, with or without a space before the digits', () => {
    const spans = findDeaSpans('DEA # RB0394940   DEA NUMBER FP 7683851');
    expect(spans.map((s) => s.dea)).toEqual(['RB0394940', 'FP7683851']);
  });

  it('ignores invoice and account numbers that only look close', () => {
    expect(findDeaSpans('INVOICE GA87264  03-Etown-CS-PA#3000010294  PO VC0SWFFN')).toEqual([]);
  });

  it('covers a number the reader listed even if its check digit is off (misprint)', () => {
    expect(findDeaSpans('DEA AB1234564')).toEqual([]);
    expect(findDeaSpans('DEA AB1234564', new Set(['AB1234564'])).map((s) => s.dea)).toEqual([
      'AB1234564',
    ]);
  });
});

describe('placing DEA numbers from a PDF text layer', () => {
  const run = (str: string, x: number, y: number, width: number, height = 10): PlacedText => ({
    str,
    x,
    y,
    width,
    height,
  });

  it('boxes just the number inside a longer run', () => {
    // "DEA # RB0394940" at 10 px per character.
    const [hit] = deaBoxesFromText([run('DEA # RB0394940', 100, 200, 150)]);
    expect(hit.dea).toBe('RB0394940');
    const [l, t, r, b] = hit.box;
    expect(l).toBeCloseTo(160 - 2);
    expect(r).toBeCloseTo(250 + 2);
    expect(t).toBeLessThanOrEqual(190);
    expect(b).toBeGreaterThan(200);
  });

  it('joins a number split across two runs on the same line', () => {
    const hits = deaBoxesFromText([run('FP768385', 300, 400, 80), run('1', 380, 400, 10)]);
    expect(hits).toHaveLength(1);
    expect(hits[0].dea).toBe('FP7683851');
    expect(hits[0].box[2]).toBeCloseTo(392);
  });

  it('does not join runs from different lines', () => {
    expect(deaBoxesFromText([run('FP768', 300, 400, 50), run('3851', 350, 430, 40)])).toEqual([]);
  });
});

describe('padding the reader box on a photo', () => {
  it('covers more than the box and stays on the page', () => {
    const [l, t, r, b] = padReaderBox([0.5, 0.5, 0.6, 0.52], 1000, 1000);
    expect(l).toBeLessThan(500);
    expect(t).toBeLessThan(500);
    expect(r).toBeGreaterThan(600);
    expect(b).toBeGreaterThan(520);
    expect(padReaderBox([0, 0, 1, 1], 100, 100)).toEqual([0, 0, 100, 100]);
  });
});
