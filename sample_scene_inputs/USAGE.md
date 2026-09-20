# 场景页面示例输入说明

本目录用于测试沙箱中的三个场景页面：合同对比上传页、纪要生成页、测试报告生成页。

## 1. 合同对比上传页

页面位置：

- 合同对比上传页

可上传文件：

- `contracts/contract_a_supplier_standard.md`
- `contracts/contract_b_company_template.md`

建议填写：

- 合同类型：`采购服务合同`
- 审查重点：`付款条件, 违约责任, 验收条款, 保密与数据安全, 争议解决`
- 补充说明：`重点识别供应商版本相对公司模板的风险，包括预付款比例过高、自动验收、违约责任不对等、保密期限不足和管辖地不利。`

接口 payload：

- `payloads/contract_review_payload.json`

## 2. 纪要生成页

页面位置：

- 纪要生成页

可复制内容：

- `meeting/q2_procurement_optimization_notes.md`

建议填写：

- 会议主题：`Q2 采购流程优化会`
- 会议日期：`2026-05-11`
- 参会人员：`张三、李四、王五、赵六、钱七`
- 原始记录：复制 `meeting/q2_procurement_optimization_notes.md` 中的会议要点

接口 payload：

- `payloads/meeting_summary_payload.json`

## 3. 测试报告生成页

页面位置：

- 测试报告生成页

可复制内容：

- `test_report/erp_kb_console_test_inputs.md`

建议填写：

- 项目名称：`ERP 知识库控制台`
- 版本号：`v0.6.0-sandbox`
- 测试范围：复制“测试范围”部分
- 缺陷与现象：复制“缺陷与现象”部分
- 测试结论：复制“测试结论”部分

接口 payload：

- `payloads/test_report_payload.json`

## 当前状态

这三个页面目前仍然调用 mock 后端接口：

- `/erp/v1/scenes/contract-review`
- `/erp/v1/scenes/meeting-summary`
- `/erp/v1/scenes/test-report`

也就是说，它们现在可以用于演示页面流程、历史会话和审批闭环，但还没有真正读取文件正文并调用本地 `qwen3:8b`。