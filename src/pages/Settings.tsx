import { useEffect, useState } from 'react';
import { Alert, Card, Form, Input, Button, Switch, Divider, Typography, Space, message, Row, Col, Table, Tag, Select } from 'antd';
import { DownloadOutlined, UserOutlined, KeyOutlined } from '@ant-design/icons';
import { useAppStore } from '@/stores/app-store';
import BackendLoginModal from '@/components/BackendLoginModal';
import { erpApi, type KnowledgeDatasetMapping } from '@/api/erp';

const { Title, Text } = Typography;

export default function Settings() {
  const { currentUser } = useAppStore();
  const [authOpen, setAuthOpen] = useState(false);
  const [form] = Form.useForm();
  const [saved, setSaved] = useState(false);
  const [datasetMappings, setDatasetMappings] = useState<KnowledgeDatasetMapping[]>([]);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [datasetSaving, setDatasetSaving] = useState(false);
  const [roleOptions, setRoleOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [departmentOptions, setDepartmentOptions] = useState<Array<{ label: string; value: string }>>([]);

  const isAdmin = Boolean(currentUser.erp?.is_admin);

  const loadDatasetMappings = async () => {
    if (!isAdmin) return;
    setDatasetLoading(true);
    try {
      const [result, roles, departments] = await Promise.all([
        erpApi.knowledgeDatasetMappings(), erpApi.roles(), erpApi.departments(),
      ]);
      setDatasetMappings(result.mappings || []);
      setRoleOptions(roles.map((item) => ({ label: String(item.name || item.id), value: String(item.id) })));
      setDepartmentOptions(departments.map((item) => ({ label: String(item.name || item.id), value: String(item.id) })));
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Dataset 路由加载失败');
    } finally {
      setDatasetLoading(false);
    }
  };

  const saveDatasetMappings = async () => {
    setDatasetSaving(true);
    try {
      const result = await erpApi.updateKnowledgeDatasetMappings(datasetMappings);
      setDatasetMappings(result.mappings || []);
      message.success('知识域 Dataset 路由已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Dataset 路由保存失败');
    } finally {
      setDatasetSaving(false);
    }
  };

  const exportMigrationInventory = async () => {
    try {
      const blob = await erpApi.exportKnowledgeMigrationInventory();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = '知识库Dataset迁移清单.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '迁移清单导出失败');
    }
  };

  useEffect(() => { void loadDatasetMappings(); }, [isAdmin]);

  const handleSave = (values: any) => {
    console.log('Settings saved:', values);
    setSaved(true);
    message.success('设置已保存');
    setTimeout(() => setSaved(false), 2000);
  };

  const systemInfo = [
    { label: '系统版本', value: 'v2.1.0' },
    { label: '前端环境', value: 'React 18 + Vite 6 + TypeScript' },
    { label: 'AI 能力', value: '后端真实 API（PaddleOCR + Ollama + Skill 上下文）' },
    { label: '数据库', value: 'SQLite 合同台账（data/contracts.db）' },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>系统设置</Title>

      <Row gutter={16}>
        <Col span={8}>
          <Card title="用户信息" size="small">
            <Form layout="vertical" initialValues={{ name: currentUser.name, department: currentUser.erp?.department_name || '未设置部门' }}>
              <Form.Item name="name" label="用户名"><Input prefix={<UserOutlined />} /></Form.Item>
              <Form.Item name="department" label="所属部门">
                <Input disabled prefix={<KeyOutlined />} />
              </Form.Item>
              <Alert type={currentUser.erp ? 'success' : 'warning'} showIcon message={currentUser.erp ? '已连接 ERP 身份' : '当前未连接 ERP 身份'} description={currentUser.erp ? `所属部门：${currentUser.erp.department_name || '未设置部门'}` : '请使用 ERP 账号登录后进入系统。'} />
              {!currentUser.erp && <Button type="primary" onClick={() => setAuthOpen(true)} style={{ marginTop: 12 }}>连接 ERP 账号</Button>}
            </Form>
          </Card>
        </Col>
        <Col span={8}>
          <Card title="安全设置" size="small">
            <Form layout="vertical" onFinish={handleSave}>
              <Form.Item name="enableAI" label="启用 AI 功能" valuePropName="checked" initialValue={true}><Switch /></Form.Item>
              <Form.Item name="enableOCR" label="启用 OCR 识别" valuePropName="checked" initialValue={true}><Switch /></Form.Item>
              <Form.Item name="enableNotifications" label="启用主动提醒" valuePropName="checked" initialValue={true}><Switch /></Form.Item>
              <Form.Item name="enableAutoSync" label="自动数据同步" valuePropName="checked" initialValue={false}><Switch /></Form.Item>
              <Form.Item><Button type="primary" htmlType="submit" block>保存设置</Button></Form.Item>
            </Form>
          </Card>
        </Col>
        <Col span={8}>
          <Card title="系统信息" size="small">
            <Space direction="vertical" style={{ width: '100%' }}>
              {systemInfo.map(item => (
                <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">{item.label}</Text>
                  <Text code>{item.value}</Text>
                </div>
              ))}
              <Divider style={{ margin: '8px 0' }} />
              <Text type="secondary" style={{ fontSize: 11 }}>
                当前 AI 链路已经接入后端真实接口，可结合 PaddleOCR、本地 Ollama 模型与 Skill 化法规上下文执行评审。
              </Text>
            </Space>
          </Card>
        </Col>
      </Row>

      {isAdmin && <Card
        title="知识域 Dataset 路由"
        size="small"
        style={{ marginTop: 16 }}
        extra={<Space><Button icon={<DownloadOutlined />} onClick={() => void exportMigrationInventory()}>导出迁移清单</Button><Button type="primary" loading={datasetSaving} onClick={() => void saveDatasetMappings()}>保存路由</Button></Space>}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="兼容单库模式"
          description="Dataset ID 留空时，该知识域会回退到系统设置中的旧版 Dify Dataset。创建新 Dataset 后，只需在对应行填入 UUID。"
        />
        <Table<KnowledgeDatasetMapping>
          rowKey="id"
          size="small"
          loading={datasetLoading}
          pagination={false}
          dataSource={datasetMappings}
          scroll={{ x: 1450 }}
          columns={[
            { title: '知识域', dataIndex: 'security_domain', width: 130, render: (value: string, row) => <span><strong>{value || row.dataset_key}</strong><br /><Typography.Text type="secondary">{row.scope_name || '全局'}</Typography.Text></span> },
            { title: 'Dataset Key', dataIndex: 'dataset_key', width: 180 },
            { title: 'Dataset 名称', dataIndex: 'dataset_name', width: 170 },
            {
              title: 'Dify Dataset UUID',
              dataIndex: 'dataset_id',
              width: 280,
              render: (value: string, row) => <Input value={value || ''} placeholder="留空使用旧单库" onChange={(event) => setDatasetMappings((items) => items.map((item) => item.id === row.id ? { ...item, dataset_id: event.target.value.trim() } : item))} />,
            },
            { title: '允许角色', dataIndex: 'allowed_role_ids', width: 260, render: (value: string[], row) => <Select mode="multiple" allowClear maxTagCount="responsive" style={{ width: '100%' }} value={value || []} options={roleOptions} placeholder={row.security_domain === 'public' ? '留空表示所有可读角色' : '未指定角色'} onChange={(next) => setDatasetMappings((items) => items.map((item) => item.id === row.id ? { ...item, allowed_role_ids: next } : item))} /> },
            { title: '允许部门', dataIndex: 'allowed_department_ids', width: 260, render: (value: string[], row) => <Select mode="multiple" allowClear maxTagCount="responsive" style={{ width: '100%' }} value={value || []} options={departmentOptions} placeholder="未指定部门" onChange={(next) => setDatasetMappings((items) => items.map((item) => item.id === row.id ? { ...item, allowed_department_ids: next } : item))} /> },
            { title: '启用', dataIndex: 'enabled', width: 80, render: (value: boolean, row) => <Switch size="small" checked={value !== false} onChange={(checked) => setDatasetMappings((items) => items.map((item) => item.id === row.id ? { ...item, enabled: checked } : item))} /> },
          ]}
        />
      </Card>}

      <Card title="AI 能力说明" size="small" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Title level={5}>当前已接入能力</Title>
            <ul style={{ paddingLeft: 20, fontSize: 13 }}>
              <li>OCR 识别：后端 PaddleOCR 接口</li>
              <li>合同信息提取（NER）：本地 Ollama / Qwen 模型</li>
              <li>法务预审：后端敏感词与模型审查</li>
              <li>合规性检查：Skill 化法规上下文 + 模型评审</li>
              <li>历史对比：后端基于 SQLite 合同台账做真实聚合比较</li>
            </ul>
          </Col>
          <Col span={12}>
            <Title level={5}>生产环境接入要点</Title>
            <ul style={{ paddingLeft: 20, fontSize: 13 }}>
              <li>OCR：当前默认使用 PaddleOCR，可按需替换为企业 OCR 服务</li>
              <li>NER：当前默认使用本地 Ollama / 通义千问模型，可切换其他大模型</li>
              <li>法规库：当前通过 Skill 文档 + 后端加载实现，可继续升级为企业知识库 API</li>
              <li>代码扫描：接入 SonarQube / CodeGeeX 等 SAST 工具</li>
              <li>摘要生成：接入 Embedding + RAG 检索增强</li>
              <li>OA 同步：需获取金蝶/用友对外接口授权并配置鉴权</li>
            </ul>
          </Col>
        </Row>
      </Card>
      <BackendLoginModal open={authOpen} onAuthenticated={() => setAuthOpen(false)} onCancel={() => setAuthOpen(false)} />
    </div>
  );
}
