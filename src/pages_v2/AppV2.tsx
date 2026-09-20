import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { App as AntdApp, Layout, Menu, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  AuditOutlined,
  SettingOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import { useAppStore } from '@/stores/app-store';

const HomeV2 = lazy(() => import('./HomeV2'));
const IntakeV2 = lazy(() => import('./contracts/IntakeV2'));
const ReviewV2 = lazy(() => import('./contracts/ReviewV2'));
const ChatV2 = lazy(() => import('./ChatV2'));
const SettingsV2 = lazy(() => import('./SettingsV2'));

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

function Loading() {
  return (
    <div style={{ padding: 80, textAlign: 'center', color: '#888' }}>加载中…</div>
  );
}

const menuItems: MenuProps['items'] = [
  { key: '/v2/home', icon: <DashboardOutlined />, label: '合同工作台' },
  { key: '/v2/intake', icon: <FileTextOutlined />, label: 'AI 智能录入' },
  { key: '/v2/review', icon: <AuditOutlined />, label: '合同评审' },
  { key: '/v2/chat', icon: <MessageOutlined />, label: '智能问答' },
  { key: '/v2/settings', icon: <SettingOutlined />, label: '系统配置' },
];

const AppV2 = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const loadContracts = useAppStore((state) => state.loadContracts);
  const contractsLoaded = useAppStore((state) => state.contractsLoaded);

  useEffect(() => {
    if (!contractsLoaded) {
      void loadContracts().catch(() => undefined);
    }
  }, [contractsLoaded, loadContracts]);

  return (
    <AntdApp>
      <Layout style={{ minHeight: '100vh' }}>
        <Sider
          className="v2-sider"
          width={220}
          style={{ background: '#0f172a' }}
        >
          <div style={{ padding: 20, color: '#fff' }}>
            <Title level={5} style={{ color: '#fff', margin: 0 }}>合同智审</Title>
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[location.pathname]}
            onClick={({ key }) => navigate(String(key))}
            items={menuItems}
            style={{ background: '#0f172a' }}
          />
        </Sider>
        <Layout className="v2-main-layout">
          <Header className="v2-header" style={{ background: '#fff', padding: '0 24px', borderBottom: '1px solid #eef1f6' }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>合同智能评审工作台</span>
          </Header>
          <Content className="v2-content" style={{ margin: 16 }}>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="home" element={<HomeV2 />} />
                <Route path="intake" element={<IntakeV2 />} />
                <Route path="review" element={<ReviewV2 />} />
                <Route path="chat" element={<ChatV2 />} />
                <Route path="settings" element={<SettingsV2 />} />
                <Route path="*" element={<Navigate to="home" replace />} />
              </Routes>
            </Suspense>
          </Content>
        </Layout>
      </Layout>
    </AntdApp>
  );
};

export default AppV2;
