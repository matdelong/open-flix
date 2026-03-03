const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json()); // Middleware to parse JSON bodies
app.use(cookieParser());

// Auth Middleware
const authMiddleware = (req, res, next) => {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).send('Unauthorized: No token provided');
  }
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    // Use environment variable WEB_PIN
    if (decoded === process.env.WEB_PIN) {
      next();
    } else {
      res.status(401).send('Unauthorized: Invalid passcode');
    }
  } catch (e) {
    res.status(401).send('Unauthorized: Invalid token format');
  }
};

// Apply auth middleware to all API routes
app.use('/api', authMiddleware);

// PostgreSQL client setup
const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  port: 5432,
});

const initDb = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create new schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS media (
        id SERIAL PRIMARY KEY,
        imdb_id TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        type VARCHAR(50) NOT NULL,
        poster_url TEXT,
        description TEXT,
        year INTEGER,
        rating VARCHAR(10),
        is_watched BOOLEAN DEFAULT FALSE,
        epguides_url TEXT
      );
    `);
    
    // Add extra rich metadata columns if they don't exist
    await client.query(`
      ALTER TABLE media
      ADD COLUMN IF NOT EXISTS backdrop_url TEXT,
      ADD COLUMN IF NOT EXISTS trailer_url TEXT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(50),
      ADD COLUMN IF NOT EXISTS age_rating VARCHAR(20),
      ADD COLUMN IF NOT EXISTS runtime INTEGER,
      ADD COLUMN IF NOT EXISTS tagline TEXT,
      ADD COLUMN IF NOT EXISTS networks TEXT,
      ADD COLUMN IF NOT EXISTS creators TEXT;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS genres (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS media_genres (
        media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
        genre_id INTEGER REFERENCES genres(id) ON DELETE CASCADE,
        PRIMARY KEY (media_id, genre_id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS actors (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS media_actors (
        media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
        actor_id INTEGER REFERENCES actors(id) ON DELETE CASCADE,
        PRIMARY KEY (media_id, actor_id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS seasons (
        id SERIAL PRIMARY KEY,
        media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
        season_number INTEGER NOT NULL,
        year INTEGER,
        is_watched BOOLEAN DEFAULT FALSE,
        UNIQUE (media_id, season_number)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS episodes (
        id SERIAL PRIMARY KEY,
        season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
        episode_number INTEGER NOT NULL,
        title TEXT,
        air_date DATE,
        is_watched BOOLEAN DEFAULT FALSE
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        sort_order INTEGER
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS media_tags (
        media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
        tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (media_id, tag_id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS streaming_links (
        id SERIAL PRIMARY KEY,
        media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        platform VARCHAR(100) NOT NULL
      );
    `);

    await client.query('COMMIT');
    console.log('Database initialized successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error initializing database', err.stack);
  } finally {
    client.release();
  }
};

app.get('/', (req, res) => {
  res.send('Hello from the backend!');
});

app.post('/api/media', async (req, res) => {
  let { imdbUrl, tmdbId, type } = req.body;

  if (tmdbId && type) {
    if (!process.env.TMDB_API_KEY) {
      return res.status(503).json({ error: 'TMDB integration not configured' });
    }
    try {
      const endpoint = type === 'movie' ? 'movie' : 'tv';
      const tmdbRes = await axios.get(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}/external_ids`, {
        params: { api_key: process.env.TMDB_API_KEY }
      });
      const imdbId = tmdbRes.data.imdb_id;
      if (!imdbId) {
        return res.status(404).json({ error: 'IMDB ID not found for this media on TMDB.' });
      }
      imdbUrl = `https://www.imdb.com/title/${imdbId}/`;
      console.log(`Resolved TMDB ID ${tmdbId} to IMDB URL: ${imdbUrl}`);
    } catch (error) {
      console.error('TMDB ID resolution error:', error);
      return res.status(500).json({ error: 'Failed to resolve TMDB ID to IMDB ID' });
    }
  }

  if (!imdbUrl) {
    return res.status(400).json({ error: 'imdbUrl or (tmdbId and type) is required' });
  }

  const client = await pool.connect();
  try {
    const imdbIdMatch = imdbUrl.match(/title\/(tt\d+)/);
    if (!imdbIdMatch) {
      return res.status(400).json({ error: 'Invalid IMDB URL' });
    }
    const imdbId = imdbIdMatch[1];

    const existingMedia = await client.query('SELECT * FROM media WHERE imdb_id = $1', [imdbId]);
    if (existingMedia.rowCount > 0) {
      return res.status(409).json({ error: 'Media with this IMDB ID already exists.', existingMediaId: existingMedia.rows[0].id });
    }

    let title, year, description, poster_url, rating, genres = [], actors = [], mediaType;
    let backdrop_url, trailer_url, status, age_rating, runtime, tagline, networks = [], creators = [], watch_providers = [];
    let globalTmdbId = null;

    if (!process.env.TMDB_API_KEY) {
      return res.status(503).json({ error: 'TMDB API key is required to add media.' });
    }

    console.log(`Using TMDB API for IMDB ID: ${imdbId}`);
    try {
      const findRes = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}`, {
        params: { api_key: process.env.TMDB_API_KEY, external_source: 'imdb_id' }
      });
      
      let tmdbItem = null;
      let tmdbType = null;
      if (findRes.data.movie_results.length > 0) {
        tmdbItem = findRes.data.movie_results[0];
        tmdbType = 'movie';
      } else if (findRes.data.tv_results.length > 0) {
        tmdbItem = findRes.data.tv_results[0];
        tmdbType = 'tv';
      }

      if (tmdbItem) {
        globalTmdbId = tmdbItem.id;
        const detailRes = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdbItem.id}`, {
          params: { api_key: process.env.TMDB_API_KEY, append_to_response: 'credits,videos,release_dates,content_ratings,watch/providers' }
        });
        const d = detailRes.data;

        title = d.title || d.name;
        const dateStr = d.release_date || d.first_air_date;
        year = dateStr ? parseInt(dateStr.substring(0, 4), 10) : null;
        description = d.overview;
        poster_url = d.poster_path ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${d.poster_path}` : null;
        rating = d.vote_average ? d.vote_average.toFixed(1).toString() : null;
        mediaType = tmdbType === 'tv' ? 'tv_show' : 'movie';
        
        backdrop_url = d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : null;
        status = d.status || null;
        tagline = d.tagline || null;
        runtime = d.runtime || (d.episode_run_time && d.episode_run_time[0]) || null;
        
        if (d.videos && d.videos.results) {
          const trailer = d.videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube');
          if (trailer) trailer_url = `https://www.youtube.com/watch?v=${trailer.key}`;
        }

        if (tmdbType === 'movie' && d.release_dates && d.release_dates.results) {
          const usRelease = d.release_dates.results.find(r => r.iso_3166_1 === 'US');
          if (usRelease && usRelease.release_dates && usRelease.release_dates.length > 0) {
            age_rating = usRelease.release_dates[0].certification;
          }
        } else if (tmdbType === 'tv' && d.content_ratings && d.content_ratings.results) {
          const usRating = d.content_ratings.results.find(r => r.iso_3166_1 === 'US');
          if (usRating) age_rating = usRating.rating;
        }

        if (tmdbType === 'tv' && d.networks) {
          networks = d.networks.map(n => n.name);
        } else if (tmdbType === 'movie' && d.production_companies) {
          networks = d.production_companies.map(p => p.name);
        }

        if (tmdbType === 'tv' && d.created_by) {
          creators = d.created_by.map(c => c.name);
        } else if (tmdbType === 'movie' && d.credits && d.credits.crew) {
          creators = d.credits.crew.filter(c => c.job === 'Director').map(c => c.name);
        }

        if (d['watch/providers'] && d['watch/providers'].results && d['watch/providers'].results.US) {
          const usProviders = d['watch/providers'].results.US;
          const link = usProviders.link;
          if (usProviders.flatrate) {
            const allowedPlatforms = ['Netflix', 'Amazon Prime Video', 'Disney+', 'Hulu', 'Max', 'Apple TV+', 'Paramount+', 'Peacock', 'BBC iPlayer', 'Channel 4'];
            usProviders.flatrate.forEach(p => {
              let name = p.provider_name;
              if (name === 'Disney Plus') name = 'Disney+';
              if (name === 'Apple TV Plus') name = 'Apple TV+';
              if (name === 'Paramount Plus') name = 'Paramount+';
              if (name === 'Peacock Premium') name = 'Peacock';
              
              if (allowedPlatforms.includes(name) && !watch_providers.some(wp => wp.platform === name)) {
                watch_providers.push({ platform: name, url: link });
              }
            });
          }
        }
        
        if (d.genres) genres = d.genres.map(g => g.name);
        if (d.credits && d.credits.cast) actors = d.credits.cast.slice(0, 10).map(c => c.name);
      } else {
        console.warn('IMDB ID not found on TMDB.');
      }
    } catch (err) {
      console.warn('TMDB fetch failed.', err.message);
    }

    if (!title) {
      throw new Error('Could not retrieve media details from TMDB. Please ensure your TMDB_API_KEY is configured and the IMDB ID is valid.');
    }

    await client.query('BEGIN');

    const newMediaRes = await client.query(
      `INSERT INTO media (imdb_id, title, type, poster_url, description, year, rating, backdrop_url, trailer_url, status, age_rating, runtime, tagline, networks, creators)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [imdbId, title, mediaType, poster_url, description, year, rating, backdrop_url, trailer_url, status, age_rating, runtime, tagline, networks.join(', '), creators.join(', ')]
    );
    const newMedia = newMediaRes.rows[0];

    for (const wp of watch_providers) {
      await client.query(
        'INSERT INTO streaming_links (media_id, url, platform) VALUES ($1, $2, $3)',
        [newMedia.id, wp.url, wp.platform]
      );
    }

    for (const name of genres) {
      let genreRes = await client.query('SELECT id FROM genres WHERE name = $1', [name]);
      let genreId;
      if (genreRes.rowCount === 0) {
        genreRes = await client.query('INSERT INTO genres (name) VALUES ($1) RETURNING id', [name]);
        genreId = genreRes.rows[0].id;
      } else {
        genreId = genreRes.rows[0].id;
      }
      await client.query('INSERT INTO media_genres (media_id, genre_id) VALUES ($1, $2)', [newMedia.id, genreId]);
    }
    
    for (const name of actors) {
      if (!name) continue;
      let actorRes = await client.query('SELECT id FROM actors WHERE name = $1', [name]);
      let actorId;
      if (actorRes.rowCount === 0) {
        actorRes = await client.query('INSERT INTO actors (name) VALUES ($1) RETURNING id', [name]);
        actorId = actorRes.rows[0].id;
      } else {
        actorId = actorRes.rows[0].id;
      }
      await client.query('INSERT INTO media_actors (media_id, actor_id) VALUES ($1, $2)', [newMedia.id, actorId]);
    }

      if (mediaType === 'tv_show' && globalTmdbId) {
        try {
          console.log(`Fetching seasons and episodes from TMDB for TV Show ID: ${globalTmdbId}`);
          const tvRes = await axios.get(`https://api.themoviedb.org/3/tv/${globalTmdbId}`, {
            params: { api_key: process.env.TMDB_API_KEY }
          });
          const seasons = tvRes.data.seasons;

          for (const season of seasons) {
            if (season.season_number === 0) continue; // Skip specials by default
            
            const yearForSeason = season.air_date ? parseInt(season.air_date.substring(0, 4), 10) : null;
            const seasonRes = await client.query(
              'INSERT INTO seasons (media_id, season_number, year) VALUES ($1, $2, $3) RETURNING id',
              [newMedia.id, season.season_number, yearForSeason]
            );
            const seasonIdForEpisode = seasonRes.rows[0].id;
            console.log(`Added Season ${season.season_number} for ${title}`);

            const seasonDetailRes = await axios.get(`https://api.themoviedb.org/3/tv/${globalTmdbId}/season/${season.season_number}`, {
              params: { api_key: process.env.TMDB_API_KEY }
            });
            const episodes = seasonDetailRes.data.episodes;

            for (const ep of episodes) {
              await client.query(
                'INSERT INTO episodes (season_id, episode_number, title, air_date) VALUES ($1, $2, $3, $4)',
                [seasonIdForEpisode, ep.episode_number, ep.name, ep.air_date ? new Date(ep.air_date) : null]
              );
              console.log(`  Added S${season.season_number}E${ep.episode_number}: ${ep.name}`);
            }
          }
        } catch (tmdbErr) {
          console.error("Failed to fetch episodes from TMDB.", tmdbErr.message);
        }
      }

      await client.query('COMMIT');
      res.status(201).json(newMedia);

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Scraping or DB error:', error);
      res.status(500).json({ error: 'Failed to scrape or save media.' });
    } finally {
      client.release();
    }
  });

