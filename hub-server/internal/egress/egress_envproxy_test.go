package egress

// 代理 env 的断言跑在**子进程**里，不是写法偏好而是必需：
// net/http.ProxyFromEnvironment 用进程级 sync.Once（envProxyOnce）把首次读到的
// HTTP_PROXY/HTTPS_PROXY/NO_PROXY 钉死到进程退出，父测试进程一旦求值过一次，
// 之后任何 t.Setenv 都不再生效 ⇒ `go test -count=2` 第二轮会连向上一轮已被
// t.Cleanup 关掉的 httptest 代理并 connection refused（#2254，CI 的 -count=1
// 永久掩盖了它，本地标准动作 -race -count=2 必撞）。子进程每轮都是干净缓存。
//
// 连带收益：父进程不再设置任何代理 env，于是本包其余测试「loopback 必须直连」
// 不再依赖本文件按字母序排在 egress_test.go 之前这一隐式顺序约束，
// 改由下面的 TestMain 显式钉住 NO_PROXY（与文件顺序、与开发机 ambient
// HTTP_PROXY 都解耦）。

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
)

// egressProxyHelperRunFlag 让子进程只跑 helper 本体，避免整包重跑。
const egressProxyHelperRunFlag = "-test.run=^TestEgressProxyEnvHelper$"

// egressProxyHelperEnvKey 标记「本进程是 TestProxyFromEnvironmentHonored 派生的子进程」。
// 与 edge-server/internal/lifecycle 的 AGENTHUB_PROCESS_EXECUTOR_HELPER 同族命名。
const egressProxyHelperEnvKey = "AGENTHUB_EGRESS_PROXY_HELPER"

// loopbackNoProxy 是本包所有非代理测试的直连前提：它们全部打向 127.0.0.1 上的
// httptest server，必须在 ProxyFromEnvironment 首次求值之前就排除代理。
const loopbackNoProxy = "127.0.0.1,localhost,::1"

// TestMain 在包级（而非某个恰好排第一的测试里）钉住 NO_PROXY，
// 使本包的直连假设不再依赖测试执行顺序或 ambient 代理配置。
// helper 子进程跳过：它的代理 env 由父进程精确注入，不许被覆盖。
func TestMain(m *testing.M) {
	if os.Getenv(egressProxyHelperEnvKey) != "1" {
		_ = os.Setenv("NO_PROXY", loopbackNoProxy)
	}
	os.Exit(m.Run())
}

// TestProxyFromEnvironmentHonored 证明代理配置路径 = 环境变量
// （HTTP_PROXY/NO_PROXY）：请求经代理以 absolute-form 发出，
// 拨号时 SSRF 地址校验作用于代理地址，目标主机本身不在本地解析/拨号。
// 目标选 192.0.2.1（TEST-NET-1，受限类）：若代理 env 未生效，
// dialContext 会在拨号前以策略错误失败，全程无真实外网连接。
// 注意：配置代理后受限网络检查作用于代理而非最终目标，
// 代理来自进程 env，其信任边界是管理员配置。
//
// 关键证据（代理命中数、absolute-form URL）由**父进程**侧的 httptest handler
// 观测，子进程无法自证；子进程只负责「在干净缓存下真的把请求发出去」。
func TestProxyFromEnvironmentHonored(t *testing.T) {
	var proxyHits int64
	var seenURL atomic.Value // holds string
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&proxyHits, 1)
		seenURL.Store(r.URL.String())
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(proxy.Close)

	// #nosec G204,G702 -- 子进程就是本测试二进制自身（os.Args[0]），命令名与参数
	// 全部为包内常量/自身路径，无任何外部输入参与拼接。
	cmd := exec.Command(os.Args[0], egressProxyHelperRunFlag, "-test.v=true")
	cmd.Env = append(withoutProxyEnv(os.Environ()),
		egressProxyHelperEnvKey+"=1",
		"HTTP_PROXY="+proxy.URL,
		"HTTPS_PROXY="+proxy.URL,
		// 保持 loopback 直连：子进程要回连父进程的 httptest 代理本身。
		"NO_PROXY=127.0.0.1,localhost,::1",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("proxy helper subprocess failed: %v\noutput:\n%s", err, output)
	}
	if !strings.Contains(string(output), "--- PASS: TestEgressProxyEnvHelper") {
		t.Fatalf("proxy helper subprocess did not report PASS\noutput:\n%s", output)
	}
	if got := atomic.LoadInt64(&proxyHits); got != 1 {
		t.Fatalf("proxy hits = %d, want 1", got)
	}
	seen, _ := seenURL.Load().(string)
	if seen != "http://192.0.2.1/v1/health" {
		t.Fatalf("proxy saw URL %q, want absolute-form target URL", seen)
	}
}

// TestEgressProxyEnvHelper 只在 TestProxyFromEnvironmentHonored 派生的子进程里
// 执行真实断言；正常 `go test` 下直接 Skip，因此 -count=N 不累积任何进程内状态。
func TestEgressProxyEnvHelper(t *testing.T) {
	if os.Getenv(egressProxyHelperEnvKey) != "1" {
		t.Skip("只在 TestProxyFromEnvironmentHonored 派生的子进程里运行")
	}

	c, err := New(Config{AllowCIDRs: []string{"127.0.0.0/8"}, AllowPlainHTTP: true})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	resp, err := c.Get(context.Background(), "http://192.0.2.1/v1/health")
	if err != nil {
		t.Fatalf("Get through proxy: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 via proxy", resp.StatusCode)
	}
}

// withoutProxyEnv 剔除 ambient 代理变量，保证子进程的代理语义完全由父进程注入，
// 不受开发机/CI 环境里已有的 HTTP_PROXY 等影响（重复 key 在 exec 环境里语义未定）。
func withoutProxyEnv(env []string) []string {
	filtered := make([]string, 0, len(env))
	for _, kv := range env {
		name, _, _ := strings.Cut(kv, "=")
		switch strings.ToUpper(name) {
		case "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY":
			continue
		}
		filtered = append(filtered, kv)
	}
	return filtered
}

// TestTransportProxyWiring 固化 transport 的代理钩子是
// http.ProxyFromEnvironment（仅 env 路径，无配置文件路径）。
func TestTransportProxyWiring(t *testing.T) {
	c, err := New(Config{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	tr, ok := c.hc.Transport.(*http.Transport)
	if !ok || tr == nil || tr.Proxy == nil {
		t.Fatalf("transport proxy wiring missing (type %T)", c.hc.Transport)
	}
	if reflect.ValueOf(tr.Proxy).Pointer() != reflect.ValueOf(http.ProxyFromEnvironment).Pointer() {
		t.Fatal("transport.Proxy must be http.ProxyFromEnvironment")
	}
}
