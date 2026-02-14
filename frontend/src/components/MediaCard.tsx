import React from 'react';
import './MediaCard.css';

interface MediaCardProps {
  title: string;
  year: number | null;
  posterUrl: string | null;
  onClick: () => void;
}

const MediaCard: React.FC<MediaCardProps> = ({ title, year, posterUrl, onClick }) => {
  const placeholderImage = "https://via.placeholder.com/200x300.png?text=No+Image";
  
  return (
    <div className="media-card" onClick={onClick}>
      <img src={posterUrl || placeholderImage} alt={`${title} poster`} />
      <div className="media-card-info">
        <h3>{title}</h3>
        {year && <p>{year}</p>}
      </div>
    </div>
  );
};

export default MediaCard;