app.get('/api/media/grouped', async (req, res) => {
  try {
    const query = `
      SELECT category, media, sort_order, type
      FROM (
        SELECT 
          t.name AS category,
          t.sort_order,
          1 AS type,
          json_agg(
            json_build_object(
              'id', m.id, 'title', m.title, 'type', m.type, 'poster_url', m.poster_url, 'year', m.year, 'rating', m.rating
            ) ORDER BY m.rating DESC, m.title
          ) AS media
        FROM tags t
        JOIN media_tags mt ON t.id = mt.tag_id
        JOIN media m ON mt.media_id = m.id
        GROUP BY t.id, t.name, t.sort_order

        UNION ALL

        SELECT 
          g.name AS category, 
          NULL AS sort_order,
          2 AS type,
          json_agg(
            json_build_object(
              'id', m.id, 'title', m.title, 'type', m.type, 'poster_url', m.poster_url, 'year', m.year, 'rating', m.rating
            ) ORDER BY m.rating DESC, m.title
          ) AS media
        FROM genres g
        JOIN media_genres mg ON g.id = mg.genre_id
        JOIN media m ON mg.media_id = m.id
        WHERE m.id NOT IN (SELECT media_id FROM media_tags)
        GROUP BY g.name

        UNION ALL

        SELECT 
          'Other' AS category,
          NULL AS sort_order,
          3 AS type,
          json_agg(
            json_build_object(
              'id', m.id, 'title', m.title, 'type', m.type, 'poster_url', m.poster_url, 'year', m.year, 'rating', m.rating
            ) ORDER BY m.rating DESC, m.title
          ) AS media
        FROM media m
        WHERE m.id NOT IN (SELECT media_id FROM media_tags)
          AND m.id NOT IN (SELECT media_id FROM media_genres)
      ) AS result
      ORDER BY type, sort_order, category;
    `;

    const { rows } = await pool.query(query);
    const grouped = rows.reduce((acc, row) => {
      if (row.media) {
        acc[row.category] = row.media;
      }
      return acc;
    }, {});

    res.json(grouped);

  } catch (err) {
    console.error('Error grouping media', err.stack);
    res.status(500).send('Server Error');
  }
});

