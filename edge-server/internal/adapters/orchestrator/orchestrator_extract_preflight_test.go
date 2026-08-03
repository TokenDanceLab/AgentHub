package orchestrator

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// ── 常量：A-V1 RFC §6 / #1566 定义的 13 个已迁移文件 ──────────────────────────

// orchestratorSourceFiles 是已从根 adapters 包迁移到当前叶子包
// edge-server/internal/adapters/orchestrator/ 的 13 个 orchestrator_*.go
// 源文件（不含 _test.go）。
var orchestratorSourceFiles = []string{
	"orchestrator.go",
	"orchestrator_dag.go",
	"orchestrator_dispatch_handle.go",
	"orchestrator_dispatch_interceptor.go",
	"orchestrator_dispatch_parse.go",
	"orchestrator_dispatch_results.go",
	"orchestrator_failure.go",
	"orchestrator_failure_circuit.go",
	"orchestrator_failure_classify.go",
	"orchestrator_failure_recovery.go",
	"orchestrator_ids.go",
	"orchestrator_payloads.go",
	"orchestrator_prompt.go",
}

// orchestratorTestFiles 是配套测试文件。
var orchestratorTestFiles = []string{
	"orchestrator_dag_robust_test.go",
	"orchestrator_dag_test.go",
	"orchestrator_e2e_test.go",
	"orchestrator_failure_test.go",
	"orchestrator_residual_test.go",
}

// parentDir 是上游 adapters 包路径（相对于 edge-server 模块根）。
const parentDir = "internal/adapters"

// leafDir 是当前叶子包路径（相对于 edge-server 模块根）。
const leafDir = parentDir + "/orchestrator"

// ── 阶段 1a：确认 13 个源文件已迁移到叶子包（根包不得再持有）──────────────

func TestOrchestratorFilesLiveInLeaf(t *testing.T) {
	edgeRoot, err := edgeServerRoot()
	if err != nil {
		t.Fatalf("查找 edge-server 根目录: %v", err)
	}
	leafPath := filepath.Join(edgeRoot, leafDir)

	for _, f := range orchestratorSourceFiles {
		p := filepath.Join(leafPath, f)
		if _, err := os.Stat(p); os.IsNotExist(err) {
			t.Errorf("orchestrator 源文件应位于叶子包: %s", p)
		}
	}
	for _, f := range orchestratorTestFiles {
		p := filepath.Join(leafPath, f)
		if _, err := os.Stat(p); os.IsNotExist(err) {
			t.Errorf("orchestrator 测试文件应位于叶子包: %s", p)
		}
	}

	// 反向断言：根包不得再持有这些文件（防回退到 god package）。
	parentPath := filepath.Join(edgeRoot, parentDir)
	for _, f := range orchestratorSourceFiles {
		if _, err := os.Stat(filepath.Join(parentPath, f)); err == nil {
			t.Errorf("根 adapters 包不应再持有 %s（已迁移到叶子包）", f)
		}
	}
}

// ── 阶段 1b：go vet（当前包卫生检查）───────────────────────────────────────

func TestGoVetAdaptersPackage(t *testing.T) {
	edgeRoot, err := edgeServerRoot()
	if err != nil {
		t.Fatalf("查找 edge-server 根目录: %v", err)
	}

	cmd := exec.Command("go", "vet", "./"+parentDir+"/...")
	cmd.Dir = edgeRoot
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Stdout = &stderr

	if err := cmd.Run(); err != nil {
		t.Errorf("go vet 失败（当前 adapters 包必须通过 vet）:\n%s", stderr.String())
	}
}

// ── 阶段 1c：依赖方向门禁（叶子不反向依赖根）───────────────────────────────

// TestLeafDoesNotImportRootAdapters 断言叶子包的 go list -deps 输出中不出现
// 根 internal/adapters 实现包（#1566 verifier 核心断言之一）。注意叶子包
// 自身的 import path 以 internal/adapters/ 开头，因此按完整包路径精确匹配。
func TestLeafDoesNotImportRootAdapters(t *testing.T) {
	edgeRoot, err := edgeServerRoot()
	if err != nil {
		t.Fatalf("查找 edge-server 根目录: %v", err)
	}

	cmd := exec.Command("go", "list", "-deps", "./"+leafDir+"/...")
	cmd.Dir = edgeRoot
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list -deps ./internal/adapters/orchestrator/... 失败: %v", err)
	}
	rootPkg := "github.com/agenthub/edge-server/" + parentDir
	for _, line := range strings.Split(string(out), "\n") {
		if line == rootPkg {
			t.Fatalf("叶子包不得 import 根 internal/adapters 实现包，实际依赖: %s", line)
		}
	}
	t.Logf("叶子包依赖方向正确（未反向依赖根 adapters）")
}

