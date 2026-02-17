import React, { useState, useEffect } from 'react';
import './StreamingLinksModal.css';

interface StreamingLink {
  id: number;
  url: string;
  platform: string;
}

interface StreamingLinksModalProps {
  mediaId: number;
  links: StreamingLink[];
  onClose: () => void;
  onSave: () => void;
}

const StreamingLinksModal: React.FC<StreamingLinksModalProps> = ({ mediaId, links, onClose, onSave }) => {
  const [newLink, setNewLink] = useState('');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onClose]);

  const handleAddLink = async () => {
    if (!newLink.trim()) return;

    await fetch(`/api/media/${mediaId}/streaming-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: newLink }),
    });
    setNewLink('');
    onSave();
  };


  const handleUpdateLink = async (linkId: number, url: string) => {
    await fetch(`/api/media/${mediaId}/streaming-links/${linkId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    onSave();
  };

  const handleDeleteLink = async (linkId: number) => {
    if (window.confirm('Are you sure you want to delete this link?')) {
      await fetch(`/api/media/${mediaId}/streaming-links/${linkId}`, {
        method: 'DELETE',
      });
      onSave();
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <h2>Manage Streaming Links</h2>
        <div className="streaming-links-list">
          {links.map(link => (
            <div key={link.id} className="streaming-link-item">
              <input
                type="text"
                value={link.url}
                onChange={(e) => handleUpdateLink(link.id, e.target.value)}
              />
              <button onClick={() => handleDeleteLink(link.id)}>&times;</button>
            </div>
          ))}
        </div>
        <div className="add-streaming-link">
          <input
            type="text"
            placeholder="Add new URL"
            value={newLink}
            onChange={(e) => setNewLink(e.target.value)}
          />
          <button onClick={handleAddLink}>Add</button>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default StreamingLinksModal;
