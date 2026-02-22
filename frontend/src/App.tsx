import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
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
  isRemote?: boolean;
  overview?: string;
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
  const [remoteSearchResults, setRemoteSearchResults] = useState<Media[]>([]);

  // Discover / Trending
  const [trendingMedia, setTrendingMedia] = useState<Media[]>([]);
  const [isTrendingModalOpen, setIsTrendingModalOpen] = useState(false);
  const [discoverFilter, setDiscoverFilter] = useState('trending');
  const [discoverPage, setDiscoverPage] = useState(1);
  const [isLoadingDiscover, setIsLoadingDiscover] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<Media | null>(null); // For previewing TMDB items
  const [tmdbEnabled, setTmdbEnabled] = useState(false);
  const [rowScrollPositions, setRowScrollPositions] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => setTmdbEnabled(data.tmdbEnabled))
      .catch(err => console.error('Failed to fetch config', err));
  }, []);

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
        if (isTrendingModalOpen) {
          setIsTrendingModalOpen(false);
        }
        if (previewMedia) {
          closePreview();
        }
      }
    };

    if (isModalOpen || isTagsModalOpen || isTrendingModalOpen || previewMedia) {
      document.body.classList.add('modal-open');
      document.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.classList.remove('modal-open');
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModalOpen, isTagsModalOpen, isTrendingModalOpen, previewMedia]);

  useEffect(() => {
    const scrollable = document.querySelector('.modal-body-scrollable');
    if (scrollable) {
      scrollable.scrollTop = 0;
    }
  }, [discoverFilter]);

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

  const scrollYRef = useRef(0);

  useLayoutEffect(() => {
    if (selectedMediaId === null) {
      window.scrollTo(0, scrollYRef.current);
    }
  }, [selectedMediaId]);

  const handleCardClick = (id: number) => {
    scrollYRef.current = window.scrollY;
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

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      setRemoteSearchResults([]);
      return;
    }
    
    const lowerQuery = query.toLowerCase();
    const results = allMedia.filter(item => 
      item.title.toLowerCase().includes(lowerQuery)
    );
    setSearchResults(results.slice(0, 10)); // Limit to 10 local results

    // Search TMDB if query is long enough
    if (query.length > 2) {
      try {
        const res = await fetch(`/api/search/tmdb?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          // Transform remote data to match Media interface
          const remoteData: Media[] = data.map((item: any) => ({
            id: item.id,
            title: item.title,
            type: item.type,
            poster_url: item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : null,
            year: item.year ? parseInt(item.year) : null,
            isRemote: true,
            overview: item.overview
          }));
          setRemoteSearchResults(remoteData.slice(0, 5)); // Limit to 5 remote results
        }
      } catch (err) {
        console.error("Failed to search remote:", err);
      }
    } else {
      setRemoteSearchResults([]);
    }
  };

  const toggleSearch = () => {
    setIsSearchOpen(!isSearchOpen);
    if (isSearchOpen) {
      setSearchQuery('');
      setSearchResults([]);
      setRemoteSearchResults([]);
    } else {
      setTimeout(() => document.getElementById('search-input')?.focus(), 100);
    }
  };

  const fetchDiscover = async (filter: string = 'trending', page: number = 1) => {
    if (isLoadingDiscover) return;
    setIsLoadingDiscover(true);
    
    if (filter !== discoverFilter || page === 1) {
        setDiscoverFilter(filter);
        setDiscoverPage(1);
        if (page === 1) setTrendingMedia([]);
    }

    try {
      const res = await fetch(`/api/recommendations/discover?filter=${filter}&page=${page}&count=1`);
      if (res.ok) {
        const data = await res.json();
        
        // Create a Set of existing titles for faster lookup
        const existingTitles = new Set(allMedia.map(m => m.title.toLowerCase()));

        const formatted: Media[] = data.map((item: any) => ({
            id: item.id,
            title: item.title,
            type: item.type,
            poster_url: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
            year: item.year ? parseInt(item.year) : null,
            isRemote: true,
            overview: item.overview
        })).filter((item: Media) => !existingTitles.has(item.title.toLowerCase()));

        setTrendingMedia(prev => {
            if (page === 1) return formatted;
            const existingIds = new Set(prev.map(item => item.id));
            const newUniqueItems = formatted.filter(item => !existingIds.has(item.id));
            return [...prev, ...newUniqueItems];
        });
        if (page === 1) setIsTrendingModalOpen(true);
      }
    } catch (err) {
      console.error("Failed to fetch discover:", err);
    } finally {
        setIsLoadingDiscover(false);
    }
  };

  const handleDiscoverScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 300 && !isLoadingDiscover) {
        const nextPage = discoverPage + 1;
        setDiscoverPage(nextPage);
        fetchDiscover(discoverFilter, nextPage);
    }
  };

  const handlePreview = (media: Media) => {
    setPreviewMedia(media);
    setIsSearchOpen(false); // Close search if open
    // Keep discover modal open behind preview so we can return to it? 
    // Or close it? The user might want to browse more.
    // Let's keep it open but hidden or just rely on z-index?
    // If we set isTrendingModalOpen(false), we lose context.
    // Let's keep it true.
  };

  const closePreview = () => {
    setPreviewMedia(null);
  };

  const handleAddFromTMDB = async () => {
    if (!previewMedia) return;
    
    setIsLoading(true);
    setAddMediaError('');

    try {
      const res = await fetch('/api/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdbId: previewMedia.id, type: previewMedia.type }),
      });

      if (res.status === 409) {
        const data = await res.json();
        window.alert("Media already exists. Opening it now.");
        if (data.existingMediaId) {
            setSelectedMediaId(data.existingMediaId);
            setActiveTab(previewMedia.type);
        }
        closePreview();
        return;
      }

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
      }

      const addedMedia = await res.json();
      await fetchMedia();
      setActiveTab(addedMedia.type);
      setSelectedMediaId(addedMedia.id);
      closePreview();
    } catch (err: any) {
      console.error(err);
      window.alert(`Failed to add media: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const searchContainer = document.getElementById('search-container');
      if (searchContainer && !searchContainer.contains(event.target as Node)) {
        setIsSearchOpen(false);
        setSearchQuery('');
        setSearchResults([]);
        setRemoteSearchResults([]);
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

  const handleRowScroll = (category: string, scrollLeft: number) => {
    setRowScrollPositions(prev => ({
      ...prev,
      [category]: scrollLeft
    }));
  };

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
            {(searchResults.length > 0 || remoteSearchResults.length > 0) && (
              <ul className="search-results">
                {searchResults.length > 0 && <li className="search-section-header">Library</li>}
                {searchResults.map(result => (
                  <li key={`local-${result.id}`} onClick={() => {
                    setActiveTab(result.type);
                    setSelectedMediaId(result.id);
                    setIsSearchOpen(false);
                    setSearchQuery('');
                    setSearchResults([]);
                    setRemoteSearchResults([]);
                  }}>
                    <img src={result.poster_url || ''} alt={result.title} />
                    <div>
                      <span className="search-result-title">{result.title}</span>
                      <span className="search-result-year">({result.year})</span>
                    </div>
                  </li>
                ))}
                {remoteSearchResults.length > 0 && <li className="search-section-header">Add to Library</li>}
                {remoteSearchResults.map(result => (
                  <li key={`remote-${result.id}`} onClick={() => handlePreview(result)}>
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
              initialScrollLeft={rowScrollPositions[category] || 0}
              onScroll={(left) => handleRowScroll(category, left)}
            />
          )
        })}
      </main>

      <div style={{ textAlign: 'center', margin: '2rem 0', opacity: 0.5, display: 'flex', gap: '1rem', justifyContent: 'center' }}>
        <button onClick={() => { fetchDiscover('trending', 1); setIsTrendingModalOpen(true); }} style={{ background: 'none', border: 'none', color: '#666', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}>
          Discover More
        </button>
        <button onClick={handleSignOut} style={{ background: 'none', border: 'none', color: '#666', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}>
          Sign Out
        </button>
      </div>

      {isTrendingModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsTrendingModalOpen(false)}>
          <div className="modal-content trending-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <button className="close-button" onClick={() => setIsTrendingModalOpen(false)}>&times;</button>
              <h2 style={{ marginBottom: '1rem' }}>Discover Media</h2>
              
              <div className="discover-filters">
                <select 
                  className="mobile-filters" 
                  value={discoverFilter} 
                  onChange={(e) => fetchDiscover(e.target.value, 1)}
                >
                  <option value="trending">Trending</option>
                  <option value="top_rated_movies">Top Rated Movies</option>
                  <option value="top_rated_tv">Top Rated TV</option>
                  <option value="upcoming">Coming Soon</option>
                  <option value="now_playing">In Theaters</option>
                  <option value="popular_tv">Popular TV</option>
                  <option value="family_movies">Family Movies</option>
                  <option value="family_tv">Family TV</option>
                  <option value="documentary_movies">Documentaries</option>
                  <option value="comedy_movies">Comedy</option>
                  <option value="romcom_movies">Rom-Com</option>
                </select>

                <div className="desktop-filters">
                  <button className={discoverFilter === 'trending' ? 'active' : ''} onClick={() => fetchDiscover('trending', 1)}>Trending</button>
                  <button className={discoverFilter === 'top_rated_movies' ? 'active' : ''} onClick={() => fetchDiscover('top_rated_movies', 1)}>Top Rated Movies</button>
                  <button className={discoverFilter === 'top_rated_tv' ? 'active' : ''} onClick={() => fetchDiscover('top_rated_tv', 1)}>Top Rated TV</button>
                  <button className={discoverFilter === 'upcoming' ? 'active' : ''} onClick={() => fetchDiscover('upcoming', 1)}>Coming Soon</button>
                  <button className={discoverFilter === 'now_playing' ? 'active' : ''} onClick={() => fetchDiscover('now_playing', 1)}>In Theaters</button>
                  <button className={discoverFilter === 'popular_tv' ? 'active' : ''} onClick={() => fetchDiscover('popular_tv', 1)}>Popular TV</button>
                  <button className={discoverFilter === 'family_movies' ? 'active' : ''} onClick={() => fetchDiscover('family_movies', 1)}>Family Movies</button>
                  <button className={discoverFilter === 'family_tv' ? 'active' : ''} onClick={() => fetchDiscover('family_tv', 1)}>Family TV</button>
                  <button className={discoverFilter === 'documentary_movies' ? 'active' : ''} onClick={() => fetchDiscover('documentary_movies', 1)}>Documentaries</button>
                  <button className={discoverFilter === 'comedy_movies' ? 'active' : ''} onClick={() => fetchDiscover('comedy_movies', 1)}>Comedy</button>
                  <button className={discoverFilter === 'romcom_movies' ? 'active' : ''} onClick={() => fetchDiscover('romcom_movies', 1)}>Rom-Com</button>
                </div>
              </div>
            </div>

            <div className="modal-body-scrollable" onScroll={handleDiscoverScroll}>
              <div className="trending-grid">
                {trendingMedia.map(item => (
                  <div key={item.id} className="trending-item" onClick={() => handlePreview(item)}>
                    <img src={item.poster_url || ''} alt={item.title} />
                    <p>{item.title}</p>
                  </div>
                ))}
              </div>
              {isLoadingDiscover && <div style={{ textAlign: 'center', padding: '1rem', color: '#888', width: '100%' }}>Loading more...</div>}
            </div>
          </div>
        </div>
      )}

      {previewMedia && (
        <div className="modal-backdrop">
          <div className="modal-content preview-modal">
            <button className="close-button" onClick={closePreview}>&times;</button>
            <div className="preview-header">
                {previewMedia.poster_url && <img src={previewMedia.poster_url} alt={previewMedia.title} className="preview-poster" />}
                <div className="preview-info">
                    <h2>{previewMedia.title} ({previewMedia.year})</h2>
                    <p className="preview-type">{previewMedia.type === 'movie' ? 'Movie' : 'TV Show'}</p>
                    <p className="preview-overview">{previewMedia.overview}</p>
                    <div className="modal-actions">
                        <button onClick={handleAddFromTMDB} disabled={isLoading}>
                            {isLoading ? 'Adding...' : 'Add to Library'}
                        </button>
                        <button onClick={closePreview}>Cancel</button>
                    </div>
                </div>
            </div>
          </div>
        </div>
      )}

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
                {tmdbEnabled && (
                  <button 
                    type="button" 
                    onClick={() => { closeModal(); fetchDiscover('trending', 1); setIsTrendingModalOpen(true); }}
                    style={{ marginRight: 'auto' }}
                  >
                    Discover More
                  </button>
                )}
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
