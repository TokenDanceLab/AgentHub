-- Cloud documents table — stores user-created documents and artifact projections.
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID,
  title VARCHAR(500) NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'md',
  source VARCHAR(32) NOT NULL DEFAULT 'user',
  source_ref VARCHAR(256),
  tag VARCHAR(64),
  location VARCHAR(128) NOT NULL DEFAULT '我的文档库',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  content TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_documents_status CHECK (status IN ('active', 'archived', 'deleted')),
  CONSTRAINT chk_documents_source CHECK (source IN ('user', 'artifact', 'upload', 'external'))
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source, status);
