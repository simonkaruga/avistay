/**
 * Property photos.
 * Wide screens: a large lead photo, one wide and two small, "+N" on the last.
 * Phones: one swipeable photo with a counter.
 * A single photo is shown whole over a blurred copy of itself — never cropped
 * into a thin strip.
 */
import { useRef, useState } from "react";
import { Grid2x2, Home as HomeIcon, Images } from "lucide-react";
import { imgSrc } from "../../utils/image";

interface Props {
  images: string[];
  title: string;
  onOpen: (index: number) => void;
}

function Tile({ src, alt, onClick, className = "", width, children }: {
  src: string; alt: string; onClick: () => void; className?: string; width: number; children?: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={`relative overflow-hidden group ${className}`} aria-label={`Open photo: ${alt}`}>
      <img src={imgSrc(src, width)} alt={alt} loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500" />
      {children}
    </button>
  );
}

function Single({ src, title, onClick, className = "" }: { src: string; title: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label="Open photo" className={`relative overflow-hidden bg-black ${className}`}>
      <img src={imgSrc(src, 400)} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-60" />
      <img src={imgSrc(src, 1200)} alt={title} className="relative w-full h-full object-contain" />
    </button>
  );
}

export default function PhotoMosaic({ images, title, onOpen }: Props) {
  const [index, setIndex] = useState(0);
  const touchX = useRef(0);
  const n = images.length;

  if (!n) {
    return (
      <div className="aspect-4/3 md:aspect-auto md:h-[420px] rounded-none md:rounded-2xl bg-linear-to-br from-forest to-teal flex items-center justify-center">
        <HomeIcon className="w-12 h-12 text-white/40" aria-hidden="true" />
      </div>
    );
  }

  const allButton = n > 1 && (
    <button type="button" onClick={() => onOpen(0)}
      className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-white/95 text-nearblack text-xs font-semibold px-3.5 py-2 rounded-full shadow-sm">
      <Grid2x2 className="w-4 h-4" aria-hidden="true" /> All {n} photos
    </button>
  );

  return (
    <>
      {/* Phones: swipe through photos */}
      <div className="md:hidden relative aspect-4/3 -mx-4 bg-black"
        onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (dx < -40 && index < n - 1) setIndex(i => i + 1);
          if (dx > 40 && index > 0) setIndex(i => i - 1);
        }}>
        <button type="button" onClick={() => onOpen(index)} className="absolute inset-0" aria-label="Open photos">
          <img src={imgSrc(images[index], 800)} alt={`${title} , photo ${index + 1}`} className="w-full h-full object-cover" />
        </button>
        {n > 1 && (
          <span className="absolute bottom-3 right-3 flex items-center gap-1 bg-black/60 text-white text-xs font-medium px-2.5 py-1 rounded-full pointer-events-none">
            <Images className="w-3.5 h-3.5" aria-hidden="true" /> {index + 1} / {n}
          </span>
        )}
      </div>

      {/* Wide screens: mosaic */}
      <div className="hidden md:block relative">
        {n === 1 && <Single src={images[0]} title={title} onClick={() => onOpen(0)} className="w-full h-[440px] rounded-3xl" />}

        {(n === 2 || n === 3) && (
          <div className="grid grid-cols-3 grid-rows-2 gap-2.5 h-[440px]">
            <Tile src={images[0]} alt={title} width={1000} onClick={() => onOpen(0)} className="col-span-2 row-span-2 rounded-3xl" />
            {images.slice(1, 3).map((src, i) => (
              <Tile key={src} src={src} alt={`${title} , photo ${i + 2}`} width={500} onClick={() => onOpen(i + 1)}
                className={n === 2 ? "row-span-2 rounded-3xl" : "rounded-3xl"} />
            ))}
          </div>
        )}

        {n >= 4 && (
          // NaivaStay layout: a large lead photo, one wide photo, two small ones.
          <div className="grid grid-cols-5 grid-rows-2 gap-2.5 h-[440px]">
            <Tile src={images[0]} alt={title} width={1000} onClick={() => onOpen(0)} className="col-span-3 row-span-2 rounded-3xl" />
            <Tile src={images[1]} alt={`${title}. Photo 2`} width={700} onClick={() => onOpen(1)} className="col-span-2 rounded-3xl" />
            {images.slice(2, 4).map((src, i) => (
              <Tile key={src} src={src} alt={`${title} , photo ${i + 3}`} width={500} onClick={() => onOpen(i + 2)} className="rounded-3xl">
                {i === 1 && n > 4 && (
                  <span className="absolute inset-0 bg-black/55 flex items-center justify-center text-white font-semibold text-lg">+{n - 4}</span>
                )}
              </Tile>
            ))}
          </div>
        )}
        {allButton}
      </div>
    </>
  );
}
