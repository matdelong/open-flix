const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

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
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS media (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL
      );
    `);

    const res = await pool.query('SELECT * FROM media');
    if (res.rowCount === 0) {
      await pool.query(
        "INSERT INTO media (title, type) VALUES ($1, $2)",
        ['The Matrix', 'Movie']
      );
    }
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Error initializing database', err.stack);
  }
};

app.use(cors());

app.get('/', (req, res) => {
  res.send('Hello from the backend!');
});

app.get('/media', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM media');
    res.json(rows);
  } catch (err) {
    console.error('Error querying media', err.stack);
    res.status(500).send('Server Error');
  }
});

app.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
  initDb();
});
