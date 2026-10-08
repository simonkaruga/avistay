/**
 * /photo-credits: one place for the attribution the photo licences ask for
 * (Wikimedia Commons CC BY / CC BY-SA require it; Unsplash doesn't, but we
 * credit those photographers too). Linked from the About page.
 */
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useSEO } from "../utils/seo";
import { PLACES, type PlacePhoto } from "../data/places";
import { STAY_PHOTOS } from "../data/stayPhotos";

function CreditList({ photos }: { photos: PlacePhoto[] }) {
  return (
    <ul className="space-y-1.5">
      {photos.map(p => (
        <li key={p.src}>
          {p.caption}: <a href={p.source} target="_blank" rel="noopener noreferrer" className="underline">{p.credit}</a>,{" "}
          <a href={p.licenseUrl || p.source} target="_blank" rel="noopener noreferrer" className="underline">{p.license}</a>
        </li>
      ))}
    </ul>
  );
}

export default function PhotoCredits() {
  useSEO({ title: "Photo credits", description: "Credits for the photographs used on NaivaStay.", noIndex: true });
  return (
    <div className="min-h-screen bg-(--bg-primary) pt-header pb-24">
      <div className="max-w-3xl mx-auto px-4 text-sm text-(--text-muted) leading-relaxed">
        <Link to="/about" className="flex items-center gap-1.5 text-(--text-primary) py-3">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> About
        </Link>
        <h1 className="text-2xl font-semibold text-(--text-primary) mb-2">Photo credits</h1>
        <p className="mb-6">Thank you to the photographers whose work appears on NaivaStay.</p>
        {PLACES.map(place => (
          <section key={place.slug} className="mb-6">
            <h2 className="font-semibold text-(--text-primary) mb-1.5">{place.name}</h2>
            <CreditList photos={place.photos} />
          </section>
        ))}
        <section className="mb-6">
          <h2 className="font-semibold text-(--text-primary) mb-1.5">Stays</h2>
          <CreditList photos={Object.values(STAY_PHOTOS)} />
        </section>
      </div>
    </div>
  );
}