app.get('/api/media/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const mediaRes = await pool.query('SELECT * FROM media WHERE id = $1', [id]);
    if (mediaRes.rowCount === 0) {
      return res.status(404).json({ error: 'Media not found' });
    }
    const media = mediaRes.rows[0];

    const genresRes = await pool.query(`
      SELECT g.name FROM genres g
      JOIN media_genres mg ON g.id = mg.genre_id
      WHERE mg.media_id = $1
    `, [id]);
    media.genres = genresRes.rows.map(r => r.name);

    const actorsRes = await pool.query(`
      SELECT a.name FROM actors a
      JOIN media_actors ma ON a.id = ma.actor_id
      WHERE ma.media_id = $1
    `, [id]);
    media.actors = actorsRes.rows.map(r => r.name);

    const tagsRes = await pool.query(`
      SELECT t.id, t.name FROM tags t
      JOIN media_tags mt ON t.id = mt.tag_id
      WHERE mt.media_id = $1
      ORDER BY t.sort_order
    `, [id]);
    media.tags = tagsRes.rows;

    const streamingLinksRes = await pool.query('SELECT * FROM streaming_links WHERE media_id = $1', [id]);
    media.streaming_links = streamingLinksRes.rows;

    if (media.type === 'tv_show') {
      const seasonsRes = await pool.query('SELECT * FROM seasons WHERE media_id = $1 ORDER BY season_number', [id]);
      const seasons = seasonsRes.rows;

      for (const season of seasons) {
        const episodesRes = await pool.query('SELECT * FROM episodes WHERE season_id = $1 ORDER BY episode_number', [season.id]);
        season.episodes = episodesRes.rows;
      }
      media.seasons = seasons;
    }

    res.json(media);
  } catch (err) {
    console.error(`Error fetching media with id ${id}`, err.stack);
    res.status(500).send('Server Error');
  }
});

