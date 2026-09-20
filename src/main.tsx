import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import './index.css';

dayjs.locale('zh-cn');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1a73e8', borderRadius: 6, fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif' } }}>
        <App />
      </ConfigProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
