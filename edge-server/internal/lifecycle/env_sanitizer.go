package lifecycle

import (
	"log/slog"
	"os"
	"runtime"
	"strings"
)

// EnvFilterAudit records the results of an environment variable filtering pass.
// It is returned by SanitizedEnv so callers can log structured summaries and,
// at DEBUG level, inspect which specific keys were filtered.
//
// FilteredKeys contains key names only — values are NEVER captured.
//
// # Structured Log Format
//
// sanitizeParentEnv emits a single structured INFO log with these keys:
//
//	"total"           — total env vars processed (parent + extra), maps to TotalVars
//	"passed"          — vars that passed through (whitelisted + extra), maps to PassedVars
//	"sensitive"       — vars blocked by IsSensitiveEnvKey, maps to SensitiveVars
//	"not_whitelisted" — vars blocked because not in the approved whitelist, maps to NotWhitelisted
//
// At DEBUG level, an additional log is emitted:
//
//	"filteredKeys" — []string of key names that were filtered (keys only, never values)
//
// The INFO log is always emitted (even when zero vars are filtered) so operators
// can confirm filtering is active. The DEBUG log is suppressed at default log
// levels to avoid leaking key names into production logs.
//
// Callers (e.g., envForRun in process_executor.go) may also emit run-scoped audit
// logs using the same field names when SensitiveVars > 0 or NotWhitelisted > 0,
// adding a "runId" key for correlation.
type EnvFilterAudit struct {
	TotalVars      int      // total env vars processed (parent + extra)
	PassedVars     int      // passed through whitelist + extra env
	SensitiveVars  int      // blocked as sensitive (key pattern match)
	NotWhitelisted int      // blocked as not in whitelist
	FilteredKeys   []string // filtered key names (for DEBUG only, never contains values)
}

// SanitizedEnv returns a minimal environment for running agent CLI processes.
// It does NOT inherit the full parent OS environment — only explicitly whitelisted
// variables and explicitly provided extra env vars are passed through.
//
// When profileEnv is non-nil, it is used as-is (the caller has explicitly
// configured the environment). When nil, the parent environment is filtered
// to a safe subset via sanitizeParentEnv.
//
// extraEnv contains additional KEY=VALUE pairs to append (e.g., AgentHub
// runtime vars like AGENTHUB_RUN_ID). These always pass through unconditionally
// — they are appended after filtering, never inspected by IsSensitiveEnvKey or
// isWhitelistedEnvKey.
//
// # Structured Logging Side Effects
//
// When profileEnv is nil, sanitizeParentEnv emits structured logs:
//   - INFO: "env filtered for agent process" with keys total/passed/sensitive/not_whitelisted
//   - DEBUG: "env filtered keys" with key filteredKeys (key names only, never values)
//
// When profileEnv is non-nil, the caller (envForRun) is responsible for logging
// warnings about sensitive-looking keys in the explicitly configured environment.
//
// The returned EnvFilterAudit provides structured counts of the filtering
// pass for further logging and reporting by callers.
func SanitizedEnv(profileEnv, extraEnv []string) ([]string, EnvFilterAudit) {
	if profileEnv != nil {
		env := make([]string, 0, len(profileEnv)+len(extraEnv))
		env = append(env, profileEnv...)
		env = append(env, extraEnv...)
		return env, EnvFilterAudit{
			TotalVars:  len(env),
			PassedVars: len(env),
		}
	}
	return sanitizeParentEnv(extraEnv)
}

// IsSensitiveEnvKey returns true if the env var name looks like a secret
// (key, token, password, credential, etc.).
func IsSensitiveEnvKey(key string) bool {
	upper := strings.ToUpper(key)

	// Suffix patterns — typical naming conventions for secrets.
	for _, suffix := range []string{
		"_KEY",
		"_SECRET",
		"_TOKEN",
		"_PASSWORD",
		"_PASSWD",
		"_CREDENTIAL",
		"_CREDENTIALS",
		"_AUTH_TOKEN",
		"_PRIVATE_KEY",
		"_API_SECRET",
	} {
		if strings.HasSuffix(upper, suffix) {
			return true
		}
	}

	// Exact-match patterns for well-known secret env vars.
	for _, name := range []string{
		"AWS_ACCESS_KEY_ID",
		"AWS_SECRET_ACCESS_KEY",
		"AWS_SESSION_TOKEN",
		"DATABASE_URL",
		"DATABASE_PASSWORD",
		"DB_URL",
		"MONGODB_URI",
		"REDIS_URL",
		"CONNECTION_STRING",
		"PGPASSWORD",
		"MYSQL_PWD",
		"DOCKER_PASSWORD",
		"DOCKER_AUTH",
		"GITHUB_TOKEN",
		"GITLAB_TOKEN",
		"BITBUCKET_TOKEN",
		"NPM_TOKEN",
		"NUGET_API_KEY",
		"PYPI_TOKEN",
		"AZURE_STORAGE_KEY",
		"AZURE_CLIENT_SECRET",
		"GOOGLE_APPLICATION_CREDENTIALS",
		"KUBECONFIG",
		"JWT_SECRET",
		"ENCRYPTION_KEY",
		"MASTER_KEY",
		"SIGNING_KEY",
		"SSH_PRIVATE_KEY",
		"CODEX_ACCESS_TOKEN",
		"CODEX_CONNECTORS_TOKEN",
		"OPENAI_API_KEY",
		"ANTHROPIC_API_KEY",
		"CLAUDE_API_KEY",
		"GIT_CONFIG_GLOBAL",
		"GIT_CONFIG_SYSTEM",
	} {
		if upper == name {
			return true
		}
	}

	return false
}

