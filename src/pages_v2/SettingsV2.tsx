import { useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, Form, Input, Button, Space, Typography, Tag, Alert, Divider, message } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { apiUrl, deploymentConfig } from '@/config/deployment';
import { clearRuntimeSettings, loadRuntimeSettings, saveRuntimeSettings, type RuntimeSettings } from '@/config/runtimeSettings';

const { Title, Text, Paragraph } = Typography;

interface HealthReport {
  backend: { ok: boolean; detail?: string };
  ollama: { ok: boolean; model?: string; detail?: string };
  dify: { ok: boolean; configured: boolean; detail?: string; datasetId?: string };
  embedding: { ok: boolean; provider?: string; model?: string; detail?: string };
}

const DEFAULTS: RuntimeSettings = {
  apiBaseUrl: deploymentConfig.apiBaseUrl,
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen3:8b',
  difyBaseUrl: 'http://127.0.0.1:5001/v1',
  difyApiKey: '',
  difyDatasetId: '',
  difyAppApiKey: '',
  embeddingProvider: 'dashscope',
  embeddingModel: 'text-embedding-v3',
};

export default function SettingsV2() {
  const [form] = Form.useForm<RuntimeSettings>();
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadRuntimeSettings();
    form.setFieldsValue({ ...DEFAULTS, ...stored });
    if (Object.keys(stored).length > 0) {
      setSavedAt('已从本地缓存恢复');
    }
  }, [form]);

  const persist = () => {
    setSaving(true);
    try {
      const values = form.getFieldsValue();
      saveRuntimeSettings(values);
      setSavedAt(new Date().toLocaleString());
      message.success('已保存到当前浏览器');
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaults = () => {
    form.setFieldsValue(DEFAULTS);
    clearRuntimeSettings();
    setSavedAt(null);
    message.info('已恢复默认值并清空本地缓存');
  };

  const runHealth = async () => {
    setChecking(true);
    try {
      const values = form.getFieldsValue();
      saveRuntimeSettings(values);
      const response = await fetch(apiUrl('/api/contracts/ai/health-check'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = (await response.json()) as HealthReport;
      setHealth(data);
      setSavedAt(new Date().toLocaleString());
    } catch (error) {
      message.error('健康检查失败，请确认后端已启动');
    } finally {
      setChecking(false);
    }
  };

  const statusTag = (ok?: boolean, label = '未检查') => {
    if (ok === undefined) return <Tag>{label}</Tag>;
    return ok
      ? <Tag icon={<CheckCircleOutlined />} color="green">正常</Tag>
      : <Tag icon={<CloseCircleOutlined />} color="red">异常</Tag>;
  };

  const infoBlocks = useMemo(() => ([
    {
      title: '后端 API',
      status: statusTag(health?.backend?.ok),
      detail: health?.backend?.detail || `apiBaseUrl: ${deploymentConfig.apiBaseUrl || '(通过代理)'} `,
    },
    {
      title: '本地大模型 (Ollama)',
      status: statusTag(health?.ollama?.ok),
      detail: health?.ollama?.detail || `model: ${health?.ollama?.model || DEFAULTS.ollamaModel}`,
    },
    {
      title: 'Dify 服务',
      status: statusTag(health?.dify?.ok),
      detail: health?.dify?.detail || (health?.dify?.configured ? `dataset: ${health?.dify?.datasetId || '-'} ` : '未配置'),
    },
    {
      title: 'Embedding 模型',
      status: statusTag(health?.embedding?.ok),
      detail: health?.embedding?.detail || `${health?.embedding?.provider || DEFAULTS.embeddingProvider} / ${health?.embedding?.model || DEFAULTS.embeddingModel}`,
    },
  ]), [health]);

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>系统配置</Title>

      <Alert
        showIcon
        type="info"
        style={{ marginBottom: 16 }}
        message="使用说明"
        description={
          <span>
            这里的配置会保存到<Text strong>当前浏览器 localStorage</Text>，刷新页面后仍然存在，但换浏览器或换设备需要重新填写。<br />
            点击"运行连通性检查"会请求后端 <Text code>/api/contracts/ai/health-check</Text>，同时把当前表单值一并保存。
          </span>
        }
      />

      <Row gutter={16}>
        <Col span={16}>
          <Card
            title="部署配置"
            size="small"
            extra={savedAt ? <Text type="secondary" style={{ fontSize: 12 }}>最近保存：{savedAt}</Text> : <Text type="secondary" style={{ fontSize: 12 }}>尚未保存</Text>}
          >
            <Form form={form} layout="vertical">
              <Divider orientation="left" plain>后端 / API</Divider>
              <Form.Item name="apiBaseUrl" label="前端调用后端的 Base URL（留空则走 Vite / Nginx 代理）">
                <Input placeholder="http://192.168.1.10:8013 或 留空" />
              </Form.Item>

              <Divider orientation="left" plain>本地大模型（Ollama）</Divider>
              <Form.Item name="ollamaBaseUrl" label="Ollama Base URL">
                <Input placeholder="http://127.0.0.1:11434 或 http://host.docker.internal:11434" />
              </Form.Item>
              <Form.Item name="ollamaModel" label="模型名称">
                <Input placeholder="qwen3:8b" />
              </Form.Item>

              <Divider orientation="left" plain>Dify（知识库/评审/问答）</Divider>
              <Form.Item name="difyBaseUrl" label="Dify API Base URL（一般要带 /v1）">
                <Input placeholder="http://192.168.1.20:5001/v1" />
              </Form.Item>
              <Form.Item name="difyApiKey" label="Dify Dataset API Key（知识库）">
                <Input.Password placeholder="dataset-xxxx" />
              </Form.Item>
              <Form.Item name="difyDatasetId" label="Dify Dataset ID">
                <Input placeholder="abc123-def456" />
              </Form.Item>
              <Form.Item name="difyAppApiKey" label="Dify App API Key（Chat 应用）">
                <Input.Password placeholder="app-xxxx" />
              </Form.Item>

              <Divider orientation="left" plain>Embedding 向量模型</Divider>
              <Form.Item name="embeddingProvider" label="Embedding Provider">
                <Input placeholder="dashscope / openai / bailian" />
              </Form.Item>
              <Form.Item name="embeddingModel" label="Embedding 模型名">
                <Input placeholder="text-embedding-v3" />
              </Form.Item>

              <Space>
                <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={persist}>
                  保存到本地
                </Button>
                <Button icon={<ReloadOutlined />} loading={checking} onClick={runHealth}>
                  保存并运行连通性检查
                </Button>
                <Button onClick={restoreDefaults}>恢复默认值</Button>
              </Space>
            </Form>
          </Card>
        </Col>

        <Col span={8}>
          <Card title="连通性" size="small">
            <Space direction="vertical" style={{ width: '100%' }}>
              {infoBlocks.map((block) => (
                <Card key={block.title} size="small" bordered>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Space>
                      <Text strong>{block.title}</Text>
                      {block.status}
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12 }}>{block.detail}</Text>
                  </Space>
                </Card>
              ))}
            </Space>
          </Card>

          <Card title="配置说明" size="small" style={{ marginTop: 16 }}>
            <Paragraph style={{ marginBottom: 6 }}>
              <Text strong>本地缓存位置：</Text>
            </Paragraph>
            <Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
              浏览器 <Text code>localStorage</Text> 键 <Text code>contract_ai_runtime_settings_v1</Text>。清空浏览器缓存或点"恢复默认值"会失效。
            </Paragraph>
            <Paragraph style={{ marginBottom: 6 }}>
              <Text strong>Dify base_url：</Text>
            </Paragraph>
            <Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
              自部署 Dify 一般是 <Text code>http://host:port/v1</Text>。
            </Paragraph>
            <Paragraph style={{ marginBottom: 6 }}>
              <Text strong>Key 不要加 Bearer 前缀：</Text>
            </Paragraph>
            <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
              直接填 <Text code>dataset-xxxx</Text> 或 <Text code>app-xxxx</Text>，后端自动加 <Text code>Authorization: Bearer</Text>。
            </Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
