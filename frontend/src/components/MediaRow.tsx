import React from 'react';
import MediaCard from './MediaCard';
import './MediaRow.css';

interface Media {
  id: number;
  title: string;
  poster_url: string | null;
  year: number | null;
}

interface MediaRowProps {
  title: string;
  media: Media[];
  onCardClick: (id: number) => void;
}

const MediaRow: React.FC<MediaRowProps> = ({ title, media, onCardClick }) => {
  if (media.length === 0) {
    return null; // Don't render empty rows
  }

  return (
    <div className="media-row">
      <h2>{title}</h2>
      <div className="media-scroller">
        {media.map(item => (
          <MediaCard 
            key={item.id} 
            title={item.title} 
            year={item.year} 
            posterUrl={item.poster_url} 
            onClick={() => onCardClick(item.id)}
          />
        ))}
      </div>
    </div>
  );
};

export default MediaRow;
