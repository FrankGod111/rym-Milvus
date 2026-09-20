import { useEffect, useState } from 'react';
import { Card, Table, Tag, Button, Space, Typography, Timeline, Row, Col, Statistic, Badge, Tabs, message, Divider } from 'antd';
import { WarningOutlined, CheckCircleOutlined, ClockCircleOutlined, EyeOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/app-store';
import { generateRiskAlerts } from '@/utils/ai-engine';
import type { RiskAlert } from '@/types';

const { Title, Text } = Typography;
dayjs.extend(relativeTime);

export default function RiskAlertPanel() {
  const navigate = useNavigate();
  const { contracts, addNotification } = useAppStore();
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const result = await generateRiskAlerts(contracts);
      setAlerts(result);
    } catch (e) { /* noop */ }
    setLoading(false);
  };

  useEffect(() => {
    loadAlerts();
  }, [contracts]);

  const getLevelTag = (level: string) => {
    const map: Record<string, string> = { high: 'red', medium: 'orange', low: 'blue' };
    const labelMap: Record<string, string> = { high: '高', medium: '中', low: '低' };
    return <Tag color={map[level]}>{labelMap[level] || level}</Tag>;
  };

  const handleResolve = (id: string) => {
    setAlerts(alerts.map(a => a.id === id ? { ...a, resolved: true } : a));
    addNotification('风险提醒已标记为处理', 'success');
  };

  const alertColumns = [
    { title: '级别', dataIndex: 'level', key: 'level', width: 80, render: (v: string) => getLevelTag(v) },
    { title: '合同编号', dataIndex: 'contractCode', key: 'contractCode', render: (v: string) => <a style={{ color: '#1a73e8' }}>{v}</a> },
    { title: '类型', dataIndex: 'type', key: 'type' },
    { title: '风险内容', dataIndex: 'content', key: 'content', ellipsis: true },
    { title: '建议措施', dataIndex: 'suggestion', key: 'suggestion', ellipsis: true, width: 260 },
    { title: '历史借鉴', dataIndex: 'historyRef', key: 'historyRef', render: (v: string) => v ? <Tag color="cyan">有历史案例</Tag> : <Text type="secondary">—</Text> },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => dayjs(v).fromNow() },
    {
      title: '操作', key: 'action', width: 150,
      render: (_: unknown, record: RiskAlert) => (
        <Space>
          {!record.resolved && <Button type="link" size="small" icon={<CheckCircleOutlined />} onClick={() => handleResolve(record.id)}>处理</Button>}
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/contract/${record.contractId}`)}>查看合同</Button>
        </Space>
      ),
    },
  ];

  const highAlerts = alerts.filter(a => a.level === 'high');
  const mediumAlerts = alerts.filter(a => a.level === 'medium');
  const lowAlerts = alerts.filter(a => a.level === 'low');

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>风险提醒看板</Title>
          <Badge count={alerts.filter(a => !a.resolved).length} style={{ backgroundColor: '#ff4d4f' }} />
        </Space>
        <Space>
          <Button onClick={loadAlerts}>刷新</Button>
        </Space>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic title="高风险" value={highAlerts.filter(a => !a.resolved).length} prefix={<ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="中风险" value={mediumAlerts.filter(a => !a.resolved).length} prefix={<WarningOutlined style={{ color: '#faad14' }} />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="低风险" value={lowAlerts.filter(a => !a.resolved).length} prefix={<ClockCircleOutlined style={{ color: '#1a73e8' }} />} />
          </Card>
        </Col>
      </Row>

      <Tabs
        defaultActiveKey="all"
        items={[
          { key: 'all', label: `全部 (${alerts.length})`, children: <AlertTable alerts={alerts} columns={alertColumns} /> },
          { key: 'high', label: `高风险 (${highAlerts.length})`, children: <AlertTable alerts={highAlerts} columns={alertColumns} /> },
          { key: 'medium', label: `中风险 (${mediumAlerts.length})`, children: <AlertTable alerts={mediumAlerts} columns={alertColumns} /> },
          { key: 'low', label: `低风险 (${lowAlerts.length})`, children: <AlertTable alerts={lowAlerts} columns={alertColumns} /> },
        ]}
      />
    </div>
  );
}

function AlertTable({ alerts, columns }: { alerts: RiskAlert[]; columns: any[] }) {
  return (
    <Table
      dataSource={alerts}
      columns={columns}
      rowKey="id"
      pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
      expandable={{
        expandedRowRender: (record) => (
          <div style={{ padding: '12px 24px' }}>
            <Row gutter={24}>
              <Col span={12}>
                <Text strong>风险内容：</Text>
                <p style={{ marginTop: 4 }}>{record.content}</p>
              </Col>
              <Col span={12}>
                <Text strong>建议措施：</Text>
                <p style={{ marginTop: 4, color: '#1a73e8' }}>{record.suggestion || '请联系处理人人工分析'}</p>
              </Col>
            </Row>
            {record.historyRef && (
              <>
                <Divider style={{ margin: '8px 0' }} />
                <Text strong>历史借鉴：</Text>
                <Card size="small" style={{ marginTop: 4, background: '#fffbe6' }}>
                  <Text type="secondary">参考案例：{record.historyRef}</Text>
                </Card>
              </>
            )}
          </div>
        ),
      }}
    />
  );
}
