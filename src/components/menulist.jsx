import { Menu } from 'antd';
import { HomeOutlined, CheckSquareOutlined, TeamOutlined } from '@ant-design/icons';

const Menulist = ({ darkTheme, currentView, setCurrentView }) => {
  const menuItems = [
    {
      key: 'home',
      icon: <HomeOutlined />,
      label: 'Home'
    },
    {
      key: 'tasks',
      icon: <CheckSquareOutlined />,
      label: 'My Tasks'
    },
    {
      key: 'meetings',
      icon: <TeamOutlined />,
      label: 'My Meetings'
    }
  ];

  return (
    <Menu
      theme={darkTheme ? 'dark' : 'light'}
      mode="inline"
      className="menu-bar"
      selectedKeys={[currentView]}
      onClick={({ key }) => setCurrentView(key)}
      items={menuItems}
    />
  );
};

export default Menulist;