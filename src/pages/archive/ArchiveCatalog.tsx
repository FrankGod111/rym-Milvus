import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, Form, Input, Modal, Select, Space, Spin, Switch, Table, Tag, Tree, Typography, message } from 'antd';
import type { DataNode, TreeProps } from 'antd/es/tree';
import { DownloadOutlined, EditOutlined, FileTextOutlined, FolderOpenOutlined, FolderOutlined, PlusOutlined, ReloadOutlined, SettingOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { erpApi, type ArchiveTreeNode, type DocumentRecord } from '@/api/erp';
import BackendLoginModal from '@/components/BackendLoginModal';

const { Title, Text, Paragraph } = Typography;
const actionLabels: Record<string, string> = { read: '查看', upload: '上传', delete: '删除', metadata: '修改元数据', download: '下载' };
type TreeNode = ArchiveTreeNode & { children?: TreeNode[]; loaded?: boolean };

function treeData(nodes: TreeNode[]): DataNode[] {
  return nodes.map((node) => ({
    key: node.id,
    title: <span className="archive-tree-title"><span className="archive-tree-icon">{node.node_type === 'category' ? <FolderOutlined /> : <FolderOpenOutlined />}</span><span>{node.name}</span>{node.required && <Tag color="red" className="compact-status-tag">必传</Tag>}{Boolean(node.document_count) && <Text type="secondary">{node.document_count}</Text>}</span>,
    isLeaf: node.has_children === false || node.child_count === 0,
    children: node.children ? treeData(node.children) : undefined,
  }));
}
function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const node of nodes) { if (node.id === id) return node; const found = node.children && findNode(node.children, id); if (found) return found; }
  return undefined;
}
function replaceChildren(nodes: TreeNode[], id: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((node) => node.id === id ? { ...node, children, loaded: true } : node.children ? { ...node, children: replaceChildren(node.children, id, children) } : node);
}
function replaceNode(nodes: TreeNode[], id: string, update: TreeNode): TreeNode[] {
  return nodes.map((node) => node.id === id ? { ...node, ...update } : node.children ? { ...node, children: replaceNode(node.children, id, update) } : node);
}

