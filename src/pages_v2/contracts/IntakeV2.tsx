import { useState } from 'react';
import { Card, Steps, Upload, Button, message, Typography, Table, Space, Input, Progress } from 'antd';
import type { UploadProps } from 'antd';
import { InboxOutlined, CheckCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/app-store';
import { simulateOCR, extractContractInfo } from '@/utils/ai-engine';
import { uploadContractFile } from '@/api/contracts';
import type { AiExtractResult, Contract, FieldExtraction } from '@/types';

const { Dragger } = Upload;
const { Title, Text } = Typography;

export default function IntakeV2() {
  const navigate = useNavigate();
  const saveContract = useAppStore((state) => state.saveContract);
  const currentUser = useAppStore((state) => state.currentUser);

  const [current, setCurrent] = useState(0);
  const [fileList, setFileList] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ocrResult, setOcrResult] = useState<AiExtractResult | null>(null);
  const [fields, setFields] = useState<FieldExtraction[]>([]);
  const [edits, setEdits] = useState<Record<string, any>>({});

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    setFileList([file as File]);
    return false;
  };

  const handleRunOCR = async () => {
    if (fileList.length === 0) {
      message.warning('请先上传文件');
      return;
    }
    setLoading(true);
    try {
      const result = await simulateOCR(fileList[0]);
      setOcrResult(result);
      const fs = result.fields?.length ? result.fields : await extractContractInfo(result.rawText);
      setFields(fs);
      const initial: Record<string, any> = {};
      fs.forEach((f) => { initial[f.field] = f.value; });
      setEdits(initial);
      setCurrent(1);
      message.success('识别完成，可修正后保存');
    } catch (e) {
      message.error('识别失败，请检查后端 AI 服务');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!ocrResult) return;
    setSaving(true);
    try {
      const payload: Partial<Contract> = {
        code: edits['合同编号'] || `HT-${dayjs().format('YYYYMMDDHHmm')}`,
        partyA: edits['甲方名称'] || '',
        partyB: edits['乙方名称'] || '上海月明信息系统有限公司',
        signDate: edits['签订日期'] || dayjs().format('YYYY-MM-DD'),
        effectiveDate: dayjs().add(7, 'day').format('YYYY-MM-DD'),
        expireDate: dayjs().add(1, 'year').format('YYYY-MM-DD'),
        dept: '合同管理',
        handler: currentUser.name,
        amount: parseFloat(String(edits['合同总金额'] || '0').replace(/[¥,]/g, '').replace(/[^\d.]/g, '')) || 0,
        subject: edits['合同标的物'] || '',
        paymentTerms: edits['付款条件'] || '',
        deliverables: edits['交付物'] || '',
        acceptanceStandard: edits['验收标准'] || '',
        servicePeriod: edits['服务期限'] || '',
        renewalConditions: edits['续约条件'] || '',
        stage: 'S4_确认',
        status: 'pending',
        aiExtracted: { ...ocrResult, fields },
        manualEdited: edits,
      };
      const saved = await saveContract(payload);
      if (fileList[0]) {
        await uploadContractFile(saved.id, fileList[0]);
        await useAppStore.getState().refreshContracts();
      }
      message.success('合同已保存至台账');
      setTimeout(() => navigate('/v2/review'), 800);
    } catch (e) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>AI 智能录入</Title>
      <Card>
        <Steps
          current={current}
          items={[
            { title: '上传合同' },
            { title: '确认字段' },
          ]}
          style={{ marginBottom: 24 }}
        />

        {current === 0 && (
          <div>
            <Dragger beforeUpload={beforeUpload} fileList={fileList as any} showUploadList accept=".pdf,.jpg,.jpeg,.png,.bmp,.tiff">
              <p><InboxOutlined style={{ fontSize: 48, color: '#2563eb' }} /></p>
              <p style={{ fontSize: 16 }}>点击或拖拽文件到此处</p>
              <p style={{ color: '#999' }}>后端将调用 PaddleOCR 与本地/云端大模型完成识别</p>
            </Dragger>
            <div style={{ textAlign: 'center', marginTop: 24 }}>
              <Button type="primary" size="large" icon={<CheckCircleOutlined />} loading={loading} onClick={handleRunOCR}>
                开始识别
              </Button>
            </div>
          </div>
        )}

        {current === 1 && (
          <div>
            <Card size="small" title="OCR 原文" style={{ marginBottom: 16 }}>
              <pre style={{ background: '#f8fafc', padding: 12, borderRadius: 6, maxHeight: 200, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {ocrResult?.rawText || '无'}
              </pre>
            </Card>
            <Card size="small" title="字段确认" style={{ marginBottom: 16 }}>
              <Table
                dataSource={fields.map((f, i) => ({ ...f, key: i }))}
                pagination={false}
                size="small"
                columns={[
                  { title: '字段', dataIndex: 'field', width: 140 },
                  { title: 'AI 提取值', dataIndex: 'value', render: (v) => <Text type={v ? undefined : 'secondary'}>{v || '—'}</Text> },
                  {
                    title: '人工修正', key: 'edit',
                    render: (_, r) => (
                      <Input
                        value={edits[r.field]}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [r.field]: e.target.value }))}
                      />
                    ),
                  },
                  {
                    title: '置信度', dataIndex: 'confidence', width: 140,
                    render: (v: number) => <Progress percent={Math.round(v * 100)} size="small" />,
                  },
                ]}
              />
            </Card>
            <div style={{ textAlign: 'center' }}>
              <Space>
                <Button onClick={() => setCurrent(0)}>上一步</Button>
                <Button type="primary" loading={saving} onClick={handleSave}>保存并送评审</Button>
              </Space>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
