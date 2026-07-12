import fc from 'fast-check';
import { PACKAGE_NAME } from './index';

/**
 * Scaffolding smoke tests: verify the Jest + fast-check toolchain is wired.
 * Design correctness properties are implemented in later tasks.
 */
describe('@calorie-cortisol/notification scaffolding', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@calorie-cortisol/notification');
  });

  it('runs the fast-check property toolchain (min 100 iterations)', () => {
    fc.assert(
      fc.property(fc.nat(), (n) => n >= 0)
    );
  });
});
