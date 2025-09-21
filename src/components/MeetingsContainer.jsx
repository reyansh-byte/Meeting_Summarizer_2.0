import React, { useState, useEffect } from 'react';
import { Card, List, Button, Tag, message, Popconfirm, Modal, Typography, Collapse } from 'antd';
import { DeleteOutlined, EyeOutlined, UserOutlined, BankOutlined, EnvironmentOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;
const { Panel } = Collapse;

const MeetingsContainer = () => {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  const fetchMeetings = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:5000/meetings');
      const data = await response.json();
      setMeetings(data);
    } catch (error) {
      message.error('Failed to fetch meetings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeetings();
  }, []);

  const deleteMeeting = async (meetingId) => {
    try {
      const response = await fetch(`http://localhost:5000/meetings/${meetingId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        message.success('Meeting deleted successfully');
        fetchMeetings();
      } else {
        message.error('Failed to delete meeting');
      }
    } catch (error) {
      message.error('Network error');
    }
  };

  const viewMeeting = async (meetingId) => {
    try {
      const response = await fetch(`http://localhost:5000/meetings/${meetingId}`);
      const data = await response.json();
      setSelectedMeeting(data);
      setModalVisible(true);
    } catch (error) {
      message.error('Failed to load meeting details');
    }
  };

  const getEntityIcon = (type) => {
    switch (type) {
      case 'PERSON': return <UserOutlined />;
      case 'ORG': return <BankOutlined />;
      case 'LOC': return <EnvironmentOutlined />;
      default: return null;
    }
  };

  const getEntityColor = (type) => {
    switch (type) {
      case 'PERSON': return 'blue';
      case 'ORG': return 'green';
      case 'LOC': return 'orange';
      case 'MISC': return 'purple';
      default: return 'default';
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

  return (
    <div>
      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between' }}>
        <h2>My Meetings</h2>
        <Button type="primary" onClick={fetchMeetings}>
          Refresh
        </Button>
      </div>

      <Card>
        <List
          dataSource={meetings}
          loading={loading}
          renderItem={(meeting) => (
            <List.Item
              actions={[
                <Button 
                  icon={<EyeOutlined />} 
                  onClick={() => viewMeeting(meeting.id)}
                >
                  View Details
                </Button>,
                <Popconfirm
                  title="Are you sure you want to delete this meeting? This will also delete all associated tasks."
                  onConfirm={() => deleteMeeting(meeting.id)}
                  okText="Yes"
                  cancelText="No"
                >
                  <Button icon={<DeleteOutlined />} danger />
                </Popconfirm>
              ]}
            >
              <List.Item.Meta
                title={
                  <div>
                    <Text strong>{meeting.title}</Text>
                    <div style={{ marginTop: '8px' }}>
                      {meeting.tasks && meeting.tasks.length > 0 && (
                        <Tag color="blue">{meeting.tasks.length} tasks extracted</Tag>
                      )}
                      {meeting.entities && Object.values(meeting.entities).some(arr => arr.length > 0) && (
                        <Tag color="green">Entities detected</Tag>
                      )}
                    </div>
                  </div>
                }
                description={
                  <div>
                    <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: '8px' }}>
                      {meeting.summary}
                    </Paragraph>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      Created: {new Date(meeting.createdAt).toLocaleString()}
                    </Text>
                    {meeting.context && (
                      <Text type="secondary" style={{ fontSize: '12px', marginLeft: '12px' }}>
                        Context: {meeting.context}
                      </Text>
                    )}
                  </div>
                }
              />
            </List.Item>
          )}
        />
      </Card>

      {/* Meeting Details Modal */}
      <Modal
        title={selectedMeeting?.title || 'Meeting Details'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setSelectedMeeting(null);
        }}
        footer={[
          <Button key="close" onClick={() => setModalVisible(false)}>
            Close
          </Button>
        ]}
        width={800}
        style={{ top: 20 }}
      >
        {selectedMeeting && (
          <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            <Collapse defaultActiveKey={['summary']} ghost>
              {/* Summary Section */}
              <Panel header="Summary" key="summary">
                <Paragraph>{selectedMeeting.summary}</Paragraph>
                <div style={{ marginTop: '12px' }}>
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    Meeting Date: {new Date(selectedMeeting.createdAt).toLocaleString()}
                  </Text>
                  {selectedMeeting.context && (
                    <div>
                      <Text type="secondary" style={{ fontSize: '12px' }}>
                        Context: {selectedMeeting.context}
                      </Text>
                    </div>
                  )}
                </div>
              </Panel>

              {/* Transcript Section */}
              <Panel header="Full Transcript" key="transcript">
                <div style={{ maxHeight: '300px', overflowY: 'auto', background: '#f5f5f5', padding: '12px', borderRadius: '4px' }}>
                  <Text>{selectedMeeting.transcript}</Text>
                </div>
              </Panel>

              {/* Entities Section */}
              {selectedMeeting.entities && Object.values(selectedMeeting.entities).some(arr => arr.length > 0) && (
                <Panel header="Extracted Entities" key="entities">
                  {Object.keys(selectedMeeting.entities).map(entityType => (
                    selectedMeeting.entities[entityType].length > 0 && (
                      <div key={entityType} style={{ marginBottom: '12px' }}>
                        <Text strong>{entityType}:</Text>
                        <div style={{ marginTop: '4px' }}>
                          {selectedMeeting.entities[entityType].map((entity, index) => (
                            <Tag
                              key={index}
                              color={getEntityColor(entityType)}
                              icon={getEntityIcon(entityType)}
                              style={{ marginBottom: '4px' }}
                            >
                              {entity.text} ({Math.round(entity.confidence * 100)}%)
                            </Tag>
                          ))}
                        </div>
                      </div>
                    )
                  ))}
                </Panel>
              )}

              {/* Tasks Section */}
              {selectedMeeting.tasks && selectedMeeting.tasks.length > 0 && (
                <Panel header={`Extracted Tasks (${selectedMeeting.tasks.length})`} key="tasks">
                  <List
                    dataSource={selectedMeeting.tasks}
                    renderItem={(task) => (
                      <List.Item>
                        <div style={{ width: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                              <Text strong>{task.text}</Text>
                              {task.assignedTo && (
                                <div style={{ marginTop: '4px' }}>
                                  <Tag icon={<UserOutlined />} color="blue">
                                    {task.assignedTo}
                                  </Tag>
                                </div>
                              )}
                              <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                                <Text type="secondary">Extracted from:</Text>
                                <div style={{ fontStyle: 'italic', marginTop: '2px' }}>
                                  "{task.extractedFrom}"
                                </div>
                              </div>
                            </div>
                            <Tag color={getStatusColor(task.status)}>
                              {task.status}
                            </Tag>
                          </div>
                        </div>
                      </List.Item>
                    )}
                  />
                </Panel>
              )}
            </Collapse>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default MeetingsContainer;