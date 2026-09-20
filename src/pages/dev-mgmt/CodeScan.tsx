import { useState } from 'react';
import { Card, Table, Button, Tag, Space, Typography, Statistic, Row, Col, Modal, message, Descriptions, Divider } from 'antd';
import { ThunderboltOutlined, PlayCircleOutlined, ExclamationCircleOutlined, CheckCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useNavigate } from 'react-router-dom';

dayjs.extend(relativeTime);
import { useAppStore } from '@/stores/app-store';
import { simulateCodeScan } from '@/utils/ai-engine';
import { mockCodeScanResults, mockTestCases } from '@/api/mock-data';

const { Title, Text } = Typography;

export default function CodeScan() {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);

  const handleScan = async () => {
    Modal.confirm({
      title: '触发代码扫描',
      content: '将使用当前 API Token 触发自动代码扫描，扫描完成后将展示问题列表。是否继续？',
      onOk: async () => {
        setScanning(true);
        setScanResult(null);
        try {
          const result = await simulateCodeScan('HT-2024-001', 'sk-proj-demo-key-xyz');
          setScanResult(result);
          message.success('代码扫描完成');
        } catch (e) {
          message.error('扫描失败');
        }
        setScanning(false);
      },
    });
  };

  const columns = [
    { title: '扫描ID', dataIndex: 'scanId', key: 'scanId' },
    { title: '合同编号', dataIndex: 'contractCode', key: 'contractCode' },
    { title: 'API Key', dataIndex: 'apiKey', key: 'apiKey' },
    { title: '触发时间', dataIndex: 'triggeredAt', key: 'triggeredAt', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (v: string) => <Tag color={v === 'completed' ? 'green' : v === 'scanning' ? 'orange' : 'red'}>{v === 'completed' ? '已完成' : v === 'scanning' ? '扫描中' : '失败'}</Tag>,
    },
    {
      title: '问题数', key: 'issueCount',
      render: (_: unknown, r: any) => {
        const errs = r.issues.filter((i: any) => i.severity === 'error').length;
        const warns = r.issues.filter((i: any) => i.severity === 'warning').length;
        return (
          <Space>
            {errs > 0 && <Tag color="red">错误 {errs}</Tag>}
            {warns > 0 && <Tag color="orange">警告 {warns}</Tag>}
            {errs === 0 && warns === 0 && <Tag color="green">无问题</Tag>}
          </Space>
        );
      },
    },
    {
      title: '操作', key: 'action',
      render: (_: unknown, record: any) => (
        <Button type="link" size="small" onClick={() => { setSelectedRecord(record); setModalOpen(true); }}>查看详情</Button>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>代码扫描</Title>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}><Card size="small"><Statistic title="扫描次数" value={mockCodeScanResults.length} prefix={<ThunderboltOutlined />} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="发现问题总数" value={mockCodeScanResults.reduce((s, r) => s + r.issues.length, 0)} prefix={<ExclamationCircleOutlined style={{ color: '#faad14' }} />} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="最近扫描" value={mockCodeScanResults.length ? dayjs(mockCodeScanResults[0].triggeredAt).fromNow() : '—'} /></Card></Col>
      </Row>

      <Card>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text strong>扫描历史记录</Text>
          <Button type="primary" icon={<PlayCircleOutlined />} loading={scanning} onClick={handleScan}>触发新的扫描</Button>
        </div>

        {scanResult && (
          <Card size="small" style={{ marginBottom: 16, background: '#f6ffed', borderColor: '#b7eb8f' }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text strong><CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />最新扫描完成</Text>
              <Text>扫描ID：{scanResult.scanId} · 合同：{scanResult.contractCode}</Text>
              <Space>
                {scanResult.issues.map((iss: any) => (
                  <Tag key={iss.id} color={iss.severity === 'error' ? 'red' : iss.severity === 'warning' ? 'orange' : 'blue'}>
                    {iss.type}: {iss.message.slice(0, 40)}…
                  </Tag>
                ))}
              </Space>
            </Space>
          </Card>
        )}

        <Table dataSource={[...mockCodeScanResults, ...(scanResult ? [scanResult] : [])]} columns={columns} rowKey="id" pagination={false} />
      </Card>

      <Modal title="扫描详情" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} width={800}>
        {selectedRecord && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="扫描ID">{selectedRecord.scanId}</Descriptions.Item>
              <Descriptions.Item label="合同编号">{selectedRecord.contractCode}</Descriptions.Item>
              <Descriptions.Item label="API Key">{selectedRecord.apiKey}</Descriptions.Item>
              <Descriptions.Item label="触发时间">{dayjs(selectedRecord.triggeredAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color="green">已完成</Tag></Descriptions.Item>
              <Descriptions.Item label="发现问题数">{selectedRecord.issues.length}</Descriptions.Item>
            </Descriptions>
            <Divider orientation="left">问题列表</Divider>
            <Table
              dataSource={selectedRecord.issues}
              columns={[
                { title: '严重程度', dataIndex: 'severity', key: 'severity', render: (v: string) => <Tag color={v === 'error' ? 'red' : v === 'warning' ? 'orange' : 'blue'}>{v === 'error' ? '错误' : v === 'warning' ? '警告' : '信息'}</Tag> },
                { title: '类型', dataIndex: 'type', key: 'type' },
                { title: '描述', dataIndex: 'message', key: 'message', ellipsis: true },
                { title: '文件', dataIndex: 'file', key: 'file', render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code> },
                { title: '行号', dataIndex: 'line', key: 'line', width: 70 },
                { title: '修复建议', dataIndex: 'suggestion', key: 'suggestion', ellipsis: true },
              ]}
              rowKey="id"
              pagination={false}
              size="small"
            />
          </Space>
        )}
      </Modal>
    </div>
  );
}
