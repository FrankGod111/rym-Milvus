import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Steps, Row, Col, Descriptions, Tag, Button, Space, Timeline, message, Tabs, Statistic, Progress, Modal, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  CheckOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ContractStage } from '@/types';
import { useAppStore } from '@/stores/app-store';
import { extractContractInfo } from '@/utils/ai-engine';
import { getContract } from '@/api/contracts';

const { Step } = Steps;
const { Title, Text } = Typography;

const stageSteps: Record<string, number> = { 'S4_确认': 0, 'S5_签订': 1, 'S6_履约': 2, completed: 3 };

export default function ContractDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const contracts = useAppStore((state) => state.contracts);
  const updateContractStage = useAppStore((state) => state.updateContractStage);
  const addNotification = useAppStore((state) => state.addNotification);
  const [contract, setContract] = useState<ReturnType<typeof useAppStore.getState>['contracts'][0] | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [extractFields, setExtractFields] = useState<any[]>([]);

  useEffect(() => {
    const local = contracts.find((item) => item.id === id);
    if (local) {
      setContract(local);
      return;
    }
    if (!id) return;
    getContract(id)
      .then((result) => setContract(result))
      .catch(() => setContract(null));
  }, [contracts, id]);

  if (!contract) {
    return <Card><Space direction="vertical" align="center" style={{ width: '100%' }}><FileTextOutlined style={{ fontSize: 48, color: '#ccc' }} /><p>合同未找到或已删除</p><Button onClick={() => navigate('/contract')}>返回列表</Button></Space></Card>;
  }

  const currentStep = stageSteps[contract.stage] ?? 0;

  const handleStageChange = async (newStage: ContractStage) => {
    try {
      await updateContractStage(contract.id, newStage);
      setContract({ ...contract, stage: newStage });
      addNotification(`合同 ${contract.code} 已推进至 ${newStage}`, 'success');
    } catch (error) {
      message.error('更新阶段失败');
    }
  };

  const handleOCR = async () => {
    if (!contract.aiExtracted) {
      Modal.info({ title: '提示', content: '请先在“AI 提取录入”页面上传扫描件。' });
      return;
    }
    setOcrLoading(true);
    try {
      const result = await extractContractInfo(contract.aiExtracted.rawText);
      setExtractFields(result);
      message.success('智能提取完成');
    } catch (error) {
      message.error('提取失败');
    } finally {
      setOcrLoading(false);
    }
  };

  const tabsItems = [
    {
      key: 'detail',
      label: '基本信息',
      children: (
        <Descriptions bordered column={2} size="middle">
          <Descriptions.Item label="合同编号">{contract.code}</Descriptions.Item>
          <Descriptions.Item label="合同状态">
            <Tag color={contract.status === 'risk' ? 'red' : contract.status === 'active' ? 'green' : 'blue'}>
              {contract.status === 'active' ? '履约中' : contract.status === 'pending' ? '待处理' : contract.status === 'completed' ? '已完成' : '风险'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="甲方">{contract.partyA}</Descriptions.Item>
          <Descriptions.Item label="乙方">{contract.partyB}</Descriptions.Item>
          <Descriptions.Item label="签订日期">{dayjs(contract.signDate).format('YYYY-MM-DD')}</Descriptions.Item>
          <Descriptions.Item label="生效日期">{dayjs(contract.effectiveDate).format('YYYY-MM-DD')}</Descriptions.Item>
          <Descriptions.Item label="到期日期">{dayjs(contract.expireDate).format('YYYY-MM-DD')}</Descriptions.Item>
          <Descriptions.Item label="经办部门">{contract.dept}</Descriptions.Item>
          <Descriptions.Item label="经办人">{contract.handler}</Descriptions.Item>
          <Descriptions.Item label="合同总金额"><span style={{ fontSize: 18, fontWeight: 700, color: '#1a73e8' }}>¥{contract.amount.toLocaleString()}</span></Descriptions.Item>
          <Descriptions.Item label="合同标的物">{contract.subject}</Descriptions.Item>
          <Descriptions.Item label="单价">¥{contract.unitPrice?.toLocaleString() ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="税率">{contract.taxRate}%</Descriptions.Item>
          <Descriptions.Item label="付款条件">{contract.paymentTerms}</Descriptions.Item>
          <Descriptions.Item label="保证金">{contract.deposit ? `¥${contract.deposit.toLocaleString()}` : '无'}</Descriptions.Item>
          <Descriptions.Item label="交付物" span={2}>{contract.deliverables}</Descriptions.Item>
          <Descriptions.Item label="验收标准" span={2}>{contract.acceptanceStandard}</Descriptions.Item>
          <Descriptions.Item label="服务期限">{contract.servicePeriod}</Descriptions.Item>
          <Descriptions.Item label="续约条件" span={2}>{contract.renewalConditions}</Descriptions.Item>
          <Descriptions.Item label="附件存储路径" span={2}>{contract.filePath || '未上传'}</Descriptions.Item>
        </Descriptions>
      ),
    },
    {
      key: 'ai',
      label: 'AI 处理',
      children: (
        <Card>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Button icon={<ThunderboltOutlined />} loading={ocrLoading} onClick={handleOCR} type="primary">智能提取字段信息</Button>
            {extractFields.length > 0 && (
              <Card title="提取结果" size="small">
                {extractFields.map((field, index) => (
                  <Space key={index} style={{ marginBottom: 4 }}>
                    <Text strong style={{ width: 90 }}>{field.field}:</Text>
                    <Text>{field.value || '（未提取到）'}</Text>
                    <Progress percent={Math.round(field.confidence * 100)} size="small" style={{ width: 120 }} format={(percent) => `${percent}%`} />
                  </Space>
                ))}
              </Card>
            )}
            {contract.aiExtracted && (
              <Card title="OCR 原始文本" size="small">
                <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, maxHeight: 200, overflow: 'auto', fontSize: 12 }}>{contract.aiExtracted.rawText}</pre>
              </Card>
            )}
          </Space>
        </Card>
      ),
    },
    {
      key: 'flow',
      label: '流程记录',
      children: (
        <Card>
          <Timeline
            items={[
              { color: 'green', children: <><Text strong>合同创建</Text><br /><Text type="secondary">经办人 {contract.handler} 于 {dayjs(contract.createdAt).format('YYYY-MM-DD')} 创建</Text></> },
              { color: 'blue', children: <><Text strong>阶段变更</Text><br /><Text type="secondary">当前阶段 {contract.stage}</Text></> },
              { color: contract.status === 'risk' ? 'red' : 'green', children: <><Text strong>状态更新</Text><br /><Text type="secondary">最近更新 {dayjs(contract.updatedAt).format('YYYY-MM-DD')}</Text></> },
              ...(contract.aiExtracted ? [{ color: 'cyan', children: <><Text strong>AI 提取</Text><br /><Text type="secondary">于 {dayjs(contract.aiExtracted.extractedAt).format('YYYY-MM-DD HH:mm')} 执行，来源文件 {contract.aiExtracted.sourceFile}</Text></> }] : []),
            ]}
          />
        </Card>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/contract')}>返回列表</Button>
        <Title level={4} style={{ margin: 0 }}>{contract.code} — {contract.subject}</Title>
      </Space>

      <Card style={{ marginBottom: 16 }}>
        <Steps current={currentStep} status="process" style={{ padding: '12px 0' }}>
          <Step title="S4 项目确认" description="需求确认" />
          <Step title="S5 合同签订" description="签约生效" />
          <Step title="S6 合同履约" description="交付验收" />
          <Step title="已完成" description="归档" />
        </Steps>
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          {currentStep === 0 && (
            <Space>
              <Button type="primary" onClick={() => handleStageChange('S5_签订')} icon={<CheckOutlined />}>确认通过，推进至签订</Button>
            </Space>
          )}
          {currentStep === 1 && (
            <Space>
              <Button onClick={() => handleStageChange('S6_履约')} icon={<CheckOutlined />}>签订完成，开始履约</Button>
            </Space>
          )}
          {currentStep === 2 && (
            <Space>
              <Button onClick={() => handleStageChange('completed')} icon={<CheckOutlined />}>确定完成，归档</Button>
            </Space>
          )}
          {currentStep === 3 && <Tag color="green">合同流程已全部完成</Tag>}
        </div>
      </Card>

      <Tabs items={tabsItems} />

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={8}>
          <Card size="small"><Statistic title="已履约天数" value={Math.floor((Date.now() - new Date(contract.effectiveDate).getTime()) / 86400000)} suffix="天" /></Card>
        </Col>
        <Col span={8}>
          <Card size="small"><Statistic title="剩余天数" value={Math.max(0, Math.floor((new Date(contract.expireDate).getTime() - Date.now()) / 86400000))} suffix="天" /></Card>
        </Col>
        <Col span={8}>
          <Card size="small"><Statistic title="付款进度" value={contract.amount} prefix="¥" suffix="/ 100%" /></Card>
        </Col>
      </Row>
    </div>
  );
}
