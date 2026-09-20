import { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { erpApi, type DocumentRecord } from '@/api/erp';
import BackendLoginModal from '@/components/BackendLoginModal';

const { Title, Text } = Typography;
type IndexJob = { id: string; document_id: string; document_title?: string; status?: string; chunk_count?: number; message?: string; created_at?: string };
type IndexPayload = { summary?: Record<string, number>; jobs?: IndexJob[] };

function statusTag(value: unknown) {
  const status = String(value || 'pending');
  const color = status === 'completed' ? 'green' : status === 'failed' ? 'red' : status === 'running' ? 'blue' : 'gold';
  const labels: Record<string, string> = { completed: '已完成', failed: '失败', running: '处理中', pending: '待处理', skipped: '已跳过' };
  return <Tag color={color}>{labels[status] || status}</Tag>;
}

function isDifyManaged(record: DocumentRecord) {
  return record.knowledge_source_type === 'dify' || record.source_type === 'dify' || (Boolean(record.dify_document_id) && !record.content_text && record.knowledge_sync_status === 'synced');
}

export default function IndexStatus() {
  const [payload, setPayload] = useState<IndexPayload>({});
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<React.Key[]>([]);
  const [loading, setLoading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [authOpen, setAuthOpen] = useState(!erpApi.hasSession());

  function fail(error: unknown, fallback: string) {
    const detail = error instanceof Error ? error.message : fallback;
    if (detail === 'ERP_AUTH_REQUIRED') setAuthOpen(true); else message.error(detail);
  }

  async function load() {
    setLoading(true);
    try {
      const [status, docs] = await Promise.all([erpApi.indexStatus(), erpApi.listDocuments()]);
      setPayload(status as IndexPayload);
      setDocuments(docs.documents || []);
    } catch (error) { fail(error, '索引状态加载失败'); } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const summary = payload.summary || {};
  const latestJobs = useMemo(() => {
    const map = new Map<string, IndexJob>();
    for (const job of payload.jobs || []) if (!map.has(job.document_id)) map.set(job.document_id, job);
    return map;
  }, [payload.jobs]);

  async function reindex() {
    if (!selectedIds.length) { message.warning('请先选择需要重建索引的文档'); return; }
    setReindexing(true);
    try {
      const result = await erpApi.reindexDocuments(selectedIds.map(String));
      message.success(`已提交 ${Number(result.affected || selectedIds.length)} 个索引任务`);
      setSelectedIds([]);
      await load();
    } catch (error) { fail(error, '重建索引失败'); } finally { setReindexing(false); }
  }

  return (
    <div className="workspace-page">
      <div className="page-heading"><div><Title level={3}>知识库索引状态</Title><Text type="secondary">查看文档切分任务、chunk 数量和本地/Dify 索引处理结果</Text></div><Space><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button><Button type="primary" icon={<SyncOutlined spin={reindexing} />} loading={reindexing} disabled={!selectedIds.length} onClick={() => void reindex()}>重建索引 ({selectedIds.length})</Button></Space></div>
      <div className="metric-strip"><div><span>待处理</span><strong>{summary.pending || 0}</strong></div><div><span>处理中</span><strong>{summary.running || 0}</strong></div><div><span>已完成</span><strong>{summary.completed || 0}</strong></div><div><span>失败 / 跳过</span><strong className={summary.failed ? 'metric-warning' : ''}>{(summary.failed || 0) + (summary.skipped || 0)}</strong></div></div>
      <section className="table-workspace">
        <div className="table-toolbar"><Text strong>文档索引任务</Text><Text type="secondary">选中文档后可批量重建索引</Text></div>
        <Table<DocumentRecord> rowKey="id" loading={loading} dataSource={documents} scroll={{ x: 1050 }} rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds, getCheckboxProps: (row) => ({ disabled: isDifyManaged(row) }) }} locale={{ emptyText: <Empty description="暂无文档索引数据" /> }} pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 个文档` }} columns={[
          { title: '文档', key: 'title', width: 280, render: (_: unknown, row) => <span><strong>{row.title}</strong><br /><Text type="secondary">{row.file_name || row.id}</Text></span> },
          { title: '当前状态', dataIndex: 'index_status', width: 140, render: (value: unknown, row: DocumentRecord) => isDifyManaged(row) ? <Tag color="green">由 Dify 管理</Tag> : statusTag(value) },
          { title: '知识库同步', dataIndex: 'knowledge_sync_status', width: 120, render: (value: unknown) => { const status = String(value || 'disabled'); const labels: Record<string, string> = { synced: '已同步', failed: '同步失败', pending: '待同步', disabled: '未启用' }; return <Tag className="compact-status-tag" color={status === 'synced' ? 'green' : status === 'failed' ? 'red' : 'default'}>{labels[status] || '待确认'}</Tag>; } },
          { title: '最近 chunk', key: 'chunks', width: 110, render: (_: unknown, row) => latestJobs.get(row.id)?.chunk_count ?? '-' },
          { title: '最近任务', key: 'job', width: 180, render: (_: unknown, row) => { const job = latestJobs.get(row.id); return job?.created_at ? dayjs(job.created_at).format('YYYY-MM-DD HH:mm') : '-'; } },
          { title: '处理消息', key: 'message', width: 360, render: (_: unknown, row) => isDifyManaged(row) ? '该文件由 Dify 管理，本地索引无需执行' : latestJobs.get(row.id)?.message || '尚未生成索引任务' },
        ]} />
      </section>
      <BackendLoginModal open={authOpen} onAuthenticated={() => { setAuthOpen(false); void load(); }} />
    </div>
  );
}
