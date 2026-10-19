// Package migrations embeds the SQL migration set so release binaries can
// apply schema migrations without a repository checkout.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