export default function ArchiveCatalogPage() {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [loading, setLoading] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [authOpen, setAuthOpen] = useState(!erpApi.hasSession());
  const [isAdmin, setIsAdmin] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [scopes, setScopes] = useState<Array<{ id: string; name: string }>>([]);
  const [users, setUsers] = useState<Array<{ id: string; name: string; username?: string }>>([]);
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [template, setTemplate] = useState<{ name: string; content: string } | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [form] = Form.useForm();
  const [batchForm] = Form.useForm();
  const selected = useMemo(() => findNode(nodes, selectedId), [nodes, selectedId]);

  function fail(error: unknown, fallback: string) { const detail = error instanceof Error ? error.message : fallback; if (detail === 'ERP_AUTH_REQUIRED') setAuthOpen(true); else message.error(detail); }
  async function loadRoot() {
    setLoading(true);
    try {
      const [children, rootNode, context, scopeRows, userRows, roleRows] = await Promise.all([erpApi.archiveTreeChildren('archive-root'), erpApi.archiveTreeNode('archive-root'), erpApi.accessContext(), erpApi.departments(), erpApi.users(), erpApi.roles()]);
      setNodes([{ ...(rootNode as TreeNode), children: children as TreeNode[], loaded: true }]);
      setIsAdmin(Boolean(context.user?.is_admin)); setCanManage(Boolean(context.user?.is_admin || context.permissions?.includes('archive:catalog:write')));
      setScopes((scopeRows || []).map((row) => ({ id: String(row.id), name: String(row.name || row.id) })));
      setUsers((userRows || []).map((row) => ({ id: String(row.id), name: String(row.name || row.username || row.id), username: String(row.username || '') })));
      setRoles((roleRows || []).map((row) => ({ id: String(row.id), name: String(row.name || row.id) })));
      setSelectedId('archive-root'); await loadDocuments('archive-root');
    } catch (error) { fail(error, '档案树加载失败'); } finally { setLoading(false); }
  }
  async function loadDocuments(id: string) { setDocsLoading(true); try { setDocuments((await erpApi.archiveTreeNodeDocuments(id)).documents || []); } catch (error) { fail(error, '节点文档加载失败'); } finally { setDocsLoading(false); } }
  async function loadChildren(node: TreeNode) { if (node.loaded || node.has_children === false) return; try { const children = await erpApi.archiveTreeChildren(node.id); setNodes((current) => replaceChildren(current, node.id, children as TreeNode[])); } catch (error) { fail(error, '子目录加载失败'); } }
  useEffect(() => { if (erpApi.hasSession()) void loadRoot(); }, [authOpen]);
  const loadData: TreeProps['loadData'] = async (node) => { const target = findNode(nodes, String(node.key)); if (target) await loadChildren(target); };
  async function selectNode(id: string) { setSelectedId(id); await loadDocuments(id); }
  function openEditor(node?: TreeNode) { setCreating(!node); form.resetFields(); form.setFieldsValue(node || { required: false, archive_status: 'unfiled', archive_period: '年度', retention_period: '长期', ai_enabled: true, ai_priority_scope: false, permission_mode: 'inherit', allowed_actions: ['read', 'upload', 'delete', 'metadata', 'download'] }); setEditorOpen(true); }
  async function saveNode() {
    try {
      const values = await form.validateFields();
      if (creating) { const created = await erpApi.createArchiveTreeNode({ ...values, parent_id: selectedId || 'archive-root', node_type: values.node_type || 'category' }); setNodes((current) => replaceChildren(current, selectedId || 'archive-root', [...(findNode(current, selectedId || 'archive-root')?.children || []), created as TreeNode])); }
      else { const updated = await erpApi.updateArchiveTreeNode(selectedId, values); setNodes((current) => replaceNode(current, selectedId, updated as TreeNode)); }
      setEditorOpen(false); message.success(creating ? '目录节点已创建' : '目录规则已保存');
    } catch (error) { fail(error, '目录规则保存失败'); }
  }
  async function openTemplate() { if (!selectedId) return; try { setTemplate(await erpApi.archiveTreeNodeTemplate(selectedId)); setTemplateOpen(true); } catch (error) { fail(error, '模板读取失败'); } }
  async function downloadTemplate() { if (!selectedId) return; try { const blob = await erpApi.downloadArchiveTreeTemplate(selectedId); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = (selected?.name || '归档模板') + '.md'; link.click(); URL.revokeObjectURL(url); } catch (error) { fail(error, '模板下载失败'); } }
  async function batchUpdate() { try { const values = await batchForm.validateFields(); await erpApi.batchUpdateArchiveTreeNodes({ ids: selectedKeys.map(String), ...values }); setBatchOpen(false); message.success('批量规则已更新'); await loadRoot(); } catch (error) { fail(error, '批量更新失败'); } }
  const onDrop: TreeProps['onDrop'] = async (info) => { if (!canManage) return; const dragId = String(info.dragNode.key); const targetId = String(info.node.key); if (dragId === 'archive-root' || dragId === targetId) return; try { await erpApi.moveArchiveTreeNode(dragId, targetId); message.success('目录节点已移动'); await loadRoot(); } catch (error) { fail(error, '目录移动失败'); } };

  return <div className="workspace-page archive-tree-workspace">
    <div className="page-heading"><div><Title level={3}>档案目录</Title><Text type="secondary">以规则树管理组织隔离、业务分类、归档策略与节点权限</Text></div><Space><Button icon={<ReloadOutlined />} onClick={() => void loadRoot()}>刷新</Button>{canManage && <Button icon={<PlusOutlined />} onClick={() => openEditor()}>新增节点</Button>}<Button disabled={!selected || selected.node_type === 'root'} icon={<UploadOutlined />} type="primary" onClick={() => navigate('/archive/upload?tree_node_id=' + encodeURIComponent(selectedId))}>在此节点上传</Button></Space></div>
    <Alert type="info" showIcon message="点击节点即可过滤右侧文档；展开目录时才加载子节点。" description="节点规则会自动应用到上传文件、AI 检索和文档权限。" style={{ marginBottom: 16 }} />
    <div className="archive-tree-layout"><section className="archive-tree-panel"><div className="table-toolbar"><Text strong>规则目录树</Text><Text type="secondary">支持无限级目录与拖拽排序</Text></div>{loading ? <Spin /> : <Tree blockNode showLine checkable={canManage} draggable={canManage} selectedKeys={[selectedId]} checkedKeys={selectedKeys} loadData={loadData} onSelect={(keys) => { if (keys[0]) void selectNode(String(keys[0])); }} onCheck={(keys) => setSelectedKeys(keys as React.Key[])} onDrop={onDrop} treeData={treeData(nodes)} />}{canManage && selectedKeys.length > 1 && <Button block icon={<SettingOutlined />} style={{ marginTop: 16 }} onClick={() => { batchForm.resetFields(); setBatchOpen(true); }}>批量设置 {selectedKeys.length} 个节点</Button>}</section>
      <section className="archive-tree-content"><div className="archive-breadcrumb">{((selected?.path as Array<{ id: string; name: string }>) || [{ id: 'archive-root', name: '档案目录' }]).map((item: { id: string; name: string }, index: number, all: Array<{ id: string; name: string }>) => <span key={item.id}><Button type="link" size="small" onClick={() => void selectNode(item.id)}>{item.name}</Button>{index < all.length - 1 && ' / '}</span>)}</div><div className="table-toolbar"><div><Title level={4} style={{ margin: 0 }}>{selected?.name || '档案目录'}</Title><Text type="secondary">{selected?.node_type === 'root' ? '全局档案策略' : '节点范围内可见文档：' + documents.length + ' 个'}</Text></div><Space>{selected && selected.node_type !== 'root' && <><Button icon={<FileTextOutlined />} onClick={() => void openTemplate()}>预览模板</Button><Button icon={<DownloadOutlined />} onClick={() => void downloadTemplate()}>下载模板</Button>{canManage && <Button icon={<EditOutlined />} onClick={() => openEditor(selected)}>配置节点</Button>}</>}</Space></div>{selected && <Descriptions size="small" column={3} bordered style={{ marginBottom: 16 }}><Descriptions.Item label="归档周期">{selected.archive_period || '年度'}</Descriptions.Item><Descriptions.Item label="保留年限">{selected.retention_period || '长期'}</Descriptions.Item><Descriptions.Item label="权限模式">{selected.permission_mode === 'override' ? '覆盖父级' : '继承父级'}</Descriptions.Item><Descriptions.Item label="AI 策略">{selected.ai_enabled ? (selected.ai_priority_scope ? '优先检索本节点' : '允许使用') : '禁用'}</Descriptions.Item><Descriptions.Item label="操作权限">{(selected.allowed_actions || []).map((item) => <Tag key={item}>{actionLabels[item] || item}</Tag>)}</Descriptions.Item></Descriptions>}<Table<DocumentRecord> rowKey="id" loading={docsLoading} dataSource={documents} pagination={{ pageSize: 8 }} locale={{ emptyText: <Empty description="该节点暂无可见文档" /> }} columns={[{ title: '文档', dataIndex: 'title', render: (value: string, row) => <span><strong>{value}</strong><br /><Text type="secondary">{row.file_name || row.id}</Text></span> }, { title: '归档路径', dataIndex: 'archive_path', render: (value: string) => value || '-' }, { title: '归档状态', dataIndex: 'filing_status', render: (value: string) => <Tag color={value === 'filed' ? 'green' : value === 'pending' ? 'blue' : 'orange'}>{value === 'filed' ? '已归档' : value === 'pending' ? '待归档' : '未归档'}</Tag> }, { title: '知识库', dataIndex: 'knowledge_sync_status', render: (value: string) => <Tag color={value === 'synced' ? 'green' : 'default'}>{value === 'synced' ? '已同步' : '待处理'}</Tag> }]} /></section></div>
    <Drawer title={creating ? '新增目录节点' : '配置目录节点'} width={520} open={editorOpen} onClose={() => setEditorOpen(false)} extra={<Button type="primary" onClick={() => void saveNode()}>保存</Button>}><Form form={form} layout="vertical"><Form.Item name="name" label="节点名称" rules={[{ required: true }]}><Input /></Form.Item>{creating && <><Form.Item name="node_type" label="节点类型"><Select options={[{ value: 'organization', label: '组织节点' }, { value: 'category', label: '分类节点' }]} /></Form.Item><Form.Item noStyle shouldUpdate={(prev, next) => prev.node_type !== next.node_type}>{({ getFieldValue }) => getFieldValue('node_type') === 'organization' ? <Form.Item name="scope_id" label="绑定组织范围" rules={[{ required: true, message: '请选择组织范围' }]}><Select showSearch optionFilterProp="label" options={scopes.map((scope) => ({ value: scope.id, label: scope.name }))} /></Form.Item> : null}</Form.Item></>}<Space wrap><Form.Item name="archive_period" label="归档周期"><Select style={{ width: 150 }} options={['年度', '季度', '月度'].map((value) => ({ value }))} /></Form.Item><Form.Item name="retention_period" label="保留年限"><Select style={{ width: 150 }} options={['永久', '长期', '30年', '10年', '5年', '3年'].map((value) => ({ value }))} /></Form.Item></Space><Space wrap><Form.Item name="owner_role_id" label="负责人角色"><Select allowClear showSearch optionFilterProp="label" options={roles.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="reviewer_role_id" label="审核人角色"><Select allowClear showSearch optionFilterProp="label" options={roles.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Space><Form.Item name="required" label="必传节点" valuePropName="checked"><Switch /></Form.Item><Form.Item name="permission_mode" label="权限继承"><Select options={[{ value: 'inherit', label: '继承父节点' }, { value: 'override', label: '覆盖父节点' }]} /></Form.Item><Form.Item name="allowed_actions" label="节点操作权限"><Select mode="multiple" options={Object.entries(actionLabels).map(([value, label]) => ({ value, label }))} /></Form.Item><Form.Item name="user_ids" label="用户白名单"><Select mode="multiple" showSearch optionFilterProp="label" options={users.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="role_ids" label="角色白名单"><Select mode="multiple" showSearch optionFilterProp="label" options={roles.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="department_ids" label="部门白名单"><Select mode="multiple" showSearch optionFilterProp="label" options={scopes.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="deny_user_ids" label="用户黑名单"><Select mode="multiple" showSearch optionFilterProp="label" options={users.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="deny_role_ids" label="角色黑名单"><Select mode="multiple" showSearch optionFilterProp="label" options={roles.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="deny_department_ids" label="部门黑名单"><Select mode="multiple" showSearch optionFilterProp="label" options={scopes.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Alert type="info" showIcon message="权限规则" description="黑名单优先；未配置白名单时按节点组织范围继承。子节点可选择覆盖父节点。" /><Form.Item name="ai_enabled" label="启用 AI" valuePropName="checked"><Switch /></Form.Item><Form.Item name="ai_priority_scope" label="优先在本节点检索" valuePropName="checked"><Switch /></Form.Item><Form.Item name="ai_summary_template" label="AI 摘要模板"><Input.TextArea rows={4} /></Form.Item><Form.Item name="template_name" label="归档模板名称"><Input /></Form.Item><Form.Item name="template_content" label="归档模板内容"><Input.TextArea rows={5} /></Form.Item></Form></Drawer>
    <Modal title="模板预览" open={templateOpen} footer={<Button onClick={() => setTemplateOpen(false)}>关闭</Button>} onCancel={() => setTemplateOpen(false)}><Text strong>{template?.name}</Text><Paragraph style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{template?.content}</Paragraph></Modal><Modal title="批量设置节点规则" open={batchOpen} okText="应用" cancelText="取消" onOk={() => void batchUpdate()} onCancel={() => setBatchOpen(false)}><Form form={batchForm} layout="vertical"><Form.Item name="archive_period" label="归档周期"><Select allowClear options={['年度', '季度', '月度'].map((value) => ({ value }))} /></Form.Item><Form.Item name="retention_period" label="保留年限"><Select allowClear options={['永久', '长期', '30年', '10年', '5年', '3年'].map((value) => ({ value }))} /></Form.Item><Form.Item name="ai_enabled" label="AI 开关" valuePropName="checked"><Switch /></Form.Item><Form.Item name="ai_priority_scope" label="优先本节点检索" valuePropName="checked"><Switch /></Form.Item></Form></Modal><BackendLoginModal open={authOpen} onAuthenticated={() => { setAuthOpen(false); void loadRoot(); }} />
  </div>;
}