// TestOrchestrationContractNeutral 断言 internal/orchestration 是中立合同包：
// 不得 import adapters（或任何 adapters 内部实现）。合同方向必须是
// adapters → orchestration，不能反向。
func TestOrchestrationContractNeutral(t *testing.T) {
	edgeRoot, err := edgeServerRoot()
	if err != nil {
		t.Fatalf("查找 edge-server 根目录: %v", err)
	}

	cmd := exec.Command("go", "list", "-deps", "./internal/orchestration/")
	cmd.Dir = edgeRoot
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list -deps ./internal/orchestration/ 失败: %v", err)
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "internal/adapters") {
			t.Fatalf("中立合同包 internal/orchestration 不得依赖 internal/adapters，实际依赖: %s", line)
		}
	}
	t.Logf("orchestration 合同包依赖方向正确（无 adapters 依赖）")
}

// ── 阶段 1d：合同类型归属门禁 ────────────────────────────────────────────────

// contractTypes 是 A-V1 合同词汇表：唯一权威定义必须在 internal/orchestration；
// adapters 根包内只允许 `type X = orchestration.X` 的 alias，不允许 struct/string
// 定义（防双 SSOT 与环回退）。
var contractTypes = []string{
	"TaskStatus",
	"PlanTask",
	"ExecutionPlan",
	"PlanApprovalConfig",
	"PendingPlan",
	"PlanDecision",
	// Step 2 (#1566)：adapter-domain 合同类型随叶子包迁移进入 orchestration。
	"AgentAdapter",
	"EventEmitter",
	"AdapterMetadata",
	"AgentCapabilities",
	"SubAgentTask",
	"SiblingInfo",
	"SubAgentSpawner",
}

// TestContractTypesOwnedByOrchestration 断言合同类型的唯一权威在
// internal/orchestration：adapters 根目录中这些类型只能以 alias 形式出现。
func TestContractTypesOwnedByOrchestration(t *testing.T) {
	edgeRoot, err := edgeServerRoot()
	if err != nil {
		t.Fatalf("查找 edge-server 根目录: %v", err)
	}
	parentPath := filepath.Join(edgeRoot, parentDir)

	entries, err := os.ReadDir(parentPath)
	if err != nil {
		t.Fatalf("读取 adapters 目录失败: %v", err)
	}
	fset := token.NewFileSet()
	var violations []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		fullPath := filepath.Join(parentPath, e.Name())
		f, err := parser.ParseFile(fset, fullPath, nil, 0)
		if err != nil {
			t.Errorf("解析 %s 失败: %v", e.Name(), err)
			continue
		}
		for _, decl := range f.Decls {
			gd, ok := decl.(*ast.GenDecl)
			if !ok || gd.Tok != token.TYPE {
				continue
			}
			for _, spec := range gd.Specs {
				ts, ok := spec.(*ast.TypeSpec)
				if !ok {
					continue
				}
				if !containsString(contractTypes, ts.Name.Name) {
					continue
				}
				if !ts.Assign.IsValid() {
					// 非 alias 的 type 定义（struct/string 等）在 adapters 属于双 SSOT
					violations = append(violations, fmt.Sprintf("%s:%d 定义 %s（唯一权威应在 internal/orchestration，此处只允许 type alias）",
						e.Name(), fset.Position(ts.Pos()).Line, ts.Name.Name))
				}
			}
		}
	}
	if len(violations) > 0 {
		t.Fatalf("adapters 包内合同类型出现非 alias 定义（%d 处）:\n  %s",
			len(violations), strings.Join(violations, "\n  "))
	}
	t.Logf("合同类型在 adapters 中仅以 alias 形式存在（唯一权威在 internal/orchestration）")
}

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// ── 阶段 1e：go build 自检 ───────────────────────────────────────────────────

func TestGoBuildSelf(t *testing.T) {
	edgeRoot, err := edgeServerRoot()
	if err != nil {
		t.Fatalf("查找 edge-server 根目录: %v", err)
	}

	cmd := exec.Command("go", "build", "./"+leafDir+"/...")
	cmd.Dir = edgeRoot
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Stdout = &stderr

	if err := cmd.Run(); err != nil {
		t.Errorf("go build 失败（此包必须可编译）:\n%s", stderr.String())
	}
}

// ── 辅助函数 ────────────────────────────────────────────────────────────────────

// edgeServerRoot 返回 edge-server 模块的根目录绝对路径。
// 从当前测试文件位置向上推导直至找到 go.mod。
func edgeServerRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("找不到 edge-server 模块根（go.mod）")
		}
		dir = parent
	}
}
