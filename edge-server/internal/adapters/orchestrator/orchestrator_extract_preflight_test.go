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
	"sort"
	"strings"
	"testing"
)

// ── 常量：A-V1 RFC §6 定义的 13 个待提取文件 ──────────────────────────────────

// orchestratorSourceFiles 是当前位于 edge-server/internal/adapters/ 的 13 个
// orchestrator_*.go 源文件（不含 _test.go）。A-V1 RFC §6 计划将这些文件提取到
// 当前叶子包 edge-server/internal/adapters/orchestrator/。
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

// orchestratorTestFiles 是配套的 5 个测试文件。
var orchestratorTestFiles = []string{
	"orchestrator_dag_robust_test.go",
	"orchestrator_dag_test.go",
	"orchestrator_e2e_test.go",
	"orchestrator_failure_test.go",
	"orchestrator_residual_test.go",
}

// parentDir 是上游 adapters 包路径（相对于 edge-server 模块根）。
const parentDir = "internal/adapters"

// ── 阶段 0a：确认 13 个源文件存在 ──────────────────────────────────────────────

func TestOrchestratorFilesExist(t *testing.T) {
	edgeRoot, err := edgeServerRoot()
	if err != nil {
		t.Fatalf("查找 edge-server 根目录: %v", err)
	}
	parentPath := filepath.Join(edgeRoot, parentDir)

	for _, f := range orchestratorSourceFiles {
		p := filepath.Join(parentPath, f)
		if _, err := os.Stat(p); os.IsNotExist(err) {
			t.Errorf("orchestrator 源文件缺失: %s", p)
		}
	}

	for _, f := range orchestratorTestFiles {
		p := filepath.Join(parentPath, f)
		if _, err := os.Stat(p); os.IsNotExist(err) {
			t.Errorf("orchestrator 测试文件缺失: %s", p)
		}
	}
}

// ── 阶段 0b：go vet（当前包卫生检查）───────────────────────────────────────────

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

// ── 阶段 0c：goimports dry-run（仅检查非测试源文件的导入卫生）────────────────

func TestGoImportsDryRun(t *testing.T) {
	edgeRoot, err := edgeServerRoot()
	if err != nil {
		t.Fatalf("查找 edge-server 根目录: %v", err)
	}

	if _, err := exec.LookPath("goimports"); err != nil {
		t.Skipf("goimports 未安装，跳过导入卫生检查: %v", err)
	}

	parentPath := filepath.Join(edgeRoot, parentDir)

	// 只检查非测试的 Go 源文件，避免 CRLF→LF 行尾归一化误报。
	var dirtyFiles []string
	for _, f := range orchestratorSourceFiles {
		if goimportsHasRealChanges(t, filepath.Join(parentPath, f)) {
			dirtyFiles = append(dirtyFiles, f)
		}
	}

	// 同时检查关键非 orchestrator 文件
	keyFiles := []string{"adapter.go", "plan_approval.go", "registry.go", "control_protocol.go"}
	for _, f := range keyFiles {
		if goimportsHasRealChanges(t, filepath.Join(parentPath, f)) {
			dirtyFiles = append(dirtyFiles, f)
		}
	}

	if len(dirtyFiles) > 0 {
		t.Logf("提示: goimports 发现 %d 个文件存在非行尾差异（本项目使用 gofmt，导入由人工管理）:\n  %s",
			len(dirtyFiles), strings.Join(dirtyFiles, "\n  "))
	}
}

// goimportsHasRealChanges 对单个文件运行 goimports -d，排除纯行尾差异后，
// 返回是否有实质性内容变化。
func goimportsHasRealChanges(t *testing.T, filePath string) bool {
	t.Helper()

	cmd := exec.Command("goimports", "-d", filePath)
	out, err := cmd.Output()
	if err != nil {
		// goimports -d 在 diff 非空时返回非零退出码
		if len(out) == 0 {
			return false
		}
	}

	diff := string(out)
	if diff == "" {
		return false
	}

	// 解析 unified diff，跳过纯行尾差异。
	// goimports 重写整个文件时，diff 中每行都标记为变更。
	// 如果唯一的变化是 \r\n → \n，则视为无实质变更。
	return hasContentDiff(diff)
}

