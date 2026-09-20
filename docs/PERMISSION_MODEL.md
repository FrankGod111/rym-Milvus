# 文档与目录权限模型

本项目将“能做什么”和“能看哪些数据”拆开管理。角色能力控制操作，文档 ACL 和档案目录范围控制数据。黑名单优先，下载是独立动作。

## 决策顺序

1. 用户身份和角色能力。管理员角色拥有通配能力，其他角色必须拥有对应能力。
2. 文档黑名单。命中用户、角色或部门黑名单立即拒绝。
3. 规则树节点范围。检查节点操作权限、继承或覆盖后的白名单和组织范围。
4. 档案目录范围。目录策略开启文档继承时继续检查目录 ACL。
5. 文档可见范围和 ACL。公开仅代表全员可读；下载仍需下载能力和 download_enabled=true。部门范围默认仅所属部门，角色范围仅指定角色，私有仅本人，管理员范围仅管理员。

## 目录节点配置

在档案目录选择节点并点击配置节点，管理员可设置查看、上传、删除、修改元数据、下载五类动作，以及用户、角色、部门白名单和黑名单。节点支持 inherit 继承父节点或 override 覆盖父节点。白名单为空时，组织节点按 scope_id 限制到对应部门。

## 文档权限配置

在文档详情点击配置权限，管理员可以调整可见范围、下载开关以及文档级白名单和黑名单。保存时后端校验用户、角色和部门编号必须真实存在。

## 权限决策解释接口

GET /erp/v1/documents/{document_id}/access-decision?action=read|write|index|download
GET /erp/v1/archive/tree/nodes/{node_id}/access-decision?action=read|upload|delete|metadata|download

响应包含 allowed、reason、required_capability、matched_rules、denied_by 和 effective_scope，用于解释允许或拒绝原因。

## Dify 检索过滤

Dify 直传文档没有 ERP 映射时不会对普通账号开放。管理员可以查看未映射文档；普通账号只会得到已关联并通过文档、目录权限判断的 Dify 文档。

## 部署注意

仅同步代码和依赖文件；不要覆盖服务器的 .env、data/erp/state.json、data/erp/documents 或服务器专用 Dify/Qwen 配置。权限数据属于 state.json，上线前应备份服务器数据并在服务器上完成角色、目录和 ACL 配置。

## 详细实现说明

### 1. 权限数据和登录

文件存储版的用户、角色、部门、目录、文档 ACL 和 Dify 映射都在 `data/erp/state.json`：

| 数据 | 字段 |
| --- | --- |
| 用户 | `users` |
| 角色能力 | `roles` |
| 部门/组织 | `departments`、`org_nodes` |
| 规则树 | `archive_tree_nodes` |
| 档案目录 | `archive_catalogs`、`archive_catalog_items` |
| 目录权限 | `catalog_permissions` |
| 文档 | `documents` |
| 文档 ACL | `permissions` |

登录接口为 `POST /erp/v1/auth/login`。后端签发带签名和过期时间的 Bearer Token，后续接口从 Token 解析用户身份，不信任前端传入的用户 ID。

当前演示账号关系如下：

| 账号 | 角色 | 部门 | 默认范围 |
| --- | --- | --- | --- |
| `admin` | 管理员 | 运营管理部 | `*`，全局权限 |
| `ops` | 文档编辑 | 运营管理部 | 文档读写、索引、下载、档案和 AI 治理 |
| `finance` | 只读成员 | 财务部 | 文档读取、档案读取、覆盖看板读取 |

当前演示登录只检查密码非空。正式环境应替换为密码哈希、LDAP 或 SSO。

### 2. 角色能力和菜单

角色使用权限编号控制操作，例如 `document:read`、`document:write`、`document:index`、`document:download`、`archive:read`、`archive:write`、`archive:catalog:write`、`archive:coverage:read`、`ai-governance:read` 和 `ai-governance:write`。管理员的 `*` 表示全局能力。

`GET /erp/v1/access-context` 返回角色、权限编号、组织树和 `menu_permissions`。前端据此裁剪左侧菜单，但菜单隐藏不是安全边界，后端接口仍会通过 `require_permission` 再次校验。

