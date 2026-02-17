import React, { useState, useEffect } from 'react';
import './TagsModal.css';

interface Tag {
  id: number;
  name: string;
  sort_order: number;
}

interface TagsModalProps {
  onClose: () => void;
}

const TagsModal: React.FC<TagsModalProps> = ({ onClose }) => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchTags = async () => {
    try {
      const res = await fetch('/api/tags');
      if (!res.ok) {
        throw new Error('Failed to fetch tags');
      }
      const data = await res.json();
      setTags(data);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    fetchTags();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) {
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newTagName }),
      });
      if (!res.ok) {
        throw new Error('Failed to add tag');
      }
      setNewTagName('');
      fetchTags();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTag = async (tagId: number) => {
    if (!window.confirm('Are you sure you want to delete this tag?')) {
      return;
    }
    try {
      const res = await fetch(`/api/tags/${tagId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('Failed to delete tag');
      }
      fetchTags();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLLIElement>, index: number) => {
    e.dataTransfer.setData('draggedIndex', index.toString());
  };

  const handleDragOver = (e: React.DragEvent<HTMLLIElement>) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent<HTMLLIElement>, dropIndex: number) => {
    const draggedIndex = parseInt(e.dataTransfer.getData('draggedIndex'), 10);
    const newTags = [...tags];
    const draggedItem = newTags[draggedIndex];
    newTags.splice(draggedIndex, 1);
    newTags.splice(dropIndex, 0, draggedItem);
    setTags(newTags);

    const orderedTags = newTags.map((tag, index) => ({ ...tag, sort_order: index }));
    try {
      const res = await fetch('/api/tags', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tags: orderedTags }),
      });
      if (!res.ok) {
        throw new Error('Failed to save tag order');
      }
    } catch (err: any) {
      setError(err.message);
      // Revert to original order if save fails
      fetchTags();
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <h2>Manage Tags</h2>
        {error && <p className="error-message">{error}</p>}
        <form onSubmit={handleAddTag} className="add-tag-form">
          <input
            type="text"
            placeholder="New tag name"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Adding...' : 'Add'}
          </button>
        </form>
        <ul className="tags-list">
          {tags.map((tag, index) => (
            <li
              key={tag.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
            >
              <span className="drag-handle">⋮⋮</span>
              <span className="tag-name">{tag.name}</span>
              <button onClick={() => handleDeleteTag(tag.id)} className="delete-tag-button">&times;</button>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default TagsModal;
