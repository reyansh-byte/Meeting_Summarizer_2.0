import { VideoCameraAddOutlined } from '@ant-design/icons';

const Logo = ({ darkTheme }) => {
  return (
    <div className="logo">
      <div
        className="logo-icon"
        style={{
          color: darkTheme ? 'white' : 'black',
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
        }}
      >
        <VideoCameraAddOutlined />
      </div>
    </div>
  );
};

export default Logo;