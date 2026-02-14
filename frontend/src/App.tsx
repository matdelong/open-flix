import { useState, useEffect } from 'react';
import './App.css';
import MediaDetail from './components/MediaDetail';
import MediaRow from './components/MediaRow';

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
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mediaType, setMediaType] = useState<'movie' | 'tv_show' | null>(null);
  const [imdbUrl, setImdbUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'tv_show' | 'movie'>('tv_show');
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null);

  const fetchMedia = async () => {
    try {
      setError('');
      const res = await fetch('http://localhost:3000/api/media/grouped');
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      setGroupedMedia(data);
    } catch (err: any) {
      setError('Failed to fetch media from the backend.');
      console.error(err);
    }
  };

  useEffect(() => {
    fetchMedia();
  }, []);

  const openModal = (type: 'movie' | 'tv_show') => {
    setMediaType(type);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setImdbUrl('');
    setMediaType(null);
  };

  const handleAddMedia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mediaType) return;

    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('http://localhost:3000/api/media', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imdbUrl, type: mediaType }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
      }

      await fetchMedia(); // Refresh the media list
      setActiveTab(mediaType); // Switch to the correct tab
      closeModal();
    } catch (err: any) {
      setError(err.message);
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
        <h1>Open Flix</h1>
        <nav className="tabs">
          <button onClick={() => setActiveTab('tv_show')} className={activeTab === 'tv_show' ? 'active' : ''}>TV Shows</button>
          <button onClick={() => setActiveTab('movie')} className={activeTab === 'movie' ? 'active' : ''}>Movies</button>
        </nav>
        <div className="header-actions">
          <button onClick={() => openModal('movie')}>Add Movie</button>
          <button onClick={() => openModal('tv_show')}>Add TV Show</button>
        </div>
      </header>

      {error && <p className="error-message">{error}</p>}
      
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
            <h2>Add New {mediaType === 'movie' ? 'Movie' : 'TV Show'}</h2>
            <form onSubmit={handleAddMedia}>
              <input
                type="text"
                placeholder="Enter IMDB.com URL"
                value={imdbUrl}
                onChange={(e) => setImdbUrl(e.target.value)}
                required
                disabled={isLoading}
              />
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
    </div>
  );
}

export default App;