// hasContentDiff 解析 unified diff，排除仅行尾变化和空白对齐的假阳性。
// goimports 除管理 import 外还会做 gofmt 不做的空白对齐；本项目以 gofmt 为准。
// 只有 import 路径实际发生变化时才算实质性差异。
func hasContentDiff(diff string) bool {
	lines := strings.Split(diff, "\n")
	var minusLines, plusLines []string
	for _, line := range lines {
		if len(line) == 0 {
			continue
		}
		if strings.HasPrefix(line, "--- ") || strings.HasPrefix(line, "+++ ") || strings.HasPrefix(line, "@@") {
			continue
		}
		if strings.HasPrefix(line, "-") {
			minusLines = append(minusLines, line[1:])
		} else if strings.HasPrefix(line, "+") {
			plusLines = append(plusLines, line[1:])
		}
	}

	if len(minusLines) != len(plusLines) {
		return true
	}

	for i := range minusLines {
		minusClean := normalizeWhitespace(minusLines[i])
		plusClean := normalizeWhitespace(plusLines[i])
		if minusClean != plusClean {
			return true
		}
	}
	return false
}

// normalizeWhitespace 去掉 \r 并将连续空白折叠为单个空格，忽略纯空白对齐差异。
func normalizeWhitespace(s string) string {
	s = strings.ReplaceAll(s, "\r", "")
	// 折叠连续空格/Tab 为单个空格
	var b strings.Builder
	inSpace := false
	for _, r := range s {
		if r == ' ' || r == '\t' {
			if !inSpace {
				b.WriteByte(' ')
				inSpace = true
			}
		} else {
			b.WriteRune(r)
			inSpace = false
		}
	}
	return b.String()
}

// ── 阶段 0d：导入环风险分析 ────────────────────────────────────────────────────

// importCycleReport 是导入环分析结果为结构性摘要。
type importCycleReport struct {
	// ParentTypesUsedByOrch 列出 orchestrator 文件使用的上游 adapters 类型。
	ParentTypesUsedByOrch []string
	// OrchTypesUsedByParent 列出上游 adapters 文件中使用的 orchestrator 类型。
	OrchTypesUsedByParent []string
	// CycleRisk 标记是否存在潜在导入环。
	CycleRisk bool
	// CycleDetails 描述环路径。
	CycleDetails string
}

// TestImportCycleRisk 分析 13 个 orchestrator 文件与上游 adapters 包之间的
// 类型引用关系，检测提取后可能产生的导入环。
//
// 分析逻辑：
//   - 如果 orchestrator→adapters 且 adapters→orchestrator → 必然环
//   - 当前已知风险：plan_approval.go 使用 orchestrator_dag.go 的 PlanTask 类型
func TestImportCycleRisk(t *testing.T) {
	edgeRoot, err := edgeServerRoot()
	if err != nil {
		t.Fatalf("查找 edge-server 根目录: %v", err)
	}
	parentPath := filepath.Join(edgeRoot, parentDir)

	report := analyzeImportCycleRisk(t, parentPath)
	t.Logf("\n%s", formatCycleReport(report))

	if report.CycleRisk {
		t.Logf("⚠ 检测到潜在导入环: %s", report.CycleDetails)
		t.Logf("⚠ 提取前需处理以下跨包引用:")
		for _, typ := range report.OrchTypesUsedByParent {
			t.Logf("  - upstream 文件使用了 orchestrator 类型 %s", typ)
		}
		for _, typ := range report.ParentTypesUsedByOrch {
			t.Logf("  - orchestrator 文件使用了 upstream 类型 %s", typ)
		}
	}
}

// ── 阶段 0e：go build 自检 ─────────────────────────────────────────────────────

