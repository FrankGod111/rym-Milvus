import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Select, Space, Switch, Typography, Upload, message } from 'antd';
import { InboxOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { UploadFile } from 'antd';
import { erpApi } from '@/api/erp';
import BackendLoginModal from '@/components/BackendLoginModal';

const { Dragger } = Upload;
const { Title, Text } = Typography;
type Scope = { id: string; name: string; children?: Scope[] };

function flattenScopes(nodes: Scope[], depth = 0): Array<{ value: string; label: string }> {
  return nodes.flatMap((node) => [
    { value: node.id, label: `${'　'.repeat(depth)}${node.name}` },
    ...flattenScopes(node.children || [], depth + 1),
  ]);
}

export default function ArchiveUpload() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form] = Form.useForm();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [authOpen, setAuthOpen] = useState(!erpApi.hasSession());
  const [scopes, setScopes] = useState<Scope[]>([]);
  const treeNodeId = params.get('tree_node_id') || '';
  const [treeNodeName, setTreeNodeName] = useState('');

  useEffect(() => {
    form.setFieldsValue({
      title: params.get('title') || '',
      org_unit_id: params.get('scope_id') || 'dept-ops',
      archive_category: params.get('category') || '制度',
      filing_year: params.get('filing_year') || String(new Date().getFullYear()),
      filing_period: params.get('filing_period') || '年度',
    });
  }, [form, params]);

  useEffect(() => {
    if (!treeNodeId || !erpApi.hasSession()) return;
    void Promise.all([erpApi.archiveTreeNode(treeNodeId), erpApi.archiveTreeNodeUploadDefaults(treeNodeId)])
      .then(([node, defaults]) => { setTreeNodeName(node.name); form.setFieldsValue(defaults); })
      .catch((error) => { const detail = error instanceof Error ? error.message : '节点规则加载失败'; if (detail === 'ERP_AUTH_REQUIRED') setAuthOpen(true); else message.error(detail); });
  }, [treeNodeId, authOpen, form]);

  useEffect(() => {
    if (!erpApi.hasSession()) return;
    void Promise.all([erpApi.archiveScopes(), erpApi.accessContext()]).then(([rows, context]) => {
      const nextScopes = rows as Scope[];
      setScopes(nextScopes);
      if (!params.get('scope_id')) {
        const ownDepartment = String((context as { user?: { department_id?: string } }).user?.department_id || '');
        const available = flattenScopes(nextScopes).map((item) => item.value);
        if (ownDepartment && available.includes(ownDepartment)) form.setFieldValue('org_unit_id', ownDepartment);
        else if (available[0]) form.setFieldValue('org_unit_id', available[0]);
      }
    }).catch(() => undefined);
  }, [authOpen, form, params]);

  async function submit() {
    const uploadFiles = files.map((item) => item.originFileObj).filter(Boolean) as File[];
    if (!uploadFiles.length) { message.warning('请先选择文件'); return; }
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const results = await Promise.allSettled(uploadFiles.map((file) => erpApi.uploadArchiveDocument(file, {
        ...values,
        archive_tree_node_id: treeNodeId,
        title: values.title || file.name.replace(/\.[^.]+$/, ''),
      })));
      const succeeded = results.filter((result) => result.status === 'fulfilled').length;
      const failed = results.length - succeeded;
      if (failed) {
        message.warning(`${succeeded} 个文件上传成功，${failed} 个文件失败，请检查后重试`);
      } else {
        message.success(`${succeeded} 个档案已上传并进入处理流程`);
        navigate('/archive/library');
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '上传失败';
      if (detail === 'ERP_AUTH_REQUIRED') setAuthOpen(true); else message.error(detail);
    } finally { setSubmitting(false); }
  }

  return (
    <div className="workspace-page upload-workspace">
      <div className="page-heading"><div><Title level={3}>文档上传</Title><Text type="secondary">补齐档案元数据后上传，文件将进入解析、切分与知识库同步流程</Text></div><Button onClick={() => navigate('/archive/library')}>返回档案库</Button></div>
      <Alert type="info" showIcon message={treeNodeName ? '当前归档节点：' + treeNodeName : '上传前确认归档范围'} description={treeNodeName ? '文件将自动继承该节点的组织、分类、归档周期和 AI 策略。' : '密级、AI 用途与知识库映射会决定该文档能否进入 Dify 检索。'} />
      <div className="upload-layout">
        <section className="upload-drop-zone"><Dragger fileList={files} multiple beforeUpload={() => false} onChange={({ fileList }) => setFiles(fileList)}><p className="ant-upload-drag-icon"><InboxOutlined /></p><p className="ant-upload-text">拖入多个文件，或点击批量选择</p><p className="ant-upload-hint">支持 PDF、Word、Excel、Markdown 和文本，可一次选择多个文件</p></Dragger></section>
        <section className="upload-form-zone"><Form form={form} layout="vertical" initialValues={{ visibility: 'department', document_type: '通用文档', filing_status: 'unfiled', filing_period: '年度', retention_period: '长期', confidentiality_level: 'internal', ai_enabled: true, ai_usage_scope: 'ai_answer', redaction_required: false }}>
          <Form.Item name="title" label="文档标题"><Input placeholder="留空时使用文件名" /></Form.Item>
          <Space align="start" wrap><Form.Item name="org_unit_id" label="归档组织" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={flattenScopes(scopes)} style={{ width: 220 }} placeholder="选择组织范围" /></Form.Item><Form.Item name="document_code" label="档案编码"><Input style={{ width: 200 }} /></Form.Item></Space>
          <Space align="start" wrap><Form.Item name="archive_category" label="档案分类" rules={[{ required: true }]}><Select showSearch allowClear options={[{ value: '综合档案', label: '综合档案' }, { value: '制度', label: '制度' }, { value: '财务管理', label: '财务管理' }, { value: '人事档案', label: '人事档案' }, { value: '合同与印章', label: '合同与印章' }, { value: '行政流程', label: '行政流程' }, { value: '安全生产', label: '安全生产' }, { value: '工程技术', label: '工程技术' }, { value: '信息系统', label: '信息系统' }, { value: '培训资料', label: '培训资料' }]} style={{ width: 220 }} placeholder="选择档案分类" /></Form.Item><Form.Item name="document_type" label="文档类型"><Input style={{ width: 200 }} /></Form.Item></Space>
          <Space align="start" wrap><Form.Item name="filing_year" label="归档年度"><Input style={{ width: 130 }} /></Form.Item><Form.Item name="filing_period" label="归档周期"><Select style={{ width: 130 }} options={[{ value: '年度' }, { value: '季度' }, { value: '月度' }]} /></Form.Item><Form.Item name="filing_status" label="归档状态"><Select style={{ width: 130 }} options={[{ value: 'unfiled', label: '未归档' }, { value: 'pending', label: '待归档' }, { value: 'filed', label: '已归档' }]} /></Form.Item></Space>
          <Space align="start" wrap><Form.Item name="confidentiality_level" label="密级"><Select style={{ width: 160 }} options={[{ value: 'public', label: '公开' }, { value: 'internal', label: '内部' }, { value: 'sensitive', label: '敏感' }, { value: 'restricted', label: '受限' }]} /></Form.Item><Form.Item name="visibility" label="可见范围"><Select style={{ width: 160 }} options={[{ value: 'public', label: '公开' }, { value: 'department', label: '部门' }, { value: 'private', label: '私有' }]} /></Form.Item></Space>
          <Space size={28}><Form.Item name="ai_enabled" label="允许 AI 使用" valuePropName="checked"><Switch /></Form.Item><Form.Item name="redaction_required" label="入库前脱敏" valuePropName="checked"><Switch /></Form.Item></Space>
          <Form.Item name="ai_usage_scope" label="AI 用途"><Select options={[{ value: 'archive_only', label: '仅归档' }, { value: 'ai_search', label: '允许检索' }, { value: 'ai_answer', label: '允许生成回答' }]} /></Form.Item>
          <Button type="primary" icon={<UploadOutlined />} loading={submitting} onClick={() => void submit()} block>上传并进入处理流程</Button>
        </Form></section>
      </div>
      <BackendLoginModal open={authOpen} onAuthenticated={() => setAuthOpen(false)} />
    </div>
  );
}
