"use client";
// A silent looping clip from the film's motion kit, used as a moving picture
// behind or beside the words. Nothing is fetched but the poster until the clip
// is near the screen, it stops when it leaves, and a visitor who asked for less
// motion keeps the poster.
import { useEffect, useRef } from "react";

export default function Loop({
  src,
  poster,
  className = "",
}: {
  /** Sources in the order to offer them. */
  src: string[];
  poster: string;
  className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = video.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const watch = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) el.play().catch(() => {});
        else el.pause();
      },
      { rootMargin: "240px 0px" },
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return (
    <video ref={video} className={`loop ${className}`} muted loop playsInline preload="none" poster={poster} aria-hidden="true">
      {src.map((s) => (
        <source key={s} src={s} type={s.endsWith(".webm") ? "video/webm" : "video/mp4"} />
      ))}
    </video>
  );
}
/** A clip from /assets/kit/clips, by name. */
export function Clip({ name, className }: { name: string; className?: string }) {
  const at = `/assets/kit/clips/${name}`;
  return <Loop className={className} src={[`${at}-720.webm`, `${at}.mp4`]} poster={`${at}-poster.jpg`} />;
}
/** One of the film's explainer cards from /assets/kit/cards, by name. */
export function Card({ name, className }: { name: string; className?: string }) {
  const at = `/assets/kit/cards/${name}`;
  return <Loop className={className} src={[`${at}.mp4`]} poster={`${at}-poster.jpg`} />;
}
