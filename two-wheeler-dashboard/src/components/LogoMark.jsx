import React, { useEffect, useState } from 'react'

/**
 * Renders an OEM corporate logo from /public/<path>.
 *
 * Behaviour:
 *  - Starts on the text fallback (no broken-image flash on first paint).
 *  - Pre-loads the asset asynchronously. On successful decode, swaps to the
 *    <img>; on 404 / decode error, stays on the text fallback.
 *  - No external hot-linking: only loads from this app's /public/ folder.
 *  - Container size is fixed by the parent (.logo-mark-header) so the
 *    layout never shifts whether the image is present or not.
 *
 * Sourcing: the upstream press-kit URL is recorded in tvs.json -> logo.*
 * but never fetched from JS. The PNG must be committed to public/ manually.
 */
export default function LogoMark({ src, fallbackSrc, fallbackText, fallbackColor, alt, imgClassName }) {
  // Build the candidate-source list. We try src first, then fallbackSrc
  // (e.g. SVG primary -> PNG backup) before giving up to the text wordmark.
  const candidates = [src, fallbackSrc].filter(Boolean)

  const [resolvedSrc, setResolvedSrc] = useState(null)
  const [exhausted, setExhausted] = useState(candidates.length === 0)

  useEffect(() => {
    if (candidates.length === 0) { setExhausted(true); return }
    let cancelled = false
    setResolvedSrc(null)
    setExhausted(false)
    let i = 0
    const tryNext = () => {
      if (cancelled) return
      if (i >= candidates.length) { setExhausted(true); return }
      const url = candidates[i++]
      const img = new window.Image()
      img.onload  = () => { if (!cancelled) setResolvedSrc(url) }
      img.onerror = () => { if (!cancelled) tryNext() }
      img.src = url
    }
    tryNext()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, fallbackSrc])

  if (resolvedSrc && !exhausted) {
    return (
      <img
        src={resolvedSrc}
        alt={alt || fallbackText}
        className={`max-w-full max-h-full object-contain ${imgClassName || ''}`.trim()}
        draggable={false}
      />
    )
  }

  return (
    <span
      className="logo-text-full"
      style={{ color: fallbackColor || '#4C1D95' }}
    >
      {fallbackText}
    </span>
  )
}