app.delete('/api/media/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM media WHERE id = $1', [id]);
    res.sendStatus(204);
  } catch (err) {
    console.error(`Error deleting media with id ${id}`, err.stack);
    res.status(500).send('Server Error');
  }
});

// Tag Management Endpoints
app.get('/api/tags', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tags ORDER BY sort_order');
    res.json(rows);
  } catch (err) {
    console.error('Error getting tags', err.stack);
    res.status(500).send('Server Error');
  }
});

app.post('/api/tags', async (req, res) => {
  const { name } = req.body;
  try {
    const { rows } = await pool.query('INSERT INTO tags (name) VALUES ($1) RETURNING *', [name]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating tag', err.stack);
    res.status(500).send('Server Error');
  }
});

app.put('/api/tags', async (req, res) => {
  const { tags } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const tag of tags) {
      await client.query('UPDATE tags SET sort_order = $1 WHERE id = $2', [tag.sort_order, tag.id]);
    }
    await client.query('COMMIT');
    res.sendStatus(204);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating tag order', err.stack);
    res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

app.delete('/api/tags/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM tags WHERE id = $1', [id]);
    res.sendStatus(204);
  } catch (err) {
    console.error('Error deleting tag', err.stack);
    res.status(500).send('Server Error');
  }
});

app.post('/api/media/:id/tags', async (req, res) => {
  const { id } = req.params;
  const { tagId } = req.body;
  try {
    await pool.query('INSERT INTO media_tags (media_id, tag_id) VALUES ($1, $2)', [id, tagId]);
    res.sendStatus(204);
  } catch (err) {
    console.error('Error adding tag to media', err.stack);
    res.status(500).send('Server Error');
  }
});

app.delete('/api/media/:id/tags/:tagId', async (req, res) => {
  const { id, tagId } = req.params;
  try {
    await pool.query('DELETE FROM media_tags WHERE media_id = $1 AND tag_id = $2', [id, tagId]);
    res.sendStatus(204);
  } catch (err) {
    console.error('Error removing tag from media', err.stack);
    res.status(500).send('Server Error');
  }
});

// Streaming Link Management Endpoints
const detectPlatform = (url) => {
  if (url.includes('netflix')) return 'Netflix';
  if (url.includes('amazon') || url.includes('a.co')) return 'Amazon Prime Video';
  if (url.includes('plex.tv') || url.includes('192.168.1.124:32400')) return 'Plex';
  if (url.includes('disneyplus.com')) return 'Disney+';
  if (url.includes('bbc.co.uk/iplayer')) return 'BBC IPlayer';
  if (url.includes('channel4.com')) return 'Channel 4';
  return 'Other';
};

