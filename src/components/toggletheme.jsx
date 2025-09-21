import React from "react";
import { Button } from "antd";
import { HiOutlineSun, HiOutlineMoon } from "react-icons/hi";

const Toggle = ({ darkTheme, toggleTheme }) => {
  return (
    <div className="toggle-btn">
      <Button onClick={toggleTheme}>
        {darkTheme ? <HiOutlineSun /> : <HiOutlineMoon />}
      </Button>
    </div>
  );
};

export default Toggle;
