// Package main is the entrypoint for the User & Profile Service (Go / PostgreSQL).
//
// The local "dev mode" bootstrap (see dev_server.go) starts a net/http server
// on PORT (default 8081) that mounts the service's existing handlers backed by
// the in-memory stores the package already ships — no PostgreSQL required.
package main

import "log"

// PackageName identifies this service.
const PackageName = "user-profile"

func main() {
	_ = PackageName
	if err := RunDevServer(); err != nil {
		log.Fatalf("[user-profile] server error: %v", err)
	}
}
