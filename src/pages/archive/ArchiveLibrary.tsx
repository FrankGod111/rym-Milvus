import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { ApartmentOutlined, CloudSyncOutlined, DatabaseOutlined, EditOutlined, EyeOutlined, ReloadOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { erpApi, type DocumentRecord } from '@/api/erp';
import BackendLoginModal from '@/components/BackendLoginModal';
import { useAppStore } from '@/stores/app-store';

const { Title, Text, Paragraph } = Typography;

const filingLabels: Record<string, string> = { unfiled: '未归档', pending: '待归档', filed: '已归档', void: '作废' };
const syncLabels: Record<string, string> = { disabled: '未启用', pending: '待同步', synced: '已同步', failed: '同步失败' };
function flattenScopes(nodes: Array<{ id: string; name?: string; children?: unknown[] }>): Array<{ id: string; name: string }> {
  return nodes.flatMap((node) => [{ id: String(node.id), name: String(node.name || node.id) }, ...flattenScopes((node.children || []) as Array<{ id: string; name?: string; children?: unknown[] }>)]);
}

export default function ArchiveLibrary() {
  const navigate = useNavigate();
  const currentUser = useAppStore((state) => state.currentUser);
  const canWrite = currentUser.permissions.includes('*') || currentUser.permissions.includes('document:write');
  const canIndex = currentUser.permissions.includes('*') || currentUser.permissions.includes('document:index');
  const [rows, setRows] = useState<DocumentRecord[]>([]);
  const [query, setQuery] = useState('');
  const [filingStatus, setFilingStatus] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<DocumentRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(!erpApi.hasSession());
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm] = Form.useForm();
  const [scopes, setScopes] = useState<Array<{ id: string; name: string }>>([]);
  const [catalogItems, setCatalogItems] = useState<Array<{ id: string; scope_id?: string; scope_name?: string; category?: string; document_name_rule?: string }>>([]);
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([]);
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [transferWorking, setTransferWorking] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (filingStatus) params.set('filing_status', filingStatus);
    if (syncStatus) params.set('knowledge_sync_status', syncStatus);
    try {
      const data = await erpApi.archiveDocuments(params.toString());
      setRows(data.documents || []);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '档案加载失败';
      if (detail === 'ERP_AUTH_REQUIRED') setAuthOpen(true); else message.error(detail);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const stats = useMemo(() => ({
    total: rows.length,
    filed: rows.filter((item) => item.filing_status === 'filed').length,
    ai: rows.filter((item) => item.ai_enabled).length,
    synced: rows.filter((item) => item.knowledge_sync_status === 'synced').length,
  }), [rows]);

  async function inspect(record: DocumentRecord) {
    setSelected(record);
    setDrawerOpen(true);
    try { setSelected(await erpApi.archiveDocument(record.id)); } catch { /* retain list payload */ }
  }

  async function openTransfer(record: DocumentRecord) {
    setSelected(record);
    try {
      const [scopeRows, itemRows, roleRows, userRows] = await Promise.all([erpApi.archiveScopes(), erpApi.archiveCatalogItems(), erpApi.roles(), erpApi.users()]);
      setScopes(flattenScopes(scopeRows as Array<{ id: string; name?: string; children?: unknown[] }>));
      setCatalogItems(itemRows as typeof catalogItems);
      setRoles(roleRows.map((row) => ({ id: String(row.id), name: String(row.name || row.id) })));
      setUsers(userRows.map((row) => ({ id: String(row.id), name: String(row.name || row.username || row.id) })));
      transferForm.setFieldsValue({ target_scope_id: record.department_id || undefined, visibility: record.visibility || 'department' });
      setTransferOpen(true);
    } catch (error) { message.error(error instanceof Error ? error.message : '组织范围加载失败'); }
  }

  async function transfer() {
    if (!selected) return;
    const values = await transferForm.validateFields();
    setTransferWorking(true);
    try {
      await erpApi.transferArchiveDocumentScope(selected.id, values.target_scope_id, values.target_catalog_item_id || '', values.visibility, values.role_ids || [], values.user_ids || []);
      message.success('文档归属已调整，原部门权限已清理');
      setTransferOpen(false);
      await load();
      setDrawerOpen(false);
    } catch (error) { message.error(error instanceof Error ? error.message : '文档归属调整失败'); }
    finally { setTransferWorking(false); }
  }

  function openEdit(record: DocumentRecord) {
    setSelected(record);
    editForm.setFieldsValue({
      title: record.title,
      archive_category: record.archive_category || '',
      document_type: record.document_type || '',
      filing_status: record.filing_status || 'unfiled',
      visibility: record.visibility || 'department',
      confidentiality_level: record.confidentiality_level || 'internal',
      ai_enabled: Boolean(record.ai_enabled),
      ai_usage_scope: record.ai_usage_scope || 'archive_only',
    });
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!selected) return;
    try {
      const values = await editForm.validateFields();
      const updated = await erpApi.updateDocument(selected.id, values);
      setRows((current) => current.map((item) => item.id === selected.id ? { ...item, ...updated } : item));
      setSelected(updated);
      setEditOpen(false);
      message.success('文档信息已更新');
    } catch (error) { message.error(error instanceof Error ? error.message : '文档更新失败'); }
  }

  async function reindex(record: DocumentRecord) {
    try {
      if (record.parse_status !== 'parsed') await erpApi.reparseDocument(record.id);
      await erpApi.reindexDocuments([record.id]);
      message.success(record.parse_status === 'parsed' ? '索引任务已完成' : '文档已重新解析并建立索引');
      await load();
    } catch (error) { message.error(error instanceof Error ? error.message : '文档处理失败'); }
  }

  async function sync(record: DocumentRecord) {
    try {
      await erpApi.syncDocument(record.id);
      message.success('已提交 Dify 知识库处理');
      await load();
    } catch (error) { message.error(error instanceof Error ? error.message : '知识库同步失败'); }
  }

  async function refreshSync(record: DocumentRecord) {
    try {
      await erpApi.refreshDocumentSync(record.id);
      message.success('Dify 处理状态已刷新');
      await load();
    } catch (error) { message.error(error instanceof Error ? error.message : '状态刷新失败'); }
  }

  return (
    <div className="workspace-page">
      <div className="page-heading"><div><Title level={3}>档案库</Title><Text type="secondary">按组织、目录、归档状态和 AI 准入条件管理企业档案</Text></div><Space><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button><Button type="primary" icon={<UploadOutlined />} onClick={() => navigate('/archive/upload')}>上传档案</Button></Space></div>
      <div className="metric-strip archive-metric-strip"><div><span>档案总数</span><strong>{stats.total}</strong><small>当前可见档案</small></div><div><span>已归档</span><strong>{stats.filed}</strong><small>完成归档登记</small></div><div><span>允许 AI 使用</span><strong>{stats.ai}</strong><small>已通过准入</small></div><div><span>已同步知识库</span><strong>{stats.synced}</strong><small>已进入知识库</small></div></div>
      <section className="table-workspace">
        <div className="table-toolbar archive-filter-bar">
          <Input allowClear prefix={<SearchOutlined />} placeholder="标题、编码或档案路径" value={query} onChange={(event) => setQuery(event.target.value)} onPressEnter={() => void load()} />
          <Select allowClear placeholder="归档状态" value={filingStatus || undefined} onChange={(value) => setFilingStatus(value || '')} options={[{ value: 'unfiled', label: '未归档' }, { value: 'pending', label: '待归档' }, { value: 'filed', label: '已归档' }, { value: 'void', label: '作废' }]} />
          <Select allowClear placeholder="知识同步" value={syncStatus || undefined} onChange={(value) => setSyncStatus(value || '')} options={[{ value: 'disabled', label: '未启用' }, { value: 'pending', label: '待同步' }, { value: 'synced', label: '已同步' }, { value: 'failed', label: '同步失败' }]} />
          <Button onClick={() => void load()}>查询</Button>
        </div>
        <Table<DocumentRecord> rowKey="id" loading={loading} dataSource={rows} scroll={{ x: 1100 }} pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 件` }} locale={{ emptyText: <Empty description="暂无符合条件的档案" /> }} columns={[
          { title: '档案', key: 'title', width: 300, render: (_: unknown, record) => <button className="text-link approval-title" onClick={() => void inspect(record)}><strong>{record.title}</strong><small>{String(record.document_code || record.file_name || record.id)}</small></button> },
          { title: '组织 / 路径', key: 'org', width: 190, render: (_: unknown, record) => <span>{String(record.department_name || record.department_id || '-')}<br /><Text type="secondary">{String(record.org_path || record.archive_path || '-')}</Text></span> },
          { title: '分类', key: 'category', width: 140, render: (_: unknown, record) => `${String(record.archive_category || '-')} / ${String(record.document_type || '-')}` },
          { title: '归档', dataIndex: 'filing_status', width: 100, render: (value: string) => <Tag className="compact-status-tag" color={value === 'filed' ? 'green' : value === 'pending' ? 'blue' : 'default'}>{filingLabels[value] || filingLabels.unfiled}</Tag> },
          { title: 'AI', dataIndex: 'ai_enabled', width: 90, render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '可用' : '禁用'}</Tag> },
          { title: '知识库', dataIndex: 'knowledge_sync_status', width: 110, render: (value: string) => <Tag className="compact-status-tag" color={value === 'synced' ? 'green' : value === 'failed' ? 'red' : 'default'}>{syncLabels[value] || syncLabels.disabled}</Tag> },
          { title: '操作', width: 310, fixed: 'right', render: (_: unknown, record) => <Space size={0}><Button type="text" icon={<EyeOutlined />} title="详情" onClick={() => void inspect(record)}>详情</Button>{canWrite && <><Button type="text" icon={<EditOutlined />} title="编辑文档信息" onClick={() => openEdit(record)}>编辑</Button><Button type="text" icon={<ApartmentOutlined />} title="调整归属部门" onClick={() => void openTransfer(record)}>调整归属</Button></>}{canIndex && (record.parse_status !== 'parsed' || ['pending', 'failed', 'skipped'].includes(String(record.index_status || '')) ? <Button type="text" icon={<DatabaseOutlined />} title="重新处理并建立索引" onClick={() => void reindex(record)}>处理</Button> : null)}{canIndex && record.parse_status === 'parsed' && record.ai_enabled && record.knowledge_sync_status !== 'synced' && !record.dify_batch ? <Button type="text" icon={<CloudSyncOutlined />} title="同步到 Dify" onClick={() => void sync(record)}>同步</Button> : null}{canIndex && record.dify_batch ? <Button type="text" icon={<ReloadOutlined />} title="刷新 Dify 状态" onClick={() => void refreshSync(record)}>刷新</Button> : null}</Space> },
        ]} />
      </section>
      <Drawer title="档案详情" width={640} open={drawerOpen} onClose={() => setDrawerOpen(false)}>{selected && <Space direction="vertical" size={18} style={{ width: '100%' }}><Title level={4}>{selected.title}</Title><Descriptions bordered size="small" column={2}><Descriptions.Item label="档案编码">{String(selected.document_code || '-')}</Descriptions.Item><Descriptions.Item label="文件名">{selected.file_name || '-'}</Descriptions.Item><Descriptions.Item label="归属组织">{String(selected.department_name || selected.department_id || '-')}</Descriptions.Item><Descriptions.Item label="归档年度">{String(selected.filing_year || '-')}</Descriptions.Item><Descriptions.Item label="归档状态">{filingLabels[String(selected.filing_status || '')] || filingLabels.unfiled}</Descriptions.Item><Descriptions.Item label="档案分类">{String(selected.archive_category || '-')}</Descriptions.Item><Descriptions.Item label="文档类型">{String(selected.document_type || '-')}</Descriptions.Item><Descriptions.Item label="密级">{selected.confidentiality_level || '-'}</Descriptions.Item><Descriptions.Item label="知识同步">{syncLabels[String(selected.knowledge_sync_status || '')] || syncLabels.disabled}</Descriptions.Item></Descriptions><Button icon={<ApartmentOutlined />} onClick={() => void openTransfer(selected)}>调整归属部门</Button>{Boolean(selected.ai_block_reason) && <div><Text strong>AI 阻断原因</Text><Paragraph className="decision-note">{String(selected.ai_block_reason)}</Paragraph></div>}</Space>}</Drawer>
      <Modal title="调整文档归属" open={transferOpen} onOk={() => void transfer()} confirmLoading={transferWorking} onCancel={() => setTransferOpen(false)} destroyOnClose>
        <Alert type="info" showIcon message="跨部门调整会同步更新组织、档案路径和权限" description="原部门白名单将被清理。目标部门默认可见；如需同部门内进一步限制，可在权限管理中配置用户或角色白名单。" />
        <Form form={transferForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="target_scope_id" label="目标组织/部门" rules={[{ required: true, message: '请选择目标组织' }]}><Select showSearch optionFilterProp="label" options={scopes.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.target_scope_id !== next.target_scope_id}>{({ getFieldValue }) => <Form.Item name="target_catalog_item_id" label="目标档案目录项"><Select allowClear showSearch optionFilterProp="label" options={catalogItems.filter((item) => !getFieldValue('target_scope_id') || item.scope_id === getFieldValue('target_scope_id')).map((item) => ({ value: item.id, label: `${item.category || ''} · ${item.document_name_rule || item.scope_name || item.id}` }))} placeholder="可选：放入目标部门具体目录" /></Form.Item>}</Form.Item>
          <Form.Item name="visibility" label="同部门可见范围"><Select options={[{ value: 'department', label: '目标部门全员可见' }, { value: 'role', label: '目标部门指定角色' }, { value: 'private', label: '仅文档负责人' }, { value: 'public', label: '全公司可见' }]} /></Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.visibility !== next.visibility}>{({ getFieldValue }) => getFieldValue('visibility') === 'role' ? <Form.Item name="role_ids" label="目标部门可见角色" rules={[{ required: true, message: '请选择至少一个角色' }]}><Select mode="multiple" showSearch optionFilterProp="label" options={roles.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item> : null}</Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.visibility !== next.visibility}>{({ getFieldValue }) => getFieldValue('visibility') === 'private' ? <Form.Item name="user_ids" label="可见用户" rules={[{ required: true, message: '请选择至少一个用户' }]}><Select mode="multiple" showSearch optionFilterProp="label" options={users.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item> : null}</Form.Item>
        </Form>
      </Modal>
      <Modal title="编辑文档信息" open={editOpen} onOk={() => void saveEdit()} onCancel={() => setEditOpen(false)} destroyOnClose>
        <Form form={editForm} layout="vertical">
          <Form.Item name="title" label="文档标题" rules={[{ required: true, message: '请输入文档标题' }]}><Input /></Form.Item>
          <Space wrap><Form.Item name="archive_category" label="档案分类"><Input /></Form.Item><Form.Item name="document_type" label="文档类型"><Input /></Form.Item></Space>
          <Space wrap><Form.Item name="filing_status" label="归档状态"><Select options={[{ value: 'unfiled', label: '未归档' }, { value: 'pending', label: '待归档' }, { value: 'filed', label: '已归档' }, { value: 'void', label: '作废' }]} /></Form.Item><Form.Item name="visibility" label="可见范围"><Select options={[{ value: 'public', label: '全公司可见' }, { value: 'department', label: '所属部门' }, { value: 'role', label: '指定角色' }, { value: 'private', label: '仅本人' }, { value: 'admin', label: '仅管理员' }]} /></Form.Item></Space>
          <Space wrap><Form.Item name="confidentiality_level" label="密级"><Select options={[{ value: 'public', label: '公开' }, { value: 'internal', label: '内部' }, { value: 'sensitive', label: '敏感' }, { value: 'restricted', label: '受限' }]} /></Form.Item><Form.Item name="ai_usage_scope" label="AI 用途"><Select options={[{ value: 'archive_only', label: '仅归档' }, { value: 'ai_search', label: '允许检索' }, { value: 'ai_answer', label: '允许回答' }]} /></Form.Item></Space>
          <Form.Item name="ai_enabled" label="允许 AI 使用" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
      <BackendLoginModal open={authOpen} onAuthenticated={() => { setAuthOpen(false); void load(); }} />
    </div>
  );
}
