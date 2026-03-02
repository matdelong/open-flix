import React, { useState, useEffect, useRef } from 'react';
import './MediaDetail.css';
import StreamingLinksModal from './StreamingLinksModal';

// Define more detailed types to match the backend response
interface Episode {
  id: number;
  episode_number: number;
  title: string;
  air_date: string | null;
  is_watched: boolean;
}

interface Season {
  id: number;
  season_number: number;
  year: number | null;
  is_watched: boolean;
  episodes: Episode[];
}

interface StreamingLink {
  id: number;
  url: string;
  platform: string;
}

interface MediaDetailData {
  id: number;
  imdb_id: string;
  title: string;
  type: 'movie' | 'tv_show';
  poster_url: string | null;
  year: number | null;
  description: string | null;
  rating: string | null;
  is_watched: boolean;
  epguides_url: string | null;
  backdrop_url: string | null;
  trailer_url: string | null;
  status: string | null;
  age_rating: string | null;
  runtime: number | null;
  tagline: string | null;
  networks: string | null;
  creators: string | null;
  genres: string[];
  actors: string[];
  tags: { id: number; name: string }[];
  streaming_links: StreamingLink[];
  seasons?: Season[];
}

interface Tag {
  id: number;
  name: string;
}

interface MediaDetailProps {
  mediaId: number;
  onClose: () => void;
}

