package lifecycle

import (
	"log/slog"
	"os"
	"runtime"
	"strings"
)

// SanitizedEnv returns a minimal environment for running agent CLI processes.
// It does NOT inherit the full parent OS environment — only explicitly whitelisted
// variables and explicitly provided extra env vars are passed through.
//
// When profileEnv is non-nil, it is used as-is (the caller has explicitly
// configured the environment). When nil, the parent environment is filtered
// to a safe subset.
//
// extraEnv contains additional KEY=VALUE pairs to append (e.g., AgentHub
// runtime vars like AGENTHUB_RUN_ID).
func SanitizedEnv(profileEnv, extraEnv []string) []string {
	if profileEnv != nil {
		env := make([]string, 0, len(profileEnv)+len(extraEnv))
		env = append(env, profileEnv...)
		env = append(env, extraEnv...)
		return env
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
	} {
		if upper == name {
			return true
		}
	}

	return false
}

// isWhitelistedEnvKey returns true when key is safe to pass through to child
// agent processes.
func isWhitelistedEnvKey(key string) bool {
	upperKey := strings.ToUpper(key)

	// AgentHub-managed vars always pass through.
	if strings.HasPrefix(upperKey, "AGENTHUB_") {
		return true
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
		"GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM",
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

// sanitizeParentEnv filters os.Environ() to safe variables and appends extraEnv.
func sanitizeParentEnv(extraEnv []string) []string {
	var env []string
	for _, kv := range os.Environ() {
		key, _, found := strings.Cut(kv, "=")
		if !found {
			continue
		}
		if isWhitelistedEnvKey(key) {
			env = append(env, kv)
		} else if IsSensitiveEnvKey(key) {
			slog.Debug("sensitive env var filtered from agent process", "key", key)
		}
	}
	env = append(env, extraEnv...)
	return env
}
