-- Seed marketplace with pre-built Skills and MCP Servers
-- ========================================================
-- Uses a dedicated system user (marketplace-system) as the owner.
-- If no users exist, creates the system user first.
-- All entries are created as public (is_public = TRUE) for marketplace visibility.
-- Safe to re-run: uses ON CONFLICT DO NOTHING for all inserts.
--
-- Usage:
--   psql -h localhost -U agenthub -d agenthub < migrations/0050_seed_market_skills_mcp.up.sql
--   Or via migration tool if wired up.

-- Ensure the system owner exists.
-- Uses a fixed UUID so the seed is idempotent across runs.
INSERT INTO users (id, username, password_hash, nickname, created_at, updated_at)
VALUES (
    'c0000000-0000-0000-0000-000000000001',
    'marketplace-system',
    '$2a$10$NOLOGIN.NOLOGIN.NOLOGIN.NOLOGIN.NOLOGIN',  -- unusable bcrypt; login disabled
    'Marketplace System',
    NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
    sys_owner UUID := 'c0000000-0000-0000-0000-000000000001';
BEGIN
    RAISE NOTICE 'Using system owner: %', sys_owner;

    -- ============================================================
    -- Skills
    -- ============================================================

    -- 1. PPTX Generator
    INSERT INTO skills (id, owner_id, name, description, skill_type, runtime_ids, entry_point, config_schema, is_public, version, install_count)
    VALUES (
        'a0000001-0000-0000-0000-000000000001', sys_owner,
        'PPTX Generator',
        'Create professional .pptx presentations with slides, layouts, charts, and speaker notes using python-pptx',
        'agent_skill',
        '["claude-code","codex"]'::jsonb,
        '',
        '{}'::jsonb,
        TRUE, '1.0.0', 0
    ) ON CONFLICT (id) DO NOTHING;

    -- 2. DOCX Report Generator
    INSERT INTO skills (id, owner_id, name, description, skill_type, runtime_ids, entry_point, config_schema, is_public, version, install_count)
    VALUES (
        'a0000001-0000-0000-0000-000000000002', sys_owner,
        'DOCX Report Generator',
        'Create .docx reports, proposals, and documentation with python-docx — headings, tables, images, TOC',
        'agent_skill',
        '["claude-code","codex"]'::jsonb,
        '',
        '{}'::jsonb,
        TRUE, '1.0.0', 0
    ) ON CONFLICT (id) DO NOTHING;

    -- 3. Excel Data Analyzer
    INSERT INTO skills (id, owner_id, name, description, skill_type, runtime_ids, entry_point, config_schema, is_public, version, install_count)
    VALUES (
        'a0000001-0000-0000-0000-000000000003', sys_owner,
        'Excel Data Analyzer',
        'Analyze .xlsx/.csv data with pandas/openpyxl — pivot tables, charts, data cleaning, statistical analysis',
        'agent_skill',
        '["claude-code","codex"]'::jsonb,
        '',
        '{}'::jsonb,
        TRUE, '1.0.0', 0
    ) ON CONFLICT (id) DO NOTHING;

    -- 4. PDF Toolkit
    INSERT INTO skills (id, owner_id, name, description, skill_type, runtime_ids, entry_point, config_schema, is_public, version, install_count)
    VALUES (
        'a0000001-0000-0000-0000-000000000004', sys_owner,
        'PDF Toolkit',
        'Merge, split, extract text, fill forms, and convert PDFs with PyPDF2/pikepdf',
        'agent_skill',
        '["claude-code","codex"]'::jsonb,
        '',
        '{}'::jsonb,
        TRUE, '1.0.0', 0
    ) ON CONFLICT (id) DO NOTHING;

    -- 5. Diagram Generator
    INSERT INTO skills (id, owner_id, name, description, skill_type, runtime_ids, entry_point, config_schema, is_public, version, install_count)
    VALUES (
        'a0000001-0000-0000-0000-000000000005', sys_owner,
        'Diagram Generator',
        'Generate Mermaid/PlantUML diagrams — flowcharts, sequence diagrams, ERDs, architecture diagrams',
        'agent_skill',
        '["claude-code","codex"]'::jsonb,
        '',
        '{}'::jsonb,
        TRUE, '1.0.0', 0
    ) ON CONFLICT (id) DO NOTHING;

    -- 6. Code Documentation Generator
    INSERT INTO skills (id, owner_id, name, description, skill_type, runtime_ids, entry_point, config_schema, is_public, version, install_count)
    VALUES (
        'a0000001-0000-0000-0000-000000000006', sys_owner,
        'Code Documentation Generator',
        'Generate comprehensive code documentation, API docs, README files from source code analysis',
        'agent_skill',
        '["claude-code","codex"]'::jsonb,
        '',
        '{}'::jsonb,
        TRUE, '1.0.0', 0
    ) ON CONFLICT (id) DO NOTHING;

    -- 7. Image Processor
    INSERT INTO skills (id, owner_id, name, description, skill_type, runtime_ids, entry_point, config_schema, is_public, version, install_count)
    VALUES (
        'a0000001-0000-0000-0000-000000000007', sys_owner,
        'Image Processor',
        'Resize, crop, convert, compress, watermark images with Pillow — batch processing supported',
        'agent_skill',
        '["claude-code","codex"]'::jsonb,
        '',
        '{}'::jsonb,
        TRUE, '1.0.0', 0
    ) ON CONFLICT (id) DO NOTHING;

    -- 8. Markdown to HTML/Slides
    INSERT INTO skills (id, owner_id, name, description, skill_type, runtime_ids, entry_point, config_schema, is_public, version, install_count)
    VALUES (
        'a0000001-0000-0000-0000-000000000008', sys_owner,
        'Markdown to HTML/Slides',
        'Convert Markdown to reveal.js slides, static HTML sites, or PDF via markdown-to-presentation pipeline',
        'agent_skill',
        '["claude-code","codex"]'::jsonb,
        '',
        '{}'::jsonb,
        TRUE, '1.0.0', 0
    ) ON CONFLICT (id) DO NOTHING;

    -- ============================================================
    -- MCP Servers
    -- ============================================================

    -- 1. Filesystem MCP
    INSERT INTO mcp_servers (id, owner_id, name, transport, command, args, env_vars, url, auth_type, auth_config, tool_schema, is_public, install_count)
    VALUES (
        'b0000001-0000-0000-0000-000000000001', sys_owner,
        'Filesystem MCP',
        'stdio', 'npx',
        '["-y","@anthropic-ai/mcp-server-filesystem","."]'::jsonb,
        '{}'::jsonb,
        '', 'none',
        '{}'::jsonb,
        '{}'::jsonb,
        TRUE, 0
    ) ON CONFLICT (id) DO NOTHING;

    -- 2. GitHub MCP
    INSERT INTO mcp_servers (id, owner_id, name, transport, command, args, env_vars, url, auth_type, auth_config, tool_schema, is_public, install_count)
    VALUES (
        'b0000001-0000-0000-0000-000000000002', sys_owner,
        'GitHub MCP',
        'stdio', 'npx',
        '["-y","@anthropic-ai/mcp-server-github"]'::jsonb,
        '{"GITHUB_PERSONAL_ACCESS_TOKEN":"***"}'::jsonb,
        '', 'bearer',
        '{"token_env":"GITHUB_PERSONAL_ACCESS_TOKEN"}'::jsonb,
        '{}'::jsonb,
        TRUE, 0
    ) ON CONFLICT (id) DO NOTHING;

    -- 3. Postgres MCP
    INSERT INTO mcp_servers (id, owner_id, name, transport, command, args, env_vars, url, auth_type, auth_config, tool_schema, is_public, install_count)
    VALUES (
        'b0000001-0000-0000-0000-000000000003', sys_owner,
        'Postgres MCP',
        'stdio', 'npx',
        '["-y","@anthropic-ai/mcp-server-postgres"]'::jsonb,
        '{"DATABASE_URL":"***"}'::jsonb,
        '', 'none',
        '{}'::jsonb,
        '{}'::jsonb,
        TRUE, 0
    ) ON CONFLICT (id) DO NOTHING;

    -- 4. Brave Search MCP
    INSERT INTO mcp_servers (id, owner_id, name, transport, command, args, env_vars, url, auth_type, auth_config, tool_schema, is_public, install_count)
    VALUES (
        'b0000001-0000-0000-0000-000000000004', sys_owner,
        'Brave Search MCP',
        'stdio', 'npx',
        '["-y","@anthropic-ai/mcp-server-brave-search"]'::jsonb,
        '{"BRAVE_API_KEY":"***"}'::jsonb,
        '', 'none',
        '{}'::jsonb,
        '{}'::jsonb,
        TRUE, 0
    ) ON CONFLICT (id) DO NOTHING;

    -- 5. Puppeteer MCP
    INSERT INTO mcp_servers (id, owner_id, name, transport, command, args, env_vars, url, auth_type, auth_config, tool_schema, is_public, install_count)
    VALUES (
        'b0000001-0000-0000-0000-000000000005', sys_owner,
        'Puppeteer MCP',
        'stdio', 'npx',
        '["-y","@anthropic-ai/mcp-server-puppeteer"]'::jsonb,
        '{}'::jsonb,
        '', 'none',
        '{}'::jsonb,
        '{}'::jsonb,
        TRUE, 0
    ) ON CONFLICT (id) DO NOTHING;

    -- 6. Memory MCP
    INSERT INTO mcp_servers (id, owner_id, name, transport, command, args, env_vars, url, auth_type, auth_config, tool_schema, is_public, install_count)
    VALUES (
        'b0000001-0000-0000-0000-000000000006', sys_owner,
        'Memory MCP',
        'stdio', 'npx',
        '["-y","@anthropic-ai/mcp-server-memory"]'::jsonb,
        '{}'::jsonb,
        '', 'none',
        '{}'::jsonb,
        '{}'::jsonb,
        TRUE, 0
    ) ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Marketplace seed complete: 8 skills + 6 MCP servers.';
END $$;
