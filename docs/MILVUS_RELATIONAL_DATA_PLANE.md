# Milvus + 关系数据库数据底座

## 适配结论

本项目已经完成 Milvus 的代码级适配，但范围是知识库检索数据平面。关系数据库保存文档元数据、chunk 文本、权限快照和索引任务状态，Milvus 保存向量；ERP 主业务状态仍在 `data/erp/state.json` 和本地文件中，合同模块仍使用 `data/contracts.db`。因此切换到 Milvus 不等于已经把整套系统的数据库统一迁移完成。

项目同时保留 Dify 兼容路径：

- `KNOWLEDGE_VECTOR_BACKEND=milvus`：本项目生成 Embedding 并检索 Milvus；Dify 仍可作为 Chat App/Workflow 生成服务。
- `KNOWLEDGE_VECTOR_BACKEND=dify`：继续调用 Dify Dataset 检索接口，不需要本项目单独维护 Milvus。

这个开关只改变本项目的知识检索后端，不会替换 Dify 自己的 PostgreSQL、Redis 或向量服务。

本副本把数据职责拆成两层：

- 关系数据库是权威源，保存文档元数据、版本、chunk 文本、权限快照和索引任务状态。
- Milvus 只保存向量以及 `chunk_id`、`document_id`、`version`、`knowledge_domain` 等检索字段。
- Milvus 的主键直接使用关系库 `knowledge_document_chunks.id`，避免生成不可追踪的匿名向量 ID。
- 原始文件仍保存在对象存储或 `data/erp/documents`，不复制进 Milvus。

## 入库

文档上传时 ERP 先保存文档事实和权限；执行重建索引时，解析文本按固定窗口切块，写入 `knowledge_document_chunks`，再生成 Embedding 并 upsert 到 Milvus。向量服务不可用时，chunk 保持 `pending`，可以重试，不会丢失关系库数据。

## 查询

后端先根据用户 Token 计算允许的文档 ID，再检索 Milvus；随后用一条批量 SQL 查询按 `chunk_id` 获取文本和元数据，并再次执行 ACL、AI 治理、版本和删除状态检查。只有通过两次检查的内容才会进入 LLM 上下文。

## 关键环境变量

| 变量 | 说明 |
|---|---|
| `KNOWLEDGE_DATABASE_URL` | SQLAlchemy URL，默认 SQLite `data/erp/knowledge.db` |
| `KNOWLEDGE_VECTOR_BACKEND` | `milvus`（默认）或 `dify` |
| `MILVUS_URI` | 默认 `http://127.0.0.1:19530`；为空时保留 SQL chunk 并走词法降级 |
| `MILVUS_COLLECTION` | 向量集合名，默认 `knowledge_chunks` |
| `KNOWLEDGE_EMBEDDING_PROVIDER` | `hash`（开发）或 `ollama`（生产示例） |

`GET /erp/v1/ai/data-plane/status` 只返回健康状态和计数，不返回任何密钥。

## 企业部署检查清单

采用 Milvus 模式时，需要分别部署并验证：

1. PostgreSQL：设置 `KNOWLEDGE_DATABASE_URL=postgresql+psycopg://...`，并规划正式的数据库迁移工具。当前代码使用 SQLAlchemy `create_all`，没有 Alembic 迁移链路。
2. Milvus：配置 `MILVUS_URI` 和 collection，并确认服务端鉴权、TLS、网络策略和备份方案。当前适配器只读取 URI 和 collection，没有独立的 `MILVUS_TOKEN`/用户名密码配置；接入开启鉴权的远程 Milvus 或 Zilliz Cloud 前，需要补充认证配置。项目的启动脚本只启动 FastAPI，不会启动 Milvus。
3. Embedding：生产环境不要使用默认的 `hash` provider，应使用 Ollama 或企业 Embedding API，并保持模型维度与 Milvus collection 一致。
4. 历史数据：执行 `python scripts/migrate_json_to_relational.py` 可回填知识库关系表和向量；ERP `state.json`、合同 SQLite 和本地原始文件仍需单独迁移。
5. 存储与密钥：原始文件应迁移到 MinIO、S3 或 OSS；Dify/Milvus 凭据应使用环境变量或密钥管理系统，不应随状态 JSON 打包。

如果企业仍希望由 Dify 管理切分、Embedding 和召回，可以选择 `KNOWLEDGE_VECTOR_BACKEND=dify`，沿用 Dify 自己的数据库和向量服务，不必额外部署 Milvus。

当前 Milvus 3.0 使用 `pymilvus 3.x`。项目仍兼容现有 ORM 风格 API；启动日志中的
`PyMilvusDeprecationWarning` 是迁移提示，不是连接或检索错误。
