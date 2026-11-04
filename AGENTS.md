# AGENTS.md

本文件是本仓库 agent 说明的唯一入口。细节按需读 `docs/` 下的文档，不要在这里堆长文。

## Agent skills

### Issue tracker

issue 与 spec 以本地 markdown 记在 `.scratch/<feature-slug>/` 下，无远程 tracker。见 `docs/agents/issue-tracker.md`。

### Triage labels

默认五词：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。见 `docs/agents/triage-labels.md`。

### Domain docs

单 context：根目录 `GLOSSARY.md` + `docs/adr/`。见 `docs/agents/domain.md`。
