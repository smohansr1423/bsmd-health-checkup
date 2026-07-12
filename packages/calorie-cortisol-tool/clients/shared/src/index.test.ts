import fc from 'fast-check';
import { PACKAGE_NAME } from './index';

/**
 * Scaffolding smoke tests: verify the Jest + fast-check toolchain is wired.
 * Design correctness properties are implemented in later tasks.
 */
describe('@calorie-cortisol/client-shared scaffolding', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@calorie-cortisol/client-shared');
  });

  it('runs the fast-check property toolchain (min 100 iterations)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (xs) => Array.isArray(xs))
    );
  });
});