### 3. 规则树权限

规则树节点支持 `read`、`upload`、`delete`、`metadata`、`download` 五种操作，以及用户、角色、部门白名单和黑名单。节点的 `permission_mode` 为 `inherit` 时继承父节点，为 `override` 时从当前节点覆盖父级。

无显式白名单时，组织节点按 `scope_id` 限制到所属部门。判断顺序是：

```text
管理员通配权限
 -> 角色操作能力
 -> 节点允许的操作
 -> 黑名单拒绝
 -> 白名单匹配
 -> 默认组织范围
```

配置入口：`档案目录 -> 选择节点 -> 配置节点`。

### 4. 档案目录权限

目录权限支持 `read`、`write`、`coverage`、`missing`、`download`，并支持用户、角色、部门白名单/黑名单。`inherit_to_documents=true` 时，目录策略会继续约束目录下的文档。

因此财务部用户不会因为能够访问系统页面，就自动看到人力资源部或信息化管理部的目录内容。

### 5. 文档 ACL

文档权限字段包括：

```text
visibility            public / department / role / private
user_ids              用户白名单
role_ids              角色白名单
department_ids        部门白名单
deny_user_ids         用户黑名单
deny_role_ids         角色黑名单
deny_department_ids   部门黑名单
download_enabled      下载开关
```

配置入口：`知识文档 -> 文档详情 -> 配置权限`。保存接口为 `PUT /erp/v1/documents/{document_id}/permissions`，当前仅管理员可以修改文档 ACL。

`public` 只表示全员可读，不代表全员可下载。下载必须同时满足角色拥有 `document:download`、文档开启 `download_enabled`、目录和规则树允许下载，并且 ERP 本地存在真实且非空的原始附件。

### 6. 统一判断和解释接口

文档访问的实际顺序为：

```text
Token 身份
 -> 角色能力
 -> 文档黑名单
 -> 规则树节点
 -> 档案目录
 -> 文档 visibility / 白名单
 -> 下载开关和原始文件检查
```

可用以下接口解释允许或拒绝原因：

```text
GET /erp/v1/documents/{document_id}/access-decision?action=read|write|index|download
GET /erp/v1/archive/tree/nodes/{node_id}/access-decision?action=read|upload|delete|metadata|download
```

响应包含 `allowed`、`reason`、`required_capability`、`matched_rules`、`denied_by` 和 `effective_scope`。

### 7. Dify 检索过滤

Dify 不会自动识别 ERP 的 `admin`、`ops`、`finance` 角色。后端采用二次过滤：

```text
用户提问
 -> Dify 返回候选切片
 -> ERP 根据 dify_document_id 找到本地文档
 -> 应用规则树、目录和文档 ACL
 -> 丢弃无权限切片
 -> 将剩余内容交给 Dify Chat App
```

Dify 直接上传但尚未关联 ERP 的文档，管理员可以看到并关联，普通用户不会获得其检索结果。“Dify 数据集里存在”不等于“ERP 用户可以访问”。

### 8. 部署边界

同步权限逻辑时涉及 `app/erp/store.py`、`app/erp/router.py`、`app/erp/schemas.py`、`app/integrations/dify/client.py` 和 `app/integrations/dify/service.py`。不要用本地版本覆盖服务器的 `.env`、`data/erp/state.json`、`data/erp/documents/`、`app/deployment_config.py` 或 `deployment.config.mjs`。

同步后需重启 FastAPI；修改 React 前端后还需重新构建。服务器上的角色、目录 ACL、文档 ACL 和 Dify 文档映射应在服务器自己的 `state.json` 上配置和备份。

### 9. 当前边界

当前实现是文件存储版，密码仍为演示逻辑，Dify 权限由 ERP 二次过滤完成而非 Dify 原生多角色 Dataset 隔离。Dify 直传文档若 ERP 没有保存原始附件，只能导出检索到的正文片段，不能伪造原始文件下载。生产环境建议接入正式身份认证、数据库、对象存储，并按部门或密级拆分 Dataset。
