import React, { useState, useEffect } from 'react';
import './MediaDetail.css';

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
  genres: string[];
  actors: string[];
  tags: { id: number; name: string }[];
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

  useEffect(() => {
    const fetchDetails = async () => {
      setLoading(true);
      try {
        const res = await fetch(`http://localhost:3000/api/media/${mediaId}`);
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

    const fetchTags = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/tags');
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
    await makeApiCall(`http://localhost:3000/api/media/${media.id}/tags`, 'POST', { tagId });
  };

  const handleRemoveTag = async (tagId: number) => {
    if (!media) return;
    const newTags = media.tags.filter(t => t.id !== tagId);
    setMedia({ ...media, tags: newTags });
    await makeApiCall(`http://localhost:3000/api/media/${media.id}/tags/${tagId}`, 'DELETE');
  };

  const toggleMediaWatched = () => {
    if (!media) return;
    const newWatchedState = !media.is_watched;
    setMedia({ ...media, is_watched: newWatchedState });
    makeApiCall(`http://localhost:3000/api/media/${media.id}/watched`, 'POST', { is_watched: newWatchedState });
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
    makeApiCall(`http://localhost:3000/api/episodes/${episode.id}/watched`, 'POST', { is_watched: episode.is_watched });
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
    makeApiCall(`http://localhost:3000/api/seasons/${season.id}/watched`, 'POST', { is_watched: season.is_watched });
  };

  const handleRescrape = async () => {
    if (!media) return;
    const epguidesUrl = window.prompt('Enter epguides.com URL', media.epguides_url || '');
    if (epguidesUrl === null) {
      return;
    }
    setLoading(true);
    try {
      await fetch(`http://localhost:3000/api/media/${media.id}/rescrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ epguidesUrl }),
      });
      // Refetch details to show updated data
      const res = await fetch(`http://localhost:3000/api/media/${mediaId}`);
      if (!res.ok) {
        throw new Error('Failed to fetch updated media details.');
      }
      const data = await res.json();
      setMedia(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!media) return;
    if (window.confirm('Are you sure you want to remove this item?')) {
      try {
        const res = await fetch(`http://localhost:3000/api/media/${media.id}`, {
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

  if (loading) return <div className="detail-loading">Loading...</div>;
  if (error) return <div className="detail-error">Error: {error}</div>;
  if (!media) return null;

  const availableTags = allTags.filter(tag => !media.tags.find(t => t.id === tag.id));

  return (
    <div className="media-detail-backdrop">
      <div className="media-detail-content">
        <button className="close-button" onClick={onClose}>&times;</button>
        <div className="detail-header">
          <img src={media.poster_url || undefined} alt={`${media.title} poster`} className="detail-poster" />
          <div className="detail-info">
            <h1>{media.title} ({media.year})</h1>
            <a href={`https://www.imdb.com/title/${media.imdb_id}`} target="_blank" rel="noopener noreferrer" className="detail-rating">
              IMDB Rating: {media.rating}
            </a>
            <div className="detail-genres">
              {media.genres.map(genre => <span key={genre} className="genre-chip">{genre}</span>)}
            </div>
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
            <p className="detail-description">{media.description}</p>
            {media.type === 'movie' && (
              <button onClick={toggleMediaWatched} className="watch-button">
                {media.is_watched ? 'Mark as Unwatched' : 'Mark as Watched'}
              </button>
            )}
            {media.type === 'tv_show' && (
              <button onClick={handleRescrape} className="watch-button">
                Re-scrape Episodes
              </button>
            )}
          </div>
        </div>

        <button onClick={handleRemove} className="remove-button">Remove</button>

        <h2>Cast</h2>
        <ul className="detail-actors">
          {media.actors.map(actor => <li key={actor}>{actor}</li>)}
        </ul>

        {media.type === 'tv_show' && media.seasons && (
          <>
            <h2>Seasons</h2>
            <div className="seasons-container">
              {media.seasons.map((season, seasonIdx) => (
                <div key={season.id} className="season">
                  <div className="season-header">
                    <h3>Season {season.season_number} ({season.year})</h3>
                    <button 
                      onClick={() => toggleSeasonWatched(seasonIdx)} 
                      className="watch-button season-watch-button"
                      disabled={season.episodes.some(ep => !ep.air_date || new Date(ep.air_date) > new Date())}
                    >
                      {season.is_watched ? 'Mark Season as Unwatched' : 'Mark Season as Watched'}
                    </button>
                  </div>
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
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default MediaDetail;
