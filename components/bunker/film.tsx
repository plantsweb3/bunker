// The films. To move one to a video host, replace its entry with
// { embed: "https://…the host's embed address…", … } and allow that host in
// the frame-src of the page policy in proxy.ts. Nothing else needs to change.
/** Exactly one of `file` and `embed`. */
type Film = { title: string; poster: string; captions?: string; file?: string; embed?: string };
const FILMS = {
  /** "Bunker Mode", the music video. The lyrics are already in the picture,
   * so its captions track is there to be switched on, and for screen
   * readers, but is not shown by default. */
  main: {
    title: "Bunker Mode, the film",
    file: "/assets/film/bunker-mode-film-720p.mp4",
    poster: "/assets/film/poster.jpg",
    captions: "/assets/film/lyrics.en.vtt",
  },
  /** "Secure the Bunker", about the bug bounty. */
  bounty: {
    title: "Secure the Bunker, the bug bounty film",
    file: "/assets/film/secure-the-bunker-720p.mp4",
    poster: "/assets/film/secure-the-bunker-poster.jpg",
  },
} satisfies Record<string, Film>;

export default function FilmPlayer({ film = "main" }: { film?: keyof typeof FILMS }) {
  const f: Film = FILMS[film];
  if (f.embed) {
    return (
      <iframe
        className="film-frame"
        src={f.embed}
        title={f.title}
        loading="lazy"
        allow="fullscreen; picture-in-picture"
        allowFullScreen
      />
    );
  }
  return (
    <video className="film-frame" controls preload="metadata" playsInline poster={f.poster} aria-label={f.title}>
      <source src={f.file} type="video/mp4" />
      {f.captions && <track kind="captions" src={f.captions} srcLang="en" label="Lyrics" />}
    </video>
  );
}
