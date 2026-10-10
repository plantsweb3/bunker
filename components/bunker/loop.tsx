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
  onScreenOnly = false,
}: {
  /** Sources in the order to offer them. */
  src: string[];
  poster: string;
  className?: string;
  /** Play only while some of the clip is actually on screen, and start
   * fetching it a little before that. Without this it plays from a little
   * before it comes on screen, which suits a backdrop. */
  onScreenOnly?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = video.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const play = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) el.play().catch(() => {});
        else el.pause();
      },
      { rootMargin: onScreenOnly ? "0px" : "240px 0px" },
    );
    play.observe(el);
    // Nothing but the poster is fetched until the clip is near the screen.
    const near = onScreenOnly
      ? new IntersectionObserver(
          ([entry]) => {
            if (!entry.isIntersecting) return;
            el.preload = "auto";
            near?.disconnect();
          },
          { rootMargin: "600px 0px" },
        )
      : null;
    near?.observe(el);
    return () => {
      play.disconnect();
      near?.disconnect();
    };
  }, [onScreenOnly]);
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
