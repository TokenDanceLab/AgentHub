package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Residual pure-helper peel #1134: Config root, Load, and Validate glue.
// Domain sections and env helpers live in companion files.

type Config struct {
	Server       ServerConfig       `mapstructure:"server"`
	DB           DBConfig           `mapstructure:"db"`
	Redis        RedisConfig        `mapstructure:"redis"`
	JWT          JWTConfig          `mapstructure:"jwt"`
	Upload       UploadConfig       `mapstructure:"upload"`
	S3           S3Config           `mapstructure:"s3"`
	TokenDanceID TokenDanceIDConfig `mapstructure:"tokendance_id"`
	AgentTeam    AgentTeamConfig    `mapstructure:"agent_team"`
	Egress       EgressConfig       `mapstructure:"egress"`
	Edge         EdgeDispatchConfig `mapstructure:"edge"`
}

// EdgeDispatchConfig is the Hub→trusted-Edge dispatch client config (#1549).
// Env binding: AGENTHUB_EDGE_URL / AGENTHUB_EDGE_AUTH_TOKEN /
// AGENTHUB_EDGE_DEVICE_ID / AGENTHUB_EDGE_TIMEOUT (viper AutomaticEnv with
// the "."→"_" replacer), so existing deployments keep working unchanged.
// Read at startup by the composition root; the service layer never calls
// os.Getenv.
type EdgeDispatchConfig struct {
	URL       string        `mapstructure:"url"`
	AuthToken string        `mapstructure:"auth_token"`
	DeviceID  string        `mapstructure:"device_id"`
	Timeout   time.Duration `mapstructure:"timeout"`
}

// EgressConfig is the outbound HTTP policy (#1540). Default-deny: an empty
// allowlist refuses every dial to loopback/private/link-local/metadata
// networks. Ping of user-supplied execution-target addresses therefore
// fails closed until an administrator explicitly allows the target ranges.
type EgressConfig struct {
	AllowCIDRs     []string      `mapstructure:"allow_cidrs"`
	AllowHostnames []string      `mapstructure:"allow_hostnames"`
	AllowPlainHTTP bool          `mapstructure:"allow_plain_http"`
	Timeout        time.Duration `mapstructure:"timeout"`
}

func Load(configPath string) (*Config, error) {
	v := viper.New()
	v.SetConfigFile(configPath)
	v.SetEnvPrefix("AGENTHUB")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()
	v.SetDefault("db.sslmode", "disable")
	v.SetDefault("db.application_name", "agenthub")
	v.SetDefault("db.max_open_conns", 2)
	v.SetDefault("db.max_idle_conns", 1)
	v.SetDefault("db.conn_max_lifetime", 30*time.Minute)
	v.SetDefault("db.conn_max_idle_time", 5*time.Minute)
	v.SetDefault("upload.allowed_mime_types", DefaultAllowedUploadMimeTypes)
	// #1549: Hub→Edge dispatch timeout default keeps the historical
	// EdgeHTTPClientTimeoutSeconds=10 semantics. URL/token/device-id are
	// registered with empty defaults so AutomaticEnv can bind the
	// AGENTHUB_EDGE_* vars even when the yaml has no edge section (viper's
	// AllSettings only walks registered keys).
	v.SetDefault("edge.url", "")
	v.SetDefault("edge.auth_token", "")
	v.SetDefault("edge.device_id", "")
	v.SetDefault("edge.timeout", 10*time.Second)
	// #1564: TokenDance ID outbound client policy defaults (10s timeout,
	// 64 KiB fail-closed response cap) keep the historical behavior.
	v.SetDefault("tokendance_id.http_timeout", 10*time.Second)
	v.SetDefault("tokendance_id.max_response_body_bytes", int64(64*1024))
	setAgentTeamDefaults(v)

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	if err := applyEnvOverrides(&cfg); err != nil {
		return nil, err
	}

	// Auto-derive JWKS URI from issuer URL when not explicitly set.
	if cfg.TokenDanceID.JWKSURI == "" && cfg.TokenDanceID.IssuerURL != "" {
		cfg.TokenDanceID.JWKSURI = cfg.TokenDanceID.IssuerURL + "/oidc/jwks"
	}
	// Auto-derive token endpoint from issuer URL when not explicitly set.
	if cfg.TokenDanceID.TokenURL == "" && cfg.TokenDanceID.IssuerURL != "" {
		cfg.TokenDanceID.TokenURL = cfg.TokenDanceID.IssuerURL + "/oidc/token"
	}
	cfg.AgentTeam = cfg.AgentTeam.withDefaults()

	return &cfg, nil
}

// Validate checks that the loaded configuration is usable at startup.
// It rejects insecure defaults, missing infrastructure addresses, and
// missing directories that the server depends on.
func (c *Config) Validate() error {
	if err := c.validateServerEnv(); err != nil {
		return err
	}
	if err := c.validateProdGuard(); err != nil {
		return err
	}
	if err := c.validateDB(); err != nil {
		return err
	}
	if err := c.validateRedis(); err != nil {
		return err
	}
	if err := c.validateJWT(); err != nil {
		return err
	}
	if err := c.validateTokenDanceID(); err != nil {
		return err
	}

	c.AgentTeam = c.AgentTeam.withDefaults()
	if err := c.AgentTeam.Validate(); err != nil {
		return err
	}

	if err := c.S3.Validate(); err != nil {
		return err
	}

	// Upload: if local storage is used and a directory is configured, it must exist.
	if !c.S3.IsConfigured() && c.Upload.Dir != "" {
		if _, err := os.Stat(c.Upload.Dir); os.IsNotExist(err) {
			return fmt.Errorf("upload directory does not exist: %s", c.Upload.Dir)
		}
	}

	return nil
}
