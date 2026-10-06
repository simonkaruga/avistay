/**
 * Guides to the places guests come to Naivasha for. Each one has a page at
 * /places/:slug with photos, what to do, practical tips and stays nearby.
 *
 * Photos are from Wikimedia Commons (free licences that require credit) —
 * see placePhotos.ts. Prices and park fees are deliberately left out: they
 * change, and a wrong price is worse than none.
 */
import { PLACE_PHOTOS } from "./placePhotos";

export interface PlacePhoto {
  src: string; sm: string; caption: string;
  credit: string; license: string; licenseUrl: string; source: string;
}

export interface Place {
  slug: string;
  name: string;
  tagline: string;
  area: string;              // NAIVASHA_AREAS slug. Where to stay for it
  intro: string[];
  todo: { title: string; text: string }[];
  facts: { label: string; value: string }[];
  tips: string[];
  photos: PlacePhoto[];
}

const P = (slug: string) => PLACE_PHOTOS[slug] ?? [];

export const PLACES: Place[] = [
  {
    slug: "hells-gate",
    name: "Hell's Gate National Park",
    tagline: "Cycle among zebra and giraffe, then walk down into the gorge",
    area: "hells-gate",
    intro: [
      "Hell's Gate is one of the few national parks in Kenya where you can leave the car behind. You can cycle or walk the main track past zebra, giraffe, buffalo, eland and gazelle, with red volcanic cliffs on either side.",
      "Its name comes from a narrow break in those cliffs, explored in the 1880s. Today the highlight is the Lower Gorge, a maze of water-carved rock with warm springs seeping out of the walls. Two volcanic towers stand in the park: Fischer's Tower, near the main gate, and Central Tower, at the head of the gorge. The landscape is often said to have inspired scenes in The Lion King.",
    ],
    todo: [
      { title: "Cycle the park", text: "Bikes are for hire at the main (Elsa) gate. The track to the gorge is mostly flat and passes grazing animals." },
      { title: "Walk the Lower Gorge", text: "A guided walk through the narrow gorge, with hot springs and rock 'showers'. Allow 2 to 3 hours." },
      { title: "Rock climbing", text: "Fischer's Tower and the cliffs are popular climbing spots. Go with a local guide who has gear." },
      { title: "Geothermal spa", text: "The Olkaria side of the park has a geothermal spa with warm mineral pools, a good way to end a day of cycling." },
    ],
    facts: [
      { label: "Best for", value: "Cycling, hiking, families who like to be active" },
      { label: "Time needed", value: "Half a day to a full day" },
      { label: "Getting there", value: "Off Moi South Lake Road, a short drive from most stays on South Lake" },
      { label: "Entry", value: "Park fees are set by Kenya Wildlife Service. Check kws.go.ke before you go" },
    ],
    tips: [
      "Go early: the morning is cooler for cycling and the animals are more active.",
      "Never enter the gorge if it is raining or rain is likely. Flash floods there can be deadly.",
      "Use a registered park guide in the gorge; the paths are not marked.",
      "Carry water and sun protection. There is little shade on the main track.",
    ],
    photos: P("hells-gate"),
  },
  {
    slug: "crescent-island",
    name: "Crescent Island",
    tagline: "Walk with giraffe, wildebeest and waterbuck by the lake",
    area: "south-lake",
    intro: [
      "Crescent Island is the rim of an old volcanic crater curving out into Lake Naivasha. It's a private wildlife sanctuary where you explore on foot. There are no big predators, so you can walk right among giraffe, zebra, wildebeest, waterbuck, impala and gazelle.",
      "Avenues of yellow fever trees and views across the water make it one of the most photographed places on the lake. Many visitors combine it with a boat ride to see hippos on the way.",
    ],
    todo: [
      { title: "Walking safari", text: "Guided or self-guided walks of 1 to 3 hours across the island's grassland and woodland." },
      { title: "Boat there", text: "Arrive by boat for hippos and fish eagles on the way, or go by road if you prefer." },
      { title: "Photography", text: "Golden-hour light, giraffe against the lake and the fever-tree avenues." },
    ],
    facts: [
      { label: "Best for", value: "Families, photographers, first-time safari walkers" },
      { label: "Time needed", value: "2 to 4 hours with the boat ride" },
      { label: "Getting there", value: "By boat from South Lake jetties, or by road" },
      { label: "Entry", value: "A sanctuary fee is paid on arrival. Ask your host for current rates" },
    ],
    tips: [
      "Wild animals are still wild: keep a few metres away, especially from mothers with young.",
      "Wear closed shoes. The grass hides thorns and dung.",
      "Mornings and late afternoons are cooler and the light is best.",
    ],
    photos: P("crescent-island"),
  },
  {
    slug: "mount-longonot",
    name: "Mount Longonot",
    tagline: "A sunrise hike to the crater rim (2,776 m)",
    area: "longonot",
    intro: [
      "Mount Longonot is a dormant volcano rising over the Rift Valley floor south-east of Lake Naivasha. A steep path climbs to the rim of its huge crater, and a trail runs all the way around the top. From there you see the forest growing on the crater floor, Lake Naivasha and the Rift Valley stretching away.",
      "Its name is usually traced to a Maasai word for 'mountain of many spurs' or 'steep ridges'. It's one of the most popular day hikes near Nairobi, and a great reason to stay a night in Naivasha.",
    ],
    todo: [
      { title: "Climb to the rim", text: "A steep climb of about 1 to 2 hours from the gate to the crater rim." },
      { title: "Walk the crater rim", text: "The full loop around the rim takes another 2 to 3 hours, with the summit on the way." },
      { title: "Wildlife on the slopes", text: "Look out for giraffe, zebra and buffalo on the lower slopes, and eagles over the crater." },
    ],
    facts: [
      { label: "Best for", value: "Hikers with reasonable fitness" },
      { label: "Time needed", value: "4 to 6 hours for the full rim loop" },
      { label: "Height", value: "2,776 m at the summit" },
      { label: "Entry", value: "Kenya Wildlife Service park. Check kws.go.ke for fees" },
    ],
    tips: [
      "Start early. The climb is exposed and gets hot by late morning.",
      "Bring at least 2 litres of water each; there is none on the mountain.",
      "The path is loose volcanic ash: shoes with grip help a lot, especially coming down.",
      "Stay the night before in Longonot or South Lake and you'll beat the Nairobi day-trippers.",
    ],
    photos: P("mount-longonot"),
  },
  {
    slug: "lake-naivasha",
    name: "Lake Naivasha boat rides",
    tagline: "Hippos, fish eagles and golden-hour cruises",
    area: "south-lake",
    intro: [
      "Lake Naivasha is a freshwater lake high on the floor of the Rift Valley, and a protected wetland of international importance. Its name comes from a Maasai word often translated as 'rough water'. It is home to hundreds of hippos and more than 400 bird species, and African fish eagles swoop down for fish next to the boats.",
      "In recent years the water has risen, drowning stands of acacia along the shore. Those silver trees standing in the water are now one of the lake's most striking sights.",
    ],
    todo: [
      { title: "Hippo boat ride", text: "Around an hour on the water, with hippo pods, pelicans and kingfishers. Most stays can arrange a boat." },
      { title: "Fish eagle feeding", text: "Boat guides often throw a fish so you can watch an eagle dive for it. Have your camera ready." },
      { title: "Sunset cruise", text: "The lake is calmest and most beautiful in the last hour of light." },
      { title: "Birdwatching", text: "Herons, cormorants, jacanas and many more, a dream for birders." },
    ],
    facts: [
      { label: "Best for", value: "Everyone. An easy, relaxing outing" },
      { label: "Time needed", value: "1 to 2 hours" },
      { label: "Getting there", value: "Jetties all along Moi South Lake Road" },
      { label: "Price", value: "Agreed per boat with the operator. Your host can recommend one" },
    ],
    tips: [
      "Always wear the life jacket, and use a licensed operator.",
      "Hippos are dangerous: never walk on the shore at night, when they come out to graze.",
      "Mornings are calm; afternoon wind can make the water choppy.",
    ],
    photos: P("lake-naivasha"),
  },
  {
    slug: "lake-oloiden",
    name: "Lake Oloidien",
    tagline: "A quiet little lake next door, loved by birds",
    area: "south-lake",
    intro: [
      "Lake Oloidien is a small lake just south-west of Lake Naivasha. It was once part of the big lake. Its water is more alkaline, which can draw flamingos, and it's quieter and more peaceful than the main lakeshore.",
      "Come for an unhurried walk, a picnic or birdwatching. Pelicans, cormorants and waders are common in the area, and flamingos visit at times.",
    ],
    todo: [
      { title: "Birdwatching", text: "Pelicans, flamingos (seasonal), cormorants and waders. Bring binoculars." },
      { title: "Lakeside walk", text: "A slower, quieter alternative to the busy main shore." },
      { title: "Photography", text: "Still water and reflections, especially early in the morning." },
    ],
    facts: [
      { label: "Best for", value: "Birdwatchers, quiet walks, photographers" },
      { label: "Time needed", value: "1 to 2 hours" },
      { label: "Getting there", value: "Off the far end of Moi South Lake Road" },
      { label: "Flamingos", value: "Come and go with water conditions, not guaranteed" },
    ],
    tips: [
      "Early morning has the calmest water and the most birds.",
      "Keep your distance from flocks so they don't take off.",
      "Ask your host about access. Some shoreline is on private land.",
    ],
    photos: P("lake-oloiden"),
  },
  {
    slug: "elsamere",
    name: "Elsamere",
    tagline: "Joy Adamson's lakeside home: tea on the lawn with colobus monkeys",
    area: "south-lake",
    intro: [
      "Elsamere was the last home of Joy Adamson, author of Born Free, who lived here on the shore of Lake Naivasha. Today it's a conservation centre with a small museum about her life and work.",
      "Most visitors come for afternoon tea on the lawn, where black-and-white colobus monkeys play in the trees and the occasional giraffe wanders past.",
    ],
    todo: [
      { title: "Afternoon tea", text: "Tea and cake on the lawn facing the lake." },
      { title: "The museum", text: "Joy Adamson's story, her paintings and the Born Free legacy." },
      { title: "Colobus spotting", text: "Black-and-white colobus monkeys live in the garden's trees." },
    ],
    facts: [
      { label: "Best for", value: "A relaxed afternoon, history lovers, families" },
      { label: "Time needed", value: "1 to 2 hours" },
      { label: "Getting there", value: "On Moi South Lake Road" },
      { label: "Entry", value: "Ask your host or call ahead for current times and prices" },
    ],
    tips: [
      "Combine it with a boat ride or Crescent Island the same day.",
      "Keep food covered. The monkeys are quick!",
    ],
    photos: P("elsamere"),
  },
];

export const placeBySlug = (slug?: string) => PLACES.find(p => p.slug === slug);

/** Match an admin-created destination (by name) to its guide, if we have one. */
export function placeForDestination(name: string): Place | undefined {
  const n = name.toLowerCase();
  if (n.includes("hell")) return placeBySlug("hells-gate");
  if (n.includes("crescent")) return placeBySlug("crescent-island");
  if (n.includes("longonot")) return placeBySlug("mount-longonot");
  if (n.includes("oloid")) return placeBySlug("lake-oloiden");
  if (n.includes("elsamere")) return placeBySlug("elsamere");
  if (n.includes("naivasha") || n.includes("boat")) return placeBySlug("lake-naivasha");
  return undefined;
}
