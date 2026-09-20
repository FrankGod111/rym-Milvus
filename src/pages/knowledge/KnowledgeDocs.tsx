import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  CloudSyncOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
  DatabaseOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { UploadProps } from 'antd';
import { erpApi, type DifyRemoteDocument, type DocumentRecord } from '@/api/erp';
import BackendLoginModal from '@/components/BackendLoginModal';
import { useAppStore } from '@/stores/app-store';

const { Title, Text, Paragraph } = Typography;

const statusLabels: Record<string, string> = {
  uploaded: '已上传',
  indexing: '索引中',
  indexed: '已索引',
  failed: '失败',
  archived: '已归档',
  pending: '待处理',
  running: '处理中',
  completed: '已完成',
  synced: '已同步',
  disabled: '未启用',
  parsed: '已解析',
  empty: '无可用内容',
  waiting: '等待索引',
  available: '可用',
};

function statusColor(value = '') {
  if (['indexed', 'completed', 'synced', 'parsed', 'available'].includes(value)) return 'green';
  if (['failed', 'deleted', 'empty', 'error'].includes(value)) return 'red';
  if (['indexing', 'running', 'pending', 'waiting'].includes(value)) return 'blue';
  return 'default';
}

function fileType(record: DocumentRecord) {
  const name = record.file_name || record.title;
  const suffix = name.split('.').pop();
  return suffix && suffix !== name ? suffix.toUpperCase() : 'DOC';
}

function isDifyManaged(record: DocumentRecord) {
  return record.knowledge_source_type === 'dify' || record.source_type === 'dify' || (Boolean(record.dify_document_id) && !record.content_text && record.knowledge_sync_status === 'synced');
}

type MetricFilter = 'all' | 'indexed' | 'synced' | 'attention';

function indexStates(record: DocumentRecord) {
  return [record.index_status, record.status, record.dify_indexing_status].map((value) => String(value || '').toLowerCase());
}

function parseStates(record: DocumentRecord) {
  return [record.parse_status, record.index_status, record.status, record.dify_indexing_status].map((value) => String(value || '').toLowerCase());
}

function isIndexed(record: DocumentRecord) {
  return indexStates(record).some((value) => ['indexed', 'completed', 'available', 'parsed'].includes(value));
}

function isSynced(record: DocumentRecord) {
  return record.knowledge_sync_status === 'synced' || Boolean(record.dify_document_id);
}

function needsAttention(record: DocumentRecord) {
  return parseStates(record).some((value) => ['failed', 'pending', 'empty', 'indexing', 'waiting', 'running', 'error'].includes(value));
}

function canOfferDownload(record: DocumentRecord) {
  if (record.original_path) return true;
  const mime = String(record.mime_type || '').toLowerCase();
  const name = String(record.file_name || '').toLowerCase();
  return mime.startsWith('text/') || ['application/json', 'application/markdown'].includes(mime) || /\.(txt|md|csv|json)$/.test(name);
}

type ScopeNode = { id: string; name: string; children?: ScopeNode[] };

function flattenScopes(nodes: ScopeNode[], depth = 0): Array<{ id: string; name: string; label: string }> {
  return nodes.flatMap((node) => [
    { id: node.id, name: node.name, label: `${'　'.repeat(depth)}${node.name}` },
    ...flattenScopes(node.children || [], depth + 1),
  ]);
}

