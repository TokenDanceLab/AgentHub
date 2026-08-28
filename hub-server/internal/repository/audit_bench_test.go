package repository

// audit_bench_test.go — 审计写入热路径微基准（#2037）。
//
// 度量意图：审计事件写入（CreateAuditEvent）是所有敏感操作的公共落盘
// 路径：事务 → 尾行查询 → 链哈希计算（SHA-256 全内容规范化序列化）→
// 插入。本基准度量该路径在仓库层显式支持的 sqlite 纯路径上的成本
// （advisory xact lock 为 postgres 专属，sqlite 下跳过；见
// repository/audit.go 注释与 internal/service/audit 单测同口径）。
//
// 覆盖边界：PostgreSQL 专属语义（pg_advisory_xact_lock、prev_hash 唯一
// 索引冲突重试）需要真实 PG，不纳入本微基准门禁，由集成层
// （tests/integration/audit_chain_test.go）覆盖。本文件只使用内存
// sqlite（单连接、无磁盘/网络 IO），门禁可封闭运行。

import (
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/model"
)

// newAuditBenchDB 建内存 sqlite 审计库。表结构与
// internal/service/audit/operations_test.go 的 newAuditTestDB 一致；
// :memory: 按连接隔离，锁定单连接保证 schema 对所有查询可见。
func newAuditBenchDB(b *testing.B) *gorm.DB {
	b.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		b.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		b.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.Exec(`
		CREATE TABLE audit_events (
			id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
			user_id    TEXT,
			profile_id TEXT,
			target_id  TEXT,
			event_type TEXT NOT NULL,
			severity   TEXT NOT NULL DEFAULT 'info',
			summary    TEXT NOT NULL,
			details    TEXT DEFAULT '{}',
			client_ip  TEXT DEFAULT '',
			prev_hash  TEXT NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX idx_audit_events_created ON audit_events(created_at DESC);
	`).Error; err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = sqlDB.Close() })
	return db
}

// benchAuditEvent 返回固定字段的审计事件（每次迭代新建实例，因为
// CreateAuditEvent 会原地写入 ID/PrevHash）。
func benchAuditEvent() *model.AuditEvent {
	return &model.AuditEvent{
		UserID:    "00000000-0000-0000-0000-000000000001",
		EventType: "bench.audit_write",
		Severity:  "info",
		Summary:   "benchmark audit write",
		Details:   `{"path":"/bench"}`,
		ClientIP:  "127.0.0.1",
	}
}

// BenchmarkCreateAuditEventSQLite 度量完整审计链写入路径
// （事务 + 尾行查询 + ComputeLinkHash + 插入）。链长随迭代数线性增长；
// 门禁 100ms benchtime 下为数百至数千行，尾行查询有 created_at 索引。
func BenchmarkCreateAuditEventSQLite(b *testing.B) {
	db := newAuditBenchDB(b)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := CreateAuditEvent(db, benchAuditEvent()); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkAuditLinkHash 单独度量写入路径的 CPU 核心：链哈希计算
// （SHA-256 over 全内容规范化序列化），用于把哈希成本与存储层成本分离。
// 输入为固定常量事件。
func BenchmarkAuditLinkHash(b *testing.B) {
	prev := &model.AuditEvent{
		ID:        "00000000-0000-0000-0000-000000000001",
		UserID:    "00000000-0000-0000-0000-000000000002",
		EventType: "bench.link_hash",
		Severity:  "info",
		Summary:   "benchmark link hash",
		Details:   `{"path":"/bench"}`,
		ClientIP:  "127.0.0.1",
		PrevHash:  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = model.ComputeLinkHash(prev)
	}
}
