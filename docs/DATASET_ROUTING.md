# 知识域与 Dataset 路由实施说明

## 目标

ERP 代码层是企业用户的第一道权限网关。Dify Dataset、Workspace 和 App 权限是第二道后台防线。用户问题中的关键词不能改变用户已授权的知识域。

```text
用户 Token
 -> 角色能力
 -> 部门、目录和文档 ACL
 -> 允许的知识域
 -> 对应 Dify Dataset 检索
 -> 结果再次执行文档权限过滤
 -> Dify Chat App 生成回答
```

## 知识域矩阵

系统按安全域管理 Dataset，不按用户创建 Dataset：

| 知识域 key | 内容示例 | 默认访问范围 |
| --- | --- | --- |
| `public-kb` | 用车、请假、发文、采购报销等公共流程 | 全体具备 `document:read` 的用户 |
| `ops-sop-kb` | 运营 SOP、项目和运维流程 | 运营管理部 |
| `finance-policy-kb` | 固定资产、财务制度、财务审批 | 财务部 |
| `hr-kb` | 人事制度、薪酬、绩效和培训 | 人力资源部 |
| `legal-kb` | 合同、印章和合规制度 | 法务合规部 |
| `admin-kb` | 综合行政、会议和公文材料 | 综合管理部 |
| `safety-kb` | 安全生产、施工、车辆和设备制度 | 安全生产部 |
| `engineering-kb` | 工程技术和项目技术资料 | 工程技术部 |
| `information-kb` | OA、企业邮箱和信息系统资料 | 信息化管理部 |
| `restricted-kb` | 核心经营和受限资料 | 管理员及显式授权负责人 |

管理员拥有全部知识域。普通用户和部门负责人首先按所属部门、目录权限和文档 ACL 计算允许范围，再进行检索。

## 配置方式

Dataset 映射保存在 `data/erp/state.json` 的 `knowledge_dataset_mappings` 中。每条映射包括：

```json
{
  "dataset_key": "finance-policy-kb",
  "dataset_name": "财务制度知识库",
  "dataset_id": "Dify 中的真实 Dataset UUID",
  "scope_id": "dept-finance",
  "security_domain": "finance",
  "enabled": true,
  "priority": 100
}
```

兼容阶段可以将 `dataset_id` 留空。后端会自动回退到系统设置中的旧 `dify_dataset_id`，所有知识域共用原知识库，但仍执行 ERP 文档权限过滤。

管理员也可以在前端进入：

```text
系统设置 -> 知识域 Dataset 路由
```

为每个知识域填写 UUID。保存接口为：

```text
GET   /erp/v1/knowledge/datasets/mapping
PATCH /erp/v1/knowledge/datasets/mapping
```

路由表中的“允许角色”和“允许部门”可以直接维护白名单，保存时后端会校验主体是否存在并拒绝重复 Dataset Key。公共域两列留空表示所有拥有 `document:read` 能力的已登录角色；受限域默认没有白名单，只有管理员可用，部门负责人需要由管理员显式加入角色或部门白名单。路由表还提供“导出迁移清单”，对应接口为：

```text
GET /erp/v1/knowledge/migration-inventory/export
```

该 CSV 不会复制文档内容，只列出迁移前需要人工确认的部门、目录、知识域、目标 Dataset、密级、可见主体、AI 状态和当前 Dify ID。

## 上传和同步路由

上传文档时，系统根据档案目录、组织范围、文档类型、可见范围和 AI 用途确定 `knowledge_dataset_key`。同步时根据该 key 找到物理 Dataset：

```text
财务部 / 固定资产制度 -> finance-policy-kb
全员 / 请假流程       -> public-kb
核心受限资料          -> restricted-kb
```

如果文档没有匹配的知识域，不能在多 Dataset 模式下同步，后端会返回“文档未匹配到可用知识域”。这属于安全拒绝，而不是自动放入未知知识库。

文档跨部门迁移、改目录、改可见范围或改密级后，ERP 会自动重算知识域并将已同步状态标记为待更新。再次同步时，同一 Dataset 使用 Dify 更新接口；跨 Dataset 则先写入目标库，再删除旧库记录（旧记录不存在时按已清理处理）。

