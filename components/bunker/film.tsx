// The full film. To move it to a video host, replace FILM with
// { embed: "https://…the host's embed address…" } and allow that host in the
// frame-src of the page policy in proxy.ts. Nothing else needs to change.
type Film = { file: string } | { embed: string };
const FILM: Film = { file: "/assets/film/bunker-mode-film-720p.mp4" };
const POSTER = "/assets/film/poster.jpg";
const TITLE = "Bunker Mode, the film";

export default function FilmPlayer() {
  if ("embed" in FILM) {
    return (
      <iframe
        className="film-frame"
        src={FILM.embed}
        title={TITLE}
        loading="lazy"
        allow="fullscreen; picture-in-picture"
        allowFullScreen
      />
    );
  }
  // The lyrics are already in the picture, so the captions track is there to be
  // switched on, and for screen readers, but is not shown by default.
  return (
    <video className="film-frame" controls preload="metadata" playsInline poster={POSTER} aria-label={TITLE}>
      <source src={FILM.file} type="video/mp4" />
      <track kind="captions" src="/assets/film/lyrics.en.vtt" srcLang="en" label="Lyrics" />
    </video>
  );
}