// isWhitelistedEnvKey returns true when key is safe to pass through to child
// agent processes from the inherited (parent process) environment.
//
// AGENTHUB_* vars are NOT broadly whitelisted. Only explicitly approved vars
// listed in isSafeInheritedAgentHubEnvKey pass through from the parent env.
// Profile-configured env (profileEnv non-nil in SanitizedEnv) bypasses this
// check entirely — those vars are explicitly configured by the administrator.
func isWhitelistedEnvKey(key string) bool {
	upperKey := strings.ToUpper(key)

	// AgentHub-managed vars: only explicit safe vars pass through from inherited env.
	if strings.HasPrefix(upperKey, "AGENTHUB_") {
		return isSafeInheritedAgentHubEnvKey(upperKey)
	}

	// XDG base directories (XDG_*).
	if strings.HasPrefix(upperKey, "XDG_") {
		return true
	}

	// --- Cross-platform (Unix + Windows) ---

	commonWhitelist := []string{
		// File system / user identity
		"HOME", "USER", "LOGNAME",
		// Executable search
		"PATH",
		"TMPDIR", "TEMPDIR",
		// Locale
		"LANG",
		// Shell and terminal
		"SHELL", "TERM", "COLORTERM", "TERM_PROGRAM",
		// Display / graphical
		"DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY",
		"XDG_RUNTIME_DIR", "XDG_SESSION_TYPE", "XDG_CURRENT_DESKTOP",
		"DBUS_SESSION_BUS_ADDRESS",
		// SSH agent + connection context
		"SSH_AUTH_SOCK", "SSH_AGENT_PID",
		"SSH_CLIENT", "SSH_CONNECTION", "SSH_TTY",
		// Editors and pagers
		"EDITOR", "VISUAL", "PAGER", "BROWSER",
		// Process state
		"PWD", "OLDPWD", "SHLVL",
		// System info
		"HOSTNAME", "HOSTTYPE", "MACHTYPE", "OSTYPE",
		// Color control
		"NO_COLOR", "FORCE_COLOR", "CLICOLOR",
		// Node.js ecosystem
		"NVM_DIR", "NODE_PATH", "NPM_CONFIG_PREFIX", "NPM_CONFIG_CACHE",
		// Python ecosystem
		"PYTHONPATH", "PYTHONHOME",
		"VIRTUAL_ENV", "CONDA_PREFIX", "CONDA_DEFAULT_ENV", "CONDA_SHLVL",
		"PIP_REQUIRE_VIRTUALENV",
		// Java
		"JAVA_HOME", "JRE_HOME", "JDK_HOME",
		// Rust
		"RUSTUP_HOME", "CARGO_HOME",
		// Go
		"GOPATH", "GOROOT", "GOMODCACHE", "GOCACHE", "GOBIN",
		"GOFLAGS", "GOOS", "GOARCH", "GOTOOLCHAIN",
		"CGO_ENABLED", "CC", "CXX",
		// Deno / Bun / pnpm
		"DENO_INSTALL", "DENO_DIR",
		"BUN_INSTALL",
		"PNPM_HOME",
		// Proxy
		"HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
		"FTP_PROXY", "ALL_PROXY", "RSYNC_PROXY",
		// Lowercase proxy variants
		"http_proxy", "https_proxy", "no_proxy",
		// Tool pager / helpers
		"MANPATH", "INFOPATH",
		// VS Code integration (harmless IPC handles)
		"VSCODE_IPC_HOOK_CLI",
		"VSCODE_GIT_ASKPASS_NODE", "VSCODE_GIT_ASKPASS_MAIN",
		"VSCODE_GIT_IPC_HANDLE",
		// Timezone
		"TZ",
		// Git identity (read-only overrides, no tokens)
		"GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL",
		"GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL",
	}

	for _, w := range commonWhitelist {
		if upperKey == w {
			return true
		}
	}

	// Locale categories: LC_ALL, LC_CTYPE, LC_MESSAGES, etc.
	if strings.HasPrefix(upperKey, "LC_") {
		return true
	}

	// --- Windows-only variables ---
	if runtime.GOOS == "windows" {
		windowsWhitelist := []string{
			// Core OS paths
			"SYSTEMROOT", "SYSTEMDRIVE",
			"WINDIR", "COMSPEC",
			// User profile
			"USERPROFILE", "USERNAME", "USERDOMAIN",
			"HOMEDRIVE", "HOMEPATH",
			// Application data
			"APPDATA", "LOCALAPPDATA",
			// Program directories
			"PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA",
			"COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)",
			"COMMONPROGRAMW6432", "PROGRAMW6432",
			// Temp directories
			"TEMP", "TMP",
			// Path extension (e.g. .COM;.EXE;.BAT)
			"PATHEXT",
			// Machine identity
			"COMPUTERNAME",
			// Other useful
			"ALLUSERSPROFILE", "PUBLIC",
			"PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER",
			"PROCESSOR_LEVEL", "NUMBER_OF_PROCESSORS",
			"OS",
			"PSMODULEPATH",
		}

		for _, w := range windowsWhitelist {
			if upperKey == w {
				return true
			}
		}
	}

	return false
}

