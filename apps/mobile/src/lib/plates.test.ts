import { describe, expect, it } from 'vitest';
import { platesPerSide } from './plates';

describe('platesPerSide', () => {
  it('reparte del disco más pesado al más ligero', () => {
    expect(platesPerSide(142.5)).toEqual([25, 25, 10, 1.25]);
    expect(platesPerSide(127.5)).toEqual([25, 25, 2.5, 1.25]);
  });

  it('la barra sola no lleva discos', () => {
    expect(platesPerSide(20)).toEqual([]);
  });

  it('null si pesa menos que la barra o no cuadra con los discos', () => {
    expect(platesPerSide(15)).toBeNull();
    expect(platesPerSide(21)).toBeNull();
  });
});
