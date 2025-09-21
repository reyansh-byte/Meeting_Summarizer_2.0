import React, { useState, useEffect } from 'react';
import { Card, List, Button, Tag, message, Popconfirm, Select, Input, Modal, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, UserOutlined, CheckOutlined } from '@ant-design/icons';

const { Option } = Select;
const { Text } = Typography;

const TasksContainer = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:5000/tasks');
      const data = await response.json();
      setTasks(data);
    } catch (error) {
      message.error('Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const updateTaskStatus = async (taskId, status) => {
    try {
      const response = await fetch(`http://localhost:5000/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      
      if (response.ok) {
        message.success('Task updated successfully');
        fetchTasks();
      } else {
        message.error('Failed to update task');
      }
    } catch (error) {
      message.error('Network error');
    }
  };

  const deleteTask = async (taskId) => {
    try {
      const response = await fetch(`http://localhost:5000/tasks/${taskId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        message.success('Task deleted successfully');
        fetchTasks();
      } else {
        message.error('Failed to delete task');
      }
    } catch (error) {
      message.error('Network error');
    }
  };

  const handleEditTask = (task) => {
    setEditingTask(task);
    setModalVisible(true);
  };

  const handleSaveEdit = async () => {
    try {
      const response = await fetch(`http://localhost:5000/tasks/${editingTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignedTo: editingTask.assignedTo,
          status: editingTask.status
        })
      });
      
      if (response.ok) {
        message.success('Task updated successfully');
        setModalVisible(false);
        setEditingTask(null);
        fetchTasks();
      } else {
        message.error('Failed to update task');
      }
    } catch (error) {
      message.error('Network error');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'orange';
      case 'completed': return 'green';
      case 'in-progress': return 'blue';
      default: return 'default';
    }
  };

  const pendingTasks = tasks.filter(task => task.status === 'pending');
  const inProgressTasks = tasks.filter(task => task.status === 'in-progress');
  const completedTasks = tasks.filter(task => task.status === 'completed');

  const TaskList = ({ tasks, title, status }) => (
    <Card title={`${title} (${tasks.length})`} style={{ marginBottom: '16px' }}>
      <List
        dataSource={tasks}
        loading={loading}
        renderItem={(task) => (
          <List.Item
            actions={[
              <Button 
                icon={<CheckOutlined />} 
                size="small" 
                onClick={() => updateTaskStatus(task.id, status === 'completed' ? 'pending' : 'completed')}
              >
                {status === 'completed' ? 'Reopen' : 'Complete'}
              </Button>,
              <Button 
                icon={<EditOutlined />} 
                size="small" 
                onClick={() => handleEditTask(task)}
              />,
              <Popconfirm
                title="Are you sure you want to delete this task?"
                onConfirm={() => deleteTask(task.id)}
                okText="Yes"
                cancelText="No"
              >
                <Button icon={<DeleteOutlined />} size="small" danger />
              </Popconfirm>
            ]}
          >
            <List.Item.Meta
              title={
                <div>
                  <Text>{task.text}</Text>
                  <div style={{ marginTop: '4px' }}>
                    <Tag color={getStatusColor(task.status)}>{task.status}</Tag>
                    {task.assignedTo && (
                      <Tag icon={<UserOutlined />} color="blue">
                        {task.assignedTo}
                      </Tag>
                    )}
                  </div>
                </div>
              }
              description={
                <div>
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    Created: {new Date(task.createdAt).toLocaleDateString()}
                  </Text>
                  {task.meetingId && (
                    <Text type="secondary" style={{ fontSize: '12px', marginLeft: '12px' }}>
                      From Meeting #{task.meetingId}
                    </Text>
                  )}
                </div>
              }
            />
          </List.Item>
        )}
      />
    </Card>
  );

  return (
    <div>
      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between' }}>
        <h2>My Tasks</h2>
        <Button type="primary" onClick={fetchTasks}>
          Refresh
        </Button>
      </div>

      <TaskList tasks={pendingTasks} title="Pending Tasks" status="pending" />
      <TaskList tasks={inProgressTasks} title="In Progress" status="in-progress" />
      <TaskList tasks={completedTasks} title="Completed Tasks" status="completed" />

      <Modal
        title="Edit Task"
        visible={modalVisible}
        onOk={handleSaveEdit}
        onCancel={() => {
          setModalVisible(false);
          setEditingTask(null);
        }}
      >
        {editingTask && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <Text strong>Task:</Text>
              <div>{editingTask.text}</div>
            </div>
            
            <div style={{ marginBottom: '16px' }}>
              <Text strong>Assigned To:</Text>
              <Input
                value={editingTask.assignedTo || ''}
                onChange={(e) => setEditingTask({...editingTask, assignedTo: e.target.value})}
                placeholder="Enter person's name"
                style={{ marginTop: '4px' }}
              />
            </div>
            
            <div>
              <Text strong>Status:</Text>
              <Select
                value={editingTask.status}
                onChange={(value) => setEditingTask({...editingTask, status: value})}
                style={{ width: '100%', marginTop: '4px' }}
              >
                <Option value="pending">Pending</Option>
                <Option value="in-progress">In Progress</Option>
                <Option value="completed">Completed</Option>
              </Select>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default TasksContainer;