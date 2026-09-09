import sharp from 'sharp'

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_BYTES = 8 * 1024 * 1024 // 8 MB

/** Returns an error string if invalid, else null. */
export function validateUpload(mimetype, size) {
  if (!ALLOWED_MIME.includes(mimetype)) return 'unsupported file type (jpg, png, webp only)'
  if (size > MAX_BYTES) return 'file too large (8 MB max)'
  return null
}

/**
 * Re-encode (this strips EXIF/metadata), resize, and thumbnail.
 * fan  → max width 1280, aspect kept. profile → 256×256 cover-cropped square.
 * @returns {Promise<{buffer: Buffer, thumb: Buffer, ext: 'jpg'}>}
 */
export async function processImage(input, kind) {
  const base = sharp(input).rotate() // honor orientation, then drop metadata on output
  const main = kind === 'profile'
    // centre, not 'attention': the upload sheet shows you the crop before you commit to
    // it, and it can only promise that if the rule is one a browser can reproduce.
    // Smart-cropping was better on some photos and a surprise on others.
    ? base.resize(256, 256, { fit: 'cover', position: 'centre' })
    : base.resize({ width: 1280, withoutEnlargement: true })
  const buffer = await main.jpeg({ quality: 82 }).toBuffer()
  const thumb = await sharp(buffer).resize({ width: 320, withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer()
  return { buffer, thumb, ext: 'jpg' }
}
