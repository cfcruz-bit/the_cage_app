import { describe, expect, it } from 'vitest';
import { parseLoadInput } from './loadInput';

describe('parseLoadInput', () => {
  it('vacío es "empty", no un error', () => {
    expect(parseLoadInput('', 'kg')).toEqual({ kind: 'empty' });
    expect(parseLoadInput('   ', 'kg')).toEqual({ kind: 'empty' });
  });

  it('acepta coma decimal como los teclados en español', () => {
    expect(parseLoadInput('102,5', 'kg')).toEqual({ kind: 'kg', value: 102.5 });
  });

  it('acepta el espacio antes del símbolo de porcentaje', () => {
    expect(parseLoadInput('75 %', 'kg')).toEqual({ kind: 'percent', value: 75 });
    expect(parseLoadInput('75%', 'kg')).toEqual({ kind: 'percent', value: 75 });
  });

  it('respeta los límites 30 y 110 del porcentaje', () => {
    expect(parseLoadInput('30%', 'kg')).toEqual({ kind: 'percent', value: 30 });
    expect(parseLoadInput('110%', 'kg')).toEqual({ kind: 'percent', value: 110 });
    expect(parseLoadInput('29%', 'kg').kind).toBe('invalid');
    expect(parseLoadInput('111%', 'kg').kind).toBe('invalid');
  });

  it('un peso en libras se convierte a kg antes de salir', () => {
    // toKg(225, 'lb') = round((225 / 2.2046) * 100) / 100
    const result = parseLoadInput('225', 'lb');
    expect(result.kind).toBe('kg');
    if (result.kind === 'kg') {
      expect(result.value).toBeCloseTo(102.06, 1);
    }
  });

  it('el porcentaje NO depende de la unidad de pantalla', () => {
    expect(parseLoadInput('75%', 'lb')).toEqual({ kind: 'percent', value: 75 });
  });

  it('rechaza kilos en cero o negativos', () => {
    expect(parseLoadInput('0', 'kg').kind).toBe('invalid');
    expect(parseLoadInput('-10', 'kg').kind).toBe('invalid');
  });

  it('rechaza texto que no es un número', () => {
    expect(parseLoadInput('abc', 'kg').kind).toBe('invalid');
    expect(parseLoadInput('%', 'kg').kind).toBe('invalid');
  });
});
