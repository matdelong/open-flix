import { useState, useEffect, useMemo } from 'react';
import './App.css';
import MediaDetail from './components/MediaDetail';
import MediaRow from './components/MediaRow';
import TagsModal from './components/TagsModal';
import SignIn from './components/SignIn';
import { Search } from 'lucide-react';

interface Media {
  id: number;
  title: string;
  type: 'movie' | 'tv_show';
  poster_url: string | null;
  year: number | null;
}

type GroupedMedia = Record<string, Media[]>;

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => document.cookie.split('; ').some(row => row.startsWith('auth_token=')));
  const [groupedMedia, setGroupedMedia] = useState<GroupedMedia>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false);
  const [imdbUrl, setImdbUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [addMediaError, setAddMediaError] = useState(''); // New state for modal-specific error
  const [activeTab, setActiveTab] = useState<'tv_show' | 'movie'>('tv_show');
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null);
  
  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Media[]>([]);

  const handleSignOut = () => {
    document.cookie = "auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    setIsAuthenticated(false);
    setGroupedMedia({});
  };

  const fetchMedia = async () => {
    if (!isAuthenticated) return;
    try {
      setAddMediaError(''); // Clear any modal errors when fetching main media
      const res = await fetch('/api/media/grouped');
      if (res.status === 401) {
        handleSignOut();
        return;
      }
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
  }, [isAuthenticated]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isModalOpen) {
          closeModal();
        }
        if (isTagsModalOpen) {
          closeTagsModal();
        }
      }
    };

    if (isModalOpen || isTagsModalOpen) {
      document.body.classList.add('modal-open');
      document.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.classList.remove('modal-open');
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModalOpen, isTagsModalOpen]);

  const openModal = () => {
    setAddMediaError(''); // Clear error when opening modal
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setImdbUrl('');
    setAddMediaError(''); // Clear error when closing modal
    (document.getElementById('add-media-button') as HTMLElement)?.blur();
  };

  const openTagsModal = () => {
    setIsTagsModalOpen(true);
  };

  const closeTagsModal = () => {
    setIsTagsModalOpen(false);
    fetchMedia();
    (document.getElementById('manage-tags-button') as HTMLElement)?.blur();
  };

  const handleAddMedia = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsLoading(true);
    setAddMediaError(''); // Clear previous error on new attempt

    console.log('Attempting to add media with IMDB URL:', imdbUrl);

    try {
      const res = await fetch('/api/media', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imdbUrl }),
      });

      console.log('Fetch response:', res);
      
      if (res.status === 401) {
        handleSignOut();
        return;
      }

      const data = await res.json();

      if (res.status === 409 && data.existingMediaId) {
        closeModal();
        setSelectedMediaId(data.existingMediaId);
        window.alert("Media already exists. Opening it now.");
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || `HTTP error! status: ${res.status}`);
      }
      
      const addedMedia = data;

      await fetchMedia(); // Refresh the media list
      setActiveTab(addedMedia.type); // Switch to the correct tab
      setSelectedMediaId(addedMedia.id);
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

  const allMedia = useMemo(() => {
    const all = new Map<number, Media>();
    Object.values(groupedMedia).forEach(list => {
      list.forEach(item => all.set(item.id, item));
    });
    return Array.from(all.values());
  }, [groupedMedia]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    
    const lowerQuery = query.toLowerCase();
    const results = allMedia.filter(item => 
      item.title.toLowerCase().includes(lowerQuery)
    );
    setSearchResults(results.slice(0, 10)); // Limit to 10 results
  };

  const toggleSearch = () => {
    setIsSearchOpen(!isSearchOpen);
    if (isSearchOpen) {
      setSearchQuery('');
      setSearchResults([]);
    } else {
      setTimeout(() => document.getElementById('search-input')?.focus(), 100);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const searchContainer = document.getElementById('search-container');
      if (searchContainer && !searchContainer.contains(event.target as Node)) {
        setIsSearchOpen(false);
        setSearchQuery('');
        setSearchResults([]);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const categories = Object.keys(groupedMedia);
  const filteredCategories = categories.filter(category => {
    const mediaItems = groupedMedia[category];
    // A category is valid for the active tab if at least one item in it matches the tab's type
    return mediaItems.some(item => item.type === activeTab);
  });

  if (!isAuthenticated) {
    return <SignIn onSignIn={() => setIsAuthenticated(true)} />;
  }

  if (selectedMediaId) {
    return <MediaDetail mediaId={selectedMediaId} onClose={handleCloseDetail} />;
  }

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
          <div className={`search-container ${isSearchOpen ? 'open' : ''}`} id="search-container">
            <button className="search-icon-button" onClick={toggleSearch}>
              <Search size={20} />
            </button>
            {isSearchOpen && (
              <input
                id="search-input"
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="search-input"
              />
            )}
            {isSearchOpen && searchResults.length > 0 && (
              <ul className="search-results">
                {searchResults.map(result => (
                  <li key={result.id} onClick={() => {
                    setActiveTab(result.type);
                    setSelectedMediaId(result.id);
                    setIsSearchOpen(false);
                    setSearchQuery('');
                  }}>
                    <img src={result.poster_url || ''} alt={result.title} />
                    <div>
                      <span className="search-result-title">{result.title}</span>
                      <span className="search-result-year">({result.year})</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button id="manage-tags-button" onClick={openTagsModal}>Manage Tags</button>
          <button id="add-media-button" onClick={openModal}>Add Media</button>
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

      <div style={{ textAlign: 'center', margin: '2rem 0', opacity: 0.5 }}>
        <button onClick={handleSignOut} style={{ background: 'none', border: 'none', color: '#666', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}>
          Sign Out
        </button>
      </div>

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
