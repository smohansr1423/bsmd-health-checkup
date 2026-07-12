import fc from 'fast-check';
import { PACKAGE_NAME } from './index';

/**
 * Scaffolding smoke tests: verify the Jest + fast-check toolchain is wired for
 * this package. Design correctness properties (Property 1..61) are implemented
 * in later tasks.
 */
describe('@calorie-cortisol/shared scaffolding', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@calorie-cortisol/shared');
  });

  it('runs the fast-check property toolchain (min 100 iterations)', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => Number.isInteger(n))
    );
  });
});
