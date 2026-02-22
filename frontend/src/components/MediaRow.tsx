import React, { useRef, useLayoutEffect } from 'react';
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
  initialScrollLeft?: number;
  onScroll?: (scrollLeft: number) => void;
}

const MediaRow: React.FC<MediaRowProps> = ({ title, media, onCardClick, initialScrollLeft = 0, onScroll }) => {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollLeft = initialScrollLeft;
    }
  }, []); // Restore only on mount

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (onScroll) {
      onScroll(e.currentTarget.scrollLeft);
    }
  };

  if (media.length === 0) {
    return null; // Don't render empty rows
  }

  return (
    <div className="media-row">
      <h2>{title}</h2>
      <div 
        className="media-scroller" 
        ref={scrollerRef}
        onScroll={handleScroll}
      >
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
