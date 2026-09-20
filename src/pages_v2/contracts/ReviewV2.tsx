import { useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, List, Tag, Typography, Button, Space, Divider, Table, message, Empty, Spin } from 'antd';
import dayjs from 'dayjs';
import { useAppStore } from '@/stores/app-store';
import { checkSensitiveWords, checkRegulationCompliance, compareWithHistory } from '@/utils/ai-engine';
import type { Contract } from '@/types';

const { Title, Text } = Typography;

interface ReviewOutcome {
  sensitive: { word: string; found: boolean; suggestion: string }[];
  compliance: { regulation: string; compliant: boolean; note: string }[];
  comparison: { field: string; current: string; avgHistory: string; deviation: string; advice: string }[];
}

export default function ReviewV2() {
  const contracts = useAppStore((state) => state.contracts);
  const loadContracts = useAppStore((state) => state.loadContracts);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null);

  useEffect(() => {
    void loadContracts().catch(() => undefined);
  }, [loadContracts]);

  const reviewList = useMemo(
    () => contracts.filter((c) => c.status === 'pending' || c.stage === 'S4_确认'),
    [contracts],
  );

  const selected: Contract | undefined = useMemo(
    () => contracts.find((c) => c.id === selectedId),
    [contracts, selectedId],
  );

  const handleRun = async (contract: Contract) => {
    setSelectedId(contract.id);
    setLoading(true);
    setOutcome(null);
    try {
      const text = [contract.subject, contract.paymentTerms, contract.acceptanceStandard, contract.renewalConditions].filter(Boolean).join('\n');
      const [sensitive, compliance, comparison] = await Promise.all([
        checkSensitiveWords(text),
        checkRegulationCompliance(contract),
        compareWithHistory(contract),
      ]);
      setOutcome({ sensitive, compliance, comparison });
    } catch (error) {
      message.error('评审失败，请检查后端服务');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>合同评审</Title>
      <Row gutter={16}>
        <Col span={9}>
          <Card title="待评审合同" size="small">
            <List
              dataSource={reviewList}
              locale={{ emptyText: '暂无待评审合同' }}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button size="small" type="primary" onClick={() => handleRun(item)}>
                      运行评审
                    </Button>,
                  ]}
                  style={{ background: selectedId === item.id ? '#eff6ff' : undefined, padding: '10px 12px', borderRadius: 6 }}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <Text strong>{item.code}</Text>
                        <Tag>{item.stage}</Tag>
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={0}>
                        <Text type="secondary">{item.partyA} · {item.subject || '未填写标的'}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>金额 ¥{item.amount.toLocaleString()}</Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col span={15}>
          <Card
            title={selected ? `评审结果 · ${selected.code}` : '评审结果'}
            size="small"
            extra={selected && <Tag color="blue">{dayjs(selected.updatedAt).format('YYYY-MM-DD')}</Tag>}
          >
            {!selected && <Empty description="请选择左侧合同后再运行评审" />}
            {selected && loading && <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}
            {selected && !loading && outcome && (
              <div>
                <Divider orientation="left">敏感词检测</Divider>
                {outcome.sensitive.length === 0
                  ? <Tag color="green">未发现敏感词</Tag>
                  : outcome.sensitive.map((s, i) => (
                      <Card key={i} size="small" style={{ marginBottom: 8, borderColor: '#fecaca' }}>
                        <Space><Tag color="red">{s.word}</Tag><Text>{s.suggestion}</Text></Space>
                      </Card>
                    ))}

                <Divider orientation="left">合规检查</Divider>
                <Table
                  dataSource={outcome.compliance}
                  rowKey="regulation"
                  size="small"
                  pagination={false}
                  columns={[
                    { title: '法规', dataIndex: 'regulation' },
                    {
                      title: '状态', dataIndex: 'compliant', width: 90,
                      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? '合规' : '需复核'}</Tag>,
                    },
                    { title: '备注', dataIndex: 'note', ellipsis: true },
                  ]}
                />

                <Divider orientation="left">历史对比</Divider>
                <Table
                  dataSource={outcome.comparison}
                  rowKey="field"
                  size="small"
                  pagination={false}
                  columns={[
                    { title: '字段', dataIndex: 'field', width: 140 },
                    { title: '当前值', dataIndex: 'current' },
                    { title: '历史均值', dataIndex: 'avgHistory' },
                    { title: '偏差', dataIndex: 'deviation', width: 120 },
                    { title: '建议', dataIndex: 'advice', ellipsis: true },
                  ]}
                />
              </div>
            )}
            {selected && !loading && !outcome && (
              <Empty description="尚未运行评审" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
