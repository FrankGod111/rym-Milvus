# ERP Knowledge Console MVP

ERP Knowledge Console MVP 是一个基于 FastAPI 的企业文档管理与知识库控制台。这个副本已经完成“关系数据库 + Milvus”知识检索数据平面的代码适配：关系数据库保存文档、版本、chunk 文本、权限快照和索引状态，Milvus 保存向量；检索返回 `chunk_id` 后再回查关系数据库。Dify 仍可通过 `KNOWLEDGE_VECTOR_BACKEND=dify` 作为兼容的托管向量路径。

当前版本适合本地 MVP 验证，不依赖 OpenClaw。当前已经补上基础 Bearer Token 鉴权、角色权限校验和 AI 服务端身份收口；生产化时仍建议继续替换为 PostgreSQL、对象存储、正式认证体系和更强的 Dify 隔离策略。Milvus 适配覆盖知识库向量检索这一层，ERP 主业务状态仍保存在 JSON/文件兼容层，合同模块仍使用独立的 SQLite 数据库，因此整套系统尚未完成统一数据库迁移。

## 目录

- [功能概览](#功能概览)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [演示账号](#演示账号)
- [Dify 集成](#dify-集成)
- [AI 使用方式](#ai-使用方式)
- [API 概览](#api-概览)
- [数据位置](#数据位置)
- [项目结构](#项目结构)
- [排障说明](#排障说明)
- [安全说明](#安全说明)
- [更新日志](#更新日志)

## 功能概览

### 已实现

- 登录页
- Bearer Token 登录态
- 仪表盘
- 文档库
- 文档上传
- multipart 原文件上传
- 上传文件后端解析
- 文档详情
- 文档预览
- 版本历史
- 知识库索引状态
- 权限配置入口
- AI 问答页面
- 用户管理
- 角色管理
- 部门管理
- 审计日志
- 系统设置
- 文件列表
- 搜索
- 分类筛选
- 标签筛选
- 上传人筛选
- 状态筛选
- 权限级别筛选
- 批量删除
- 批量归档
- 本地重新索引
- 同步文档到 Dify
- 刷新 Dify 索引状态
- Dify 知识库检索
- Dify Chat App 问答
- ERP 文档列表/详情权限过滤
- Dify 检索结果权限过滤
- AI 问答身份由服务端 token 解析，不再信任前端透传用户 ID
- 系统设置白名单校验
- Dify 配置批量保存
- 双层治理骨架：档案层 + AI 知识库层
- 档案目录模板接口与按部门 by-scope 视图
- 档案口径文档详情、目录项匹配与目录项文档列表
- Dataset mapping 管理接口与详情联动展示
- 按治理域拆分的 archive / ai-governance 审计日志接口

### 预留能力

- 文档版本管理增强
- 文档在线编辑增强
- 批量上传
- 批量权限设置
- 文档审核流
- 文档回收站增强
- 文档下载权限
- 水印
- 敏感词扫描
- 重复文档检测
- OCR 识别增强
- 自动摘要
- 自动标签
- 知识库质量评分
- 索引失败重试
- 定时重建索引
- LLM / embedding provider 扩展
- 企业级用户认证

## 技术栈

- Backend: FastAPI
- Frontend: React 18 + TypeScript + Vite + Ant Design
- Storage: ERP JSON/文件兼容层 + SQLAlchemy 关系数据库（默认 SQLite，可切 PostgreSQL）+ 本地文件目录
- Dify API Client: httpx
- Knowledge Engine: Milvus（可选 Dify Knowledge Base 兼容模式）
- Optional Local Model Runtime: Ollama + Qwen3

## 完整启动命令（业务端）

### Milvus/关系数据库数据底座

复制项目后的默认配置是 `KNOWLEDGE_VECTOR_BACKEND=milvus`，Milvus 地址默认为 `http://127.0.0.1:19530`。本地未启动 Milvus 时，SQL chunk 仍会落库，检索会自动使用 SQL 词法降级，不会把权限判断交给向量库。`scripts/start_milvus_local.sh` 只负责导出配置并启动 FastAPI，不会启动 Milvus 服务；Milvus 需要单独以本地服务、Docker、Milvus 集群或 Zilliz Cloud 方式部署。

项目要求 Python 3.10 或更高版本。macOS 上如果系统 `python3` 是 3.9，请使用 Conda 的 Python 3.10+ 或安装 `python@3.11` 后再创建虚拟环境。

```bash
export KNOWLEDGE_DATABASE_URL='postgresql+psycopg://user:password@127.0.0.1:5432/rym'
export MILVUS_URI='http://127.0.0.1:19530'
export MILVUS_COLLECTION='knowledge_chunks'
export KNOWLEDGE_EMBEDDING_PROVIDER='ollama'
export KNOWLEDGE_EMBEDDING_MODEL='nomic-embed-text'
```

首次安装依赖后，执行一次文档“重建索引”会完成：SQL chunk 持久化、Embedding、Milvus upsert。可通过 `GET /erp/v1/ai/data-plane/status` 查看关系库 chunk 数量、向量后端和索引任务状态。开发环境默认使用 `hash` Embedding；生产环境应改为 Ollama 或企业 Embedding API，并确保向量维度与 Milvus collection 一致。

本机快速启动可以使用：

```bash
chmod +x scripts/start_milvus_local.sh
scripts/start_milvus_local.sh
```

本项目需要分别启动 FastAPI 后端和 Vite 前端。若要使用知识库同步和智能问答，还必须先启动 Dify。

### Dify 与 Milvus 的选择

`KNOWLEDGE_VECTOR_BACKEND=milvus` 表示本项目负责知识库切块、Embedding、Milvus 检索和关系库回查。Dify 仍可以作为 Chat App/Workflow 的生成服务；如果 Dify 不可用，代码会按配置尝试 Ollama 或本地回答降级。

`KNOWLEDGE_VECTOR_BACKEND=dify` 表示继续使用原来的 Dify Dataset 检索路径。这个开关只改变本项目的知识检索后端，不会替换 Dify 自己的 PostgreSQL、Redis 或向量服务。

### 企业部署迁移边界

企业部署采用 Milvus 模式时，需要同时准备 PostgreSQL、Milvus 和正式 Embedding 服务。`KNOWLEDGE_DATABASE_URL` 可以切换到 PostgreSQL，但当前关系库初始化使用 SQLAlchemy `create_all`，项目没有 Alembic 迁移链路。首次迁移可以执行：

```bash
python scripts/migrate_json_to_relational.py
```

该脚本只回填知识库关系表并重建知识向量，不会迁移 `data/erp/state.json`、`data/erp/documents/` 或 `data/contracts.db`。企业上线前还需要单独迁移 ERP 状态、合同数据和原始文件，并将本地文件替换为 MinIO、S3、OSS 等对象存储。生产密钥也应放入环境变量或密钥管理系统，不应随 `data/erp/state.json` 部署。

### 0. 启动 Dify

在 Dify 的 `docker` 目录执行（路径按本机实际位置修改）：

```bash
cd /path/to/dify/docker
docker compose up -d
docker compose ps
```

Dify 对外地址应能够访问：

```text
http://localhost
```

### 1. 首次安装后端依赖

项目中原有 `.venv` 来自其他机器，不能直接使用。请创建本机独立环境 `.venv-local`：

```bash
cd /Users/frankgod/Desktop/RAG_t/Test_python_frontend_sandbox_copy
python3 -m venv .venv-local
source .venv-local/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### 2. 启动业务后端（终端 1）

```bash
cd /Users/frankgod/Desktop/RAG_t/Test_python_frontend_sandbox_copy
source .venv-local/bin/activate
export ERP_SECRET_KEY='请替换为本机随机长字符串'
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8013
```

检查后端：

```bash
curl http://127.0.0.1:8013/health
```

API 文档：`http://127.0.0.1:8013/docs`

### 3. 启动业务前端（终端 2）

首次安装：

```bash
cd /Users/frankgod/Desktop/RAG_t/Test_python_frontend_sandbox_copy
npm install
```

每次启动：

```bash
cd /Users/frankgod/Desktop/RAG_t/Test_python_frontend_sandbox_copy
VITE_BACKEND_BASE_URL=http://127.0.0.1:8013 npm run dev -- --host 0.0.0.0 --port 5173
```

浏览器打开：

```text
http://127.0.0.1:5173/archive/library
```

打开前端后会先进入统一登录页。可使用 `admin`、`ops` 或 `finance` 登录，演示环境密码使用任意非空值即可；登录后菜单和文档范围会按账号角色自动裁剪。

### 4. 配置 Dify

后端和前端启动后进入“系统设置 -> Dify 知识库配置”，填写：

```text
dify_base_url       = http://localhost/v1
dify_api_key        = dataset-xxx（知识库 API Key）
dify_dataset_id     = 目标知识库 ID
dify_app_api_key    = app-xxx（rym-1 Workflow/App API Key）
```

API Key 只保存在后端配置中，不要写入 Vite 环境变量或前端源码。

### 5. 端口被占用时

例如后端改用 `18114`、前端改用 `5175`：

```bash
# 终端 1
cd /Users/frankgod/Desktop/RAG_t/Test_python_frontend_sandbox_copy
source .venv-local/bin/activate
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 18114

# 终端 2
cd /Users/frankgod/Desktop/RAG_t/Test_python_frontend_sandbox_copy
VITE_BACKEND_BASE_URL=http://127.0.0.1:18114 npm run dev -- --host 0.0.0.0 --port 5175
```

### 6. 停止服务

前端和后端终端分别按 `Ctrl+C`。如需停止 Dify：

```bash
cd /path/to/dify/docker
docker compose stop
```

## 演示账号与鉴权

- `admin`
- `ops`
- `finance`

角色范围：`admin` 为管理员，`ops` 为文档编辑，`finance` 为只读成员。退出系统会清除当前 Bearer Token 并返回登录页。

密码任意非空，建议本地演示使用：

```text
admin
```

登录成功后，后端返回带过期时间的 Bearer Token。除 `/health`、`/app`、`/docs`、`/erp/v1/auth/login` 外，ERP API 默认要求：

```text
Authorization: Bearer <token>
```

可选环境变量：

```bash
ERP_SECRET_KEY=change-me
ERP_TOKEN_TTL_SECONDS=43200
```

## Dify 集成

### 架构关系

```text
ERP 项目
 -> 档案层：保存文档、目录模板、目录项、权限、审计、组织范围与归档治理字段
 -> AI 层：保存 dataset mapping、AI 治理策略、审核记录、同步状态
 -> 调用 Dify Knowledge API 同步文档和检索切片
 -> 调用 Dify App API 获取 AI 问答结果

Dify
 -> 管理知识库
 -> 执行切片、Embedding、索引、检索
 -> 调用 Ollama / Qwen3 等模型生成回答
```

### Dify 配置位置

启动业务前后端后进入：

```text
http://127.0.0.1:5173/settings
```

打开：

```text
系统设置 -> Dify 知识库配置
```

填写字段：

```text
dify_base_url
dify_api_key
dify_app_api_key
dify_dataset_id
dify_indexing_technique
dify_process_rule_mode
dify_doc_form
dify_doc_language
dify_timeout_seconds
```

本地 Dify 示例：

```text
dify_base_url=http://127.0.0.1:8080/v1
dify_dataset_id=你的知识库 ID
dify_api_key=你的知识库 API Key
dify_app_api_key=你的 Chat App API Key
dify_indexing_technique=high_quality
dify_process_rule_mode=automatic
dify_doc_form=text_model
dify_doc_language=Chinese
dify_timeout_seconds=60
dify_send_metadata=false
```

如果是自部署 Dify，`dify_base_url` 使用你的 Dify API 地址，例如：

```text
http://your-dify-host/v1
```

### Key 的区别

```text
dify_api_key
```

用于：

- 文档同步到 Dify
- 刷新 Dify 文档索引状态
- 知识库检索 `/datasets/{dataset_id}/retrieve`

```text
dify_app_api_key
```

用于：

- Dify Chat App 问答 `/chat-messages`

注意：这两个 Key 不建议混用。

### 文档同步流程

```text
ERP 上传文档
 -> 文档库选择文档
 -> 点击「同步到 Dify」
 -> Dify 创建文档并异步切片索引
 -> ERP 保存 dify_document_id 和 dify_batch
 -> 点击「刷新 Dify 状态」
 -> ERP 展示 dify_indexing_status
```

同步成功后，系统会保存：

```text
dify_dataset_id
dify_document_id
dify_batch
dify_sync_status
dify_indexing_status
dify_segment_count
last_synced_at
last_dify_status_at
```

默认不会向 Dify 发送 `doc_metadata`。如果你已经在 Dify 知识库里配置了元数据字段，并确认 API 支持对应结构，可以在「系统设置」打开 `dify_send_metadata`。

## AI 使用方式

ERP 的「AI 问答」页面支持两种模式。

### 知识库检索模式

点击：

```text
AI 问答 -> 知识库检索
```

ERP 调用：

```text
POST /erp/v1/ai/retrieve
```

Dify 调用：

```text
POST /datasets/{dataset_id}/retrieve
```

返回内容包括：

- 命中的切片内容
- 文档名
- segment id
- score

适合验证：

- 知识库是否能召回
- Embedding 是否正常
- 切片是否合理
- Top K 命中质量

### AI 问答模式

点击：

```text
AI 问答 -> AI 问答
```

ERP 调用：

```text
POST /erp/v1/ai/chat
```

Dify 调用：

```text
POST /chat-messages
```

前提条件：

- Dify 中已经创建 Chat App
- Chat App 已绑定知识库
- Chat App 已配置可用 LLM，例如 Ollama `qwen3:8b`
- ERP 系统设置中已填写 `dify_app_api_key`

返回内容包括：

- 自然语言答案
- conversation_id
- message_id
- answer_mode
- permission_filtered
- confidence
- retrieved_count
- 引用来源

## 单智能助手模式

沙盒项目现在的主展示方式不再是“多个功能页入口”，而是一个默认的 **单智能助手工作台**。

用户登录后可以直接：

- 询问制度与流程问题
- 询问治理问题，例如“哪些部门档案还没齐”“哪些资料允许进入 AI”
- 让助手生成会议纪要、合同审查、测试报告草稿
- 让助手查看历史会话
- 让助手发起审批或处理审批

这一模式对应的新后端编排入口为：

```text
/erp/v1/assistant/*
```

推荐调用：

1. `POST /erp/v1/assistant/turn`
2. `GET /erp/v1/assistant/archive-overview`
3. `GET /erp/v1/assistant/ai-governance-overview`
4. `GET /erp/v1/assistant/sessions`
5. `POST /erp/v1/assistant/sessions/{session_id}/submit-approval`
6. `GET /erp/v1/assistant/approvals`
7. `PATCH /erp/v1/assistant/approvals/{approval_id}`

与本轮治理续补直接相关的返回语义：

- 覆盖明细项会带 `ai_ready`、`ai_block_reason`、`knowledge_sync_status`
- 敏感治理字段变更后，文档会进入 `ai_review_status=pending`，并记录 `review_pending_reason`
- dataset mapping 当前已支持最小行级编辑/启停/删除，前端仍复用整表提交后端

其中：

- 前端单助手工作台优先走 `/erp/v1/assistant/*`
- 外部智能体平台优先走 `/skill/v1/workflow/*`

这样项目同时具备：

- 面向人类用户的单助手体验
- 面向另一个智能体平台的 skill 契约体验

当前助手治理问答会优先复用 ERP 现有治理数据，而不是走额外模型编排：

- 档案类问题直接读取覆盖率和缺失项数据
- AI 类问题直接读取 AI 准入判断、dataset mapping 和待复核状态
- 引用来源会区分“档案记录”与“AI 知识来源”

## Skill 风格能力入口

除了原始 ERP API 之外，沙盒项目现在额外提供了一组面向外部智能体平台的 skill 风格入口：

```text
/skill/v1/workflow/*
```

它的目标不是暴露底层 ERP / Dify / 场景页面细节，而是把以下链路封成一个统一契约：

- 权限过滤的知识检索与员工问答
- 场景生成
- 历史会话留痕
- 审批提交与审批决策

如果另一个智能体平台只希望“读取 skill 就能使用能力”，优先读取：

```text
GET /skill/v1/workflow/manifest
skills/erp_scene_workflow/SKILL.md
sample_scene_inputs/workflow_skill_curl_examples.md
```

推荐顺序：

1. `POST /skill/v1/workflow/session/login`
2. `POST /skill/v1/workflow/ask` 或 `POST /skill/v1/workflow/scenes/*`
3. `GET /skill/v1/workflow/sessions` / `GET /skill/v1/workflow/approvals`
4. `PATCH /skill/v1/workflow/approvals/{approval_id}`

这样调用方不需要重新理解：

- `/erp/v1/ai/chat`
- `/erp/v1/ai/retrieve`
- `/erp/v1/scenes/*`
- `/erp/v1/scene-sessions*`
- `/erp/v1/approvals*`
- 底层 Dify 知识库与 Chat App 调用方式

## API 概览

### ERP 基础

```text
GET  /health
GET  /app
GET  /docs
POST /erp/v1/auth/login
GET  /erp/v1/auth/me
```

### 文档管理

```text
GET    /erp/v1/documents
POST   /erp/v1/documents
POST   /erp/v1/documents/upload
GET    /erp/v1/documents/{document_id}
PATCH  /erp/v1/documents/{document_id}
DELETE /erp/v1/documents/{document_id}
```

### 文档上传与解析

生产化上传入口：

```text
POST /erp/v1/documents/upload
Content-Type: multipart/form-data
```

表单字段：

```text
file                 原始文件，必填，当前单文件最大 50MB
title                文档标题，可选
category             分类，可选
tags                 逗号分隔标签，可选
owner_id             上传人 ID，非管理员会被服务端覆盖为当前登录用户
department_id        所属部门 ID，非管理员会被服务端覆盖为当前用户部门
visibility           public / department / role / private / admin
org_unit_id          组织单元 / scope ID
org_path             组织路径
archive_catalog_id   匹配的档案目录项 ID
archive_category     档案分类
document_type        文档类型
filing_year          归档年度
filing_period        归档周期
retention_period     保管期限
is_required          是否必传
ai_enabled           是否默认允许进入 AI
ai_usage_scope       archive_only / ai_search / ai_answer
knowledge_dataset_key 目标 dataset 标识
```

前端上传页当前会按“组织单元 -> 档案模板 -> 档案目录项”三级联动，自动回填部分治理字段，减少手填目录项 ID。

已支持解析：

```text
txt / md / csv / json / log / xml / html / yaml
pdf
docx
xlsx / xlsm
```

上传后系统会同时保存：

```text
original_path      原始文件相对路径
content_path       解析后的文本路径
parse_status       parsed / empty / unsupported / failed
parse_error        解析失败或空内容原因
parser             text / csv / json / html / pypdf / python-docx / openpyxl 等
source_type        upload / json
```

说明：OCR 扫描件 PDF、图片识别、复杂版式还属于预留增强能力，后续可接 PaddleOCR、Tesseract 或云 OCR 服务。

### 批量操作

```text
POST /erp/v1/documents/batch/delete
POST /erp/v1/documents/batch/archive
POST /erp/v1/documents/batch/reindex
```

### Dify 同步

```text
GET  /erp/v1/dify/config
POST /erp/v1/documents/{document_id}/sync-to-dify
POST /erp/v1/documents/batch/sync-to-dify
POST /erp/v1/documents/{document_id}/refresh-dify-status
POST /erp/v1/documents/batch/refresh-dify-status
```

### AI

```text
POST /erp/v1/ai/retrieve
POST /erp/v1/ai/chat
POST /erp/v1/ai/ask
```

`/erp/v1/ai/ask` 为兼容旧入口，当前内部走 Dify Chat App。

### 治理与助手补充接口

```text
GET  /erp/v1/assistant/archive-overview
GET  /erp/v1/assistant/ai-governance-overview
GET  /erp/v1/archive/missing-required
POST /erp/v1/archive/recalculate-coverage
PATCH /erp/v1/archive/documents/{document_id}/ai-policy
GET  /erp/v1/knowledge/sync-candidates
POST /erp/v1/knowledge/batch/sync
POST /erp/v1/archive/documents/upload
```

### 管理视图

```text
GET /erp/v1/dashboard
GET /erp/v1/users
GET /erp/v1/roles
GET /erp/v1/departments
GET /erp/v1/audit-logs
GET /erp/v1/settings
PATCH /erp/v1/settings
PATCH /erp/v1/settings/batch
GET /erp/v1/capabilities
GET /erp/v1/index/status
PUT /erp/v1/documents/{document_id}/permissions
```

权限说明：

- `admin`：可访问系统设置、审计日志、权限配置、Dify 配置，并可在权限页逐文档编辑 `visibility / user_ids / role_ids / department_ids`
- `ops`：可读写文档，可执行本地重建索引和 Dify 同步
- `finance`：只读文档和 AI 问答

当前接口不再信任前端透传的 `user_id` 或 AI 请求体中的 `user` 字段，统一以 Bearer Token 解析当前用户。

## 数据位置

ERP MVP 数据默认写入：

```text
data/erp/state.json
data/erp/documents/
```

上传后的原始文件保存到：

```text
data/erp/documents/{document_id}/original/v{version}_{safe_file_name}
```

解析后的预览文本保存到：

```text
data/erp/documents/{document_id}/v{version}.txt
```

如需切换数据目录，可设置：

```bash
ERP_DATA_DIR=/path/to/data python -m uvicorn app.main:app --reload
```

说明：当前已经使用 multipart upload 保存原始文件，并在后端解析文本。生产环境如文件量较大，建议继续升级为 MinIO、S3、OSS 等对象存储，并把本地 JSON 状态替换为 PostgreSQL。

## 项目结构

```text
app/
  main.py                     FastAPI 入口，挂载 API 和静态页面
  erp/
    parsers.py                上传文件文本解析器
    router.py                 ERP API 路由
    schemas.py                ERP 请求/响应模型
    store.py                  文件型数据存储和业务逻辑
  integrations/
    dify/
      client.py               Dify API client
      service.py              ERP 与 Dify 的同步、检索、问答服务
  static/
    index.html                管理后台 HTML
    styles.css                管理后台样式
    app.js                    管理后台交互逻辑
  knowledge/                  原有本地知识库 API
  skill_api/                  原有 skill 兼容 API

data/
  erp/
    state.json                ERP 本地状态数据
    documents/                文档原始文件和解析文本
```

## 排障说明

### Dify API 401

含义：API Key 缺失或错误。

检查：

```bash
curl -i http://127.0.0.1:8080/v1/datasets \
  -H "Authorization: Bearer 你的知识库APIKey"
```

正常应返回 `200 OK` 和知识库列表。

### Dify API 404

含义：`dify_dataset_id` 可能错误，或者文档尚未同步成功。

检查：

- 知识库 URL 中的 dataset id 是否正确
- ERP 文档详情中是否已有 `dify_batch`

### Dify API 502

常见原因：

- Dify 服务未完全启动
- Dify worker 或 api 内部报错
- Python httpx 读取系统代理环境变量导致本机请求被代理

本项目已经在 Dify client 中设置：

```python
trust_env=False
```

用于避免本机代理影响 `127.0.0.1:8080` 请求。

如果仍然 502，查看 Dify 日志：

```bash
cd ~/Desktop/dify/docker
docker compose logs --tail=100 api
docker compose logs --tail=100 worker
docker compose logs --tail=100 nginx
```

### AI 问答返回 dify_app_api_key 未配置

含义：知识库检索可用，但 Dify Chat App 问答未配置。

处理：

- 在 Dify 创建 Chat App
- 绑定知识库
- 在 App 的 API 访问页面创建 App API Key
- 回到 ERP 系统设置填写 `dify_app_api_key`

### 检索结果为空

可能原因：

- 文档还未完成 Dify 索引
- query 与文档内容不相关
- `top_k` 太小
- Embedding 模型配置不正确
- Dify 知识库中该文档未启用或未 available

## 安全说明

- 不要让前端直接调用 Dify API
- Dify API Key 当前保存在本地 `data/erp/state.json`
- 不要把真实 API Key 提交到公开仓库
- 如果 Key 曾经暴露在截图、日志或聊天中，建议在 Dify 里重新生成并删除旧 Key
- 当前登录仍是演示账号逻辑，但接口已经切到 Bearer Token 校验，不再信任前端传入用户身份
- 文档列表、文档详情、Dify 检索、AI 问答引用已按用户可见文档做服务端过滤
- AI 检索和 AI 问答统一从服务端当前登录用户出发做过滤
- 当前 Dify 权限过滤仍依赖 ERP 侧的 `dify_document_id` 映射；如果需要更强隔离，建议按部门/密级拆分 Dify Dataset，或使用 Dify 元数据过滤能力
- 系统设置现在只允许白名单字段写入，避免任意 key 注入

## 更新日志

### v0.5.0 - 鉴权收口、角色权限与 AI 身份治理

日期：2026-04-27

新增：

- 新增 Bearer Token 鉴权，登录返回 `token` 和 `expires_at`
- 新增 `GET /erp/v1/auth/me` 用于校验和续发当前会话
- ERP 路由统一从 `Authorization` 头解析当前用户，不再信任前端透传 `user_id`
- 新增角色权限校验：`document:read`、`document:write`、`document:index`
- 管理类接口收口到管理员，包括系统设置、审计日志、权限配置和 Dify 配置查看
- AI 问答返回新增 `answer_mode`、`permission_filtered`、`confidence`、`retrieved_count`
- 新增 `PATCH /erp/v1/settings/batch` 批量保存配置

调整：

- 文档列表、详情、AI 检索、AI 问答统一改为服务端按当前 token 用户过滤
- 非管理员上传或创建文档时，`owner_id` 和 `department_id` 由服务端覆盖为当前登录用户上下文
- 前端管理台请求统一改为自动附带 Bearer Token
- 前端设置页改为批量提交 Dify 配置

修复：

- 修复仅依赖前端透传用户身份带来的伪造调用风险
- 修复普通用户可直接访问敏感系统设置接口的风险
- 修复 AI 接口把用户身份放在请求体中的边界问题

说明：

- 当前仍属于本地单机 MVP，token 为本地签名票据，不是完整企业 SSO
- Dify Chat App 仍是“ERP 先检索、再构造权限过滤上下文、再调用 Dify”模式；若要进一步强化隔离，建议继续推进 metadata filter 或分 dataset 策略

### v0.4.0 - 生产化上传、文档解析与权限过滤

日期：2026-04-22

新增：

- 新增 `POST /erp/v1/documents/upload` multipart 原文件上传接口
- 新增后端文件解析器，支持文本、CSV、JSON、HTML、PDF、DOCX、XLSX/XLSM
- 新增原始文件保存目录 `documents/{document_id}/original`
- 新增解析结果字段：`parse_status`、`parse_error`、`parser`、`source_type`、`original_path`
- 前端上传页改为直接上传原文件，不再只依赖浏览器读取文本
- 文档库和详情页展示解析状态
- 文档列表和文档详情支持按当前用户过滤
- Dify Knowledge Retrieve 结果按 ERP 可见文档过滤
- Dify Chat App 问答先构造权限过滤后的上下文，再调用 Dify
- 新增上传大小保护，单文件默认最大 50MB

依赖：

- 新增 `python-multipart`
- 新增 `pypdf`
- 新增 `python-docx`
- 新增 `openpyxl`

说明：

- 当前权限过滤主要在 ERP 服务端完成，适合 MVP 和内部验证
- 生产环境建议继续补充正式登录鉴权、对象存储、数据库事务、病毒扫描、OCR、异步解析队列和更强的 Dify Dataset 隔离策略

### v0.3.0 - Dify 知识库检索与 AI 问答

日期：2026-04-21

新增：

- 新增 Dify Knowledge Retrieve 调用
- 新增 Dify Chat App `/chat-messages` 调用
- 新增 `/erp/v1/ai/retrieve`
- 新增 `/erp/v1/ai/chat`
- AI 问答页面改为双模式：知识库检索 + AI 问答
- 系统设置新增 `dify_app_api_key`
- Dify client 禁用系统代理环境 `trust_env=False`

修复：

- 修复本机代理导致 Python httpx 访问 Dify 返回 502 的问题
- 调整 Dify retrieve 请求体为 Dify 1.13 兼容的最小结构

### v0.2.0 - Dify 文档同步

日期：2026-04-21

新增：

- 新增 Dify API client
- 新增 Dify sync service
- 新增文档同步到 Dify
- 新增批量同步到 Dify
- 新增刷新 Dify 索引状态
- 新增 `dify_dataset_id`、`dify_document_id`、`dify_batch` 等字段
- 前端文档库和详情页展示 Dify 同步状态
- 系统设置新增 Dify 知识库配置项

修复：

- 默认关闭 `doc_metadata` 发送，避免 Dify 1.13 在未配置元数据字段时同步失败

### v0.1.0 - ERP 文档管理基础版

日期：2026-04-20

新增：

- 登录页
- 仪表盘
- 文档库
- 文档上传
- 文档详情
- 文档预览
- 版本历史
- 用户管理
- 角色管理
- 部门管理
- 审计日志
- 系统设置
- 批量删除
- 批量归档
- 本地重新索引
- AI 问答预留入口
- 文件型本地数据存储
