import { useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Empty, Progress, Space, Table, Tag, Typography, message } from 'antd';
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { erpApi, type CoverageRow } from '@/api/erp';
import BackendLoginModal from '@/components/BackendLoginModal';

const { Title, Text } = Typography;

function syncTag(value: unknown) {
  const status = String(value || 'missing');
  const color = status === 'synced' ? 'green' : status === 'failed' ? 'red' : status === 'pending' ? 'blue' : 'default';
  const labels: Record<string, string> = { synced: '已同步', failed: '同步失败', pending: '待同步', disabled: '未启用', missing: '无文档' };
  return <Tag className="compact-status-tag" color={color}>{labels[status] || '待确认'}</Tag>;
}

export default function ArchiveCoverage() {
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [selected, setSelected] = useState<CoverageRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [authOpen, setAuthOpen] = useState(!erpApi.hasSession());

  function fail(error: unknown, fallback: string) {
    const detail = error instanceof Error ? error.message : fallback;
    if (detail === 'ERP_AUTH_REQUIRED') setAuthOpen(true); else message.error(detail);
  }

  async function load() {
    setLoading(true);
    try { setRows(await erpApi.archiveCoverage()); } catch (error) { fail(error, '覆盖数据加载失败'); } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const summary = useMemo(() => ({
    scopes: rows.length,
    required: rows.reduce((sum, row) => sum + row.required_total, 0),
    missing: rows.reduce((sum, row) => sum + row.missing_total, 0),
    ready: rows.reduce((sum, row) => sum + row.ai_enabled_total, 0),
  }), [rows]);

  async function inspect(record: CoverageRow) {
    setSelected(record);
    setDetailLoading(true);
    try { setSelected(await erpApi.archiveCoverageDetail(record.scope_id)); } catch (error) { fail(error, '覆盖明细加载失败'); } finally { setDetailLoading(false); }
  }

  return (
    <div className="workspace-page">
      <div className="page-heading"><div><Title level={3}>覆盖看板</Title><Text type="secondary">核对各组织必传档案覆盖率与知识库准入状态</Text></div><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button></div>
      <div className="metric-strip archive-metric-strip"><div><span>组织范围</span><strong>{summary.scopes}</strong><small>已配置组织</small></div><div><span>必传目录项</span><strong>{summary.required}</strong><small>各组织合计</small></div><div><span>当前缺失</span><strong className={summary.missing ? 'metric-warning' : ''}>{summary.missing}</strong><small>需要补齐的材料</small></div><div><span>AI 就绪文档</span><strong>{summary.ready}</strong><small>可供智能问答</small></div></div>
      <section className="table-workspace">
        <div className="table-toolbar"><Text strong>组织覆盖情况</Text><Text type="secondary">点击组织查看目录项、匹配文档和阻断原因</Text></div>
        <Table<CoverageRow> rowKey="scope_id" loading={loading} dataSource={rows} pagination={false} locale={{ emptyText: <Empty description="暂无覆盖数据" /> }} columns={[
          { title: '组织', dataIndex: 'scope_name', width: 220, render: (value: string, row) => <button className="text-link approval-title" onClick={() => void inspect(row)}><strong>{value || row.scope_id}</strong><small>{row.scope_id}</small></button> },
          { title: '覆盖率', dataIndex: 'coverage_rate', width: 240, render: (value: number) => <Progress percent={Number(value || 0)} size="small" status={value < 60 ? 'exception' : 'normal'} /> },
          { title: '必传 / 已归档', key: 'filing', width: 140, render: (_: unknown, row) => `${row.required_total} / ${row.filed_total}` },
          { title: '缺失', dataIndex: 'missing_total', width: 90, render: (value: number) => <Tag color={value ? 'orange' : 'green'}>{value}</Tag> },
          { title: 'AI 就绪 / 阻断', key: 'ai', width: 150, render: (_: unknown, row) => `${row.ai_enabled_total} / ${row.ai_blocked_total}` },
          { title: '操作', width: 100, render: (_: unknown, row) => <Button type="text" icon={<EyeOutlined />} onClick={() => void inspect(row)}>明细</Button> },
        ]} />
      </section>
      <Drawer title={selected ? `${selected.scope_name}覆盖明细` : '覆盖明细'} width={760} open={Boolean(selected)} loading={detailLoading} onClose={() => setSelected(null)}>
        {selected && <Table rowKey={(row) => String(row.catalog_item_id || row.id)} dataSource={selected.items || []} scroll={{ x: 920 }} pagination={{ pageSize: 8 }} columns={[
          { title: '目录项', key: 'rule', width: 250, render: (_: unknown, row) => <span><strong>{String(row.document_name_rule || '-')}</strong><br /><Text type="secondary">{String(row.category || '-')} / {String(row.subcategory || '-')}</Text></span> },
          { title: '必传', dataIndex: 'required', width: 80, render: (value: boolean) => <Tag color={value ? 'red' : 'default'}>{value ? '是' : '否'}</Tag> },
          { title: '归档', dataIndex: 'missing', width: 90, render: (value: boolean) => <Tag color={value ? 'orange' : 'green'}>{value ? '缺失' : '已覆盖'}</Tag> },
          { title: 'AI 准入', dataIndex: 'ai_ready', width: 100, render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '就绪' : '阻断'}</Tag> },
          { title: '知识库', dataIndex: 'knowledge_sync_status', width: 100, render: syncTag },
          { title: '说明', dataIndex: 'ai_block_reason', width: 260, render: (value: unknown) => String(value || '-') },
        ]} />}
      </Drawer>
      <BackendLoginModal open={authOpen} onAuthenticated={() => { setAuthOpen(false); void load(); }} />
    </div>
  );
}