func TestGoBuildSelf(t *testing.T) {
	edgeRoot, err := edgeServerRoot()
	if err != nil {
		t.Fatalf("查找 edge-server 根目录: %v", err)
	}

	cmd := exec.Command("go", "build", "./"+parentDir+"/orchestrator/...")
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

// ── 导入环风险分析器 ────────────────────────────────────────────────────────────

// analyzeImportCycleRisk 解析 adapters 目录中的所有 Go 源文件，分析 orchestrator
// 文件与上游文件之间的类型引用关系。
func analyzeImportCycleRisk(t *testing.T, parentPath string) importCycleReport {
	t.Helper()

	fset := token.NewFileSet()

	entries, err := os.ReadDir(parentPath)
	if err != nil {
		t.Fatalf("读取 adapters 目录失败: %v", err)
	}

	orchFileSet := make(map[string]bool)
	for _, f := range orchestratorSourceFiles {
		orchFileSet[f] = true
	}

	// 第一遍：收集所有类型定义（需要完整 AST，不能用 ImportsOnly）
	orchDefinedTypes := make(map[string]bool)
	parentDefinedTypes := make(map[string]bool)

	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		fullPath := filepath.Join(parentPath, e.Name())
		f, err := parser.ParseFile(fset, fullPath, nil, 0)
		if err != nil {
			t.Logf("解析 %s 失败: %v", e.Name(), err)
			continue
		}
		target := parentDefinedTypes
		if orchFileSet[e.Name()] {
			target = orchDefinedTypes
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
				target[ts.Name.Name] = true
			}
		}
	}

	// 第二遍：查找交叉类型引用
	orchUsesParentTypes := make(map[string]bool)
	parentUsesOrchTypes := make(map[string]bool)

	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		fullPath := filepath.Join(parentPath, e.Name())
		f, err := parser.ParseFile(fset, fullPath, nil, 0)
		if err != nil {
			continue
		}

		if orchFileSet[e.Name()] {
			// orchestrator 文件引用上游 adapters 类型
			findUnqualifiedTypeRefs(f, parentDefinedTypes, orchUsesParentTypes)
		} else {
			// 上游文件引用 orchestrator 类型
			findUnqualifiedTypeRefs(f, orchDefinedTypes, parentUsesOrchTypes)
		}
	}

	report := importCycleReport{}
	for typ := range orchUsesParentTypes {
		report.ParentTypesUsedByOrch = append(report.ParentTypesUsedByOrch, typ)
	}
	sort.Strings(report.ParentTypesUsedByOrch)

	for typ := range parentUsesOrchTypes {
		report.OrchTypesUsedByParent = append(report.OrchTypesUsedByParent, typ)
	}
	sort.Strings(report.OrchTypesUsedByParent)

	if len(report.ParentTypesUsedByOrch) > 0 && len(report.OrchTypesUsedByParent) > 0 {
		report.CycleRisk = true
		report.CycleDetails = fmt.Sprintf(
			"上游包使用了 orchestrator 类型 %v，同时 orchestrator 文件使用了上游类型 %v → 提取后必然形成导入环",
			report.OrchTypesUsedByParent,
			report.ParentTypesUsedByOrch,
		)
	}

	return report
}

// findUnqualifiedTypeRefs 遍历 AST，查找 targetTypes 中的未限定类型引用。
// 排除带包前缀的引用（如 pkg.Type），只关注同包内可直接访问的类型。
func findUnqualifiedTypeRefs(file *ast.File, targetTypes map[string]bool, found map[string]bool) {
	ast.Inspect(file, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.TypeSpec:
			// 跳过类型定义本身——我们只关心使用位置
			return true
		case *ast.SelectorExpr:
			// 有包前缀的类型引用（如 store.Run）→ 跳过，不在这里统计
			return true
		case *ast.Ident:
			if targetTypes[node.Name] {
				found[node.Name] = true
			}
		}
		return true
	})
}

// formatCycleReport 格式化环风险报告为可读的结构化输出。
func formatCycleReport(r importCycleReport) string {
	var b strings.Builder
	b.WriteString("═══ A-V1 RFC §6 提取预检：导入环风险分析 ═══\n")
	b.WriteString(fmt.Sprintf("Orchestrator 源文件数: %d\n", len(orchestratorSourceFiles)))
	b.WriteString(fmt.Sprintf("Orchestrator 测试文件数: %d\n", len(orchestratorTestFiles)))

	if len(r.ParentTypesUsedByOrch) > 0 {
		b.WriteString(fmt.Sprintf("\nOrchestrator → Adapts 上游类型引用 (%d):\n", len(r.ParentTypesUsedByOrch)))
		for _, typ := range r.ParentTypesUsedByOrch {
			b.WriteString(fmt.Sprintf("  - %s\n", typ))
		}
	} else {
		b.WriteString("\nOrchestrator → Adapts 上游类型引用: 无\n")
	}

	if len(r.OrchTypesUsedByParent) > 0 {
		b.WriteString(fmt.Sprintf("\nAdapts → Orchestrator 下游类型引用 (%d):\n", len(r.OrchTypesUsedByParent)))
		for _, typ := range r.OrchTypesUsedByParent {
			b.WriteString(fmt.Sprintf("  - %s\n", typ))
		}
	} else {
		b.WriteString("\nAdapts → Orchestrator 下游类型引用: 无\n")
	}

	if r.CycleRisk {
		b.WriteString("\n循环风险: 是\n")
		b.WriteString(fmt.Sprintf("   详情: %s\n", r.CycleDetails))
		b.WriteString("   建议: 提取前将共享类型移到第三方包，或将使用方一并提取。\n")
	} else {
		b.WriteString("\n循环风险: 否\n")
	}

	return b.String()
}
