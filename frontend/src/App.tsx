import { useState } from 'react';
import './App.css';

interface Media {
  id: number;
  title: string;
  type: string;
}

function App() {
  const [media, setMedia] = useState<Media[]>([]);
  const [error, setError] = useState('');

  const fetchMedia = async () => {
    try {
      setError('');
      const res = await fetch('http://localhost:3000/media');
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      setMedia(data);
    } catch (err: any) {
      setError('Failed to fetch media from the backend.');
      console.error(err);
    }
  };

  return (
    <div className="App">
      <h1>Open Flix</h1>
      <button onClick={fetchMedia}>Fetch Media from DB</button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <ul>
        {media.map((item) => (
          <li key={item.id}>
            {item.title} ({item.type})
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;
