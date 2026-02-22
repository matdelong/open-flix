const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const axios = require('axios');
const cheerio = require('cheerio');
const he = require('he');

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

// Function to parse date strings from epguides.com (e.g., "13 Jan 15")
function parseAirDate(dateStr) {
  const parts = dateStr.split(' ');
  if (parts.length !== 3) return null;
  const day = parts[0];
  const month = parts[1];
  const year = `20${parts[2]}`;
  return new Date(`${day} ${month} ${year}`);
}

// Function to normalize titles for epguides.com URLs
const normalizeTitleForEpguides = (title) => {
  // Remove common TV show suffixes that might not be in epguides URLs
  let normalized = title.replace(/\(TV Series \d{4}(?:–\d{4})?\)/, '').trim();
  normalized = normalized.replace(/\(US\)/, '').trim();

  // Replace spaces with nothing and remove most special characters, preserve alphanumeric
  normalized = normalized.replace(/[^a-zA-Z0-9]/g, '');

  // Capitalize the first letter of each significant word, if necessary,
  // but for epguides, it often seems to just concatenate words.
  // Example: "Breaking Bad" -> "BreakingBad", "The Office (US)" -> "OfficeUS"
  // For simplicity and to match observed patterns like "Survivor",
  // we'll just remove spaces and non-alphanumeric, and let the first letter case be.
  return normalized;
};

