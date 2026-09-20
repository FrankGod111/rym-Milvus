import { useState } from 'react';
import { Card, Table, Tabs, Button, Tag, Space, Typography, Progress, Row, Col, Statistic, Form, Input, Drawer, message } from 'antd';
import { FileTextOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, PlusOutlined, ExportOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

const myMockTestCases = [
  { id: 'tc-1', title: '用户登录接口单元测试', contractCode: 'HT-2024-001', type: 'unit', status: 'passed', coverage: 95, createdAt: '2024-06-08' },
  { id: 'tc-2', title: '数据同步集成测试', contractCode: 'HT-2024-001', type: 'integration', status: 'passed', coverage: 82, createdAt: '2024-06-07' },
  { id: 'tc-3', title: '合同信息提取验收测试', contractCode: 'HT-2024-002', type: 'acceptance', status: 'pending', coverage: 0, createdAt: '2024-06-06' },
  { id: 'tc-4', title: '权限控制单元测试', contractCode: 'HT-2024-003', type: 'unit', status: 'failed', coverage: 78, createdAt: '2024-06-05' },
  { id: 'tc-5', title: 'OCR 精度回归测试', contractCode: 'HT-2024-001', type: 'acceptance', status: 'passed', coverage: 88, createdAt: '2024-06-04' },
  { id: 'tc-6', title: '消息通知集成测试', contractCode: 'HT-2024-002', type: 'integration', status: 'pending', coverage: 0, createdAt: '2024-06-03' },
];

const acceptancePlans = [
  { id: 'ap-1', title: '月度巡检报告生成验收方案', contractCode: 'HT-2024-001', owner: '运维组', status: 'approved', progress: 100 },
  { id: 'ap-2', title: '合同到期自动提醒功能验收', contractCode: 'HT-2024-002', owner: '产品组', status: 'in_progress', progress: 60 },
  { id: 'ap-3', title: 'API 接口安全扫描验收', contractCode: 'HT-2024-001', owner: '安全组', status: 'pending', progress: 0 },
];

export default function DevTestMgmt() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const statusColorMap: Record<string, string> = { passed: 'green', failed: 'red', pending: 'orange', skipped: 'default' };
  const statusLabelMap: Record<string, string> = { passed: '通过', failed: '失败', pending: '待执行', skipped: '跳过' };
  const typeColorMap: Record<string, string> = { unit: 'blue', integration: 'orange', acceptance: 'green' };
  const typeLabelMap: Record<string, string> = { unit: '单元测试', integration: '集成测试', acceptance: '验收测试' };

  const testCaseColumns = [
    { title: '用例名称', dataIndex: 'title', key: 'title', render: (v: string) => <Text strong>{v}</Text> },
    { title: '关联合同', dataIndex: 'contractCode', key: 'contractCode' },
    { title: '类型', dataIndex: 'type', key: 'type', render: (v: string) => <Tag color={typeColorMap[v]}>{typeLabelMap[v]}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <Tag color={statusColorMap[v]} icon={v === 'passed' ? <CheckCircleOutlined /> : v === 'failed' ? <CloseCircleOutlined /> : <ExclamationCircleOutlined />}>{statusLabelMap[v]}</Tag> },
    { title: '覆盖率', dataIndex: 'coverage', key: 'coverage', render: (v: number) => (v > 0 ? <Progress percent={v} size="small" style={{ width: 100 }} /> : '—') },
    { title: '创建日期', dataIndex: 'createdAt', key: 'createdAt' },
  ];

  const planStatusMap: Record<string, { color: string; label: string }> = { approved: { color: 'green', label: '已批准' }, in_progress: { color: 'orange', label: '进行中' }, pending: { color: 'blue', label: '待审批' } };

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>测试管理</Title>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}><Card size="small"><Statistic title="用例总数" value={myMockTestCases.length} prefix={<FileTextOutlined />} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="通过率" value={Math.round(myMockTestCases.filter(c => c.status === 'passed').length / myMockTestCases.length * 100)} suffix="%" valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="平均覆盖率" value={Math.round(myMockTestCases.filter(c => c.coverage > 0).reduce((s, c) => s + c.coverage, 0) / myMockTestCases.filter(c => c.coverage > 0).length)} suffix="%" /></Card></Col>
      </Row>

      <Tabs
        items={[
          {
            key: 'cases',
            label: '测试用例',
            children: (
              <Card>
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
                  <Space>
                    <Tag color="blue">单元测试 {myMockTestCases.filter(c => c.type === 'unit').length}</Tag>
                    <Tag color="orange">集成测试 {myMockTestCases.filter(c => c.type === 'integration').length}</Tag>
                    <Tag color="green">验收测试 {myMockTestCases.filter(c => c.type === 'acceptance').length}</Tag>
                  </Space>
                  <Space>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsDrawerOpen(true)}>新建用例</Button>
                    <Button icon={<ExportOutlined />}>导出报告</Button>
                  </Space>
                </div>
                <Table dataSource={myMockTestCases} columns={testCaseColumns} rowKey="id" pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }} />
              </Card>
            ),
          },
          {
            key: 'plans',
            label: '验收方案',
            children: (
              <Card>
                <Table
                  dataSource={acceptancePlans}
                  columns={[
                    { title: '方案名称', dataIndex: 'title', key: 'title' },
                    { title: '关联合同', dataIndex: 'contractCode', key: 'contractCode' },
                    { title: '负责团队', dataIndex: 'owner', key: 'owner' },
                    {
                      title: '状态', dataIndex: 'status', key: 'status',
                      render: (v: string) => <Tag color={planStatusMap[v]?.color}>{planStatusMap[v]?.label}</Tag>,
                    },
                    { title: '进度', dataIndex: 'progress', key: 'progress', render: (v: number) => <Progress percent={v} size="small" style={{ width: 140 }} /> },
                    { title: '操作', key: 'action', render: () => <Space><Button type="link" size="small">查看</Button><Button type="link" size="small">编辑</Button></Space> },
                  ]}
                  rowKey="id"
                  pagination={false}
                />
              </Card>
            ),
          },
          {
            key: 'coverage',
            label: '覆盖率报告',
            children: (
              <Card>
                <Row gutter={16}>
                  <Col span={12}><Card size="small"><div style={{ textAlign: 'center' }}><Progress type="circle" percent={78} width={160} format={(p) => `${p}%`} /><div style={{ marginTop: 8 }}>整体覆盖率</div></div></Card></Col>
                  <Col span={12}>
                    <Card size="small">
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <div><Text>单元测试覆盖率</Text><Progress percent={85} /></div>
                        <div><Text>集成测试覆盖率</Text><Progress percent={72} /></div>
                        <div><Text>验收测试覆盖率</Text><Progress percent={65} /></div>
                      </Space>
                    </Card>
                  </Col>
                </Row>
              </Card>
            ),
          },
        ]}
      />

      <Drawer title="新建测试用例" placement="right" width={500} open={isDrawerOpen} onClose={() => setIsDrawerOpen(false)}>
        <Form layout="vertical">
          <Form.Item name="title" label="用例名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="contractCode" label="关联合同"><Input /></Form.Item>
          <Form.Item name="type" label="类型">
            <Input.TextArea rows={3} placeholder="单元测试 / 集成测试 / 验收测试" />
          </Form.Item>
          <Form.Item><Button type="primary" onClick={() => { setIsDrawerOpen(false); message.success('用例已创建（演示）'); }}>保存</Button></Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
