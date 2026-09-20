import { useEffect, useState } from 'react';
import { Button, Empty, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import { DownloadOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { erpApi, type ArchiveCatalogItem } from '@/api/erp';
import BackendLoginModal from '@/components/BackendLoginModal';
import { useAppStore } from '@/stores/app-store';

const { Title, Text } = Typography;

export default function ArchiveMissing() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ArchiveCatalogItem[]>([]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [period, setPeriod] = useState('');
  const [loading, setLoading] = useState(false);
  const [authOpen, setAuthOpen] = useState(!erpApi.hasSession());
  const menuPermissions = useAppStore((state) => state.currentUser.menuPermissions);
  const canViewMissing = Object.keys(menuPermissions).length === 0 || Boolean(menuPermissions['archive-missing']);

  function query() {
    const params = new URLSearchParams();
    if (year.trim()) params.set('filing_year', year.trim());
    if (period) params.set('filing_period', period);
    return params.toString();
  }

  function fail(error: unknown, fallback: string) {
    const detail = error instanceof Error ? error.message : fallback;
    if (detail === 'ERP_AUTH_REQUIRED') setAuthOpen(true); else message.error(detail);
  }

  async function load() {
    setLoading(true);
    try { setRows((await erpApi.archiveMissing(query())).items || []); } catch (error) { fail(error, '缺失项加载失败'); } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  if (!canViewMissing) {
    return <Empty description="当前账号无档案缺失提醒权限" style={{ padding: 80 }} />;
  }

  function upload(row: ArchiveCatalogItem) {
    const params = new URLSearchParams({
      title: String(row.document_name_rule || ''),
      scope_id: String(row.scope_id || ''),
      category: String(row.category || ''),
      filing_year: String(row.filing_year || year),
      filing_period: String(row.filing_period || period || '年度'),
    });
    navigate(`/archive/upload?${params.toString()}`);
  }

  async function exportCsv() {
    try {
      const csv = await erpApi.exportArchiveMissing(query());
      const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `档案缺失清单-${year || '全部'}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { fail(error, '缺失清单导出失败'); }
  }

  return (
    <div className="workspace-page">
      <div className="page-heading"><div><Title level={3}>缺失提醒</Title><Text type="secondary">定位各组织未完成的必传目录项，并直接发起补传</Text></div><Space><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button><Button icon={<DownloadOutlined />} onClick={() => void exportCsv()}>导出 CSV</Button></Space></div>
      <section className="table-workspace">
        <div className="table-toolbar archive-filter-bar"><Input value={year} onChange={(event) => setYear(event.target.value)} placeholder="归档年度" /><Select allowClear value={period || undefined} onChange={(value) => setPeriod(value || '')} placeholder="归档周期" options={[{ value: '年度' }, { value: '季度' }, { value: '月度' }]} /><Button type="primary" onClick={() => void load()}>查询</Button><Text type="secondary">当前 {rows.length} 项待补齐</Text></div>
        <Table<ArchiveCatalogItem> rowKey={(row) => String(row.catalog_item_id || row.id)} loading={loading} dataSource={rows} scroll={{ x: 1050 }} locale={{ emptyText: <Empty description="当前筛选范围内没有缺失项" /> }} pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 项` }} columns={[
          { title: '组织', key: 'scope', width: 180, render: (_: unknown, row) => <span><strong>{String(row.scope_name || '-')}</strong><br /><Text type="secondary">{String(row.scope_id || '-')}</Text></span> },
          { title: '缺失材料', dataIndex: 'document_name_rule', width: 280, render: (value: unknown) => <strong>{String(value || '-')}</strong> },
          { title: '分类', key: 'category', width: 160, render: (_: unknown, row) => `${String(row.category || '-')} / ${String(row.subcategory || '-')}` },
          { title: '年度 / 周期', key: 'period', width: 130, render: (_: unknown, row) => `${String(row.filing_year || year || '-')} / ${String(row.filing_period || '-')}` },
          { title: '责任角色', dataIndex: 'owner_role', width: 140, render: (value: unknown) => String(value || '待分配') },
          { title: '状态', width: 90, render: () => <Tag color="orange">待补传</Tag> },
          { title: '操作', fixed: 'right' as const, width: 110, render: (_: unknown, row) => <Button type="link" icon={<UploadOutlined />} onClick={() => upload(row)}>补传</Button> },
        ]} />
      </section>
      <BackendLoginModal open={authOpen} onAuthenticated={() => { setAuthOpen(false); void load(); }} />
    </div>
  );
}