// Function to get the epguides.com URL for a TV show
async function getEpguidesShowUrl(imdbTitle) {
  const baseUrl = 'https://epguides.com/';
  const normalizedTitle = normalizeTitleForEpguides(imdbTitle);
  return `${baseUrl}${normalizedTitle}/`;
}

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

    const { data } = await axios.get(imdbUrl, {
      headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
    });
    
    const $ = cheerio.load(data);

    let title = he.decode($('h1[data-testid="hero-title-block__title"]').text().trim());
    if (!title) {
      const titleFromTag = he.decode($('title').text().trim());
      const titleMatch = titleFromTag.match(/(.*)\s\(/);
      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1];
      }
    }

    if (!title) {
      throw new Error('Could not scrape the title of the media.');
    }

    const yearText = $('a[href*="/releaseinfo"]').first().text().trim();
    const year = yearText ? parseInt(yearText, 10) : null;
    const description = he.decode($('span[data-testid="plot-l"]').text().trim());
    const poster_url = $('.ipc-media--poster-l img').attr('src');
    const ratingText = he.decode($('[data-testid="hero-rating-bar__aggregate-rating__score"] > span:first-child').text().trim());
    const rating = ratingText.split('.').length > 2 ? ratingText.substring(0, 3) : ratingText.split('/')[0];
    
    const genres = [];
    $('div[data-testid="genres"] a').each((i, el) => {
      genres.push(he.decode($(el).text().trim()));
    });

    const actors = [];
    $('a[data-testid="title-cast-item__actor"]').each((i, el) => {
      actors.push(he.decode($(el).text().trim()));
    });
    
    // The media type needs to be determined. We can infer this by looking for season/episode information.
    // If the epguides scrape is successful, it's a TV show.
    // For now, we'll try to guess based on the presence of episode information on the IMDB page.
    const isTVShow = $('a[href*="episodes"]').length > 0;
    const mediaType = isTVShow ? 'tv_show' : 'movie';

    await client.query('BEGIN');

    const newMediaRes = await client.query(
      `INSERT INTO media (imdb_id, title, type, poster_url, description, year, rating)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [imdbId, title, mediaType, poster_url, description, year, rating]
    );
    const newMedia = newMediaRes.rows[0];

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

      if (mediaType === 'tv_show') {
        try {
          const epguidesShowUrl = await getEpguidesShowUrl(title);
          console.log(`Attempting to scrape epguides.com for: ${epguidesShowUrl}`);

          const { data: epguidesPageData } = await axios.get(epguidesShowUrl, {
            headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
          });
          
          const $e = cheerio.load(epguidesPageData);
          let currentSeason = 0;
          let seasonsMap = new Map();

          const rows = [];
          $e('tr').each((i, el) => {
            rows.push($e(el));
          });

          for (const row of rows) {
            const seasonHeader = row.find("td.bold[colspan='4']");

            if (seasonHeader.length) {
              const seasonMatch = seasonHeader.text().match(/Season (\d+)/);
              if (seasonMatch) {
                currentSeason = parseInt(seasonMatch[1], 10);
              } else if (seasonHeader.text().includes('Specials')) {
                currentSeason = 0; // Use 0 for specials
              }
            } else if (currentSeason >= 0) {
              const columns = row.find('td');
              if (columns.length === 4) {
                const episodeNumberStr = columns.eq(1).text().trim();
                const specialMatch = episodeNumberStr.match(/S(\d+)\..*-(\d+)/);
                const regularMatch = episodeNumberStr.match(/(\d+)-(\d+)/);

                let seasonForEpisode, episodeInSeason, airDateStr, titleFromFile, airDate;

                if (specialMatch) {
                  seasonForEpisode = parseInt(specialMatch[1], 10);
                  episodeInSeason = parseInt(specialMatch[2], 10);
                  airDateStr = columns.eq(2).text().trim();
                  titleFromFile = he.decode(columns.eq(3).find('a').text().trim());
                  airDate = parseAirDate(airDateStr);
                } else if (regularMatch) {
                  seasonForEpisode = parseInt(regularMatch[1], 10);
                  if (currentSeason !== 0 && seasonForEpisode !== currentSeason) continue;

                  episodeInSeason = parseInt(regularMatch[2], 10);
                  airDateStr = columns.eq(2).text().trim();
                  titleFromFile = he.decode(columns.eq(3).find('a').text().trim());
                  airDate = parseAirDate(airDateStr);
                } else {
                  continue;
                }

                let seasonIdForEpisode = seasonsMap.get(seasonForEpisode);
                if (!seasonIdForEpisode) {
                  const yearForSeason = airDate ? airDate.getFullYear() : null;
                  const seasonRes = await client.query(
                    'INSERT INTO seasons (media_id, season_number, year) VALUES ($1, $2, $3) RETURNING id',
                    [newMedia.id, seasonForEpisode, yearForSeason]
                  );
                  seasonIdForEpisode = seasonRes.rows[0].id;
                  seasonsMap.set(seasonForEpisode, seasonIdForEpisode);
                  console.log(`Added Season ${seasonForEpisode} (${yearForSeason}) for ${title}`);
                }
                
                await client.query(
                  'INSERT INTO episodes (season_id, episode_number, title, air_date) VALUES ($1, $2, $3, $4)',
                  [seasonIdForEpisode, episodeInSeason, titleFromFile, airDate]
                );
                console.log(`  Added S${seasonForEpisode}E${episodeInSeason}: ${titleFromFile} (${airDate})`);
              }
            }
          }
        } catch (epguibesError) {
          console.error("Failed to scrape episodes from epguides.com. The show will be added without episodes.", epguibesError.message);
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
      await client.query('UPDATE episodes SET is_watched = $1 WHERE season_id = $2', [is_watched, id]);
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
  const { epguidesUrl: customUrl } = req.body;
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

    await client.query('BEGIN');
    
    let epguidesShowUrl = customUrl || media.epguides_url;
    if (!epguidesShowUrl) {
      epguidesShowUrl = await getEpguidesShowUrl(media.title);
      await client.query('UPDATE media SET epguides_url = $1 WHERE id = $2', [epguidesShowUrl, id]);
    } else if (customUrl) {
      // If a custom URL is provided, update the stored URL
      await client.query('UPDATE media SET epguides_url = $1 WHERE id = $2', [customUrl, id]);
    }

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

    const { data: epguidesPageData } = await axios.get(epguidesShowUrl, {
      headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
    });
    
    const $e = cheerio.load(epguidesPageData);
    let currentSeason = 0;
    let seasonsMap = new Map();

    const rows = [];
    $e('tr').each((i, el) => {
      rows.push($e(el));
    });

    for (const row of rows) {
      const seasonHeader = row.find("td.bold[colspan='4']");

      if (seasonHeader.length) {
        const seasonMatch = seasonHeader.text().match(/Season (\d+)/);
        if (seasonMatch) {
          currentSeason = parseInt(seasonMatch[1], 10);
        } else if (seasonHeader.text().includes('Specials')) {
          currentSeason = 0; // Use 0 for specials
        }
      } else if (currentSeason >= 0) {
        const columns = row.find('td');
        if (columns.length === 4) {
          const episodeNumberStr = columns.eq(1).text().trim();
          const specialMatch = episodeNumberStr.match(/S(\d+)\..*-(\d+)/);
          const regularMatch = episodeNumberStr.match(/(\d+)-(\d+)/);

          let seasonForEpisode, episodeInSeason, airDateStr, titleFromFile, airDate;

          if (specialMatch) {
            seasonForEpisode = parseInt(specialMatch[1], 10);
            episodeInSeason = parseInt(specialMatch[2], 10);
            airDateStr = columns.eq(2).text().trim();
            titleFromFile = he.decode(columns.eq(3).find('a').text().trim());
            airDate = parseAirDate(airDateStr);
          } else if (regularMatch) {
            seasonForEpisode = parseInt(regularMatch[1], 10);
            if (currentSeason !== 0 && seasonForEpisode !== currentSeason) continue;

            episodeInSeason = parseInt(regularMatch[2], 10);
            airDateStr = columns.eq(2).text().trim();
            titleFromFile = he.decode(columns.eq(3).find('a').text().trim());
            airDate = parseAirDate(airDateStr);
          } else {
            continue;
          }

          let seasonIdForEpisode = seasonsMap.get(seasonForEpisode);
          if (!seasonIdForEpisode) {
            const yearForSeason = airDate ? airDate.getFullYear() : null;
            const seasonRes = await client.query(
              'INSERT INTO seasons (media_id, season_number, year) VALUES ($1, $2, $3) RETURNING id',
              [id, seasonForEpisode, yearForSeason]
            );
            seasonIdForEpisode = seasonRes.rows[0].id;
            seasonsMap.set(seasonForEpisode, seasonIdForEpisode);
            console.log(`Added Season ${seasonForEpisode} (${yearForSeason}) for ${media.title}`);
          }
          
          const isWatched = watchedEpisodes.has(`${seasonForEpisode}-${episodeInSeason}`);
          await client.query(
            'INSERT INTO episodes (season_id, episode_number, title, air_date, is_watched) VALUES ($1, $2, $3, $4, $5)',
            [seasonIdForEpisode, episodeInSeason, titleFromFile, airDate, isWatched]
          );
          console.log(`  Added S${seasonForEpisode}E${episodeInSeason}: ${titleFromFile} (${airDate})`);
        }
      }
    }

    await client.query('COMMIT');
    res.sendStatus(204);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Re-scraping error:', error);
    res.status(500).json({ error: 'Failed to re-scrape episodes.' });
  } finally {
    client.release();
  }
});

// TMDB Integration
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

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

  const { filter, page = 1, count = 3 } = req.query;
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

app.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
  initDb();
});

