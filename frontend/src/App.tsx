import { useState, useEffect } from 'react';
import './App.css';
import MediaDetail from './components/MediaDetail';
import MediaRow from './components/MediaRow';
import TagsModal from './components/TagsModal';

interface Media {
  id: number;
  title: string;
  type: 'movie' | 'tv_show';
  poster_url: string | null;
  year: number | null;
}

type GroupedMedia = Record<string, Media[]>;

function App() {
  const [groupedMedia, setGroupedMedia] = useState<GroupedMedia>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false);
  const [imdbUrl, setImdbUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [addMediaError, setAddMediaError] = useState(''); // New state for modal-specific error
  const [activeTab, setActiveTab] = useState<'tv_show' | 'movie'>('tv_show');
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null);

  const fetchMedia = async () => {
    try {
      setAddMediaError(''); // Clear any modal errors when fetching main media
      const res = await fetch('http://localhost:3000/api/media/grouped');
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      setGroupedMedia(data);
    } catch (err: any) {
      setAddMediaError('Failed to fetch media from the backend.'); // Use modal error state for this
      console.error(err);
    }
  };

  useEffect(() => {
    fetchMedia();
  }, []);

  const openModal = () => {
    setAddMediaError(''); // Clear error when opening modal
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setImdbUrl('');
    setAddMediaError(''); // Clear error when closing modal
  };

  const openTagsModal = () => {
    setIsTagsModalOpen(true);
  };

  const closeTagsModal = () => {
    setIsTagsModalOpen(false);
    fetchMedia();
  };

  const handleAddMedia = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsLoading(true);
    setAddMediaError(''); // Clear previous error on new attempt

    console.log('Attempting to add media with IMDB URL:', imdbUrl);

    try {
      const res = await fetch('http://localhost:3000/api/media', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imdbUrl }),
      });

      console.log('Fetch response:', res);

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
      }
      
      const addedMedia = await res.json();

      await fetchMedia(); // Refresh the media list
      setActiveTab(addedMedia.type); // Switch to the correct tab
      closeModal();
    } catch (err: any) {
      setAddMediaError(err.message); // Set modal-specific error
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCardClick = (id: number) => {
    setSelectedMediaId(id);
  };

  const handleCloseDetail = () => {
    setSelectedMediaId(null);
    fetchMedia();
  };

  if (selectedMediaId) {
    return <MediaDetail mediaId={selectedMediaId} onClose={handleCloseDetail} />;
  }
  
  const categories = Object.keys(groupedMedia);
  const filteredCategories = categories.filter(category => {
    const mediaItems = groupedMedia[category];
    // A category is valid for the active tab if at least one item in it matches the tab's type
    return mediaItems.some(item => item.type === activeTab);
  });


  return (
    <div className="App">
      <header className="app-header">
        <div className="header-left">
          <h1>Open Flix</h1>
          <nav className="tabs">
            <button onClick={() => setActiveTab('tv_show')} className={activeTab === 'tv_show' ? 'active' : ''}>TV Shows</button>
            <button onClick={() => setActiveTab('movie')} className={activeTab === 'movie' ? 'active' : ''}>Movies</button>
          </nav>
        </div>
        <div className="header-actions">
          <button onClick={openTagsModal}>Manage Tags</button>
          <button onClick={openModal}>Add Media</button>
        </div>
      </header>
      <main>
        {filteredCategories.map(category => {
          const itemsForCategory = groupedMedia[category].filter(item => item.type === activeTab);
          return (
            <MediaRow 
              key={category}
              title={category}
              media={itemsForCategory}
              onCardClick={handleCardClick}
            />
          )
        })}
      </main>

      {isModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h2>Add New Media</h2>
            <form onSubmit={handleAddMedia}>
              <input
                type="text"
                placeholder="Enter IMDB.com URL"
                value={imdbUrl}
                onChange={(e) => setImdbUrl(e.target.value)}
                required
                disabled={isLoading}
              />
              {addMediaError && <p className="error-message">{addMediaError}</p>}
              <div className="modal-actions">
                <button type="submit" disabled={isLoading}>
                  {isLoading ? 'Adding...' : 'Add'}
                </button>
                <button type="button" onClick={closeModal} disabled={isLoading}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isTagsModalOpen && (
        <TagsModal onClose={closeTagsModal} />
      )}
    </div>
  );
}

export default App;
