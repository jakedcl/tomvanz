import {createImageUrlBuilder, type SanityImageSource} from '@sanity/image-url'
import {client} from './client'

const builder = createImageUrlBuilder(client)

export function urlFor(source: SanityImageSource) {
  return builder.image(source)
}

type ImageWithAlt = {
  alt?: string | null
}

/** Prefer explicit alt text on the image; otherwise use the document title or other fallback. */
export function sanityImageAlt(image: ImageWithAlt | undefined, fallback: string): string {
  const alt = image?.alt?.trim()
  return alt || fallback
}

const CARD_WIDTHS = [340, 680, 1000] as const
const LIGHTBOX_WIDTHS = [1000, 1600, 2400] as const

function sizedImageUrl(source: SanityImageSource, width: number, height: number) {
  return urlFor(source).width(width).height(height).fit('crop').auto('format').quality(80).url()
}

function srcSetForWidths(
  source: SanityImageSource,
  widths: readonly number[],
  aspect = 3 / 4,
): {src: string; srcSet: string} {
  const urls = widths.map((w) => {
    const h = Math.round(w * aspect)
    return {w, url: sizedImageUrl(source, w, h)}
  })
  const mid = urls[Math.min(1, urls.length - 1)] ?? urls[0]
  return {
    src: mid.url,
    srcSet: urls.map(({w, url}) => `${url} ${w}w`).join(', '),
  }
}

/** Responsive URLs for the map info card cover (max ~340px wide, 4:3). */
export function infoCardCoverImage(source: SanityImageSource) {
  const {src, srcSet} = srcSetForWidths(source, CARD_WIDTHS)
  return {
    src,
    srcSet,
    sizes: 'min(340px, calc(100vw - 24px))',
  }
}

/** Responsive URLs for the full-size lightbox view. */
export function infoCardLightboxImage(source: SanityImageSource) {
  const urls = LIGHTBOX_WIDTHS.map((w) => ({w, url: urlFor(source).width(w).auto('format').quality(85).fit('max').url()}))
  const mid = urls[1] ?? urls[0]
  return {
    src: mid.url,
    srcSet: urls.map(({w, url}) => `${url} ${w}w`).join(', '),
    sizes: '100vw',
  }
}