const MediaDetail: React.FC<MediaDetailProps> = ({ mediaId, onClose }) => {
  const [media, setMedia] = useState<MediaDetailData | null>(null);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [isStreamingLinksModalOpen, setIsStreamingLinksModalOpen] = useState(false);
  const [collapsedSeasons, setCollapsedSeasons] = useState<Record<number, boolean>>({});
  const initializedMediaId = useRef<number | null>(null);

  useEffect(() => {
    if (media?.type === 'tv_show' && media.seasons && initializedMediaId.current !== media.id) {
      initializedMediaId.current = media.id;
      const initialState: Record<number, boolean> = {};
      media.seasons.forEach(season => {
        const hasEpisodes = season.episodes.length > 0;
        // Check if all aired episodes are watched (and there are actually aired episodes)
        const airedEpisodes = season.episodes.filter(ep => !ep.air_date || new Date(ep.air_date) <= new Date());
        const allAiredWatched = airedEpisodes.length > 0 && airedEpisodes.every(ep => ep.is_watched);
        const hasUnaired = season.episodes.some(ep => ep.air_date && new Date(ep.air_date) > new Date());
        
        // Collapse if all aired episodes are watched AND there are no unaired episodes.
        // Wait, user said "Seasons where all episodes are watched should be collapsed by default."
        // If there are unaired episodes, they can't be watched, so the season shouldn't be collapsed.
        if (hasEpisodes && allAiredWatched && !hasUnaired) {
            initialState[season.id] = true;
        } else {
            initialState[season.id] = false;
        }
      });
      setCollapsedSeasons(initialState);
    }
  }, [media]);

  const toggleSeasonCollapse = (seasonId: number) => {
    setCollapsedSeasons(prev => ({ ...prev, [seasonId]: !prev[seasonId] }));
  };

  const fetchDetails = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/media/${mediaId}`);
      if (!res.ok) {
        throw new Error('Failed to fetch media details.');
      }
      const data = await res.json();
      setMedia(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const fetchTags = async () => {
      try {
        const res = await fetch('/api/tags');
        if (!res.ok) {
          throw new Error('Failed to fetch tags');
        }
        const data = await res.json();
        setAllTags(data);
      } catch (err: any) {
        setError(err.message);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    fetchDetails();
    fetchTags();
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mediaId, onClose]);
  
  const makeApiCall = async (url: string, method: string, body?: object) => {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        throw new Error('API request failed');
      }
    } catch (err) {
      console.error(err);
      // Optionally revert state change or show error to user
    }
  };

  const handleAddTag = async (tagId: number) => {
    if (!media) return;
    const tag = allTags.find(t => t.id === tagId);
    if (!tag || media.tags.find(t => t.id === tagId)) {
      return;
    }
    const newTags = [...media.tags, tag];
    setMedia({ ...media, tags: newTags });
    await makeApiCall(`/api/media/${media.id}/tags`, 'POST', { tagId });
  };

  const handleRemoveTag = async (tagId: number) => {
    if (!media) return;
    const newTags = media.tags.filter(t => t.id !== tagId);
    setMedia({ ...media, tags: newTags });
    await makeApiCall(`/api/media/${media.id}/tags/${tagId}`, 'DELETE');
  };

  const toggleMediaWatched = () => {
    if (!media) return;
    const newWatchedState = !media.is_watched;
    setMedia({ ...media, is_watched: newWatchedState });
    makeApiCall(`/api/media/${media.id}/watched`, 'POST', { is_watched: newWatchedState });
  };

  const toggleEpisodeWatched = (seasonIdx: number, episodeIdx: number) => {
    if (!media || !media.seasons) return;

    const newSeasons = media.seasons.map((season, sIdx) => {
      if (sIdx !== seasonIdx) return season;
      const newEpisodes = season.episodes.map((episode, eIdx) => {
        if (eIdx !== episodeIdx) return episode;
        return { ...episode, is_watched: !episode.is_watched };
      });
      return { ...season, episodes: newEpisodes };
    });

    const episode = newSeasons[seasonIdx].episodes[episodeIdx];
    setMedia({ ...media, seasons: newSeasons });
    makeApiCall(`/api/episodes/${episode.id}/watched`, 'POST', { is_watched: episode.is_watched });
  };
  
  const toggleSeasonWatched = (seasonIdx: number) => {
    if (!media || !media.seasons) return;
    
    const newSeasons = media.seasons.map((season, sIdx) => {
      if (sIdx !== seasonIdx) return season;
      
      const newWatchedState = !season.is_watched;
      const newEpisodes = season.episodes.map(ep => {
        const hasAired = !ep.air_date || new Date(ep.air_date) <= new Date();
        return { ...ep, is_watched: hasAired ? newWatchedState : ep.is_watched };
      });
      return { ...season, is_watched: newWatchedState, episodes: newEpisodes };
    });

    const season = newSeasons[seasonIdx];
    setMedia({ ...media, seasons: newSeasons });
    makeApiCall(`/api/seasons/${season.id}/watched`, 'POST', { is_watched: season.is_watched });
  };

  const handleRescrape = async () => {
    if (!media) return;
    setLoading(true);
    try {
      const rescrapeRes = await fetch(`/api/media/${media.id}/rescrape`, {
        method: 'POST',
      });
      if (!rescrapeRes.ok) {
        const errData = await rescrapeRes.json();
        throw new Error(errData.error || 'Failed to rescrape.');
      }
      // Refetch details to show updated data
      const res = await fetch(`/api/media/${mediaId}`);
      if (!res.ok) {
        throw new Error('Failed to fetch updated media details.');
      }
      const data = await res.json();
      setMedia(data);
    } catch (err: any) {
      window.alert(err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!media) return;
    if (window.confirm('Are you sure you want to remove this item?')) {
      try {
        const res = await fetch(`/api/media/${media.id}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          throw new Error('API request failed');
        }
        onClose();
      } catch (err) {
        console.error(err);
        // Optionally revert state change or show error to user
      }
    }
  };

  const getPlatformIcon = (platform: string) => {
    const baseUrl = 'https://unpkg.com/simple-icons@v14.0.0/icons/';
    switch (platform) {
      case 'Netflix': return `${baseUrl}netflix.svg`;
      case 'Amazon Prime Video': return `${baseUrl}amazon.svg`;
      case 'Plex': return `${baseUrl}plex.svg`;
      case 'Disney+': return 'https://upload.wikimedia.org/wikipedia/commons/3/3e/Disney%2B_logo.svg';
      case 'BBC IPlayer': return 'https://www.svgrepo.com/show/514952/bbc-iplayer.svg';
      case 'Channel 4': return `${baseUrl}channel4.svg`;
      case 'Hulu': return 'https://icongr.am/simple/hulu.svg';
      case 'Max': return `${baseUrl}hbo.svg`;
      case 'Apple TV+': return `${baseUrl}appletv.svg`;
      case 'Paramount+': return `${baseUrl}paramountplus.svg`;
      case 'Peacock': return 'https://upload.wikimedia.org/wikipedia/commons/d/d3/NBCUniversal_Peacock_Logo.svg';
      default: return null;
    }
  };

  const getLinkTooltip = (url: string, platform: string) => {
    if (platform !== 'Other') {
      return `Watch on ${platform}`;
    }
    try {
      const hostname = new URL(url).hostname;
      // Check if hostname looks like a normal domain (has letters, maybe dots/dashes, no purely numeric/IP look)
      if (/[a-zA-Z]/.test(hostname) && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
         return `Watch on ${hostname.replace('www.', '')}`;
      }
    } catch (e) {
      // ignore invalid URLs
    }
    return "Watch online";
  };

  if (loading) return <div className="detail-loading">Loading...</div>;
  if (error) return <div className="detail-error">Error: {error}</div>;
  if (!media) return null;

  const availableTags = allTags.filter(tag => !media.tags.find(t => t.id === tag.id));

  return (
    <div className="media-detail-backdrop" style={media.backdrop_url ? {
      backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.95) 100%), url(${media.backdrop_url})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    } : {}}>
      <div className="media-detail-content">
        <button className="close-button" onClick={onClose}>&times;</button>
        <div className="detail-header">
          <img src={media.poster_url || undefined} alt={`${media.title} poster`} className="detail-poster" />
          <div className="detail-info">
            <h1>{media.title} ({media.year})</h1>
            {media.tagline && <p style={{ fontStyle: 'italic', color: '#aaa', margin: '0 0 1rem 0' }}>{media.tagline}</p>}
            
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <a href={`https://www.imdb.com/title/${media.imdb_id}`} target="_blank" rel="noopener noreferrer" className="detail-rating">
                ⭐ {media.rating}
              </a>
              {media.age_rating && <span style={{ border: '1px solid #555', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.8rem' }}>{media.age_rating}</span>}
              {media.runtime && <span style={{ color: '#ccc', fontSize: '0.9rem' }}>{media.runtime} min</span>}
              {media.status && <span style={{ color: '#ccc', fontSize: '0.9rem' }}>• {media.status}</span>}
            </div>

            <div className="detail-genres">
              {media.genres.map(genre => <span key={genre} className="genre-chip">{genre}</span>)}
            </div>
            
            {media.networks && <p style={{ fontSize: '0.9rem', color: '#bbb' }}><strong>Network/Studio:</strong> {media.networks}</p>}
            {media.creators && <p style={{ fontSize: '0.9rem', color: '#bbb' }}><strong>Creator/Director:</strong> {media.creators}</p>}

            <div className="detail-tags">
              {media.tags.map(tag => (
                <span key={tag.id} className="tag-chip">
                  {tag.name}
                  <button onClick={() => handleRemoveTag(tag.id)}>&times;</button>
                </span>
              ))}
            </div>
            <div className="add-tag-container">
              <select onChange={(e) => handleAddTag(parseInt(e.target.value, 10))} value="">
                <option value="" disabled>Add a tag...</option>
                {availableTags.map(tag => (
                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                ))}
              </select>
            </div>
            <div className="streaming-links">
              {media && media.streaming_links && media.streaming_links.map(link => {
                const iconUrl = getPlatformIcon(link.platform);
                const tooltip = getLinkTooltip(link.url, link.platform);
                return (
                  <a href={link.url} key={link.id} target="_blank" rel="noopener noreferrer" className="streaming-link-icon" title={tooltip}>
                    {iconUrl ? <img src={iconUrl} alt={link.platform} style={{ width: '24px', height: '24px' }} /> : '🔗'}
                  </a>
                );
              })}
              <button onClick={() => setIsStreamingLinksModalOpen(true)} className="streaming-link-button"></button>
            </div>
            <p className="detail-description">{media.description}</p>
            
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              {media.type === 'movie' && (
                <button onClick={toggleMediaWatched} className="watch-button" style={{ marginTop: 0 }}>
                  {media.is_watched ? 'Mark as Unwatched' : 'Mark as Watched'}
                </button>
              )}
              {media.type === 'tv_show' && (
                <button onClick={handleRescrape} className="watch-button" style={{ marginTop: 0 }}>
                  Re-scrape Episodes
                </button>
              )}
              {media.trailer_url && (
                <a href={media.trailer_url} target="_blank" rel="noopener noreferrer" className="watch-button" style={{ textDecoration: 'none', display: 'inline-block', marginTop: 0, backgroundColor: '#e50914', color: '#fff', fontWeight: 'bold' }}>
                  ▶ Watch Trailer
                </a>
              )}
            </div>
          </div>
        </div>

        <h2>Cast</h2>
        <ul className="detail-actors">
          {media.actors.map(actor => <li key={actor}>{actor}</li>)}
        </ul>

        {media.type === 'tv_show' && media.seasons && (
          <>
            <h2>Seasons</h2>
            <div className="seasons-container">
              {media.seasons.map((season, seasonIdx) => {
                const isCollapsed = collapsedSeasons[season.id];
                return (
                  <div key={season.id} className="season">
                    <div 
                      className="season-header" 
                      onClick={() => toggleSeasonCollapse(season.id)}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                    >
                      <h3 style={{ margin: 0, borderBottom: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {isCollapsed ? '▶' : '▼'} Season {season.season_number} ({season.year})
                      </h3>
                      <button 
                        onClick={(e) => { e.stopPropagation(); toggleSeasonWatched(seasonIdx); }} 
                        className="watch-button season-watch-button"
                        style={{ marginTop: 0 }}
                        disabled={season.episodes.some(ep => !ep.air_date || new Date(ep.air_date) > new Date())}
                      >
                        {season.is_watched ? 'Mark Season as Unwatched' : 'Mark Season as Watched'}
                      </button>
                    </div>
                    {!isCollapsed && (
                      <ul className="episode-list">
                        {season.episodes.map((episode, episodeIdx) => {
                          const hasAired = !episode.air_date || new Date(episode.air_date) <= new Date();
                          return (
                            <li key={episode.id} className={episode.is_watched ? 'watched' : ''}>
                              <label>
                                <input 
                                  type="checkbox" 
                                  checked={episode.is_watched}
                                  onChange={() => hasAired && toggleEpisodeWatched(seasonIdx, episodeIdx)}
                                  disabled={!hasAired}
                                />
                                Ep {episode.episode_number}: {episode.title}
                                {episode.air_date && <span className="air-date" style={{marginLeft: '8px'}}>({new Date(episode.air_date).toLocaleDateString()})</span>}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '3rem' }}>
          <button onClick={handleRemove} className="remove-button">Remove from Library</button>
        </div>
      </div>
      {isStreamingLinksModalOpen && (
        <StreamingLinksModal
          mediaId={media.id}
          links={media.streaming_links}
          onClose={() => setIsStreamingLinksModalOpen(false)}
          onSave={fetchDetails}
        />
      )}
    </div>
  );
};

export default MediaDetail;
