const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const port = 3000;

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

    // For development, you might want to clear tables on restart
    // In production, you would not do this.
    await client.query('DROP TABLE IF EXISTS media_genres, media_actors, episodes, seasons, genres, actors, media CASCADE');

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
        is_watched BOOLEAN DEFAULT FALSE
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
        is_watched BOOLEAN DEFAULT FALSE
      );
    `);

    await client.query('COMMIT');
    console.log('Database initialized successfully with new schema.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error initializing database', err.stack);
  } finally {
    client.release();
  }
};

app.use(cors());
app.use(express.json()); // Middleware to parse JSON bodies

app.get('/', (req, res) => {
  res.send('Hello from the backend!');
});

app.post('/api/media', async (req, res) => {
  const { imdbUrl, type } = req.body;
  if (!imdbUrl || !type) {
    return res.status(400).json({ error: 'imdbUrl and type are required' });
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
      return res.status(409).json({ error: 'Media with this IMDB ID already exists.' });
    }

    const { data } = await axios.get(imdbUrl, {
      headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
    });
    
    const $ = cheerio.load(data);
    const jsonLdString = $('script[type="application/ld+json"]').html();
    if (!jsonLdString) {
      throw new Error('Could not find JSON-LD data in the page.');
    }
    const jsonData = JSON.parse(jsonLdString);

    const title = jsonData.name;
    const year = jsonData.datePublished ? parseInt(jsonData.datePublished.substring(0, 4), 10) : null;
    const description = jsonData.description;
    const poster_url = jsonData.image;
    const rating = jsonData.aggregateRating ? jsonData.aggregateRating.ratingValue : null;
    const genres = jsonData.genre || [];
    const actors = (jsonData.actor || []).map((a) => a.name);

    await client.query('BEGIN');

    const newMediaRes = await client.query(
      `INSERT INTO media (imdb_id, title, type, poster_url, description, year, rating)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [imdbId, title, type, poster_url, description, year, rating]
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

    if (type === 'tv_show') {
      const episodesUrl = `${imdbUrl.split('?')[0].replace(/\/$/, "")}/episodes`;
      const { data: seasonsPageData } = await axios.get(episodesUrl, {
          headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
      });
      const $s = cheerio.load(seasonsPageData);
      const seasonOptions = $s('select#bySeason option');

      for (const option of seasonOptions) {
        const seasonNumber = parseInt($s(option).attr('value') || '0', 10);
        if (isNaN(seasonNumber) || seasonNumber < 1) continue;
        
        console.log(`Scraping season ${seasonNumber}...`);

        const seasonRes = await client.query(
          'INSERT INTO seasons (media_id, season_number) VALUES ($1, $2) RETURNING id',
          [newMedia.id, seasonNumber]
        );
        const seasonId = seasonRes.rows[0].id;

        const seasonEpisodesUrl = `${episodesUrl}?season=${seasonNumber}`;
        const { data: episodePageData } = await axios.get(seasonEpisodesUrl, {
            headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });
        const $e = cheerio.load(episodePageData);
        
        const episodePromises = $e('div.list.detail.eplist div.list_item').map(async (i, el) => {
          const episodeTitle = $e(el).find('a[itemprop="name"]').text().trim();
          const metaText = $e(el).find('.eplist-metadata').text();
          const episodeNumberMatch = metaText.match(/Ep(\d+)/);
          const episodeNumber = episodeNumberMatch ? parseInt(episodeNumberMatch[1], 10) : i + 1;

          await client.query(
            'INSERT INTO episodes (season_id, episode_number, title) VALUES ($1, $2, $3)',
            [seasonId, episodeNumber, episodeTitle]
          );
        }).get();
        await Promise.all(episodePromises);
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
      WITH GenreGroups AS (
        SELECT 
          g.name AS category, 
          json_agg(
            json_build_object(
              'id', m.id, 'title', m.title, 'type', m.type, 'poster_url', m.poster_url, 'year', m.year
            ) ORDER BY m.year DESC, m.title
          ) AS media
        FROM genres g
        JOIN media_genres mg ON g.id = mg.genre_id
        JOIN media m ON mg.media_id = m.id
        GROUP BY g.name
      ),
      NewReleases AS (
        SELECT 
          'New Releases' AS category, 
          json_agg(
            json_build_object(
              'id', m.id, 'title', m.title, 'type', m.type, 'poster_url', m.poster_url, 'year', m.year
            ) ORDER BY m.year DESC, m.title
          ) AS media
        FROM media m
        WHERE m.year >= (EXTRACT(YEAR FROM NOW()) - 2)
      )
      SELECT category, media FROM GenreGroups
      UNION ALL
      SELECT category, media FROM NewReleases WHERE media IS NOT NULL;
    `;

    const { rows } = await pool.query(query);
    const grouped = rows.reduce((acc, row) => {
      // The JSON aggregation from postgres is already sorted.
      acc[row.category] = row.media || [];
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

app.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
  initDb();
});
