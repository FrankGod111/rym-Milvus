import { useMemo, useState } from 'react';
import { Card, Table, Button, Tag, Space, Divider, Typography, Tabs, message } from 'antd';
import { EyeOutlined, CheckOutlined, CloseOutlined, ExportOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/app-store';
import { checkSensitiveWords, checkRegulationCompliance, compareWithHistory } from '@/utils/ai-engine';

const { Title, Text } = Typography;

export default function ContractReview() {
  const navigate = useNavigate();
  const contracts = useAppStore((state) => state.contracts);
  const [loading, setLoading] = useState(false);
  const [selectedContract, setSelectedContract] = useState<any>(null);
  const [reviewResult, setReviewResult] = useState<any>(null);

  const reviewContracts = useMemo(() => contracts.filter((contract) => contract.status === 'pending' || contract.stage === 'S4_确认'), [contracts]);

  const handleReview = async (contract: any) => {
    setSelectedContract(contract);
    setLoading(true);
    setReviewResult(null);
    try {
      const [sens, reg, comp] = await Promise.all([
        checkSensitiveWords(`${contract.partyA} ${contract.subject} ${contract.amount}`),
        checkRegulationCompliance(contract),
        compareWithHistory(contract),
      ]);
      setReviewResult({ sensitive: sens, regulation: reg, comparison: comp });
      message.success('AI 评审完成');
    } catch (error) {
      message.error('评审失败');
    } finally {
      setLoading(false);
    }
  };

  const tabItems = [
    {
      key: 'list',
      label: '待评审列表',
      children: (
        <Table
          loading={loading}
          dataSource={reviewContracts}
          columns={[
            { title: '合同编号', dataIndex: 'code', key: 'code', render: (value) => <a style={{ color: '#1a73e8' }}>{value}</a> },
            { title: '甲方名称', dataIndex: 'partyA', key: 'partyA' },
            { title: '合同标的物', dataIndex: 'subject', key: 'subject', ellipsis: true },
            { title: '合同金额', dataIndex: 'amount', key: 'amount', render: (value) => <span style={{ fontWeight: 600 }}>¥{value.toLocaleString()}</span> },
            { title: '阶段', dataIndex: 'stage', key: 'stage' },
            { title: '提交日期', dataIndex: 'createdAt', key: 'createdAt', render: (value) => dayjs(value).format('YYYY-MM-DD') },
            { title: '评审类型', key: 'reviewer', render: () => '法务/AI 联合评审' },
            {
              title: '操作', key: 'action',
              render: (_, record) => (
                <Space>
                  <Button type="primary" size="small" icon={<EyeOutlined />} onClick={() => handleReview(record)}>AI 评审</Button>
                  <Button size="small" onClick={() => navigate(`/contract/${record.id}`)}>查看原始合同</Button>
                </Space>
              ),
            },
          ]}
          rowKey="id"
          locale={{ emptyText: '暂无待评审合同' }}
          pagination={false}
        />
      ),
    },
    {
      key: 'review',
      label: '评审详情',
      children: reviewResult && selectedContract ? (
        <Card title={`评审结果：${selectedContract.code}`} extra={<Space><Tag color="orange">法务/AI 联合评审</Tag><Text type="secondary">{dayjs(selectedContract.createdAt).format('YYYY-MM-DD')}</Text></Space>}>
          <Divider orientation="left">法务预审：敏感词检测</Divider>
          <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
            {reviewResult.sensitive.length === 0
              ? <Tag color="green">未发现敏感词，法务预审通过</Tag>
              : reviewResult.sensitive.filter((result: any) => result.found).map((result: any, index: number) => (
                  <Card key={index} size="small" style={{ borderColor: '#ff4d4f' }}>
                    <Space>
                      <Tag color="red">{result.word}</Tag>
                      <Text>{result.suggestion}</Text>
                    </Space>
                  </Card>
                ))}
          </Space>

          <Divider orientation="left">合规性检查：法规比对</Divider>
          <Table
            dataSource={reviewResult.regulation}
            columns={[
              { title: '法规编号与名称', dataIndex: 'regulation', key: 'regulation' },
              { title: '合规状态', key: 'compliant', render: (_: unknown, record: { compliant: boolean }) => <Tag color={record.compliant ? 'green' : 'red'}>{record.compliant ? '合规' : '需复核'}</Tag> },
              { title: '备注', dataIndex: 'note', key: 'note', ellipsis: true },
            ]}
            rowKey="regulation"
            pagination={false}
            size="small"
          />

          <Divider orientation="left">历史对比：价格/条款差异提醒</Divider>
          <Table
            dataSource={reviewResult.comparison}
            columns={[
              { title: '对比字段', dataIndex: 'field', key: 'field' },
              { title: '当前值', dataIndex: 'current', key: 'current' },
              { title: '历史均值', dataIndex: 'avgHistory', key: 'avgHistory' },
              { title: '偏差', dataIndex: 'deviation', key: 'deviation', render: (value: string) => <Text type={value === '显著偏离' ? 'danger' : undefined}>{value}</Text> },
              { title: '建议', dataIndex: 'advice', key: 'advice', ellipsis: true },
            ]}
            rowKey="field"
            pagination={false}
            size="small"
          />

          <Divider />
          <Space>
            <Button type="primary" icon={<CheckOutlined />}>通过评审</Button>
            <Button danger icon={<CloseOutlined />}>驳回修改</Button>
            <Button icon={<ExportOutlined />}>导出评审报告</Button>
          </Space>
        </Card>
      ) : (
        <Card><Space direction="vertical" align="center" style={{ width: '100%', padding: 40 }}><Text type="secondary">请从“待评审列表”选择一项合同，点击“AI 评审”查看结果。</Text></Space></Card>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>合同评审</Title>
      <Tabs items={tabItems} />
    </div>
  );
}