## 多 Dataset 检索

问答时后端先调用 `allowed_knowledge_dataset_keys(user_id)`，再将允许的 key 转换为物理 Dataset 路由。用户提问文本不会参与权限提升。

当用户同时有多个知识域权限时，后端会：

1. 对每个授权 Dataset 调用 retrieve；
2. 合并并按相关度排序；
3. 根据 ERP 文档、目录和黑名单再次过滤；
4. 只将剩余片段交给回答模型。

如果用户没有允许的 Dataset，返回无可见内容，不会尝试检索全量库。

## Dify Workspace 第二道防线

Dify Workspace 用于管理后台人员，而不是替代 ERP 普通用户 ACL：

| Dify 角色 | 用途 |
| --- | --- |
| Owner | 生产 Workspace 所有者和密钥管理 |
| Admin | Dataset、App、模型和成员管理 |
| Editor | 知识库维护和索引处理 |
| Member | 只读的后台协作人员 |

建议生产和测试使用不同 Workspace，只允许知识库维护人员进入生产 Workspace。ERP 普通用户不需要成为 Dify Workspace 成员。

Dify Dataset API Key 和 Chat App API Key 只保存在 ERP 后端。不要放在 React 前端、浏览器 localStorage 或提交到代码仓库。

## Chat App 安全要求

如果一个 Chat App 绑定了包含全部敏感文档的默认知识库，它可能在 ERP 过滤后再次自行检索，造成越权回答。必须选择以下方案之一：

- Chat App 不绑定全量敏感知识库，只使用 ERP 传入的 `erp_context`；
- 为不同知识域配置不同 Chat App，ERP 按路由选择 App；
- 确保 Dify App 的 Dataset 和元数据过滤与 ERP 路由完全一致。

当前服务会向 Chat App 传入 `erp_context`、`allowed_dataset_keys` 和 `permission_mode=erp_filtered_context`。Dify Workflow 应显式使用这些输入，不应再绑定不受限的全量知识库。ERP 会丢弃未被 ERP 检索结果证明的 Chat App 引用；未关联 ERP 的 Dify 直传文档对普通用户不可见，管理员可在知识文档页完成权限映射。

## Dataset 创建后的迁移步骤

1. 备份服务器 `data/erp/state.json` 和原始文档目录。
2. 在 Dify 中创建公共、部门和受限 Dataset。
3. 在系统设置的 Dataset 路由表中填入每个 Dataset 的 UUID。
4. 导出文档清单，确认所属部门、目录、知识域、密级、可见角色、AI 用途和下载权限。
5. 按知识域重新同步文档，确认返回的 `dify_dataset_id` 正确。
6. 在 Dify 中检查每个 Dataset 的索引状态和 App 绑定。
7. 使用 admin、ops、finance、普通员工账号分别测试问答、列表、下载和目录访问。
8. 确认敏感文档在无权限账号的检索结果、引用和回答中均不存在。

## 验收矩阵

| 测试项 | admin | ops | finance | 普通员工 |
| --- | --- | --- | --- | --- |
| 公共流程问答 | 允许 | 允许 | 允许 | 允许 |
| 运营知识问答 | 允许 | 允许 | 拒绝或无结果 | 拒绝或无结果 |
| 财务知识问答 | 允许 | 拒绝或无结果 | 允许 | 拒绝或无结果 |
| 跨部门目录查看 | 允许 | 仅本部门 | 仅本部门 | 仅授权范围 |
| 文档下载 | 按文档策略 | 需角色和文档开关 | 默认无下载能力 | 无权限 |
| Dataset 路由配置 | 允许 | 禁止 | 禁止 | 禁止 |

## 代码入口

- `app/erp/store.py`：知识域映射、用户允许 Dataset 计算和文档默认归类；
- `app/integrations/dify/client.py`：Dify Dataset API 调用；
- `app/integrations/dify/service.py`：Dataset 路由、同步、多库检索和结果过滤；
- `app/erp/router.py`：权限校验和 Dataset 映射接口；
- `src/pages/Settings.tsx`：管理员 Dataset 路由配置界面。