// isSafeInheritedAgentHubEnvKey returns true when an AGENTHUB_* env var is safe
// to inherit from the parent process environment into child agent processes.
//
// This is an explicit allowlist — only specific vars are approved. The broad
// AGENTHUB_ prefix is NOT a free pass. Vars not listed here are silently
// dropped from the inherited environment.
//
// Profile-configured env vars (passed via SanitizedEnv's profileEnv parameter)
// bypass this check entirely: those are explicitly configured by the administrator
// and pass through verbatim (with a warning for sensitive-looking keys).
func isSafeInheritedAgentHubEnvKey(upperKey string) bool {
	// Only explicitly listed AGENTHUB_* vars may be inherited from the parent
	// process environment. This prevents accidental leakage of internal Edge
	// server config vars (e.g., AGENTHUB_DB_URL, AGENTHUB_HUB_TOKEN, etc.)
	// into child agent subprocesses.
	safeVars := []string{
		"AGENTHUB_RUN_ID",
		"AGENTHUB_PROJECT_ID",
		"AGENTHUB_THREAD_ID",
	}
	for _, safe := range safeVars {
		if upperKey == safe {
			return true
		}
	}
	return false
}

// sanitizeParentEnv filters os.Environ() to safe variables, appends extraEnv,
// and returns a structured audit of the filtering pass.
//
// Filtering order for each parent env var:
//  1. IsSensitiveEnvKey(key) → counted as SensitiveVars, appended to FilteredKeys
//  2. isWhitelistedEnvKey(key) → counted as PassedVars, included in output
//  3. Otherwise → counted as NotWhitelisted, appended to FilteredKeys
//
// ExtraEnv vars are appended after filtering and are never subject to
// IsSensitiveEnvKey or isWhitelistedEnvKey checks — they always pass through.
//
// Structured logs emitted (via slog):
//
//	INFO  "env filtered for agent process"
//	      total=N, passed=N, sensitive=N, not_whitelisted=N
//	DEBUG "env filtered keys"
//	      filteredKeys=["KEY_NAME", ...]
//
// Key names (total, passed, sensitive, not_whitelisted, filteredKeys) are a
// stable contract — monitoring dashboards and alert rules may depend on them.
// Values are NEVER logged. The DEBUG log is suppressed at default log levels.
func sanitizeParentEnv(extraEnv []string) ([]string, EnvFilterAudit) {
	var audit EnvFilterAudit
	var env []string

	for _, kv := range os.Environ() {
		key, _, found := strings.Cut(kv, "=")
		if !found {
			continue
		}
		audit.TotalVars++
		switch {
		case IsSensitiveEnvKey(key):
			audit.SensitiveVars++
			audit.FilteredKeys = append(audit.FilteredKeys, key)
		case isWhitelistedEnvKey(key):
			audit.PassedVars++
			env = append(env, kv)
		default:
			audit.NotWhitelisted++
			audit.FilteredKeys = append(audit.FilteredKeys, key)
		}
	}

	// Append extraEnv unconditionally — caller-provided vars always pass through.
	env = append(env, extraEnv...)
	audit.TotalVars += len(extraEnv)
	audit.PassedVars += len(extraEnv)

	// Emit single structured INFO log — parseable, one line per filtering pass.
	slog.Info("env filtered for agent process",
		"total", audit.TotalVars,
		"passed", audit.PassedVars,
		"sensitive", audit.SensitiveVars,
		"not_whitelisted", audit.NotWhitelisted,
	)

	// At DEBUG level, log the actual filtered key names (keys only, NEVER values).
	if len(audit.FilteredKeys) > 0 {
		slog.Debug("env filtered keys", "filteredKeys", audit.FilteredKeys)
	}

	return env, audit
}
