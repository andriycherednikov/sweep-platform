/* ============================================================
   THE SWEEP — the mark.

   Two paper slips fanned out of the hat, on a vermilion tile. It
   replaces the World Cup trophy the app was forked with: that image
   is FIFA's, and this product is not a World Cup product.

   Inline SVG rather than a file so it inherits size from its box,
   stays crisp at 16px, and needs no network request.
   ============================================================ */

export function SweepMark({ size, className, title }) {
  const px = size ? { width: size, height: size } : { width: "100%", height: "100%" }
  return (
    <svg viewBox="0 0 32 32" role={title ? "img" : "presentation"} aria-hidden={title ? undefined : "true"}
         className={className} style={{ display: "block", ...px }}>
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id="sweepMarkTile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff7a5c" />
          <stop offset="1" stopColor="#c9402a" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#sweepMarkTile)" />
      {/* the slip already drawn, sitting back */}
      <rect x="6" y="11.4" width="20" height="4.6" rx="1.5" fill="#fff" opacity=".5"
            transform="rotate(-27 16 16)" />
      {/* the one coming out now */}
      <rect x="6" y="15.9" width="20" height="4.6" rx="1.5" fill="#fff"
            transform="rotate(11 16 16)" />
    </svg>
  )
}
