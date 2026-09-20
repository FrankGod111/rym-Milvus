import { useMemo } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Typography, Button, Space } from 'antd';
import { FileTextOutlined, WarningOutlined, ClockCircleOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { useAppStore } from '@/stores/app-store';
import type { Contract } from '@/types';

const { Title, Text } = Typography;

export default function HomeV2() {
  const navigate = useNavigate();
  const contracts = useAppStore((state) => state.contracts);

  const stats = useMemo(() => {
    const now = dayjs();
    return {
      total: contracts.length,
      pending: contracts.filter((c) => c.status === 'pending').length,
      risk: contracts.filter((c) => c.status === 'risk').length,
      expiring: contracts.filter((c) => {
        const expire = dayjs(c.expireDate);
        return expire.isValid() && expire.isAfter(now) && expire.diff(now, 'day') <= 60;
      }).length,
    };
  }, [contracts]);

  const recent: Contract[] = useMemo(
    () => [...contracts].sort((a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf()).slice(0, 8),
    [contracts],
  );

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>合同工作台</Title>

      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic title="合同总数" value={stats.total} prefix={<FileTextOutlined style={{ color: '#2563eb' }} />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="待评审" value={stats.pending} prefix={<ClockCircleOutlined style={{ color: '#f59e0b' }} />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="风险合同" value={stats.risk} prefix={<WarningOutlined style={{ color: '#ef4444' }} />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="60 天内到期" value={stats.expiring} prefix={<CheckCircleOutlined style={{ color: '#10b981' }} />} />
          </Card>
        </Col>
      </Row>

      <Card
        title="最近合同"
        style={{ marginTop: 16 }}
        extra={
          <Space>
            <Button type="primary" onClick={() => navigate('/v2/intake')}>AI 录入合同</Button>
            <Button onClick={() => navigate('/v2/review')}>进入评审</Button>
          </Space>
        }
      >
        <Table
          dataSource={recent}
          rowKey="id"
          size="small"
          pagination={false}
          locale={{ emptyText: '暂无合同' }}
          columns={[
            { title: '合同编号', dataIndex: 'code' },
            { title: '甲方', dataIndex: 'partyA', ellipsis: true },
            { title: '标的', dataIndex: 'subject', ellipsis: true },
            {
              title: '金额', dataIndex: 'amount', width: 140,
              render: (value: number) => <Text strong>¥{value.toLocaleString()}</Text>,
            },
            {
              title: '阶段', dataIndex: 'stage', width: 100,
              render: (value: string) => <Tag>{value}</Tag>,
            },
            {
              title: '状态', dataIndex: 'status', width: 100,
              render: (value: string) => {
                const map: Record<string, { color: string; text: string }> = {
                  active: { color: 'green', text: '履约中' },
                  pending: { color: 'blue', text: '待处理' },
                  completed: { color: 'default', text: '已完成' },
                  risk: { color: 'red', text: '风险' },
                };
                const entry = map[value] || { color: 'default', text: value };
                return <Tag color={entry.color}>{entry.text}</Tag>;
              },
            },
            { title: '更新时间', dataIndex: 'updatedAt', width: 140, render: (v: string) => dayjs(v).format('YYYY-MM-DD') },
          ]}
        />
      </Card>
    </div>
  );
}
