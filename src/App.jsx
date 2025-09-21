// ===== src/App.jsx =====
import { Layout, Button, theme } from 'antd';
import { useState } from 'react';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import Logo from './components/logo';
import Menulist from './components/menulist';
import Toggle from './components/toggletheme';
import SummaryContainer from './components/summarycontainer';
import TasksContainer from './components/TasksContainer';
import MeetingsContainer from './components/MeetingsContainer';

const { Header, Sider, Content } = Layout;

function App() {
  const [darkTheme, setDarkTheme] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [currentView, setCurrentView] = useState('home'); // 'home', 'tasks', 'meetings'

  const toggleTheme = () => {
    setDarkTheme(!darkTheme);
  };

  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
  };

  const {
    token: { colorBgContainer }
  } = theme.useToken();

  const renderContent = () => {
    switch (currentView) {
      case 'tasks':
        return <TasksContainer />;
      case 'meetings':
        return <MeetingsContainer />;
      default:
        return <SummaryContainer />;
    }
  };

  return (
    <Layout>
      <Sider
        theme={darkTheme ? 'dark' : 'light'}
        className="sidebar"
        collapsible
        collapsed={collapsed}
        trigger={null}
      >
        <Logo darkTheme={darkTheme} />
        <Menulist 
          darkTheme={darkTheme} 
          currentView={currentView} 
          setCurrentView={setCurrentView} 
        />
        <Toggle darkTheme={darkTheme} toggleTheme={toggleTheme} />
      </Sider>

      <Layout>
        <Header style={{ padding: 0, background: colorBgContainer }}>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={toggleCollapsed}
            style={{ fontSize: '16px', width: 64, height: 64 }}
          />
        </Header>

        <Content
          style={{
            margin: '24px 16px',
            padding: 24,
            minHeight: 280,
            background: colorBgContainer
          }}
        >
          {renderContent()}
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;