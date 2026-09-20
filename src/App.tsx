import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { App as AntdApp } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  CodeOutlined,
  BookOutlined,
  FolderOpenOutlined,
  ApartmentOutlined,
  CloudUploadOutlined,
  BarChartOutlined,
  BellOutlined,
  DatabaseOutlined,
  MessageOutlined,
  SettingOutlined,
  WarningOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import AppLayout from './layouts/AppLayout';
import { useAppStore } from '@/stores/app-store';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const ContractList = lazy(() => import('./pages/contracts/ContractList'));
const ContractDetail = lazy(() => import('./pages/contracts/ContractDetail'));
const ContractUploadWizard = lazy(() => import('./pages/contracts/ContractUploadWizard'));
const ContractReview = lazy(() => import('./pages/contracts/ContractReview'));
const RiskAlertPanel = lazy(() => import('./pages/contracts/RiskAlertPanel'));
const Ledger = lazy(() => import('./pages/contracts/Ledger'));
const CodeScan = lazy(() => import('./pages/dev-mgmt/CodeScan'));
const DevTestMgmt = lazy(() => import('./pages/dev-mgmt/DevTestMgmt'));
const KnowledgeDocs = lazy(() => import('./pages/knowledge/KnowledgeDocs'));
const ArchiveLibrary = lazy(() => import('./pages/archive/ArchiveLibrary'));
const ArchiveCatalog = lazy(() => import('./pages/archive/ArchiveCatalog'));
const ArchiveUpload = lazy(() => import('./pages/archive/ArchiveUpload'));
const ArchiveCoverage = lazy(() => import('./pages/archive/ArchiveCoverage'));
const ArchiveMissing = lazy(() => import('./pages/archive/ArchiveMissing'));
const IndexStatus = lazy(() => import('./pages/archive/IndexStatus'));
const KnowledgeAssistant = lazy(() => import('./pages_v2/ChatV2'));
const Settings = lazy(() => import('./pages/Settings'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const AppV2 = lazy(() => import('./pages_v2/AppV2'));

function Loading() {
  return (
    <div style={{ textAlign: 'center', padding: 80, color: '#999' }}>
      <div style={{ fontSize: 24, marginBottom: 12 }}>加载中…</div>
    </div>
  );
}

const App = () => {
  const loadContracts = useAppStore((state) => state.loadContracts);
  const contractsLoaded = useAppStore((state) => state.contractsLoaded);
  const location = useLocation();
  const isV2 = location.pathname.startsWith('/v2');
  const setErpUser = useAppStore((state) => state.setErpUser);
  const menuPermissions = useAppStore((state) => state.currentUser.menuPermissions);
  const authenticated = useAppStore((state) => state.authenticated);
  const setAuthenticated = useAppStore((state) => state.setAuthenticated);

  useEffect(() => {
    if (!contractsLoaded) {
      void loadContracts().catch(() => undefined);
    }
  }, [contractsLoaded, loadContracts]);

  useEffect(() => {
    if (isV2 || !sessionStorage.getItem('rym-erp-access-token')) return;
    void import('./api/erp').then(({ erpApi }) => erpApi.accessContext().then((context) => setErpUser(context.user, context.permissions, context.menu_permissions)).catch(() => { erpApi.logout(); setAuthenticated(false); }));
  }, [isV2, setErpUser, setAuthenticated]);

  if (!isV2 && !authenticated) {
    return <AntdApp><Suspense fallback={<Loading />}><LoginPage /></Suspense></AntdApp>;
  }

  if (isV2) {
    return (
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/v2/*" element={<AppV2 />} />
        </Routes>
      </Suspense>
    );
  }

  const allMenuItems: MenuProps['items'] = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '工作台' },
    { key: '/assistant', icon: <MessageOutlined />, label: '智能问答' },
    {
      key: 'contract-group',
      icon: <FileTextOutlined />,
      label: '合同管理',
      children: [
        { key: '/contract', label: '合同列表' },
        { key: '/contract/upload', label: 'AI 提取录入' },
        { key: '/contract/review', label: '合同评审' },
        { key: '/contract/risk', icon: <WarningOutlined />, label: '风险提醒' },
        { key: '/contract/ledger', label: '台账管理' },
      ],
    },
    {
      key: '/dev-mgmt',
      icon: <CodeOutlined />,
      label: '开发管理',
      children: [
        { key: '/dev-mgmt/scan', label: '代码扫描', icon: <ThunderboltOutlined /> },
        { key: '/dev-mgmt/test', label: '测试管理' },
      ],
    },
    {
      key: '/knowledge',
      icon: <BookOutlined />,
      label: '知识库',
      children: [
        { key: '/knowledge/docs', icon: <FileTextOutlined />, label: '文档库' },
        { key: '/knowledge/index-status', icon: <DatabaseOutlined />, label: '知识库索引状态' },
      ],
    },
    {
      key: '/archive',
      icon: <FolderOpenOutlined />,
      label: '档案治理',
      children: [
        { key: '/archive/library', icon: <FolderOpenOutlined />, label: '档案库' },
        { key: '/archive/catalog', icon: <ApartmentOutlined />, label: '档案目录' },
        { key: '/archive/upload', icon: <CloudUploadOutlined />, label: '文档上传' },
        { key: '/archive/coverage', icon: <BarChartOutlined />, label: '覆盖看板' },
        { key: '/archive/missing', icon: <BellOutlined />, label: '缺失提醒' },
      ],
    },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
  ];
  const allow = (key: string) => Object.keys(menuPermissions).length === 0 || Boolean(menuPermissions[key]);
  const menuItems: MenuProps['items'] = allMenuItems.filter((item: any) => {
    if (item.key === '/settings') return allow('settings');
    if (item.key === '/dev-mgmt') return allow('dev-mgmt');
    if (item.key === '/assistant') return allow('assistant');
    if (item.key === '/knowledge') return allow('knowledge');
    if (item.key === '/archive') return allow('archive');
    if (item.key === 'contract-group') return allow('contracts');
    return true;
  }).map((item: any) => {
    if (!item.children) return item;
    const children = item.children.filter((child: any) => {
      if (child.key === '/knowledge/index-status') return allow('knowledge-index');
      if (child.key === '/archive/upload') return allow('archive-write');
      if (child.key === '/archive/catalog') return allow('archive-catalog');
      if (child.key === '/archive/coverage') return allow('archive-coverage');
      if (child.key === '/archive/missing') return allow('archive-missing');
      return true;
    });
    return children.length ? { ...item, children } : null;
  }).filter(Boolean) as MenuProps['items'];

  return (
    <AntdApp>
      <AppLayout menuItems={menuItems}>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/assistant" element={<KnowledgeAssistant />} />
            <Route path="/contract" element={<ContractList />} />
            <Route path="/contract/upload" element={<ContractUploadWizard />} />
            <Route path="/contract/:id" element={<ContractDetail />} />
            <Route path="/contract/review" element={<ContractReview />} />
            <Route path="/contract/risk" element={<RiskAlertPanel />} />
            <Route path="/contract/ledger" element={<Ledger />} />
            <Route path="/dev-mgmt/scan" element={<CodeScan />} />
            <Route path="/dev-mgmt/test" element={<DevTestMgmt />} />
            <Route path="/knowledge/docs" element={<KnowledgeDocs />} />
            <Route path="/knowledge/index-status" element={<IndexStatus />} />
            <Route path="/archive/library" element={<ArchiveLibrary />} />
            <Route path="/archive/catalog" element={<ArchiveCatalog />} />
            <Route path="/archive/upload" element={<ArchiveUpload />} />
            <Route path="/archive/coverage" element={<ArchiveCoverage />} />
            <Route path="/archive/missing" element={<ArchiveMissing />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </AppLayout>
    </AntdApp>
  );
};

export default App;