app.post('/api/media/:id/streaming-links', async (req, res) => {
  const { id } = req.params;
  const { url } = req.body;
  const platform = detectPlatform(url);
  try {
    const { rows } = await pool.query(
      'INSERT INTO streaming_links (media_id, url, platform) VALUES ($1, $2, $3) RETURNING *',
      [id, url, platform]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating streaming link', err.stack);
    res.status(500).send('Server Error');
  }
});

app.put('/api/media/:id/streaming-links/:linkId', async (req, res) => {
  const { linkId } = req.params;
  const { url } = req.body;
  const platform = detectPlatform(url);
  try {
    const { rows } = await pool.query(
      'UPDATE streaming_links SET url = $1, platform = $2 WHERE id = $3 RETURNING *',
      [url, platform, linkId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating streaming link', err.stack);
    res.status(500).send('Server Error');
  }
});

app.delete('/api/media/:id/streaming-links/:linkId', async (req, res) => {
  const { linkId } = req.params;
  try {
    await pool.query('DELETE FROM streaming_links WHERE id = $1', [linkId]);
    res.sendStatus(204);
  } catch (err) {
    console.error('Error deleting streaming link', err.stack);
    res.status(500).send('Server Error');
  }
});

// Endpoints for marking as watched
app.post('/api/media/:id/watched', async (req, res) => {
  const { id } = req.params;
  const { is_watched } = req.body;
  try {
    await pool.query('UPDATE media SET is_watched = $1 WHERE id = $2', [is_watched, id]);
    res.sendStatus(204);
  } catch (err) {
    console.error(`Error updating watched status for media ${id}`, err.stack);
    res.status(500).send('Server Error');
  }
});

app.post('/api/seasons/:id/watched', async (req, res) => {
  const { id } = req.params;
  const { is_watched } = req.body;
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE seasons SET is_watched = $1 WHERE id = $2', [is_watched, id]);
      // Also mark all episodes in that season
      if (is_watched) {
        await client.query('UPDATE episodes SET is_watched = $1 WHERE season_id = $2 AND (air_date IS NULL OR air_date <= CURRENT_DATE)', [is_watched, id]);
      } else {
        await client.query('UPDATE episodes SET is_watched = $1 WHERE season_id = $2', [is_watched, id]);
      }
      await client.query('COMMIT');
      res.sendStatus(204);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(`Error updating watched status for season ${id}`, err.stack);
    res.status(500).send('Server Error');
  }
});

app.post('/api/episodes/:id/watched', async (req, res) => {
  const { id } = req.params;
  const { is_watched } = req.body;
  try {
    await pool.query('UPDATE episodes SET is_watched = $1 WHERE id = $2', [is_watched, id]);
    res.sendStatus(204);
  } catch (err) {
    console.error(`Error updating watched status for episode ${id}`, err.stack);
    res.status(500).send('Server Error');
  }
});


app.post('/api/media/:id/rescrape', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    const mediaRes = await client.query('SELECT * FROM media WHERE id = $1', [id]);
    if (mediaRes.rowCount === 0) {
      return res.status(404).json({ error: 'Media not found' });
    }
    const media = mediaRes.rows[0];

    if (media.type !== 'tv_show') {
      return res.status(400).json({ error: 'Cannot rescrape a movie.' });
    }

    if (!process.env.TMDB_API_KEY) {
      return res.status(503).json({ error: 'TMDB API key is required to rescrape media.' });
    }

    // Find the TMDB ID using the IMDB ID
    let tmdbId = null;
    try {
      const findRes = await axios.get(`https://api.themoviedb.org/3/find/${media.imdb_id}`, {
        params: { api_key: process.env.TMDB_API_KEY, external_source: 'imdb_id' }
      });
      if (findRes.data.tv_results.length > 0) {
        tmdbId = findRes.data.tv_results[0].id;
      }
    } catch (e) {
      console.error("Failed to find TMDB ID for rescrape", e.message);
    }

    if (!tmdbId) {
       return res.status(404).json({ error: 'Could not find TMDB ID for this media to rescrape.' });
    }

    await client.query('BEGIN');

    // Get existing watched episodes
    const watchedEpisodesRes = await client.query(`
      SELECT s.season_number, e.episode_number
      FROM episodes e
      JOIN seasons s ON e.season_id = s.id
      WHERE s.media_id = $1 AND e.is_watched = TRUE
    `, [id]);
    const watchedEpisodes = new Set(watchedEpisodesRes.rows.map(r => `${r.season_number}-${r.episode_number}`));

    // Clear existing episode data
    await client.query(`
      DELETE FROM episodes WHERE season_id IN (SELECT id FROM seasons WHERE media_id = $1)
    `, [id]);
    await client.query('DELETE FROM seasons WHERE media_id = $1', [id]);

    // Fetch from TMDB
    const tvRes = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}`, {
      params: { api_key: process.env.TMDB_API_KEY }
    });
    const seasons = tvRes.data.seasons;

    for (const season of seasons) {
      if (season.season_number === 0) continue; // Skip specials by default
      
      const yearForSeason = season.air_date ? parseInt(season.air_date.substring(0, 4), 10) : null;
      const seasonRes = await client.query(
        'INSERT INTO seasons (media_id, season_number, year) VALUES ($1, $2, $3) RETURNING id',
        [id, season.season_number, yearForSeason]
      );
      const seasonIdForEpisode = seasonRes.rows[0].id;
      console.log(`Added Season ${season.season_number} for ${media.title}`);

      const seasonDetailRes = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${season.season_number}`, {
        params: { api_key: process.env.TMDB_API_KEY }
      });
      const episodes = seasonDetailRes.data.episodes;

      for (const ep of episodes) {
        const isWatched = watchedEpisodes.has(`${season.season_number}-${ep.episode_number}`);
        await client.query(
          'INSERT INTO episodes (season_id, episode_number, title, air_date, is_watched) VALUES ($1, $2, $3, $4, $5)',
          [seasonIdForEpisode, ep.episode_number, ep.name, ep.air_date ? new Date(ep.air_date) : null, isWatched]
        );
        console.log(`  Added S${season.season_number}E${ep.episode_number}: ${ep.name}`);
      }
    }

    await client.query('COMMIT');
    res.sendStatus(204);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Re-scraping error:', error.message);
    res.status(500).json({ error: 'Failed to re-scrape episodes.' });
  } finally {
    client.release();
  }
});

