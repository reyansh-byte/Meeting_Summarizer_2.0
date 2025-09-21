import React, { useState } from 'react';
import { Upload, Button, Input, Card, message, Spin, Tag, List, Typography } from 'antd';
import { InboxOutlined, UserOutlined, BankOutlined, EnvironmentOutlined } from '@ant-design/icons';

const { Dragger } = Upload;
const { TextArea } = Input;
const { Title, Text, Paragraph } = Typography;

const SummaryContainer = () => {
  const [file, setFile] = useState(null);
  const [context, setContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const uploadProps = {
    name: 'file',
    multiple: false,
    accept: 'audio/*,video/*',
    beforeUpload: (file) => {
      setFile(file);
      return false; // Prevent automatic upload
    },
    onRemove: () => {
      setFile(null);
    },
  };

  const handleSubmit = async () => {
    if (!file) {
      message.error('Please select a file first');
      return;
    }

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('context', context);

    try {
      const response = await fetch('http://localhost:5000/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      
      if (response.ok) {
        setResult(data);
        message.success('File processed successfully!');
      } else {
        message.error(data.error || 'Processing failed');
      }
    } catch (error) {
      message.error('Network error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setFile(null);
    setContext('');
    setResult(null);
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
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
        {/* Upload Section */}
        <Card title="Upload Audio/Video" size="small">
          <Dragger {...uploadProps} style={{ marginBottom: '16px' }}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Click or drag file here</p>
            <p className="ant-upload-hint">Audio/video formats only</p>
          </Dragger>

          <TextArea
            placeholder="Provide additional context (optional)"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
            style={{ marginBottom: '16px' }}
          />

          <div style={{ display: 'flex', gap: '12px' }}>
            <Button type="default" onClick={handleClear}>
              Clear
            </Button>
            <Button
              type="primary"
              onClick={handleSubmit}
              loading={loading}
              disabled={!file}
              style={{ flex: 1 }}
            >
              {loading ? 'Processing...' : 'Submit'}
            </Button>
          </div>
        </Card>

        {/* Summary Section */}
        <Card title="Meeting Summary" size="small">
          <div style={{ minHeight: '200px' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '50px' }}>
                <Spin size="large" />
                <div style={{ marginTop: '16px' }}>Processing audio...</div>
              </div>
            ) : result ? (
              <div>
                <Paragraph>{result.summary}</Paragraph>
                {result.meetingId && (
                  <Tag color="blue">Meeting ID: {result.meetingId}</Tag>
                )}
              </div>
            ) : (
              <Text type="secondary">Your meeting summary will appear here.</Text>
            )}
          </div>
        </Card>
      </div>

      {/* Results Section */}
      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          {/* Transcript Section */}
          <Card title="Transcript" size="small">
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <Paragraph>
                <Text>{result.transcription}</Text>
              </Paragraph>
            </div>
          </Card>

          {/* Entities Section */}
          <Card title="Extracted Entities" size="small">
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {result.entities && Object.keys(result.entities).map(entityType => (
                result.entities[entityType].length > 0 && (
                  <div key={entityType} style={{ marginBottom: '12px' }}>
                    <Text strong>{entityType}:</Text>
                    <div style={{ marginTop: '4px' }}>
                      {result.entities[entityType].map((entity, index) => (
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
              {result.entities && Object.values(result.entities).every(arr => arr.length === 0) && (
                <Text type="secondary">No entities extracted</Text>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Tasks Section */}
      {result && result.tasks && result.tasks.length > 0 && (
        <Card title="Extracted Tasks" style={{ marginTop: '24px' }} size="small">
          <List
            dataSource={result.tasks}
            renderItem={(task) => (
              <List.Item>
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <Text strong>{task.text}</Text>
                      {task.assignedTo && (
                        <div>
                          <Tag icon={<UserOutlined />} color="blue">
                            {task.assignedTo}
                          </Tag>
                        </div>
                      )}
                      <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                        From: "{task.extractedFrom}"
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
        </Card>
      )}
    </div>
  );
};

export default SummaryContainer;