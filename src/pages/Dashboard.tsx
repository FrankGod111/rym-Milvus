import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Empty, List, Progress, Space, Spin, Table, Tag, Typography } from 'antd';
import {
  ApartmentOutlined,
  ArrowRightOutlined,
  BarChartOutlined,
  BookOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  FileAddOutlined,
  FileTextOutlined,
  MessageOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { useAppStore } from '@/stores/app-store';
import { erpApi, type AssistantSession, type CoverageRow, type DocumentRecord } from '@/api/erp';
import BackendLoginModal from '@/components/BackendLoginModal';

const { Title, Text } = Typography;

const filingLabels: Record<string, string> = { filed: '已归档', pending: '待归档', unfiled: '未归档', void: '作废' };
const filingColors: Record<string, string> = { filed: 'green', pending: 'blue', unfiled: 'default', void: 'default' };

function dateValue(value?: string) {
  return value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
}

function documentStatus(document: DocumentRecord) {
  if (document.knowledge_sync_status === 'synced' || document.dify_document_id) return { label: '已同步', color: 'green' };
  if (document.parse_status === 'failed' || document.index_status === 'failed') return { label: '需处理', color: 'red' };
  if (document.parse_status === 'empty') return { label: '待解析', color: 'orange' };
  if (document.index_status === 'pending' || document.index_status === 'indexing') return { label: '索引中', color: 'blue' };
  return { label: '待同步', color: 'default' };
}

type WorkspaceData = {
  documents: DocumentRecord[];
  archiveDocuments: DocumentRecord[];
  coverage: CoverageRow[];
  sessions: AssistantSession[];
};

export default function Dashboard() {
  const navigate = useNavigate();
  const contracts = useAppStore((state) => state.contracts);
  const menuPermissions = useAppStore((state) => state.currentUser.menuPermissions);
  const [data, setData] = useState<WorkspaceData>({ documents: [], archiveDocuments: [], coverage: [], sessions: [] });
  const [loading, setLoading] = useState(false);
  const [authOpen, setAuthOpen] = useState(!erpApi.hasSession());
  const [loadError, setLoadError] = useState('');

  async function loadWorkspace() {
    if (!erpApi.hasSession()) { setAuthOpen(true); return; }
    setLoading(true);
    setLoadError('');
    const results = await Promise.allSettled([
      erpApi.listDocuments(),
      erpApi.archiveDocuments(),
      erpApi.archiveCoverage(),
      erpApi.assistantSessions(),
    ]);
    const [documents, archiveDocuments, coverage, sessions] = results;
    const failed = results.filter((result) => result.status === 'rejected').length;
    const requiresAuth = results.some((result) => result.status === 'rejected' && result.reason instanceof Error && result.reason.message === 'ERP_AUTH_REQUIRED');
    if (requiresAuth) setAuthOpen(true);
    if (failed === results.length) setLoadError('知识库、档案和智能助手数据暂时无法读取，请检查后端服务或登录状态。');
    setData({
      documents: documents.status === 'fulfilled' ? documents.value.documents || [] : [],
      archiveDocuments: archiveDocuments.status === 'fulfilled' ? archiveDocuments.value.documents || [] : [],
      coverage: coverage.status === 'fulfilled' ? coverage.value || [] : [],
      sessions: sessions.status === 'fulfilled' ? sessions.value || [] : [],
    });
    setLoading(false);
  }

  useEffect(() => { void loadWorkspace(); }, []);

  const contractStats = useMemo(() => {
    const now = dayjs();
    return {
      total: contracts.length,
      active: contracts.filter((contract) => contract.status === 'active').length,
      risk: contracts.filter((contract) => contract.status === 'risk').length,
      pending: contracts.filter((contract) => contract.status === 'pending').length,
      expiring: contracts.filter((contract) => { const expire = dayjs(contract.expireDate); return expire.isValid() && expire.isAfter(now) && expire.diff(now, 'day') <= 60; }).length,
    };
  }, [contracts]);

  const knowledgeStats = useMemo(() => ({
    total: data.documents.length,
    synced: data.documents.filter((document) => document.knowledge_sync_status === 'synced' || Boolean(document.dify_document_id)).length,
    attention: data.documents.filter((document) => {
      const parseStatus = String(document.parse_status || '');
      const indexStatus = String(document.index_status || '');
      return ['failed', 'pending', 'empty', 'indexing'].includes(parseStatus) || ['failed', 'pending', 'indexing'].includes(indexStatus);
    }).length,
  }), [data.documents]);

  const archiveStats = useMemo(() => {
    const filed = data.archiveDocuments.filter((document) => document.filing_status === 'filed').length;
    const coverage = data.coverage.length ? Math.round(data.coverage.reduce((sum, item) => sum + Number(item.coverage_rate || 0), 0) / data.coverage.length) : 0;
    return { total: data.archiveDocuments.length, filed, pending: data.archiveDocuments.length - filed, coverage };
  }, [data.archiveDocuments, data.coverage]);

  const recentContracts = useMemo(() => [...contracts].sort((a, b) => dayjs(b.updatedAt).valueOf() - dayjs(a.updatedAt).valueOf()).slice(0, 5), [contracts]);
  const recentDocuments = useMemo(() => [...data.documents].sort((a, b) => dayjs(String(b.updated_at || b.updatedAt || '')).valueOf() - dayjs(String(a.updated_at || a.updatedAt || '')).valueOf()).slice(0, 5), [data.documents]);
  const recentSessions = data.sessions.slice(0, 5);
  const canViewMissing = Object.keys(menuPermissions).length === 0 || Boolean(menuPermissions['archive-missing']);

  const quickActions = [
    { label: '智能问答', desc: '查询制度、合同与业务知识', icon: <MessageOutlined />, path: '/assistant', primary: true },
    { label: '新建合同', desc: '手动录入合同台账', icon: <FileAddOutlined />, path: '/contract' },
    { label: 'AI 提取录入', desc: '从文件识别合同字段', icon: <ThunderboltOutlined />, path: '/contract/upload' },
    { label: '上传知识文档', desc: '进入解析与 Dify 同步', icon: <CloudUploadOutlined />, path: '/knowledge/docs' },
    { label: '档案目录', desc: '按部门维护归档规则', icon: <ApartmentOutlined />, path: '/archive/catalog' },
    { label: '覆盖看板', desc: '检查各组织归档覆盖', icon: <BarChartOutlined />, path: '/archive/coverage' },
    { label: '合同评审', desc: '运行合规与风险检查', icon: <CheckCircleOutlined />, path: '/contract/review' },
    { label: '索引状态', desc: '查看解析、切分与索引任务', icon: <DatabaseOutlined />, path: '/knowledge/index-status' },
  ];

  return (
    <div className="workspace-page dashboard-page">
      <div className="dashboard-heading">
        <div><Text className="dashboard-eyebrow">企业运营中心</Text><Title level={2}>工作台</Title><Text type="secondary">合同、知识库、档案治理和智能助手的统一入口。</Text></div>
        <Space wrap><Text type="secondary">更新时间：{dayjs().format('YYYY-MM-DD HH:mm')}</Text><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadWorkspace()}>刷新数据</Button><Button icon={<SettingOutlined />} onClick={() => navigate('/settings')}>系统设置</Button></Space>
      </div>

      {loadError && <Alert type="warning" showIcon message="部分运营数据未加载" description={loadError} action={<Button size="small" onClick={() => void loadWorkspace()}>重试</Button>} style={{ marginBottom: 16 }} />}

      <section className="dashboard-quick-section">
        <div className="dashboard-section-heading"><div><Title level={4}>快捷入口</Title><Text type="secondary">从这里直接进入高频工作流。</Text></div></div>
        <div className="dashboard-quick-grid">{quickActions.map((action) => <button key={action.path} className={`dashboard-quick-action ${action.primary ? 'is-primary' : ''}`} onClick={() => navigate(action.path)}><span className="dashboard-quick-icon">{action.icon}</span><span><strong>{action.label}</strong><small>{action.desc}</small></span><ArrowRightOutlined className="dashboard-quick-arrow" /></button>)}</div>
      </section>

      <div className="dashboard-domain-grid">
        <section className="dashboard-domain-section">
          <div className="dashboard-section-heading"><div><Title level={4}><FileTextOutlined /> 合同管理</Title><Text type="secondary">合同生命周期和风险关注点。</Text></div><Button type="link" onClick={() => navigate('/contract')}>进入合同管理 <ArrowRightOutlined /></Button></div>
          <div className="dashboard-metric-row"><button onClick={() => navigate('/contract')}><span>合同总数</span><strong>{contractStats.total}</strong></button><button onClick={() => navigate('/contract')}><span>履约中</span><strong className="is-green">{contractStats.active}</strong></button><button onClick={() => navigate('/contract/risk')}><span>风险合同</span><strong className="is-red">{contractStats.risk}</strong></button><button onClick={() => navigate('/contract')}><span>60 天内到期</span><strong className="is-orange">{contractStats.expiring}</strong></button></div>
          <div className="dashboard-table-wrap"><Table dataSource={recentContracts} rowKey="id" size="small" pagination={false} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无合同数据" /> }} columns={[{ title: '合同', key: 'contract', render: (_: unknown, row) => <button className="text-link dashboard-record-link" onClick={() => navigate(`/contract/${row.id}`)}><strong>{row.code}</strong><small>{row.subject || row.partyA}</small></button> }, { title: '金额', dataIndex: 'amount', width: 120, render: (value: number) => `¥${Number(value || 0).toLocaleString()}` }, { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <Tag color={value === 'risk' ? 'red' : value === 'active' ? 'green' : 'blue'}>{value === 'risk' ? '风险' : value === 'active' ? '履约中' : value === 'pending' ? '待处理' : '已完成'}</Tag> }]} /></div>
        </section>

        <section className="dashboard-domain-section">
          <div className="dashboard-section-heading"><div><Title level={4}><BookOutlined /> 知识库与档案</Title><Text type="secondary">文档处理状态和组织归档覆盖。</Text></div><Button type="link" onClick={() => navigate('/knowledge/docs')}>进入文档库 <ArrowRightOutlined /></Button></div>
          <div className="dashboard-metric-row"><button onClick={() => navigate('/knowledge/docs')}><span>知识文档</span><strong>{knowledgeStats.total}</strong></button><button onClick={() => navigate('/knowledge/docs')}><span>已同步 Dify</span><strong className="is-green">{knowledgeStats.synced}</strong></button><button onClick={() => navigate('/knowledge/index-status')}><span>待处理</span><strong className="is-orange">{knowledgeStats.attention}</strong></button><button onClick={() => navigate('/archive/library')}><span>已归档</span><strong>{archiveStats.filed}</strong></button></div>
          <div className="dashboard-coverage-line"><div><Text strong>档案覆盖率</Text><Text type="secondary">{archiveStats.total ? `已归档 ${archiveStats.filed} / ${archiveStats.total} 件` : '暂无档案数据'}</Text></div><Progress percent={archiveStats.coverage} size="small" status={archiveStats.coverage < 60 ? 'exception' : 'normal'} /></div>
          <List size="small" dataSource={recentDocuments} locale={{ emptyText: '暂无知识文档' }} renderItem={(document) => { const status = documentStatus(document); const department = String(document.department_name || document.category || '未分类'); return <List.Item><List.Item.Meta title={<Text ellipsis={{ tooltip: document.title }}>{document.title}</Text>} description={<Text type="secondary">{department} · {dateValue(String(document.updated_at || document.updatedAt))}</Text>} /><Tag color={status.color}>{status.label}</Tag></List.Item>; }} />
        </section>

        <section className="dashboard-domain-section">
          <div className="dashboard-section-heading"><div><Title level={4}><MessageOutlined /> 智能问答</Title><Text type="secondary">历史会话和知识服务入口。</Text></div><Button type="link" onClick={() => navigate('/assistant')}>打开智能问答 <ArrowRightOutlined /></Button></div>
          <div className="dashboard-metric-row"><button onClick={() => navigate('/assistant')}><span>历史会话</span><strong>{data.sessions.length}</strong></button><button onClick={() => navigate('/knowledge/docs')}><span>知识文档</span><strong>{data.documents.length}</strong></button>{canViewMissing && <button onClick={() => navigate('/archive/missing')}><span>档案缺失项</span><strong className="is-orange">{data.coverage.reduce((sum, item) => sum + Number(item.missing_total || 0), 0)}</strong></button>}<button onClick={() => navigate('/archive/library')}><span>已归档</span><strong>{archiveStats.filed}</strong></button></div>
          <List size="small" dataSource={recentSessions} locale={{ emptyText: '暂无历史会话' }} renderItem={(session) => <List.Item><List.Item.Meta title={<Text ellipsis={{ tooltip: session.title }}>{session.title || '未命名会话'}</Text>} description={<Text type="secondary">{session.summary || '已保存问答结果'} · {dateValue(session.updatedAt || session.updated_at)}</Text>} /></List.Item>} />
        </section>
      </div>
      <BackendLoginModal open={authOpen} onAuthenticated={() => { setAuthOpen(false); void loadWorkspace(); }} />
      {loading && !data.documents.length && !data.sessions.length && <div className="dashboard-loading"><Spin size="small" /> 正在读取运营数据…</div>}
    </div>
  );
}
