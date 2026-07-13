// Scaffolding smoke test: verify the gopter property-testing toolchain is wired.
// Design correctness properties (e.g. Property 42..49, 53) are implemented in
// later tasks.
package main

import (
	"testing"

	"github.com/leanovate/gopter"
	"github.com/leanovate/gopter/gen"
	"github.com/leanovate/gopter/prop"
)

func TestPackageName(t *testing.T) {
	if PackageName != "user-profile" {
		t.Fatalf("expected package name %q, got %q", "user-profile", PackageName)
	}
}

func TestGopterToolchainRuns(t *testing.T) {
	parameters := gopter.DefaultTestParameters()
	parameters.MinSuccessfulTests = 10 // reduced from 100 for faster local runs

	properties := gopter.NewProperties(parameters)
	properties.Property("non-negative ints stay non-negative", prop.ForAll(
		func(n int) bool {
			if n < 0 {
				n = -n
			}
			return n >= 0
		},
		gen.Int(),
	))

	properties.TestingRun(t)
}
