import { useState } from 'react';
import { Card, Steps, Upload, Button, message, Spin, Typography, Tag, Table, Space, Row, Col, Input, Progress, Statistic } from 'antd';
import { InboxOutlined, CheckCircleOutlined, EditOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/app-store';
import { simulateOCR, extractContractInfo, checkSensitiveWords, checkRegulationCompliance, compareWithHistory } from '@/utils/ai-engine';
import { uploadContractFile } from '@/api/contracts';
import type { Contract, AiExtractResult, FieldExtraction } from '@/types';

const { Dragger } = Upload;
const { Title, Text } = Typography;

export default function ContractUploadWizard() {
  const navigate = useNavigate();
  const saveContract = useAppStore((state) => state.saveContract);
  const addNotification = useAppStore((state) => state.addNotification);
  const currentUser = useAppStore((state) => state.currentUser);

  const [current, setCurrent] = useState(0);
  const [fileList, setFileList] = useState<any[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<AiExtractResult | null>(null);
  const [extractFields, setExtractFields] = useState<FieldExtraction[]>([]);
  const [editedFields, setEditedFields] = useState<Record<string, any>>({});
  const [reviewLoading, setReviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sensitiveResults, setSensitiveResults] = useState<any[]>([]);
  const [regulationResults, setRegulationResults] = useState<any[]>([]);
  const [comparisonResults, setComparisonResults] = useState<any[]>([]);

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    setFileList([file]);
    return false;
  };

  const handleOCR = async () => {
    if (fileList.length === 0) {
      message.warning('请先上传文件');
      return;
    }
    setOcrLoading(true);
    try {
      const result = await simulateOCR(fileList[0] as File);
      setOcrResult(result);
      const fields = result.fields?.length ? result.fields : await extractContractInfo(result.rawText);
      setExtractFields(fields);
      const initial: Record<string, any> = {};
      fields.forEach((field) => {
        initial[field.field] = field.value;
      });
      setEditedFields(initial);
      setCurrent(1);
      message.success('OCR 识别与字段提取完成');
    } catch (error) {
      message.error('识别失败');
    } finally {
      setOcrLoading(false);
    }
  };

  const handleFieldChange = (field: string, value: any) => {
    setEditedFields((prev) => ({ ...prev, [field]: value }));
  };

  const handleReview = async () => {
    setReviewLoading(true);
    try {
      const [sens, reg, comp] = await Promise.all([
        checkSensitiveWords(JSON.stringify(editedFields)),
        checkRegulationCompliance(editedFields as any),
        compareWithHistory(editedFields as any),
      ]);
      setSensitiveResults(sens);
      setRegulationResults(reg);
      setComparisonResults(comp);
      setCurrent(2);
      message.success('AI 评审完成');
    } catch (error) {
      message.error('评审失败');
    } finally {
      setReviewLoading(false);
    }
  };

  const handleSaveToLedger = async () => {
    if (!ocrResult) {
      message.warning('请先完成 OCR 与提取');
      return;
    }
    setSaving(true);
    try {
      const payload: Partial<Contract> = {
        code: editedFields['合同编号'] || `HT-2024-${Date.now().toString().slice(-4)}`,
        partyA: editedFields['甲方名称'] || '',
        partyB: editedFields['乙方名称'] || '上海月明信息系统有限公司',
        signDate: editedFields['签订日期'] || dayjs().format('YYYY-MM-DD'),
        effectiveDate: dayjs().add(7, 'day').format('YYYY-MM-DD'),
        expireDate: dayjs().add(1, 'year').format('YYYY-MM-DD'),
        dept: '销售部',
        handler: currentUser.name,
        amount: parseFloat(String(editedFields['合同总金额'] || '0').replace(/[¥,]/g, '').replace(/[^\d.]/g, '')) || 0,
        subject: editedFields['合同标的物'] || '',
        unitPrice: 0,
        taxRate: 13,
        paymentTerms: editedFields['付款条件'] || '',
        deposit: 0,
        deliverables: editedFields['交付物'] || '',
        acceptanceStandard: editedFields['验收标准'] || '',
        servicePeriod: editedFields['服务期限'] || '',
        renewalConditions: editedFields['续约条件'] || '',
        stage: 'S4_确认',
        status: 'pending',
        aiExtracted: {
          ...ocrResult,
          fields: extractFields,
        },
        manualEdited: editedFields,
      };
      const saved = await saveContract(payload);
      if (fileList[0]) {
        await uploadContractFile(saved.id, fileList[0] as File);
        await useAppStore.getState().refreshContracts();
      }
      addNotification('合同已录入台账，等待审核', 'success');
      message.success('合同已保存至台账');
      setCurrent(3);
      setTimeout(() => navigate('/contract'), 800);
    } catch (error) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const stepItems = [
    { title: '上传文件', description: '上传合同扫描件/图片' },
    { title: 'AI 提取 + 人工审核', description: '查看并修正提取结果' },
    { title: 'AI 评审', description: '敏感词、合规、历史比对' },
    { title: '完成', description: '保存至台账' },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>AI 智能提取录入</Title>
      <Card>
        <Steps current={current} items={stepItems} style={{ marginBottom: 24 }} />

        {current === 0 && (
          <div>
            <Dragger beforeUpload={beforeUpload} fileList={fileList} showUploadList={{ showRemoveIcon: true }} accept=".pdf,.jpg,.jpeg,.png,.bmp,.tiff">
              <p style={{ marginBottom: 8 }}><InboxOutlined style={{ fontSize: 48, color: '#1a73e8' }} /></p>
              <p style={{ fontSize: 16 }}>点击或拖拽文件到此处上传</p>
              <p style={{ color: '#999' }}>支持 PDF、JPG、PNG、BMP、TIFF 格式，识别将通过后端 PaddleOCR + Ollama 完成</p>
            </Dragger>
            <div style={{ textAlign: 'center', marginTop: 24 }}>
              <Button type="primary" size="large" icon={<CheckCircleOutlined />} loading={ocrLoading} onClick={handleOCR}>
                开始 OCR 识别与信息提取
              </Button>
            </div>
          </div>
        )}

        {current === 1 && (
          <div>
            <Card title="OCR 识别原始文本" size="small" style={{ marginBottom: 16 }}>
              <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, maxHeight: 200, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {ocrResult?.rawText || '无'}
              </pre>
            </Card>
            <Card title="提取字段（人工审核修正）" size="small" style={{ marginBottom: 16 }}>
              <Table
                dataSource={extractFields.map((field, index) => ({ ...field, key: index }))}
                columns={[
                  { title: '字段', dataIndex: 'field', width: 150 },
                  { title: 'AI 提取值', dataIndex: 'value', render: (value) => <Text type={value ? undefined : 'secondary'}>{value || '—'}</Text> },
                  { title: '人工修正值', key: 'edited', render: (_, record) => <Input value={editedFields[record.field]} onChange={(event) => handleFieldChange(record.field, event.target.value)} placeholder="修正后填入" /> },
                  { title: '置信度', dataIndex: 'confidence', render: (value) => <Progress percent={Math.round(value * 100)} size="small" style={{ width: 100 }} format={(percent) => `${percent}%`} /> },
                ]}
                pagination={false}
                size="small"
              />
            </Card>
            <div style={{ textAlign: 'center' }}>
              <Space>
                <Button onClick={() => setCurrent(0)}>上一步</Button>
                <Button type="primary" onClick={handleReview}>下一步：AI 评审</Button>
              </Space>
            </div>
          </div>
        )}

        {current === 2 && (
          <div>
            <Card title="法务预审：敏感词检测" size="small" style={{ marginBottom: 16 }}>
              {reviewLoading ? <Spin /> : (
                sensitiveResults.length === 0
                  ? <Tag color="green">未发现敏感词，通过</Tag>
                  : <Space direction="vertical" style={{ width: '100%' }}>
                      {sensitiveResults.filter((result) => result.found).map((result, index) => (
                        <Card key={index} size="small" style={{ borderColor: '#ff4d4f' }}><Tag color="red">{result.word}</Tag> {result.suggestion}</Card>
                      ))}
                    </Space>
              )}
            </Card>
            <Card title="合规性检查：法规比对" size="small" style={{ marginBottom: 16 }}>
              {reviewLoading ? <Spin /> : (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {regulationResults.map((result, index) => (
                    <Card key={index} size="small">
                      <Row justify="space-between">
                        <Col><Text strong>{result.regulation}</Text></Col>
                        <Col><Tag color={result.compliant ? 'green' : 'red'}>{result.compliant ? '合规' : '需复核'}</Tag></Col>
                      </Row>
                      <Text type="secondary" style={{ fontSize: 12 }}>{result.note}</Text>
                    </Card>
                  ))}
                </Space>
              )}
            </Card>
            <Card title="历史对比：价格/条款差异提醒" size="small">
              {reviewLoading ? <Spin /> : (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {comparisonResults.map((result, index) => (
                    <Card key={index} size="small">
                      <Text strong>{result.field}</Text>
                      <Row gutter={16} style={{ marginTop: 8 }}>
                        <Col span={8}><Statistic title="当前值" value={result.current} /></Col>
                        <Col span={8}><Statistic title="历史均值" value={result.avgHistory} /></Col>
                        <Col span={8}><Statistic title="偏差" value={result.deviation} valueStyle={{ color: result.deviation === '显著偏离' ? '#ff4d4f' : '#1a73e8' }} /></Col>
                      </Row>
                      <Text style={{ fontSize: 12, color: '#666', marginTop: 4 }}>建议：{result.advice}</Text>
                    </Card>
                  ))}
                </Space>
              )}
            </Card>
            <div style={{ textAlign: 'center', marginTop: 24 }}>
              <Space>
                <Button onClick={() => setCurrent(1)}>上一步</Button>
                <Button onClick={handleSaveToLedger} type="primary" icon={<EditOutlined />} loading={saving}>确认并保存至台账</Button>
              </Space>
            </div>
          </div>
        )}

        {current === 3 && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <CheckCircleOutlined style={{ fontSize: 64, color: '#52c41a', marginBottom: 16 }} />
            <Title level={4}>合同录入完成</Title>
            <p>AI 提取数据与人工修正数据已保存到后端台账，等待后续审核流程。</p>
            <Space>
              <Button type="primary" onClick={() => navigate('/contract')}>查看合同列表</Button>
              <Button onClick={() => { setCurrent(0); setFileList([]); setOcrResult(null); setExtractFields([]); setEditedFields({}); setSensitiveResults([]); setRegulationResults([]); setComparisonResults([]); }}>继续录入</Button>
            </Space>
          </div>
        )}
      </Card>
    </div>
  );
}
