# PROGRESS — 任务书 LM：镜像标签收敛 + 部署真实性

- 开工：2026-08-02，worktree chore/cd-image-deploy @ 02bd5879
- 问题：latest 被 cd-hub-server.yml master push 双路覆盖；deploy.sh 默认镜像名 agenthub-hub 与 CI 不一致；cd-production.yml 部署步骤全是 echo 占位
- 决策：仓库无 SSH 部署凭证（secrets 仅 GITHUB_TOKEN）→ cd-production.yml 选 build-only 显式声明
- 计划：cd-hub-server.yml 去 latest → deploy.sh 镜像名收敛 → cd-production.yml 部署真实性 → 验证 → 3 步 commit + PR + squash merge
- 状态：核验完成，待修改