// TMDB Integration
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

app.get('/api/media/:id/recommendations', async (req, res) => {
  const { id } = req.params;
  if (!TMDB_API_KEY) {
    return res.status(503).json({ error: 'TMDB API key not configured' });
  }

  try {
    const mediaRes = await pool.query('SELECT imdb_id, type FROM media WHERE id = $1', [id]);
    if (mediaRes.rowCount === 0) {
      return res.status(404).json({ error: 'Media not found' });
    }
    const media = mediaRes.rows[0];

    // Get TMDB ID
    const findRes = await axios.get(`${TMDB_BASE_URL}/find/${media.imdb_id}`, {
      params: { api_key: TMDB_API_KEY, external_source: 'imdb_id' }
    });
    
    let tmdbId = null;
    let tmdbType = media.type === 'movie' ? 'movie' : 'tv';
    
    if (tmdbType === 'movie' && findRes.data.movie_results.length > 0) {
      tmdbId = findRes.data.movie_results[0].id;
    } else if (tmdbType === 'tv' && findRes.data.tv_results.length > 0) {
      tmdbId = findRes.data.tv_results[0].id;
    }

    if (!tmdbId) {
      return res.json([]); // Can't find it on TMDB, return empty
    }

    const recRes = await axios.get(`${TMDB_BASE_URL}/${tmdbType}/${tmdbId}/recommendations`, {
      params: { api_key: TMDB_API_KEY, language: 'en-US', page: 1 }
    });

    const results = recRes.data.results
      .map(item => {
        return {
            id: item.id,
            title: tmdbType === 'movie' ? item.title : item.name,
            type: media.type,
            poster_url: item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : null,
            year: (item.release_date || item.first_air_date || '').substring(0, 4),
            overview: item.overview,
            rating: item.vote_average ? item.vote_average.toFixed(1).toString() : null,
        };
      })
      .filter(item => item !== null && item.poster_url);

    res.json(results);
  } catch (error) {
    console.error('TMDB Recommendations Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

app.get('/api/search/tmdb', async (req, res) => {
  if (!TMDB_API_KEY) {
    return res.status(503).json({ error: 'TMDB API key not configured' });
  }
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  try {
    const response = await axios.get(`${TMDB_BASE_URL}/search/multi`, {
      params: {
        api_key: TMDB_API_KEY,
        query: q,
        include_adult: false,
        language: 'en-US',
        page: 1,
      },
    });

    const results = response.data.results
      .filter(item => (item.media_type === 'movie' || item.media_type === 'tv') && item.poster_path)
      .map(item => ({
        id: item.id, // TMDB ID
        title: item.media_type === 'movie' ? item.title : item.name,
        type: item.media_type === 'movie' ? 'movie' : 'tv_show',
        poster_path: item.poster_path,
        year: (item.release_date || item.first_air_date || '').substring(0, 4),
        overview: item.overview,
        media_type: item.media_type // keep original type for logic
      }));

    res.json(results);
  } catch (error) {
    console.error('TMDB Search Error:', error.message);
    res.status(500).json({ error: 'Failed to search TMDB' });
  }
});

app.get('/api/recommendations/discover', async (req, res) => {
  if (!TMDB_API_KEY) {
    return res.status(503).json({ error: 'TMDB API key not configured' });
  }

  const { filter, page = 1, count = 3, type, genres, min_rating, year_from, year_to } = req.query;
  let endpoint = '/trending/all/week';
  let defaultMediaType = null; // To infer type if missing
  let params = {
    api_key: TMDB_API_KEY,
    language: 'en-US',
    include_adult: false,
  };

  const today = new Date();
  const future = new Date();
  future.setDate(today.getDate() + 90);
  const todayStr = today.toISOString().split('T')[0];
  const futureStr = future.toISOString().split('T')[0];

  if (filter === 'custom') {
    endpoint = type === 'tv' ? '/discover/tv' : '/discover/movie';
    defaultMediaType = type === 'tv' ? 'tv' : 'movie';
    params.sort_by = 'popularity.desc';
    if (genres) params.with_genres = genres;
    if (min_rating) {
      params['vote_average.gte'] = min_rating;
      params['vote_count.gte'] = 50; // Filter out obscure items with 1 10-star vote
    }
    if (year_from === 'coming_soon') {
      if (type === 'tv') {
        params['first_air_date.gte'] = todayStr;
        params['first_air_date.lte'] = futureStr;
      } else {
        params['primary_release_date.gte'] = todayStr;
        params['primary_release_date.lte'] = futureStr;
      }
    } else if (year_from === 'this_year') {
      const currentYear = new Date().getFullYear();
      if (type === 'tv') {
        params['first_air_date.gte'] = `${currentYear}-01-01`;
        params['first_air_date.lte'] = todayStr;
      } else {
        params['primary_release_date.gte'] = `${currentYear}-01-01`;
        params['primary_release_date.lte'] = todayStr;
      }
    } else {
      if (year_from) {
        if (type === 'tv') params['first_air_date.gte'] = `${year_from}-01-01`;
        else params['primary_release_date.gte'] = `${year_from}-01-01`;
      }
      if (year_to) {
        if (type === 'tv') params['first_air_date.lte'] = `${year_to}-12-31`;
        else params['primary_release_date.lte'] = `${year_to}-12-31`;
      }
    }
  } else {
    switch (filter) {
      case 'top_rated_movies':
        endpoint = '/movie/top_rated';
        defaultMediaType = 'movie';
        break;
      case 'top_rated_tv':
        endpoint = '/tv/top_rated';
        defaultMediaType = 'tv';
        break;
      case 'upcoming':
        endpoint = '/discover/movie';
        params['primary_release_date.gte'] = todayStr;
        params['primary_release_date.lte'] = futureStr;
        params.sort_by = 'popularity.desc';
        defaultMediaType = 'movie';
        break;
      case 'now_playing':
        endpoint = '/movie/now_playing';
        defaultMediaType = 'movie';
        break;
      case 'popular_tv':
        endpoint = '/tv/popular';
        defaultMediaType = 'tv';
        break;
      case 'family_movies':
        endpoint = '/discover/movie';
        params.with_genres = '10751'; // Family genre ID
        params.sort_by = 'popularity.desc';
        defaultMediaType = 'movie';
        break;
      case 'family_tv':
        endpoint = '/discover/tv';
        params.with_genres = '10751'; // Family genre ID
        params.sort_by = 'popularity.desc';
        defaultMediaType = 'tv';
        break;
      case 'documentary_movies':
        endpoint = '/discover/movie';
        params.with_genres = '99'; // Documentary genre ID
        params.sort_by = 'popularity.desc';
        defaultMediaType = 'movie';
        break;
      case 'comedy_movies':
        endpoint = '/discover/movie';
        params.with_genres = '35'; // Comedy genre ID
        params.sort_by = 'popularity.desc';
        defaultMediaType = 'movie';
        break;
      case 'romcom_movies':
        endpoint = '/discover/movie';
        params.with_genres = '35,10749'; // Comedy AND Romance
        params.sort_by = 'popularity.desc';
        defaultMediaType = 'movie';
        break;
      case 'trending':
      default:
        endpoint = '/trending/all/week';
        break;
    }
  }

  try {
    const promises = [];
    const startPage = parseInt(page, 10);
    const numPages = parseInt(count, 10);
    
    for (let i = 0; i < numPages; i++) {
      promises.push(axios.get(`${TMDB_BASE_URL}${endpoint}`, {
        params: { ...params, page: startPage + i }
      }));
    }

    const responses = await Promise.all(promises);
    
    // Combine results from all pages
    const allResults = responses.flatMap(response => response.data.results);
    
    // Deduplicate by ID
    const seenIds = new Set();
    const uniqueResults = [];
    for (const item of allResults) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        uniqueResults.push(item);
      }
    }

    const results = uniqueResults
      .map(item => {
        const mediaType = item.media_type || defaultMediaType;
        if (mediaType !== 'movie' && mediaType !== 'tv') return null; // Filter out people
        return {
            id: item.id,
            title: mediaType === 'movie' ? item.title : item.name,
            type: mediaType === 'movie' ? 'movie' : 'tv_show',
            poster_path: item.poster_path,
            year: (item.release_date || item.first_air_date || '').substring(0, 4),
            overview: item.overview,
        };
      })
      .filter(item => item !== null && item.poster_path);

    res.json(results);
  } catch (error) {
    console.error('TMDB Discover Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch discovered media' });
  }
});

app.get('/api/config', (req, res) => {
  res.json({ tmdbEnabled: !!process.env.TMDB_API_KEY });
});

const backfillRichMetadata = async () => {
  if (!process.env.TMDB_API_KEY) return;
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT m.id, m.imdb_id, m.type, m.title 
      FROM media m 
      WHERE m.backdrop_url IS NULL 
         OR NOT EXISTS (SELECT 1 FROM media_genres mg WHERE mg.media_id = m.id)
    `);
    
    if (rows.length === 0) {
      console.log('No media requires backfilling.');
      return;
    }

    console.log(`Found ${rows.length} media items needing metadata backfill. Starting using TMDB...`);

    for (const media of rows) {
      try {
        console.log(`Backfilling metadata for: ${media.title} (${media.imdb_id})`);
        
        // Find TMDB ID
        const findRes = await axios.get(`https://api.themoviedb.org/3/find/${media.imdb_id}`, {
          params: { api_key: process.env.TMDB_API_KEY, external_source: 'imdb_id' }
        });
        
        let tmdbId = null;
        let tmdbType = media.type === 'movie' ? 'movie' : 'tv';
        
        if (tmdbType === 'movie' && findRes.data.movie_results.length > 0) {
          tmdbId = findRes.data.movie_results[0].id;
        } else if (tmdbType === 'tv' && findRes.data.tv_results.length > 0) {
          tmdbId = findRes.data.tv_results[0].id;
        }

        if (tmdbId) {
          const detailRes = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}`, {
            params: { api_key: process.env.TMDB_API_KEY, append_to_response: 'credits,videos,release_dates,content_ratings,watch/providers' }
          });
          const d = detailRes.data;

          let backdrop_url = d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : null;
          let status = d.status || null;
          let tagline = d.tagline || null;
          let runtime = d.runtime || (d.episode_run_time && d.episode_run_time[0]) || null;
          let trailer_url = null;
          let age_rating = null;
          let networks = [];
          let creators = [];
          let watch_providers = [];
          
          if (d.videos && d.videos.results) {
            const trailer = d.videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube');
            if (trailer) trailer_url = `https://www.youtube.com/watch?v=${trailer.key}`;
          }

          if (tmdbType === 'movie' && d.release_dates && d.release_dates.results) {
            const usRelease = d.release_dates.results.find(r => r.iso_3166_1 === 'US');
            if (usRelease && usRelease.release_dates && usRelease.release_dates.length > 0) {
              age_rating = usRelease.release_dates[0].certification;
            }
          } else if (tmdbType === 'tv' && d.content_ratings && d.content_ratings.results) {
            const usRating = d.content_ratings.results.find(r => r.iso_3166_1 === 'US');
            if (usRating) age_rating = usRating.rating;
          }

          if (tmdbType === 'tv' && d.networks) {
            networks = d.networks.map(n => n.name);
          } else if (tmdbType === 'movie' && d.production_companies) {
            networks = d.production_companies.map(p => p.name);
          }

          if (tmdbType === 'tv' && d.created_by) {
            creators = d.created_by.map(c => c.name);
          } else if (tmdbType === 'movie' && d.credits && d.credits.crew) {
            creators = d.credits.crew.filter(c => c.job === 'Director').map(c => c.name);
          }

          if (d['watch/providers'] && d['watch/providers'].results && d['watch/providers'].results.US) {
            const usProviders = d['watch/providers'].results.US;
            const link = usProviders.link;
            if (usProviders.flatrate) {
              const allowedPlatforms = ['Netflix', 'Amazon Prime Video', 'Disney+', 'Hulu', 'Max', 'Apple TV+', 'Paramount+', 'Peacock', 'BBC iPlayer', 'Channel 4'];
              usProviders.flatrate.forEach(p => {
                let name = p.provider_name;
                if (name === 'Disney Plus') name = 'Disney+';
                if (name === 'Apple TV Plus') name = 'Apple TV+';
                if (name === 'Paramount Plus') name = 'Paramount+';
                if (name === 'Peacock Premium') name = 'Peacock';
                
                if (allowedPlatforms.includes(name) && !watch_providers.some(wp => wp.platform === name)) {
                  watch_providers.push({ platform: name, url: link });
                }
              });
            }
          }

          await client.query('BEGIN');
          
          await client.query(`
            UPDATE media SET 
              backdrop_url = $1, 
              trailer_url = $2, 
              status = $3, 
              age_rating = $4, 
              runtime = $5, 
              tagline = $6, 
              networks = $7, 
              creators = $8
            WHERE id = $9
          `, [backdrop_url, trailer_url, status, age_rating, runtime, tagline, networks.join(', '), creators.join(', '), media.id]);

          // Only insert streaming links if the item currently has none (preserves manual edits)
          const existingLinks = await client.query('SELECT 1 FROM streaming_links WHERE media_id = $1', [media.id]);
          if (existingLinks.rowCount === 0) {
              for (const wp of watch_providers) {
                await client.query(
                  'INSERT INTO streaming_links (media_id, url, platform) VALUES ($1, $2, $3)',
                  [media.id, wp.url, wp.platform]
                );
              }
          }
          
          if (d.genres && d.genres.length > 0) {
            for (const g of d.genres) {
              const name = g.name;
              let genreRes = await client.query('SELECT id FROM genres WHERE name = $1', [name]);
              let genreId;
              if (genreRes.rowCount === 0) {
                genreRes = await client.query('INSERT INTO genres (name) VALUES ($1) RETURNING id', [name]);
                genreId = genreRes.rows[0].id;
              } else {
                genreId = genreRes.rows[0].id;
              }
              await client.query('INSERT INTO media_genres (media_id, genre_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [media.id, genreId]);
            }
          }
          await client.query('COMMIT');
          console.log(`  Updated metadata for ${media.title}`);
        } else {
            console.log(`  Could not find TMDB ID for ${media.title}`);
        }
        
        // Sleep for 250ms to respect TMDB rate limits
        await new Promise(resolve => setTimeout(resolve, 250));
        
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {}); // Catch potential rollback error if transaction wasn't active
        console.error(`  Error backfilling ${media.title}:`, e.message);
      }
    }
    console.log('Finished backfilling metadata.');
  } finally {
    client.release();
  }
};

app.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
  initDb().then(() => {
    backfillRichMetadata();
  });
});