export default function KnowledgeDocs() {
  const currentUser = useAppStore((state) => state.currentUser);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [difyDocuments, setDifyDocuments] = useState<DifyRemoteDocument[]>([]);
  const [difyLoading, setDifyLoading] = useState(false);
  const [difyError, setDifyError] = useState('');
  const [scopes, setScopes] = useState<Array<{ id: string; name: string; children?: unknown[] }>>([]);
  const [catalogItems, setCatalogItems] = useState<Array<{ id: string; scope_id?: string; scope_name?: string; document_name_rule?: string; category?: string }>>([]);
  const [treeNodes, setTreeNodes] = useState<Array<{ id: string; name: string; node_type?: string; scope_id?: string; parent_id?: string }>>([]);
  const [linking, setLinking] = useState<DifyRemoteDocument | null>(null);
  const [linkForm] = Form.useForm();
  const [query, setQuery] = useState('');
  const [metricFilter, setMetricFilter] = useState<MetricFilter>('all');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<DocumentRecord | null>(null);
  const [accessDecision, setAccessDecision] = useState<import('@/api/erp').AccessDecision | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [permissionUsers, setPermissionUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [permissionRoles, setPermissionRoles] = useState<Array<{ id: string; name: string }>>([]);
  const [permissionDepartments, setPermissionDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [permissionForm] = Form.useForm();
  const [workingId, setWorkingId] = useState('');
  const [authOpen, setAuthOpen] = useState(!erpApi.hasSession());
  const [form] = Form.useForm();
  const documentsSectionRef = useRef<HTMLElement | null>(null);
  const scopeOptions = useMemo(() => flattenScopes(scopes as ScopeNode[]), [scopes]);
  const unlinkedDifyDocuments = useMemo(
    () => difyDocuments.filter((document) => !document.managed_by_erp),
    [difyDocuments],
  );
  const showDifyWorkspace = difyLoading || Boolean(difyError) || unlinkedDifyDocuments.length > 0;

  async function load(nextQuery = query) {
    setLoading(true);
    try {
      const result = await erpApi.listDocuments(nextQuery.trim());
      setDocuments(result.documents || []);
    } catch (error) {
      handleError(error, '文档加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadDifyDocuments() {
    if (!erpApi.hasSession()) return;
    setDifyLoading(true);
    setDifyError('');
    try {
      const result = await erpApi.difyDocuments();
      setDifyDocuments(result.documents || []);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Dify 文件列表加载失败';
      if (detail === 'ERP_AUTH_REQUIRED') setAuthOpen(true);
      else setDifyError(detail);
    } finally {
      setDifyLoading(false);
    }
  }

  async function loadLinkOptions() {
    const [scopeResult, itemResult, treeResult] = await Promise.allSettled([
      erpApi.archiveScopes(),
      erpApi.archiveCatalogItems(),
      erpApi.archiveTreeNodes(),
    ]);
    if (scopeResult.status === 'fulfilled') setScopes(scopeResult.value);
    if (itemResult.status === 'fulfilled') setCatalogItems(itemResult.value as typeof catalogItems);
    if (treeResult.status === 'fulfilled') setTreeNodes(treeResult.value.filter((item) => item.node_type !== 'root') as typeof treeNodes);
    if (scopeResult.status === 'rejected') handleError(scopeResult.reason, '归属组织加载失败');
    else if (itemResult.status === 'rejected') handleError(itemResult.reason, '档案目录项加载失败');
    else if (treeResult.status === 'rejected') message.warning('规则树节点暂不可用，请确认服务器已同步新版后端并完成重启');
  }

  async function linkRemoteDocument() {
    if (!linking) return;
    const values = await linkForm.validateFields();
    setWorkingId(linking.id);
    try {
      await erpApi.linkDifyDocument(linking.id, { name: linking.name, dataset_id: linking.dataset_id, ...values });
      message.success('Dify 文件已关联到 ERP 权限和档案目录');
      setLinking(null);
      linkForm.resetFields();
      await Promise.all([load(), loadDifyDocuments()]);
    } catch (error) { handleError(error, 'Dify 文件关联失败'); } finally { setWorkingId(''); }
  }

  useEffect(() => { void load(''); void loadDifyDocuments(); }, []);

  function handleError(error: unknown, fallback: string) {
    const detail = error instanceof Error ? error.message : fallback;
    if (detail === 'ERP_AUTH_REQUIRED') setAuthOpen(true);
    else message.error(detail);
  }

  const summary = useMemo(() => ({
    total: documents.length,
    indexed: documents.filter(isIndexed).length,
    synced: documents.filter(isSynced).length,
    attention: documents.filter(needsAttention).length,
  }), [documents]);

  const visibleDocuments = useMemo(() => {
    if (metricFilter === 'indexed') return documents.filter(isIndexed);
    if (metricFilter === 'synced') return documents.filter(isSynced);
    if (metricFilter === 'attention') return documents.filter(needsAttention);
    return documents;
  }, [documents, metricFilter]);

  const metricFilterLabel = metricFilter === 'indexed' ? '已完成索引' : metricFilter === 'synced' ? '已同步知识库' : metricFilter === 'attention' ? '需要处理' : '';

  function selectMetric(filter: MetricFilter) {
    setMetricFilter(filter);
    requestAnimationFrame(() => documentsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function inspect(record: DocumentRecord) {
    setSelected(record);
    setAccessDecision(null);
    setDetailOpen(true);
    try {
      const [detail, decision] = await Promise.all([erpApi.getDocument(record.id), erpApi.documentAccessDecision(record.id)]);
      setSelected(detail);
      setAccessDecision(decision);
    } catch {
      // List data remains useful when the detail endpoint is temporarily unavailable.
    }
  }

  async function download(record: DocumentRecord) {
    try {
      const blob = await erpApi.downloadDocument(record.id);
      if (blob.size === 0) throw new Error('下载文件为空，原始附件可能不存在');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = record.file_name || `${record.title}.bin`; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { handleError(error, '文档下载失败'); }
  }

  async function openPermissions(record: DocumentRecord) {
    setSelected(record);
    const [usersResult, rolesResult, departmentsResult] = await Promise.allSettled([erpApi.users(), erpApi.roles(), erpApi.departments()]);
    if (usersResult.status === 'fulfilled') setPermissionUsers(usersResult.value.map((row) => ({ id: String(row.id), name: String(row.name || row.username || row.id) })));
    if (rolesResult.status === 'fulfilled') setPermissionRoles(rolesResult.value.map((row) => ({ id: String(row.id), name: String(row.name || row.id) })));
    if (departmentsResult.status === 'fulfilled') setPermissionDepartments(departmentsResult.value.map((row) => ({ id: String(row.id), name: String(row.name || row.id) })));
    const permissions = (record.permissions || {}) as Record<string, unknown>;
    permissionForm.setFieldsValue({ visibility: record.visibility || 'department', download_enabled: Boolean(permissions.download_enabled), ...permissions });
    setPermissionOpen(true);
  }

  async function savePermissions() {
    if (!selected) return;
    try {
      const values = await permissionForm.validateFields();
      await erpApi.updateDocumentPermissions(selected.id, values);
      message.success('文档权限已保存');
      setPermissionOpen(false);
      await load();
    } catch (error) { handleError(error, '文档权限保存失败'); }
  }

  function edit(record: DocumentRecord) {
    setSelected(record);
    form.setFieldsValue({
      title: record.title,
      category: record.category || 'General',
      tags: record.tags || [],
      visibility: record.visibility || 'department',
      document_type: record.document_type || '通用文档',
      confidentiality_level: record.confidentiality_level || 'internal',
      ai_enabled: Boolean(record.ai_enabled),
      ai_usage_scope: record.ai_usage_scope || 'ai_answer',
      knowledge_dataset_key: record.knowledge_dataset_key || '',
      filing_status: record.filing_status || 'unfiled',
    });
    setEditOpen(true);
  }

  async function save() {
    if (!selected) return;
    const values = await form.validateFields();
    setWorkingId(selected.id);
    try {
      const updated = await erpApi.updateDocument(selected.id, values);
      setDocuments((prev) => prev.map((item) => item.id === selected.id ? { ...item, ...updated } : item));
      setSelected(updated);
      setEditOpen(false);
      message.success('文档信息已保存');
    } catch (error) {
      handleError(error, '保存失败');
    } finally {
      setWorkingId('');
    }
  }

  async function remove(record: DocumentRecord) {
    setWorkingId(record.id);
    try {
      await erpApi.deleteDocument(record.id);
      setDocuments((prev) => prev.filter((item) => item.id !== record.id));
      if (selected?.id === record.id) setDetailOpen(false);
      message.success('文档已移入回收状态');
    } catch (error) {
      handleError(error, '删除失败');
    } finally {
      setWorkingId('');
    }
  }

  async function sync(record: DocumentRecord) {
    setWorkingId(record.id);
    try {
      await erpApi.syncDocument(record.id);
      message.success('已提交至知识库');
      await load();
    } catch (error) {
      handleError(error, '知识库同步失败');
    } finally {
      setWorkingId('');
    }
  }

  async function refreshSync(record: DocumentRecord) {
    setWorkingId(record.id);
    try {
      const updated = await erpApi.refreshDocumentSync(record.id);
      setDocuments((prev) => prev.map((item) => item.id === record.id ? { ...item, ...updated } : item));
      message.success('知识库索引状态已刷新');
    } catch (error) {
      handleError(error, '知识库状态刷新失败');
    } finally {
      setWorkingId('');
    }
  }

  async function reindex(record: DocumentRecord) {
    setWorkingId(record.id);
    try {
      await erpApi.reindexDocuments([record.id]);
      message.success('本地索引任务已完成');
      await load();
    } catch (error) {
      handleError(error, '本地索引失败');
    } finally {
      setWorkingId('');
    }
  }

  async function reparse(record: DocumentRecord) {
    setWorkingId(record.id);
    try {
      await erpApi.reparseDocument(record.id);
      message.success('文档已重新解析');
      await load();
    } catch (error) { handleError(error, '文档重新解析失败'); }
    finally { setWorkingId(''); }
  }

  const uploadProps: UploadProps = {
    multiple: true,
    showUploadList: false,
    accept: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.txt,.csv,.png,.jpg,.jpeg',
    customRequest: async ({ file, onSuccess, onError }) => {
      setUploading(true);
      try {
        const source = file as File;
        await erpApi.uploadDocument(source, {
          title: source.name.replace(/\.[^.]+$/, ''),
          category: '业务资料',
          visibility: 'department',
          ai_enabled: true,
          ai_usage_scope: 'ai_answer',
        });
        onSuccess?.({});
        message.success(`${source.name} 已进入解析队列`);
        await load();
      } catch (error) {
        onError?.(error as Error);
        handleError(error, '上传失败');
      } finally {
        setUploading(false);
      }
    },
  };

  const columns = [
    {
      title: '文档', key: 'document', width: 300,
      render: (_: unknown, record: DocumentRecord) => (
        <button className="text-link doc-title" onClick={() => void inspect(record)}>
          <FileTextOutlined />
          <span><strong>{record.title}</strong><small>{record.file_name || record.id}</small></span>
        </button>
      ),
    },
    { title: '类型', key: 'type', width: 80, render: (_: unknown, record: DocumentRecord) => <Tag>{fileType(record)}</Tag> },
    { title: '分类', dataIndex: 'category', key: 'category', width: 120, render: (value: string) => value || '未分类' },
    {
      title: '解析 / 索引', key: 'status', width: 190,
      render: (_: unknown, record: DocumentRecord) => {
        if (isDifyManaged(record)) {
          const difyIndexing = String(record.dify_indexing_status || record.index_status || 'completed');
          return <Space size={[4, 4]} wrap><Tag color="green">解析：Dify 已处理</Tag><Tag color={statusColor(difyIndexing)}>索引：{statusLabels[difyIndexing] || difyIndexing}</Tag></Space>;
        }
        const parseValue = String(record.parse_status || 'pending');
        const indexValue = String(record.index_status || record.status || 'pending');
        return <Space size={[4, 4]} wrap><Tag color={statusColor(parseValue)}>解析：{statusLabels[parseValue] || parseValue}</Tag><Tag color={statusColor(indexValue)}>索引：{statusLabels[indexValue] || indexValue}</Tag></Space>;
      },
    },
    {
      title: 'Dify', key: 'dify', width: 120,
      render: (_: unknown, record: DocumentRecord) => {
        const value = String(record.knowledge_sync_status || (record.dify_document_id ? 'synced' : 'disabled'));
        const indexing = String(record.dify_indexing_status || '');
        return <Space size={[4, 4]} wrap><Tag color={statusColor(value)}>{statusLabels[value] || value}</Tag>{indexing && <Tag color={statusColor(indexing)}>{statusLabels[indexing] || indexing}</Tag>}</Space>;
      },
    },
    { title: '更新', key: 'updated', width: 130, render: (_: unknown, record: DocumentRecord) => dayjs(String(record.updatedAt || record.updated_at || '')).isValid() ? dayjs(String(record.updatedAt || record.updated_at)).format('YYYY-MM-DD') : '-' },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 270,
      render: (_: unknown, record: DocumentRecord) => (
        <Space size={2}>
          <Button type="text" size="small" title="查看" icon={<EyeOutlined />} onClick={() => void inspect(record)} />
          {(currentUser.permissions.includes('*') || currentUser.permissions.includes('document:download')) && canOfferDownload(record) && <Button type="text" size="small" title="下载原始附件" aria-label="下载" icon={<DownloadOutlined />} onClick={() => void download(record)} />}
          <Button type="text" size="small" title="编辑" icon={<EditOutlined />} onClick={() => edit(record)} />
          {!isDifyManaged(record) && record.parse_status !== 'parsed' && <Button type="text" size="small" title="重新解析原始文件" aria-label="重新解析" icon={<ReloadOutlined />} loading={workingId === record.id} onClick={() => void reparse(record)} />}
          {!isDifyManaged(record) && <Button type="text" size="small" title={record.parse_status === 'parsed' ? '同步到知识库' : '解析内容不可用，请先重新解析'} aria-label="同步到知识库" disabled={record.parse_status !== 'parsed'} icon={<CloudSyncOutlined />} loading={workingId === record.id} onClick={() => void sync(record)} />}
          {!isDifyManaged(record) && <Button type="text" size="small" title="重建本地索引" aria-label="重建本地索引" icon={<DatabaseOutlined />} loading={workingId === record.id} onClick={() => void reindex(record)} />}
          {Boolean(record.dify_batch) && <Button type="text" size="small" title="刷新知识库状态" aria-label="刷新知识库状态" icon={<ReloadOutlined />} loading={workingId === record.id} onClick={() => void refreshSync(record)} />}
          <Popconfirm title="删除该文档？" description="文档将从当前列表移除。" onConfirm={() => void remove(record)}>
            <Button type="text" danger size="small" title="删除" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="workspace-page">
      <div className="page-heading">
        <div>
          <Title level={3}>知识文档</Title>
          <Text type="secondary">文件入库、解析、权限维护与知识库索引同步</Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button icon={<CloudSyncOutlined />} loading={difyLoading} onClick={() => void loadDifyDocuments()}>读取 Dify 文件</Button>
          <Upload {...uploadProps}><Button type="primary" icon={<UploadOutlined />} loading={uploading}>上传文件</Button></Upload>
        </Space>
      </div>

      <div className="metric-strip" role="group" aria-label="文档状态筛选">
        <button type="button" className={metricFilter === 'all' ? 'is-active' : ''} onClick={() => selectMetric('all')} aria-pressed={metricFilter === 'all'}><span>文档总数</span><strong>{summary.total}</strong></button>
        <button type="button" className={metricFilter === 'indexed' ? 'is-active' : ''} onClick={() => selectMetric('indexed')} aria-pressed={metricFilter === 'indexed'}><span>已完成索引</span><strong>{summary.indexed}</strong></button>
        <button type="button" className={metricFilter === 'synced' ? 'is-active' : ''} onClick={() => selectMetric('synced')} aria-pressed={metricFilter === 'synced'}><span>已同步知识库</span><strong>{summary.synced}</strong></button>
        <button type="button" className={`${metricFilter === 'attention' ? 'is-active ' : ''}${summary.attention ? 'metric-warning' : ''}`} onClick={() => selectMetric('attention')} aria-pressed={metricFilter === 'attention'}><span>需要处理</span><strong>{summary.attention}</strong></button>
      </div>

      {showDifyWorkspace ? (
        <section className="table-workspace dify-remote-workspace">
          <div className="page-heading compact-heading">
            <div><Title level={4}>Dify 数据集文件</Title><Text type="secondary">仅显示尚未关联 ERP 权限的 Dify 文件</Text></div>
            <Tag color={unlinkedDifyDocuments.length ? 'orange' : 'default'}>{unlinkedDifyDocuments.length} 个待关联文件</Tag>
          </div>
          {difyError ? <Alert type="warning" showIcon message="无法读取 Dify 数据集" description={difyError} /> : null}
          <Table<DifyRemoteDocument>
            rowKey={(record) => record.id || record.name}
            loading={difyLoading}
            dataSource={unlinkedDifyDocuments}
            size="small"
            pagination={{ pageSize: 6, showTotal: (total) => `共 ${total} 个待关联文件` }}
            locale={{ emptyText: difyLoading ? '正在读取 Dify 文件…' : '暂无待关联的 Dify 文件' }}
            columns={[
              { title: 'Dify 文件', dataIndex: 'name', key: 'name', ellipsis: true },
              { title: '索引状态', dataIndex: 'indexing_status', key: 'indexing_status', width: 120, render: (value: string) => <Tag color={statusColor(value)}>{statusLabels[value] || value || '未知'}</Tag> },
              { title: '权限状态', key: 'permission', width: 300, render: (_: unknown, record) => <Space><Text type="warning">尚未配置 ERP 权限映射</Text><Button type="link" size="small" loading={workingId === record.id} onClick={() => { setLinking(record); void loadLinkOptions(); }}>关联 ERP</Button></Space> },
            ]}
          />
        </section>
      ) : null}

      <Modal title="关联 Dify 文件到 ERP" open={Boolean(linking)} onOk={() => void linkRemoteDocument()} confirmLoading={Boolean(workingId)} onCancel={() => { setLinking(null); linkForm.resetFields(); }} destroyOnClose>
        <Alert type="info" showIcon message={linking ? `文件：${linking.name}` : ''} description="关联后可按组织、档案目录和可见范围进行权限控制。不会重新上传或复制 Dify 文件。" />
        <Form form={linkForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="scope_id" label="归属组织" rules={[{ required: true, message: '请选择组织' }]}><Select showSearch optionFilterProp="label" options={scopeOptions.map((scope) => ({ value: scope.id, label: scope.label }))} onChange={() => linkForm.setFieldValue('catalog_item_id', undefined)} /></Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.scope_id !== next.scope_id}>{({ getFieldValue }) => <Form.Item name="catalog_item_id" label="档案目录项"><Select allowClear showSearch optionFilterProp="label" options={catalogItems.filter((item) => !getFieldValue('scope_id') || item.scope_id === getFieldValue('scope_id')).map((item) => ({ value: item.id, label: `${item.category || ''} · ${item.document_name_rule || item.scope_name || item.id}` }))} placeholder="可选：绑定具体目录项" /></Form.Item>}</Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.scope_id !== next.scope_id}>{({ getFieldValue }) => <Form.Item name="archive_tree_node_id" label="规则树节点"><Select allowClear showSearch optionFilterProp="label" options={treeNodes.filter((item) => !getFieldValue('scope_id') || !item.scope_id || item.scope_id === getFieldValue('scope_id')).map((item) => ({ value: item.id, label: `${item.node_type === 'organization' ? '组织' : '分类'} · ${item.name}` }))} placeholder="可选：绑定规则树节点" /></Form.Item>}</Form.Item>
          <Space align="start" wrap><Form.Item name="visibility" label="可见范围" initialValue="department"><Select options={[{ value: 'public', label: '公开' }, { value: 'department', label: '所属部门' }, { value: 'private', label: '仅本人' }]} /></Form.Item><Form.Item name="confidentiality_level" label="密级" initialValue="internal"><Select options={[{ value: 'public', label: '公开' }, { value: 'internal', label: '内部' }, { value: 'sensitive', label: '敏感' }, { value: 'restricted', label: '受限' }]} /></Form.Item></Space>
          <Form.Item name="ai_usage_scope" label="AI 用途" initialValue="ai_answer"><Select options={[{ value: 'archive_only', label: '仅归档' }, { value: 'ai_search', label: '允许检索' }, { value: 'ai_answer', label: '允许生成回答' }]} /></Form.Item>
        </Form>
      </Modal>

      <section className="table-workspace knowledge-document-table" ref={documentsSectionRef}>
        <div className="table-toolbar">
          <Space wrap>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索标题、文件名或标签"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onPressEnter={() => void load()}
            />
            <Button onClick={() => void load()}>查询</Button>
            {metricFilterLabel && <Tag closable onClose={() => selectMetric('all')}>当前筛选：{metricFilterLabel}</Tag>}
          </Space>
        </div>
        <Table<DocumentRecord>
          rowKey="id"
          loading={loading}
          dataSource={visibleDocuments}
          columns={columns}
          scroll={{ x: 1120 }}
          pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
          locale={{ emptyText: <Empty description={metricFilterLabel ? `暂无${metricFilterLabel}文档` : '暂无文档，上传文件后会在这里显示解析状态'} /> }}
        />
      </section>

      <Drawer title="文档详情" width={620} open={detailOpen} onClose={() => setDetailOpen(false)} extra={selected && <Space><Button icon={<EditOutlined />} onClick={() => edit(selected)}>编辑</Button>{currentUser.permissions.includes('*') && <Button onClick={() => void openPermissions(selected)}>配置权限</Button>}</Space>}>
        {selected && (
          <Space direction="vertical" size={20} style={{ width: '100%' }}>
            <div className="detail-title"><FileTextOutlined /><div><Title level={4}>{selected.title}</Title><Text type="secondary">{selected.file_name || selected.id}</Text></div></div>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="文档 ID" span={2}>{selected.id}</Descriptions.Item>
              <Descriptions.Item label="分类">{selected.category || '-'}</Descriptions.Item>
              <Descriptions.Item label="类型">{selected.document_type || fileType(selected)}</Descriptions.Item>
              <Descriptions.Item label="可见范围">{selected.visibility || '-'}</Descriptions.Item>
              <Descriptions.Item label="密级">{selected.confidentiality_level || '-'}</Descriptions.Item>
              <Descriptions.Item label="AI 使用">{selected.ai_enabled ? `已启用（${selected.ai_usage_scope || 'ai_answer'}）` : '未启用'}</Descriptions.Item>
              <Descriptions.Item label="解析状态">{String(selected.parse_status || selected.index_status || selected.status || '-')}</Descriptions.Item>
              <Descriptions.Item label="解析器">{String(selected.parser || (isDifyManaged(selected) ? 'Dify' : '-'))}</Descriptions.Item>
              <Descriptions.Item label="Dify 状态">{String(selected.knowledge_sync_status || '-')}</Descriptions.Item>
            </Descriptions>
            {accessDecision && <Alert type={accessDecision.allowed ? 'success' : 'warning'} showIcon message={accessDecision.allowed ? '当前账号允许访问' : '当前账号无法访问'} description={<Space direction="vertical" size={2}><span>{accessDecision.reason}</span>{accessDecision.required_capability && <span>所需能力：{accessDecision.required_capability}</span>}{accessDecision.denied_by && <span>拦截规则：{accessDecision.denied_by}</span>}{accessDecision.matched_rules?.length ? <span>命中规则：{accessDecision.matched_rules.join('；')}</span> : null}</Space>} />}
            {Boolean(selected.parse_error) && !isDifyManaged(selected) && <Alert type="warning" showIcon message="解析提示" description={String(selected.parse_error)} />}
            <div>
              <Text strong>标签</Text>
              <div style={{ marginTop: 8 }}>{selected.tags?.length ? selected.tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Text type="secondary">暂无标签</Text>}</div>
            </div>
            {selected.content_text && <div><Text strong>解析内容</Text><Paragraph className="content-preview">{selected.content_text}</Paragraph></div>}
          </Space>
        )}
      </Drawer>

      <Modal title="配置文档权限" open={permissionOpen} onOk={() => void savePermissions()} onCancel={() => setPermissionOpen(false)} destroyOnClose>
        <Form form={permissionForm} layout="vertical">
          <Form.Item name="visibility" label="可见范围"><Select options={[{ value: 'public', label: '公开（全员可读）' }, { value: 'department', label: '所属部门' }, { value: 'role', label: '指定角色' }, { value: 'private', label: '仅本人' }, { value: 'admin', label: '仅管理员' }]} /></Form.Item>
          <Form.Item name="download_enabled" label="允许下载" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="user_ids" label="用户白名单"><Select mode="multiple" showSearch optionFilterProp="label" options={permissionUsers.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
          <Form.Item name="role_ids" label="角色白名单"><Select mode="multiple" showSearch optionFilterProp="label" options={permissionRoles.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
          <Form.Item name="department_ids" label="部门白名单"><Select mode="multiple" showSearch optionFilterProp="label" options={permissionDepartments.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
          <Form.Item name="deny_user_ids" label="用户黑名单"><Select mode="multiple" showSearch optionFilterProp="label" options={permissionUsers.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
          <Form.Item name="deny_role_ids" label="角色黑名单"><Select mode="multiple" showSearch optionFilterProp="label" options={permissionRoles.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
          <Form.Item name="deny_department_ids" label="部门黑名单"><Select mode="multiple" showSearch optionFilterProp="label" options={permissionDepartments.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
          <Alert type="info" showIcon message="权限判断顺序" description="角色能力 → 黑名单拒绝 → 公开/部门/角色范围 → 下载开关。黑名单优先，下载权限独立于查看权限。" />
        </Form>
      </Modal>

      <Modal title="编辑文档信息" open={editOpen} onOk={() => void save()} confirmLoading={Boolean(workingId)} onCancel={() => setEditOpen(false)} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}><Input /></Form.Item>
          <Form.Item name="category" label="业务分类"><Input /></Form.Item>
          <Form.Item name="tags" label="标签"><Select mode="tags" tokenSeparators={[',']} /></Form.Item>
          <Form.Item name="document_type" label="文档类型"><Input /></Form.Item>
          <div className="knowledge-doc-edit-grid">
            <Form.Item name="visibility" label="可见范围"><Select options={[{ value: 'public', label: '公开' }, { value: 'department', label: '部门' }, { value: 'private', label: '仅本人' }, { value: 'admin', label: '仅管理员' }]} /></Form.Item>
            <Form.Item name="confidentiality_level" label="密级"><Select options={[{ value: 'public', label: '公开' }, { value: 'internal', label: '内部' }, { value: 'department', label: '部门敏感' }, { value: 'sensitive', label: '敏感' }, { value: 'restricted', label: '受限' }]} /></Form.Item>
            <Form.Item name="filing_status" label="归档状态"><Select options={[{ value: 'unfiled', label: '未归档' }, { value: 'pending', label: '待归档' }, { value: 'filed', label: '已归档' }, { value: 'void', label: '作废' }]} /></Form.Item>
            <Form.Item name="ai_enabled" label="允许 AI 使用" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="ai_usage_scope" label="AI 用途"><Select options={[{ value: 'archive_only', label: '仅归档' }, { value: 'ai_search', label: '允许检索' }, { value: 'ai_answer', label: '允许回答' }]} /></Form.Item>
          </div>
          <Form.Item name="knowledge_dataset_key" label="知识库标识" extra="单知识库场景可填写 rym-1；这是 ERP 路由标识，不是 Dify API Key。"><Input placeholder="例如：rym-1 或 finance-policy-kb" /></Form.Item>
        </Form>
      </Modal>
      <BackendLoginModal open={authOpen} onAuthenticated={() => { setAuthOpen(false); void load(); void loadDifyDocuments(); }} />
    </div>
  );
}
