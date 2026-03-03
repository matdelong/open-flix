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
  const [discoverFilter, setDiscoverFilter] = useState('custom');
  const [discoverPage, setDiscoverPage] = useState(1);
  const [hasMoreDiscover, setHasMoreDiscover] = useState(true);
  const [isLoadingDiscover, setIsLoadingDiscover] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<Media | null>(null); // For previewing TMDB items
  const [tmdbEnabled, setTmdbEnabled] = useState(false);
  const [rowScrollPositions, setRowScrollPositions] = useState<Record<string, number>>({});
  
  const [customFilters, setCustomFilters] = useState({
    type: 'movie',
    genre: '',
    minRating: '',
    yearFrom: '',
    yearTo: '',
    keywords: ''
  });

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
        if (previewMedia) {
          closePreview();
        } else if (isTagsModalOpen) {
          closeTagsModal();
        } else if (isModalOpen) {
          closeModal();
        } else if (isTrendingModalOpen) {
          setIsTrendingModalOpen(false);
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

  const openDiscoverModal = () => {
    closeModal();
    const resetFilters = { type: 'movie', genre: '', minRating: '', yearFrom: '', yearTo: '', keywords: '' };
    setCustomFilters(resetFilters);
    setDiscoverFilter('trending');
    fetchDiscover('trending', 1, resetFilters);
    setIsTrendingModalOpen(true);
  };

  const fetchDiscover = async (filter: string = 'custom', page: number = 1, overrideFilters?: any) => {
    if (isLoadingDiscover) return;
    setIsLoadingDiscover(true);
    
    if (filter !== discoverFilter || page === 1) {
        setDiscoverFilter(filter);
        setDiscoverPage(1);
        setHasMoreDiscover(true);
        if (page === 1) setTrendingMedia([]);
    }

    try {
      let url = `/api/recommendations/discover?filter=${filter}&page=${page}&count=1`;
      if (filter === 'custom') {
          const filters = overrideFilters || customFilters;
          url += `&type=${filters.type}`;
          if (filters.genre) url += `&genres=${filters.genre}`;
          if (filters.minRating) url += `&min_rating=${filters.minRating}`;
          if (filters.yearFrom) url += `&year_from=${filters.yearFrom}`;
          if (filters.yearTo) url += `&year_to=${filters.yearTo}`;
          if (filters.keywords) url += `&keywords=${encodeURIComponent(filters.keywords)}`;
      }
      
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        
        if (data.length === 0) {
            setHasMoreDiscover(false);
        }

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
      }
    } catch (err) {
      console.error("Failed to fetch discover:", err);
    } finally {
        setIsLoadingDiscover(false);
    }
  };

  const handleCustomFilterChange = (key: string, value: string) => {
    const newFilters = { ...customFilters, [key]: value };
    setCustomFilters(newFilters);
    if (key !== 'keywords') {
      fetchDiscover('custom', 1, newFilters);
    }
  };

  const handleKeywordSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      fetchDiscover('custom', 1, customFilters);
    }
  };

  const handleDiscoverScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 300 && !isLoadingDiscover && hasMoreDiscover) {
        const nextPage = discoverPage + 1;
        setDiscoverPage(nextPage);
        fetchDiscover(discoverFilter, nextPage);
    }
  };

  const handlePreview = (media: Media) => {
    const existing = allMedia.find(m => 
      m.title.toLowerCase() === media.title.toLowerCase() && 
      (m.year === media.year || !media.year || !m.year)
    );

    if (existing) {
      setSelectedMediaId(existing.id);
      setIsSearchOpen(false);
      setPreviewMedia(null);
    } else {
      setPreviewMedia(media);
      setIsSearchOpen(false); 
    }
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

  return (
    <div className="App">
      {!selectedMediaId ? (
        <>
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
            <button onClick={openDiscoverModal} style={{ background: 'none', border: 'none', color: '#666', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}>
              Discover More
            </button>
            <button onClick={handleSignOut} style={{ background: 'none', border: 'none', color: '#666', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}>
              Sign Out
            </button>
          </div>
        </>
      ) : (
        <MediaDetail mediaId={selectedMediaId} onClose={handleCloseDetail} onPreview={handlePreview} isPreviewOpen={!!previewMedia} />
      )}

      {isTrendingModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsTrendingModalOpen(false)}>
          <div className="modal-content trending-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <button className="close-button" onClick={() => setIsTrendingModalOpen(false)}>&times;</button>
              <h2 style={{ marginBottom: '1rem' }}>Discover Media</h2>
              
              <div className="discover-filters-container">
                <input 
                  type="text" 
                  className="discover-filter-input"
                  placeholder="Keywords..." 
                  value={customFilters.keywords}
                  onChange={(e) => setCustomFilters({...customFilters, keywords: e.target.value})}
                  onKeyDown={handleKeywordSubmit}
                />
                <select className="discover-filter-select" value={customFilters.type} onChange={(e) => handleCustomFilterChange('type', e.target.value)}>
                  <option value="movie">Movies</option>
                  <option value="tv">TV Shows</option>
                </select>
                <select className="discover-filter-select" value={customFilters.genre} onChange={(e) => handleCustomFilterChange('genre', e.target.value)}>
                  <option value="">Any Genre</option>
                  <option value="28|12|10759">Action & Adventure</option>
                  <option value="16">Animation</option>
                  <option value="35">Comedy</option>
                  <option value="80">Crime</option>
                  <option value="99">Documentary</option>
                  <option value="18">Drama</option>
                  <option value="10751|10762">Family & Kids</option>
                  <option value="14|878|10765">Sci-Fi & Fantasy</option>
                  <option value="27">Horror</option>
                  <option value="10764">Reality</option>
                  <option value="10749">Romance</option>
                  <option value="35,10749">Romantic Comedy</option>
                  <option value="53">Thriller</option>
                </select>
                <select className="discover-filter-select" value={customFilters.minRating} onChange={(e) => handleCustomFilterChange('minRating', e.target.value)}>
                  <option value="">Any Rating</option>
                  <option value="6">6+ Stars</option>
                  <option value="7">7+ Stars</option>
                  <option value="8">8+ Stars</option>
                </select>
                <select className="discover-filter-select" value={customFilters.yearFrom} onChange={(e) => {
                    const from = e.target.value;
                    let to = '';
                    if (from === 'this_year' || from === 'coming_soon') {
                      to = from;
                    } else if (from) {
                      to = String(parseInt(from) + 9);
                    }
                    const newFilters = { ...customFilters, yearFrom: from, yearTo: to };
                    setCustomFilters(newFilters);
                    fetchDiscover('custom', 1, newFilters);
                }}>
                  <option value="">Any Time</option>
                  <option value="coming_soon">Coming Soon</option>
                  <option value="this_year">This Year</option>
                  <option value="2020">2020s</option>
                  <option value="2010">2010s</option>
                  <option value="2000">2000s</option>
                  <option value="1990">1990s</option>
                  <option value="1980">1980s</option>
                </select>
                <button className="discover-filter-button" onClick={() => { 
                  const reset = { type: 'movie', genre: '', minRating: '', yearFrom: '', yearTo: '', keywords: '' };
                  setCustomFilters(reset); 
                  setDiscoverFilter('trending'); 
                  fetchDiscover('trending', 1); 
                }}>Reset</button>
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
        <div className="modal-backdrop" style={{ zIndex: 1100 }}>
          <div className="modal-content preview-modal">
            <button className="close-button" onClick={closePreview}>&times;</button>
            <div className="preview-header">
                {previewMedia.poster_url && <img src={previewMedia.poster_url} alt={previewMedia.title} className="preview-poster" />}
                <div className="preview-info">
                    <h2>{previewMedia.title} ({previewMedia.year})</h2>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
                      <p className="preview-type" style={{ margin: 0 }}>{previewMedia.type === 'movie' ? 'Movie' : 'TV Show'}</p>
                      {(previewMedia as any).rating && <span style={{ color: '#46d369', fontWeight: 'bold' }}>⭐ {(previewMedia as any).rating}</span>}
                    </div>
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
              <div className="modal-actions" style={{ justifyContent: 'space-between', width: '100%' }}>
                {tmdbEnabled ? (
                  <button 
                    type="button" 
                    onClick={openDiscoverModal}
                  >
                    Discover More
                  </button>
                ) : <div />}
                <div style={{ display: 'flex', gap: '1rem', flex: 1, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={closeModal} disabled={isLoading} style={{ flex: '0 1 auto' }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={isLoading} style={{ flex: '0 1 auto' }}>
                    {isLoading ? 'Adding...' : 'Add'}
                  </button>
                </div>
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
