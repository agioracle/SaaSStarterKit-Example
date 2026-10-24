function hasUnsafeUrlCharacters(value: string) {
  return Array.from(value).some(
    (character) =>
      character === '\\' || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
  );
}
export function safeHref(href: string) {
  if (hasUnsafeUrlCharacters(href)) return '#';
  return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href) ? href : '#';
}
export function safeImageSource(source: string) {
  if (hasUnsafeUrlCharacters(source)) return undefined;
  if (/^\/(?!\/)/.test(source)) return source;
  try {
    const url = new URL(source);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export type ContentImage = {
  image: string;
  imageWidth?: number;
  imageHeight?: number;
  imageVariants?: { src: string; width: number }[];
};
export function coverImageProps(image: ContentImage, sizes: string) {
  const bundled = image.image === '/og.png' || image.image === '/og.svg';
  const variants = image.imageVariants ?? (image.image === '/og.png'
    ? [{ src: '/og-640.png', width: 640 }, { src: '/og-960.png', width: 960 }, { src: '/og.png', width: 1200 }]
    : []);
  const srcSet = variants.flatMap((variant) => {
    const src = safeImageSource(variant.src);
    return src && Number.isInteger(variant.width) && variant.width > 0
      ? [`${src.replaceAll(',', '%2C')} ${variant.width}w`] : [];
  }).join(', ');
  return {
    width: image.imageWidth ?? (bundled ? 1200 : undefined),
    height: image.imageHeight ?? (bundled ? 630 : undefined),
    srcSet: srcSet || undefined,
    sizes: srcSet ? sizes : undefined,
    decoding: 'async' as const,
  };
}
