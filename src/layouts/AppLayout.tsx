import { useState, type ReactNode } from 'react';
import { Layout, Menu, Button, Dropdown, Badge } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  CodeOutlined,
  BookOutlined,
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '@/stores/app-store';
import { erpApi } from '@/api/erp';

const { Header, Sider, Content } = Layout;

export default function AppLayout({ children, menuItems }: { children?: ReactNode; menuItems?: MenuProps['items'] }) {
  const [collapsed, setCollapsed] = useState(false);
  const { currentUser, notifications, logout } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const defaultOpenKeys = location.pathname.startsWith('/contract')
    ? ['contract-group']
    : location.pathname.startsWith('/dev-mgmt')
      ? ['/dev-mgmt']
      : location.pathname.startsWith('/archive')
        ? ['/archive']
          : location.pathname.startsWith('/knowledge')
          ? ['/knowledge']
          : [];

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    navigate(key);
  };

  const userMenuItems: MenuProps['items'] = [
    { key: 'profile', label: '个人信息', icon: <UserOutlined /> },
    { type: 'divider' },
    { key: 'logout', label: '退出登录', icon: <LogoutOutlined />, danger: true },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        className="app-shell-sider"
        trigger={null}
        collapsible
        collapsed={collapsed}
        style={{
          background: '#001529',
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 10,
        }}
      >
        <div className="logo">
          {!collapsed ? (
            <>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: '#1a73e8', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 16 }}>月</div>
              <span>月明智能管理平台</span>
            </>
          ) : (
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#1a73e8', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 16 }}>月</div>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={defaultOpenKeys}
          onClick={handleMenuClick}
          style={{ paddingRight: 8 }}
          items={menuItems || [
            { key: '/dashboard', icon: <DashboardOutlined />, label: '工作台' },
            { key: '/contract', icon: <FileTextOutlined />, label: '合同管理' },
            { key: '/contract/upload', icon: <FileTextOutlined />, label: 'AI 提取录入' },
            { key: '/contract/review', icon: <FileTextOutlined />, label: '合同评审' },
            { key: '/contract/risk', icon: <FileTextOutlined />, label: '风险提醒' },
            { key: '/contract/ledger', icon: <FileTextOutlined />, label: '台账管理' },
            { key: '/dev-mgmt/scan', icon: <CodeOutlined />, label: '代码扫描' },
            { key: '/dev-mgmt/test', icon: <CodeOutlined />, label: '测试管理' },
            { key: '/knowledge/docs', icon: <BookOutlined />, label: '知识库' },
            { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
          ]}
        />
      </Sider>
      <Layout className={`app-shell-main ${collapsed ? 'is-collapsed' : ''}`}>
        <Header className="app-shell-header" style={{ padding: '0 24px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 4px rgba(0,21,41,0.08)', position: 'sticky', top: 0, zIndex: 9 }}>
          <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} style={{ fontSize: 16, width: 48, height: 48 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Badge count={notifications.length} size="small">
              <Button type="text" shape="circle" icon={<UserOutlined />} />
            </Badge>
            <Dropdown menu={{ items: userMenuItems, onClick: ({ key }) => { if (key === 'logout') { erpApi.logout(); logout(); navigate('/dashboard'); } } }}>
              <Button type="text" style={{ fontWeight: 500 }}>
                {currentUser.name} · {currentUser.erp?.department_name || '未设置部门'}
              </Button>
            </Dropdown>
          </div>
        </Header>
        <Content className="app-shell-content" style={{ margin: '16px 16px 0', minHeight: 'calc(100vh - 112px)' }}>
          {children || <Outlet />}
        </Content>
      </Layout>
    </Layout>
  );
}
